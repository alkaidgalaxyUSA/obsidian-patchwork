#Requires -Version 7.0
# Build, install and reload all plugins sequentially, or an explicit selection.
[CmdletBinding(SupportsShouldProcess)]
param(
  [string[]]$Plugin,
  [switch]$PluginsOnly,
  [switch]$ThemeOnly,
  [switch]$SkipReload,
  [switch]$MigrateModules,
  [string]$VaultPath = (Import-PowerShellDataFile -LiteralPath (Join-Path $PSScriptRoot 'Deployment.psd1')).VaultPath,
  [string]$ObsidianCliPath = (Import-PowerShellDataFile -LiteralPath (Join-Path $PSScriptRoot 'Deployment.psd1')).ObsidianCliPath
)

$ErrorActionPreference = 'Stop'
$installer = Join-Path $PSScriptRoot 'Install.ps1'
. $installer @PSBoundParameters
if ($MyInvocation.InvocationName -eq '.') { return }
if ($MigrateModules) { throw 'Migration is not part of the plugin build/install workflow.' }
if ($ThemeOnly -and ($PluginsOnly -or $Plugin)) { throw '-ThemeOnly cannot be combined with plugin selection.' }
$options = @{ VaultPath = $VaultPath; ObsidianCliPath = $ObsidianCliPath; SkipReload = $SkipReload }
if ($ThemeOnly) {
  if ($PSCmdlet.ShouldProcess($VaultPath, 'Build and install theme only')) { & $installer @options -ThemeOnly }
  return
}
$targets = if ($Plugin) { $Plugin } else { @('borders', 'project', 'content', 'git', 'terminal', 'claudian', 'code-editor') }
Invoke-PatchworkPlugins -Names $targets -Options $options -WhatIf:$WhatIfPreference
