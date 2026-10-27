#Requires -Version 7.0
# Compile, package, install and reload in one command.
# Dot-sourcing loads helpers without changing files or running a build.
[CmdletBinding()]
param(
  [string]$VaultPath = 'D:\my-notes',
  [string[]]$Plugin,
  [switch]$PluginsOnly,
  [switch]$ThemeOnly,
  [switch]$SkipReload,
  [string]$ObsidianCliPath
)

function Get-PatchworkPackages {
  param([string]$ProjectRoot)
  $themeRoot = Join-Path $ProjectRoot 'themes'
  if (Test-Path -LiteralPath $themeRoot -PathType Container) {
    foreach ($directory in Get-ChildItem -LiteralPath $themeRoot -Directory | Sort-Object Name) {
      $manifestPath = Join-Path $directory.FullName 'manifest.json'
      if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw "Theme manifest missing: $manifestPath" }
      $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
      $id = $manifest.name
      if ($id -cnotmatch '^[A-Za-z0-9][A-Za-z0-9-]*$') { throw "Unsafe theme ID: $id" }
      $metadataPath = Join-Path $directory.FullName 'package.psd1'
      $metadata = if (Test-Path -LiteralPath $metadataPath) { Import-PowerShellDataFile -LiteralPath $metadataPath } else { @{} }
      $styleEntry = Join-Path $directory.FullName 'src/theme.scss'
      if (-not (Test-Path -LiteralPath $styleEntry)) { throw "Theme entry point missing: $id" }
      [pscustomobject]@{
        Id = $id; Kind = 'themes'; SourceRoot = $directory.FullName; SourceDirectory = $directory.FullName
        Manifest = $manifest; Files = @('manifest.json'); StyleEntry = $styleEntry; StyleOutput = 'theme.css'
        ObsoleteFiles = @($metadata['ObsoleteFiles'] | Where-Object { $_ }); Bundled = $false
      }
    }
  }
  if (Test-Path -LiteralPath (Join-Path $ProjectRoot 'plugins') -PathType Container) {
    Get-PatchworkPluginPackages -ProjectRoot $ProjectRoot
  }
}

function Get-PatchworkPluginPackages {
  param([string]$ProjectRoot)
  $parent = Join-Path $ProjectRoot 'plugins'
  $config = Get-Content -LiteralPath (Join-Path $parent 'manifest.json') -Raw | ConvertFrom-Json -AsHashtable
  $project = Get-Content -LiteralPath (Join-Path $parent 'package.json') -Raw | ConvertFrom-Json
  if ($project.version -cnotmatch '^\d+\.\d+\.\d+$') { throw 'Invalid shared plugin version.' }
  $ids = @()
  foreach ($name in $config.plugins.Keys) {
    $definition = $config.plugins[$name]
    $manifest = $definition.manifest
    $id = $manifest.id
    if ($name -cnotmatch '^[a-z0-9-]+$' -or $id -cnotmatch '^[a-z0-9-]+$' -or $id -in $ids) {
      throw "Invalid or duplicate plugin target: $name"
    }
    if ($manifest.Contains('version')) { throw 'Set the shared version only in plugins/package.json.' }
    $ids += $id
    $manifest.version = $project.version
    $source = Get-PatchworkChildPath -Parent $parent -RelativePath $name
    if (-not (Test-Path -LiteralPath $source -PathType Container)) { throw "Plugin source missing: $source" }
    $output = Get-PatchworkChildPath -Parent $parent -RelativePath "dist/$id"
    $files = @($config.runtimeFiles)
    foreach ($required in @('main.js', 'manifest.json', 'styles.css', 'LICENSE')) {
      if ($required -notin $files) { throw "Plugin runtime file missing from shared configuration: $required" }
    }
    [pscustomobject]@{
      Id = $id; Kind = 'plugins'; SourceRoot = $output; SourceDirectory = $source
      Manifest = [pscustomobject]$manifest; Files = $files
      StyleEntry = $null; StyleOutput = 'styles.css'
      ObsoleteFiles = @(); UpstreamPlugins = @(); Bundled = $true
    }
  }
}

function Get-PatchworkChildPath {
  param([string]$Parent, [string]$RelativePath)
  $base = [IO.Path]::TrimEndingDirectorySeparator([IO.Path]::GetFullPath($Parent))
  $target = [IO.Path]::GetFullPath((Join-Path $base $RelativePath))
  if (-not $target.StartsWith($base + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Path escapes its intended directory: $target"
  }
  # Reject junctions and symlinks before walking or deleting a package tree.
  $cursor = $target
  while ($cursor -and $cursor.Length -ge $base.Length) {
    if (Test-Path -LiteralPath $cursor) {
      $item = Get-Item -LiteralPath $cursor -Force
      if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Linked paths are not supported: $cursor" }
    }
    $cursor = Split-Path -Path $cursor -Parent
  }
  return $target
}

function Assert-PatchworkImports {
  param($Package)
  if ($Package.Bundled -and $Package.Kind -eq 'plugins') {
    $built = Get-Content -LiteralPath (Join-Path $Package.SourceRoot 'manifest.json') -Raw | ConvertFrom-Json -AsHashtable
    foreach ($property in $Package.Manifest.PSObject.Properties) {
      if (-not $built.Contains($property.Name) -or $built[$property.Name] -cne $property.Value) {
        throw "Stale plugin manifest: $($Package.Id). Run the unified npm build before deployment."
      }
    }
  }
  $sources = if ($Package.Bundled) {
    $Package.Files | ForEach-Object { Get-Item -LiteralPath (Get-PatchworkChildPath -Parent $Package.SourceRoot -RelativePath $_) }
  } else { Get-ChildItem -LiteralPath $Package.SourceRoot -Recurse -File }
  foreach ($file in $sources | Where-Object { $_.Extension -in @('.js', '.scss', '.css') }) {
    $text = Get-Content -LiteralPath $file.FullName -Raw
    $pattern = if ($file.Extension -eq '.js') { '(?:require|localRequire)\(["''](\.[^"'']+)["'']\)' } else { '@(?:use|forward|import)\s+["'']([^"'']+)["'']' }
    foreach ($match in [regex]::Matches($text, $pattern)) {
      $reference = $match.Groups[1].Value
      if ($reference.StartsWith('sass:')) { continue }
      $target = [IO.Path]::GetFullPath((Join-Path $file.DirectoryName $reference))
      $relative = [IO.Path]::GetRelativePath($Package.SourceRoot, $target)
      Get-PatchworkChildPath -Parent $Package.SourceRoot -RelativePath $relative | Out-Null
      if (-not [IO.Path]::HasExtension($target)) { $target += $file.Extension }
      if (-not (Test-Path -LiteralPath $target -PathType Leaf)) { throw "Missing local import in $($file.FullName): $reference" }
    }
  }
}

function Remove-PatchworkDirectory {
  param([string]$Parent, [string]$RelativePath)
  $target = Get-PatchworkChildPath -Parent $Parent -RelativePath $RelativePath
  if (-not (Test-Path -LiteralPath $target)) { return }
  foreach ($item in Get-ChildItem -LiteralPath $target -Recurse -Force) {
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Linked paths are not supported: $($item.FullName)" }
  }
  Remove-Item -LiteralPath $target -Recurse -Force
}

function Copy-VerifiedFile {
  param([string]$SourcePath, [string]$DestinationPath)
  [IO.Directory]::CreateDirectory((Split-Path -Path $DestinationPath -Parent)) | Out-Null
  Copy-Item -LiteralPath $SourcePath -Destination $DestinationPath -Force
  if ((Get-FileHash -LiteralPath $SourcePath).Hash -ne (Get-FileHash -LiteralPath $DestinationPath).Hash) {
    throw "The copied file failed verification: $DestinationPath"
  }
}

function Embed-PatchworkSvgIcons {
  param([string]$CssPath, [string]$IconRoot)
  $css = [IO.File]::ReadAllText($CssPath)
  $pattern = 'url\(\s*["''](?:\.\./)+icons/(?<name>[a-z0-9][a-z0-9-]*\.svg)["'']\s*\)'
  $result = [regex]::Replace($css, $pattern, [Text.RegularExpressions.MatchEvaluator]{
    param($match)
    $path = Get-PatchworkChildPath -Parent $IconRoot -RelativePath $match.Groups['name'].Value
    $svg = [IO.File]::ReadAllText($path)
    $settings = [Xml.XmlReaderSettings]::new()
    $settings.DtdProcessing = [Xml.DtdProcessing]::Prohibit
    $settings.XmlResolver = $null
    $input = [IO.StringReader]::new($svg)
    $reader = [Xml.XmlReader]::Create($input, $settings)
    try {
      $document = [Xml.XmlDocument]::new()
      $document.XmlResolver = $null
      $document.Load($reader)
      if ($document.DocumentElement.LocalName -ne 'svg' -or $document.DocumentElement.NamespaceURI -ne 'http://www.w3.org/2000/svg') {
        throw "Invalid SVG icon: $path"
      }
    } finally {
      $reader.Dispose()
      $input.Dispose()
    }
    return 'url("data:image/svg+xml,' + [Uri]::EscapeDataString($svg.Trim()) + '")'
  })
  [IO.File]::WriteAllText($CssPath, $result, [Text.UTF8Encoding]::new($false))
}

function Resolve-ObsidianCli {
  param([string]$VaultRoot, [string]$CliPath)

  if (-not $CliPath) {
    $command = Get-Command Obsidian.com -CommandType Application -ErrorAction SilentlyContinue
    $CliPath = if ($command) { $command.Source } else {
      Join-Path $env:LOCALAPPDATA 'Programs/Obsidian/Obsidian.com'
    }
  }
  if (-not (Test-Path -LiteralPath $CliPath -PathType Leaf)) {
    throw 'Obsidian CLI was not found. Pass -ObsidianCliPath with the full path to Obsidian.com, or use -SkipReload for manual deployment.'
  }

  $registryPath = Join-Path $env:APPDATA 'obsidian/obsidian.json'
  if (-not (Test-Path -LiteralPath $registryPath -PathType Leaf)) {
    throw 'Obsidian vault registration was not found. Open the target vault in Obsidian first, or use -SkipReload.'
  }
  $registry = Get-Content -LiteralPath $registryPath -Raw | ConvertFrom-Json -AsHashtable
  $vaultId = $null
  foreach ($entry in $registry.vaults.GetEnumerator()) {
    $registeredPath = [System.IO.Path]::TrimEndingDirectorySeparator([System.IO.Path]::GetFullPath($entry.Value.path))
    if ($registeredPath -ieq [System.IO.Path]::TrimEndingDirectorySeparator($VaultRoot)) {
      $vaultId = $entry.Key
      break
    }
  }
  if (-not $vaultId) {
    throw "The vault is not registered in Obsidian: $VaultRoot. Open it first, or use -SkipReload."
  }

  return @{
    Path = (Resolve-Path -LiteralPath $CliPath).ProviderPath
    VaultId = $vaultId
    VaultRoot = $VaultRoot
  }
}

function Invoke-ObsidianCli {
  param(
    [hashtable]$Cli,
    [string]$Command,
    [string[]]$Parameters = @(),
    [string]$ExpectedPattern
  )

  $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = $Cli.Path
  $startInfo.WorkingDirectory = $Cli.VaultRoot
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  # ArgumentList preserves paths and JavaScript without shell interpolation.
  $startInfo.ArgumentList.Add("vault=$($Cli.VaultId)")
  $startInfo.ArgumentList.Add($Command)
  foreach ($parameter in $Parameters) {
    $startInfo.ArgumentList.Add($parameter)
  }

  $process = [System.Diagnostics.Process]::new()
  $process.StartInfo = $startInfo
  try {
    if (-not $process.Start()) { throw 'Could not start Obsidian CLI.' }
    $stdout = $process.StandardOutput.ReadToEndAsync()
    $stderr = $process.StandardError.ReadToEndAsync()
    if (-not $process.WaitForExit(30000)) {
      $process.Kill()
      throw "Obsidian CLI timed out: $Command. Check Obsidian before retrying; the command may still be running in the app."
    }
    $output = $stdout.GetAwaiter().GetResult().Trim()
    $errorOutput = $stderr.GetAwaiter().GetResult().Trim()
    $details = (@($output, $errorOutput) | Where-Object { $_ }) -join "`n"
    if ($details -match 'Command line interface is not enabled') {
      throw 'Enable Command line interface in Obsidian Settings > General > Advanced, keep the target vault open, and rerun this script. Use -SkipReload only for manual deployment.'
    }
    if ($process.ExitCode -ne 0 -or $details -match '(?m)^(Error:|\[error\]|Failed to |Restricted:)' -or
      ($ExpectedPattern -and $output -notmatch $ExpectedPattern)) {
      throw "Obsidian CLI command failed: $Command (exit $($process.ExitCode)).`n$details"
    }
    return $output
  } finally {
    $process.Dispose()
  }
}

function Get-ObsidianEnabledPlugins {
  param([hashtable]$Cli)

  $output = Invoke-ObsidianCli -Cli $Cli -Command 'plugins:enabled' -Parameters @('filter=community', 'format=json')
  $plugins = ConvertFrom-Json -InputObject $output -ErrorAction Stop
  foreach ($plugin in $plugins) {
    if (-not $plugin.id) { throw 'Obsidian CLI returned an unexpected plugin list.' }
    $plugin.id
  }
}

function Get-PatchworkCli {
  param([string]$VaultRoot, [string]$CliPath)
  $cli = Resolve-ObsidianCli -VaultRoot $VaultRoot -CliPath $CliPath
  $connected = Invoke-ObsidianCli -Cli $cli -Command 'vault' -Parameters @('info=path')
  if (-not [IO.Path]::IsPathFullyQualified($connected) -or
    [IO.Path]::TrimEndingDirectorySeparator([IO.Path]::GetFullPath($connected)) -ine
    [IO.Path]::TrimEndingDirectorySeparator($VaultRoot)) { throw "Obsidian CLI connected to an unexpected vault: $connected" }
  $restricted = Invoke-ObsidianCli -Cli $cli -Command 'plugins:restrict' -ExpectedPattern '^(on|off)$'
  if ($restricted -eq 'on') { throw 'Enable community plugins in the target vault before deployment.' }
  return $cli
}

function Assert-PatchworkDestination {
  param($Package, [string]$Destination)
  if (-not (Test-Path -LiteralPath $Destination)) { return }
  $manifestPath = Join-Path $Destination 'manifest.json'
  if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    # Removal can leave settings and an ownership record for later reinstall/cleanup.
    $recordPath = Join-Path $Destination '.patchwork-files.json'
    if (Test-Path -LiteralPath $recordPath) {
      $record = Get-Content -LiteralPath $recordPath -Raw | ConvertFrom-Json
      if ($record.id -ceq $Package.Id) { return }
    }
    $otherFiles = @(Get-ChildItem -LiteralPath $Destination -Force | Where-Object { $_.Name -ne 'data.json' -or $_.PSIsContainer })
    if (-not $otherFiles.Count) { return }
    throw "Destination has no manifest: $Destination"
  }
  $installed = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  $same = if ($Package.Kind -eq 'themes') {
    $installed.name -ceq $Package.Id -and $installed.author -ceq $Package.Manifest.author
  } else { $installed.id -ceq $Package.Id -and $installed.author -ceq $Package.Manifest.author }
  if (-not $same) { throw "Refusing to overwrite another package: $Destination" }
}

function Remove-PatchworkObsoleteFiles {
  param([string]$Destination, [string[]]$PreviousFiles, [string[]]$CurrentFiles)
  foreach ($file in $PreviousFiles | Select-Object -Unique) {
    if ($file -in $CurrentFiles) { continue }
    if ($file -eq 'data.json') { throw 'Plugin data cannot be managed as a runtime file.' }
    $path = Get-PatchworkChildPath -Parent $Destination -RelativePath $file
    if (Test-Path -LiteralPath $path -PathType Leaf) { Remove-Item -LiteralPath $path -Force }
  }
  if (-not (Test-Path -LiteralPath $Destination)) { return }
  Get-ChildItem -LiteralPath $Destination -Directory -Recurse | Sort-Object { $_.FullName.Length } -Descending | ForEach-Object {
    if (-not (Get-ChildItem -LiteralPath $_.FullName -Force | Select-Object -First 1)) {
      $safe = Get-PatchworkChildPath -Parent $Destination -RelativePath ([IO.Path]::GetRelativePath($Destination, $_.FullName))
      Remove-Item -LiteralPath $safe -Force
    }
  }
}

function Invoke-PatchworkBuild {
  param([string]$ProjectRoot, [object[]]$Packages, [object[]]$AllPackages)
  $node = Get-Command node -CommandType Application -ErrorAction Stop
  if (@($packages | Where-Object Kind -eq 'plugins').Count) {
    & $node.Source (Join-Path $projectRoot 'plugins/scripts/build.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'Plugin compilation failed. Installed files were not changed.' }
  }
  $sassCli = Join-Path $projectRoot 'node_modules/sass/sass.js'
  if (@($packages | Where-Object StyleEntry).Count) {
    $project = Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json
    $sassManifestPath = Join-Path $projectRoot 'node_modules/sass/package.json'
    if (-not (Test-Path -LiteralPath $sassCli) -or -not (Test-Path -LiteralPath $sassManifestPath)) {
      throw 'Theme dependencies are missing. Run npm ci --ignore-scripts at the repository root.'
    }
    if ((Get-Content -LiteralPath $sassManifestPath -Raw | ConvertFrom-Json).version -cne $project.devDependencies.sass) {
      throw 'Pinned Sass does not match. Run npm ci --ignore-scripts at the repository root.'
    }
  }
  foreach ($package in $packages) {
    Assert-PatchworkImports -Package $package
    foreach ($file in $package.Files | Where-Object { $_.EndsWith('.js') }) {
      & $node.Source --check (Join-Path $package.SourceRoot $file)
      if ($LASTEXITCODE -ne 0) { throw "JavaScript syntax error in $($package.Id)/$file" }
    }
  }
  
  $distRoot = Join-Path $projectRoot 'dist'
  $buildRoot = Join-Path $distRoot 'obsidian-patchwork'
  $stageName = '.staging-' + [guid]::NewGuid().ToString('N')
  $stageRoot = Get-PatchworkChildPath -Parent $distRoot -RelativePath $stageName
  $licensePath = Join-Path $projectRoot 'LICENSE'
  $license = Get-Content -LiteralPath $licensePath -Raw
  try {
    foreach ($package in $packages) {
      $output = Get-PatchworkChildPath -Parent $stageRoot -RelativePath "$($package.Kind)/$($package.Id)"
      foreach ($file in $package.Files) {
        Copy-VerifiedFile -SourcePath (Join-Path $package.SourceRoot $file) -DestinationPath (Join-Path $output $file)
      }
      $runtimeFiles = @($package.Files)
      if ($package.StyleEntry) {
        Write-Host "Compiling $($package.Id) styles..."
        $cssOutput = Join-Path $output $package.StyleOutput
        & $node.Source $sassCli --style=expanded --no-source-map --no-error-css $package.StyleEntry $cssOutput
        if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $cssOutput) -or (Get-Item -LiteralPath $cssOutput).Length -eq 0) {
          throw "Stylesheet compilation failed: $($package.Id)"
        }
        if ($package.Kind -eq 'themes') {
          Embed-PatchworkSvgIcons -CssPath $cssOutput -IconRoot (Join-Path $projectRoot 'icons')
        }
        $runtimeFiles = @($runtimeFiles + $package.StyleOutput | Select-Object -Unique)
      }
      # One root LICENSE file; independently distributed packages also carry its notice in code.
      $noticeFile = Join-Path $output $(if ($package.Kind -eq 'themes') { 'theme.css' } else { 'main.js' })
      $content = Get-Content -LiteralPath $noticeFile -Raw
      Set-Content -LiteralPath $noticeFile -Value "/*!`n$license`n*/`n$content" -NoNewline -Encoding utf8
      @{ id = $package.Id; files = $runtimeFiles } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $output '.patchwork-files.json') -Encoding utf8
    }
    # Promote only fully prepared packages; unrelated package outputs are preserved.
    foreach ($package in $packages) {
      $relative = "$($package.Kind)/$($package.Id)"
      $target = Get-PatchworkChildPath -Parent $buildRoot -RelativePath $relative
      Remove-PatchworkDirectory -Parent $buildRoot -RelativePath $relative
      [IO.Directory]::CreateDirectory((Split-Path -Path $target -Parent)) | Out-Null
      Move-Item -LiteralPath (Join-Path $stageRoot $relative) -Destination $target
    }
    # Deleted sources must not survive as stale distributable packages.
    foreach ($kind in @('themes', 'plugins')) {
      $parent = Join-Path $buildRoot $kind
      if (-not (Test-Path -LiteralPath $parent)) { continue }
      $known = @($allPackages | Where-Object Kind -eq $kind | ForEach-Object Id)
      foreach ($directory in Get-ChildItem -LiteralPath $parent -Directory) {
        if ($directory.Name -notin $known -and (Test-Path -LiteralPath (Join-Path $directory.FullName '.patchwork-files.json'))) {
          Remove-PatchworkDirectory -Parent $parent -RelativePath $directory.Name
        }
      }
    }
    Copy-VerifiedFile -SourcePath $licensePath -DestinationPath (Join-Path $buildRoot 'LICENSE')
  } finally {
    Remove-PatchworkDirectory -Parent $distRoot -RelativePath $stageName
  }
  Write-Host "Packages ready: $buildRoot"
  Write-Host 'Build complete. Installing packages...'
}


if ($MyInvocation.InvocationName -eq '.') { return }
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($ThemeOnly -and ($PluginsOnly -or $Plugin)) { throw '-ThemeOnly cannot be combined with plugin selection.' }
if (-not [IO.Path]::IsPathFullyQualified($VaultPath)) { throw 'VaultPath must be absolute.' }
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$vaultRoot = [IO.Path]::GetFullPath($VaultPath)
$obsidianRoot = Join-Path $vaultRoot '.obsidian'
if (-not (Test-Path -LiteralPath $obsidianRoot -PathType Container)) { throw 'Vault is not initialized.' }
$allPackages = @(Get-PatchworkPackages -ProjectRoot $projectRoot)
$requested = @($Plugin | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ } | Select-Object -Unique)
foreach ($name in $requested) {
  $matches = @($allPackages | Where-Object { $_.Kind -eq 'plugins' -and ($_.Id -ceq $name -or (Split-Path -Path $_.SourceDirectory -Leaf) -ceq $name) })
  if ($matches.Count -ne 1) { throw "Unknown or ambiguous plugin: $name" }
}
$packages = @($allPackages | Where-Object {
  if ($ThemeOnly) { $_.Kind -eq 'themes' }
  elseif ($requested.Count) { $_.Kind -eq 'plugins' -and ($_.Id -in $requested -or (Split-Path -Path $_.SourceDirectory -Leaf) -in $requested) }
  elseif ($PluginsOnly) { $_.Kind -eq 'plugins' }
  else { $true }
})
if (-not $packages.Count) { throw 'No packages selected.' }
if (@($allPackages | Group-Object Kind, Id | Where-Object Count -gt 1).Count) { throw 'Duplicate package IDs.' }
Invoke-PatchworkBuild -ProjectRoot $projectRoot -Packages $packages -AllPackages $allPackages
$buildRoot = Join-Path $projectRoot 'dist/obsidian-patchwork'
$node = Get-Command node -CommandType Application -ErrorAction Stop

# Validate every selected artifact and destination before disabling any plugin.
foreach ($package in $packages) {
  $source = Get-PatchworkChildPath -Parent $buildRoot -RelativePath "$($package.Kind)/$($package.Id)"
  $recordPath = Join-Path $source '.patchwork-files.json'
  if (-not (Test-Path -LiteralPath $recordPath -PathType Leaf)) { throw "Package missing: $($package.Id). Run npm run build first." }
  $record = Get-Content -LiteralPath $recordPath -Raw | ConvertFrom-Json
  $expected = @($package.Files)
  if ($package.Kind -eq 'themes') { $expected += 'theme.css' }
  if ($record.id -cne $package.Id -or @(Compare-Object -ReferenceObject $expected -DifferenceObject @($record.files)).Count) {
    throw "Package file list does not match configuration: $($package.Id). Rebuild first."
  }
  foreach ($file in $record.files) {
    if ($file -eq 'data.json') { throw 'Plugin settings cannot be installed as runtime files.' }
    $path = Get-PatchworkChildPath -Parent $source -RelativePath $file
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Package file missing: $path" }
    if ($file.EndsWith('.js')) {
      & $node.Source --check $path
      if ($LASTEXITCODE -ne 0) { throw "JavaScript syntax error: $path" }
    }
  }
  $manifest = Get-Content -LiteralPath (Join-Path $source 'manifest.json') -Raw | ConvertFrom-Json -AsHashtable
  foreach ($property in $package.Manifest.PSObject.Properties) {
    if (-not $manifest.Contains($property.Name) -or $manifest[$property.Name] -cne $property.Value) {
      throw "Stale package manifest: $($package.Id). Rebuild first."
    }
  }
  $destination = Get-PatchworkChildPath -Parent $obsidianRoot -RelativePath "$($package.Kind)/$($package.Id)"
  Assert-PatchworkDestination -Package $package -Destination $destination
  foreach ($file in $record.files) { Get-PatchworkChildPath -Parent $destination -RelativePath $file | Out-Null }
  $oldRecordPath = Join-Path $destination '.patchwork-files.json'
  $oldFiles = @($package.ObsoleteFiles)
  if (Test-Path -LiteralPath $oldRecordPath) {
    $oldRecord = Get-Content -LiteralPath $oldRecordPath -Raw | ConvertFrom-Json
    if ($oldRecord.id -cne $package.Id) { throw "Unexpected ownership record: $destination" }
    $oldFiles += @($oldRecord.files)
  }
  foreach ($file in $oldFiles) {
    if ($file -eq 'data.json') { throw 'Plugin settings cannot be removed as obsolete files.' }
    Get-PatchworkChildPath -Parent $destination -RelativePath $file | Out-Null
  }
  $package.SourceRoot = $source
  $package.Files = @($record.files)
  $package.ObsoleteFiles = $oldFiles
  Write-Host "Validated: $($package.Kind)/$($package.Id)"
}

$cli = if ($SkipReload) { $null } else { Get-PatchworkCli -VaultRoot $vaultRoot -CliPath $ObsidianCliPath }
$enabled = if ($cli) { @(Get-ObsidianEnabledPlugins -Cli $cli) } else { @() }
foreach ($package in $packages | Where-Object Kind -eq 'plugins') {
  if ($cli -and $package.Id -in $enabled) {
    Invoke-ObsidianCli -Cli $cli -Command 'plugin:disable' -Parameters @("id=$($package.Id)", 'filter=community') -ExpectedPattern "(?m)^Disabled: $([regex]::Escape($package.Id))$" | Out-Null
  }
}
foreach ($package in $packages) {
  $destination = Get-PatchworkChildPath -Parent $obsidianRoot -RelativePath "$($package.Kind)/$($package.Id)"
  foreach ($file in $package.Files | Sort-Object { $_ -eq 'main.js' }) {
    Copy-VerifiedFile -SourcePath (Join-Path $package.SourceRoot $file) -DestinationPath (Get-PatchworkChildPath -Parent $destination -RelativePath $file)
  }
  Remove-PatchworkObsoleteFiles -Destination $destination -PreviousFiles $package.ObsoleteFiles -CurrentFiles $package.Files
  Copy-VerifiedFile -SourcePath (Join-Path $package.SourceRoot '.patchwork-files.json') -DestinationPath (Join-Path $destination '.patchwork-files.json')
  Write-Host "Installed: $destination"
}
if ($cli -and @($packages | Where-Object Kind -eq 'plugins').Count) {
  Invoke-ObsidianCli -Cli $cli -Command 'eval' -Parameters @('code=(async () => { await app.plugins.loadManifests(); return "patchwork-manifests-ready"; })()') -ExpectedPattern '(?m)^=> patchwork-manifests-ready$' | Out-Null
  foreach ($package in $packages | Where-Object Kind -eq 'plugins') {
    Invoke-ObsidianCli -Cli $cli -Command 'plugin:enable' -Parameters @("id=$($package.Id)", 'filter=community') -ExpectedPattern "(?m)^Enabled: $([regex]::Escape($package.Id))$" | Out-Null
    $idJson = ConvertTo-Json -InputObject $package.Id -Compress
    $code = '(() => { const id = ' + $idJson + '; if (!app.plugins.enabledPlugins.has(id) || !app.plugins.plugins[id]) throw new Error("Plugin did not load: " + id); return "plugin-ready"; })()'
    Invoke-ObsidianCli -Cli $cli -Command 'eval' -Parameters @("code=$code") -ExpectedPattern '(?m)^=> plugin-ready$' | Out-Null
    Write-Host "Enabled: $($package.Id)"
  }
}
if ($SkipReload) { Write-Host 'Automatic reload skipped. Enable the selected plugins manually.' }
Write-Host 'Build and installation complete. Unselected plugins, settings and notes were preserved.'

