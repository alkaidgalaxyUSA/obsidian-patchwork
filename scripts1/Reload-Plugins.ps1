#Requires -Version 7.0
<#
.SYNOPSIS
Build, install and reload only the named Patchwork plugins.
.EXAMPLE
pwsh -NoProfile -File scripts/Reload-Plugins.ps1 -Plugin project
.EXAMPLE
pwsh -NoProfile -File scripts/Reload-Plugins.ps1 -Plugin 'borders,git' -WhatIf
#>
[CmdletBinding(SupportsShouldProcess)]
param(
  [Parameter(Mandatory)][ValidateNotNullOrEmpty()][string[]]$Plugin,
  [string]$VaultPath = (Import-PowerShellDataFile -LiteralPath (Join-Path $PSScriptRoot 'Deployment.psd1')).VaultPath,
  [string]$ObsidianCliPath = (Import-PowerShellDataFile -LiteralPath (Join-Path $PSScriptRoot 'Deployment.psd1')).ObsidianCliPath
)

$ErrorActionPreference = 'Stop'
$requestedPlugins = $Plugin
$deploymentOptions = @{ VaultPath = $VaultPath; ObsidianCliPath = $ObsidianCliPath }
. (Join-Path $PSScriptRoot 'Install.ps1')
Invoke-PatchworkPlugins -Names $requestedPlugins -Options $deploymentOptions -WhatIf:$WhatIfPreference
