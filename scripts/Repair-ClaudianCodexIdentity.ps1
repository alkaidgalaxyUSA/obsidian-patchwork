#Requires -Version 7.0
# Check and repair only Claudian's Codex client identity; never uninstall the plugin.
[CmdletBinding()]
param(
  [string]$VaultPath = (Import-PowerShellDataFile -LiteralPath (Join-Path $PSScriptRoot 'Deployment.psd1')).VaultPath,
  [ValidateSet('codex_cli_rs', 'codex_vscode')]
  [string]$ClientName = 'codex_cli_rs',
  [switch]$Reload,
  [string]$ObsidianCliPath = (Import-PowerShellDataFile -LiteralPath (Join-Path $PSScriptRoot 'Deployment.psd1')).ObsidianCliPath
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (-not [IO.Path]::IsPathRooted($VaultPath)) { throw 'VaultPath must be absolute.' }
$pluginRoot = [IO.Path]::GetFullPath((Join-Path $VaultPath '.obsidian/plugins'))
$installed = @(
  foreach ($id in @('realclaudian', 'claudian')) {
    $directory = [IO.Path]::GetFullPath((Join-Path $pluginRoot $id))
    $manifestPath = Join-Path $directory 'manifest.json'
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { continue }
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    if ($manifest.id -cne $id) { throw "Unexpected Claudian manifest: $manifestPath" }
    [pscustomobject]@{ Id = $id; Directory = $directory }
  }
)
if (-not $installed.Count) {
  Write-Host 'Claudian is not installed; client identity check skipped.'
  return
}
if ($installed.Count -ne 1) { throw 'Multiple Claudian installations found. Resolve the duplicate before patching.' }
$plugin = $installed[0]
$mainPath = Join-Path $plugin.Directory 'main.js'
# Refuse links anywhere in the target path before backing up or writing.
$cursor = $mainPath
while ($cursor) {
  if (Test-Path -LiteralPath $cursor) {
    $item = Get-Item -LiteralPath $cursor -Force
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Linked paths are not supported: $cursor" }
  }
  $cursor = Split-Path -Path $cursor -Parent
}
$original = [IO.File]::ReadAllText($mainPath)
$initializePattern = 'request\("initialize",\{clientInfo:(?<symbol>[\w$]+),capabilities:\{experimentalApi:!0\}\}\)'
$initializations = [regex]::Matches($original, $initializePattern)
if ($initializations.Count -ne 1) { throw 'Cannot uniquely locate Codex initialization. No files changed.' }
$symbol = [regex]::Escape($initializations[0].Groups['symbol'].Value)
$identityPattern = '(?<prefix>\b' + $symbol + '=Object\.freeze\(\{name:")(?<name>[^"]+)(?<suffix>",version:"[^"]+"\}\))'
$identities = [regex]::Matches($original, $identityPattern)
if ($identities.Count -ne 1) { throw 'Cannot uniquely locate the Codex client identity. No files changed.' }
$environmentPattern = 'return\{(?<fields>\.\.\.[\w$]+,\.\.\.[\w$]+,PATH:[\w$]+)(?:,CODEX_INTERNAL_ORIGINATOR_OVERRIDE:"(?<originator>[^"]+)")?\}'
$environments = [regex]::Matches($original, $environmentPattern)
if ($environments.Count -ne 1) { throw 'Cannot uniquely locate the Codex launch environment. No files changed.' }

$identity = $identities[0]
$environment = $environments[0]
$changed = $identity.Groups['name'].Value -cne $ClientName -or $environment.Groups['originator'].Value -cne $ClientName
if ($changed) {
  $updated = [regex]::Replace($original, $identityPattern, [Text.RegularExpressions.MatchEvaluator]{
    param($match)
    return $match.Groups['prefix'].Value + $ClientName + $match.Groups['suffix'].Value
  })
  $updated = [regex]::Replace($updated, $environmentPattern, [Text.RegularExpressions.MatchEvaluator]{
    param($match)
    return 'return{' + $match.Groups['fields'].Value + ',CODEX_INTERNAL_ORIGINATOR_OVERRIDE:"' + $ClientName + '"}'
  })
  $backupPath = $mainPath + '.before-codex-identity-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N') + '.bak'
  Copy-Item -LiteralPath $mainPath -Destination $backupPath -ErrorAction Stop
  try {
    [IO.File]::WriteAllText($mainPath, $updated, [Text.UTF8Encoding]::new($false))
    $written = [IO.File]::ReadAllText($mainPath)
    if ($written -cne $updated) { throw 'The saved plugin does not match the prepared patch.' }
  } catch {
    Copy-Item -LiteralPath $backupPath -Destination $mainPath -Force
    throw
  }
  Write-Host "Claudian Codex identity repaired: $ClientName"
  Write-Host "Backup: $backupPath"
} else {
  Write-Host "Claudian Codex identity is already correct: $ClientName"
}
if ($Reload) {
  . (Join-Path $PSScriptRoot 'Build-Install.ps1') -VaultPath $VaultPath -ObsidianCliPath $ObsidianCliPath
  $cli = Get-PatchworkCli -VaultRoot ([IO.Path]::GetFullPath($VaultPath)) -CliPath $ObsidianCliPath
  Restart-ClaudianPlugin -Cli $cli -PluginId $plugin.Id
} else {
  Write-Warning 'The identity check only verifies files on disk. Existing Codex processes can still use the old identity. Restart Obsidian, or rerun with -Reload, before retrying.'
}
[pscustomobject]@{ PluginId = $plugin.Id; Changed = $changed; ClientName = $ClientName; Path = $mainPath }
