#Requires -Version 7.0

[CmdletBinding()]
param(
  [ValidateNotNullOrEmpty()]
  [string]$VaultPath = 'D:\my-notes',

  [switch]$InstallDependencies
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Copy-VerifiedFile {
  param([string]$SourcePath, [string]$DestinationPath)

  [System.IO.Directory]::CreateDirectory((Split-Path -Path $DestinationPath -Parent)) | Out-Null
  Copy-Item -LiteralPath $SourcePath -Destination $DestinationPath -Force
  $sourceHash = (Get-FileHash -LiteralPath $SourcePath -Algorithm SHA256).Hash
  $destinationHash = (Get-FileHash -LiteralPath $DestinationPath -Algorithm SHA256).Hash
  if ($sourceHash -ne $destinationHash) {
    throw "The copied file failed verification: $DestinationPath"
  }
}

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$entryPath = Join-Path $projectRoot 'src/theme.scss'
$manifestPath = Join-Path $projectRoot 'manifest.json'
$metadataFiles = @('manifest.json', 'LICENSE', 'licenses/github-theme-MIT.txt', 'licenses/maple-theme-MIT.txt', 'licenses/maple-mono-OFL.txt')
$pluginSourceRoot = Join-Path $projectRoot 'plugins/claudian-note-actions'
# Copy main.js last so the entry point follows all of its supporting files.
$pluginFiles = @('manifest.json', 'note-inserter.js', 'code-actions.js', 'composer-actions.js', 'styles.css', 'utils/code-block.js', 'main.js')

foreach ($relativePath in @('src/theme.scss', 'package.json') + $metadataFiles) {
  $sourcePath = Join-Path $projectRoot $relativePath
  if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
    throw "Required project file is missing: $sourcePath"
  }
}

foreach ($relativePath in $pluginFiles) {
  $sourcePath = Join-Path $pluginSourceRoot $relativePath
  if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
    throw "Required plugin file is missing: $sourcePath"
  }
}
$pluginManifest = Get-Content -LiteralPath (Join-Path $pluginSourceRoot 'manifest.json') -Raw | ConvertFrom-Json
# The plugin ID is stable; author metadata may change between releases.
if ($pluginManifest.id -cne 'claudian-note-actions') {
  throw 'Unexpected companion plugin manifest. No files were deployed.'
}

$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if ($manifest.name -cne 'Patchwork') {
  throw 'This script deploys only Patchwork. Check the theme manifest before continuing.'
}

if (-not [System.IO.Path]::IsPathFullyQualified($VaultPath)) {
  throw 'VaultPath must be an absolute path.'
}

$vaultRoot = [System.IO.Path]::GetFullPath($VaultPath)
$obsidianRoot = Join-Path $vaultRoot '.obsidian'
if (-not (Test-Path -LiteralPath $obsidianRoot -PathType Container)) {
  throw "The destination is not an initialized Obsidian vault: $vaultRoot"
}

$destinationRoot = Join-Path $obsidianRoot 'themes/Patchwork'
if (Test-Path -LiteralPath $destinationRoot) {
  if (-not (Test-Path -LiteralPath $destinationRoot -PathType Container)) {
    throw "The theme destination is not a directory: $destinationRoot"
  }

  $destinationManifestPath = Join-Path $destinationRoot 'manifest.json'
  if (-not (Test-Path -LiteralPath $destinationManifestPath -PathType Leaf)) {
    throw "Refusing to overwrite an existing folder without a theme manifest: $destinationRoot"
  }

  $destinationManifest = Get-Content -LiteralPath $destinationManifestPath -Raw | ConvertFrom-Json
  if ($destinationManifest.name -cne $manifest.name -or $destinationManifest.author -cne $manifest.author) {
    throw "Refusing to overwrite a different theme: $destinationRoot"
  }
}

$pluginDestinationRoot = Join-Path $obsidianRoot 'plugins/claudian-note-actions'
if (Test-Path -LiteralPath $pluginDestinationRoot) {
  if (-not (Test-Path -LiteralPath $pluginDestinationRoot -PathType Container)) {
    throw "The plugin destination is not a directory: $pluginDestinationRoot"
  }
  $pluginDestinationManifestPath = Join-Path $pluginDestinationRoot 'manifest.json'
  if (-not (Test-Path -LiteralPath $pluginDestinationManifestPath -PathType Leaf)) {
    throw "Refusing to overwrite a folder without a plugin manifest: $pluginDestinationRoot"
  }
  $installedPluginManifest = Get-Content -LiteralPath $pluginDestinationManifestPath -Raw | ConvertFrom-Json
  if ($installedPluginManifest.id -cne $pluginManifest.id) {
    throw "Refusing to overwrite a different plugin: $pluginDestinationRoot"
  }
}

$node = Get-Command node -CommandType Application -ErrorAction Stop
foreach ($relativePath in $pluginFiles | Where-Object { $_.EndsWith('.js') }) {
  & $node.Source --check (Join-Path $pluginSourceRoot $relativePath)
  if ($LASTEXITCODE -ne 0) {
    throw "Plugin syntax validation failed: $relativePath. No files were deployed."
  }
}
$package = Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json
$sassCli = Join-Path $projectRoot 'node_modules/sass/sass.js'
$sassManifestPath = Join-Path $projectRoot 'node_modules/sass/package.json'
$sassAvailable = (Test-Path -LiteralPath $sassCli -PathType Leaf) -and
  (Test-Path -LiteralPath $sassManifestPath -PathType Leaf)

if ($sassAvailable) {
  $installedSass = Get-Content -LiteralPath $sassManifestPath -Raw | ConvertFrom-Json
  $sassAvailable = $installedSass.version -ceq $package.devDependencies.sass
}

if (-not $sassAvailable) {
  if (-not $InstallDependencies) {
    throw 'The required local Sass dependency is missing. Run this script again with -InstallDependencies.'
  }

  $npm = Get-Command npm.cmd -CommandType Application -ErrorAction Stop
  $installCommand = if (Test-Path -LiteralPath (Join-Path $projectRoot 'package-lock.json')) { 'ci' } else { 'install' }
  Write-Host "Installing project-local dependencies with npm $installCommand..."
  & $npm.Source --prefix $projectRoot $installCommand --include=dev --ignore-scripts --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) {
    throw "Dependency installation failed with exit code $LASTEXITCODE. No theme was deployed."
  }

  if (-not (Test-Path -LiteralPath $sassCli -PathType Leaf)) {
    throw 'Sass is still unavailable after dependency installation. No theme was deployed.'
  }
}

$buildRoot = Join-Path $projectRoot 'dist/Patchwork'
[System.IO.Directory]::CreateDirectory($buildRoot) | Out-Null
$cssOutput = Join-Path $buildRoot 'theme.css'

Write-Host 'Compiling src/theme.scss...'
& $node.Source $sassCli --style=expanded --no-source-map --no-error-css $entryPath $cssOutput
if ($LASTEXITCODE -ne 0) {
  throw "Sass compilation failed with exit code $LASTEXITCODE. The installed theme was not changed."
}

if (-not (Test-Path -LiteralPath $cssOutput -PathType Leaf) -or (Get-Item -LiteralPath $cssOutput).Length -eq 0) {
  throw 'The compiled stylesheet is missing or empty. No theme was deployed.'
}

if (-not (Select-String -LiteralPath $cssOutput -Pattern '/\*\s*@settings' -Quiet)) {
  throw 'The Style Settings block is missing from the compiled stylesheet. No theme was deployed.'
}

foreach ($relativePath in $metadataFiles) {
  $outputPath = Join-Path $buildRoot $relativePath
  Copy-VerifiedFile -SourcePath (Join-Path $projectRoot $relativePath) -DestinationPath $outputPath
}

$pluginBuildRoot = Join-Path $projectRoot 'dist/claudian-note-actions'
foreach ($relativePath in $pluginFiles) {
  Copy-VerifiedFile -SourcePath (Join-Path $pluginSourceRoot $relativePath) -DestinationPath (Join-Path $pluginBuildRoot $relativePath)
}

# Deploy only after both packages are ready. Preserve settings and plugin data.
$packages = @(
  @{ SourceRoot = $buildRoot; DestinationRoot = $destinationRoot; Files = $metadataFiles + @('theme.css') },
  @{ SourceRoot = $pluginBuildRoot; DestinationRoot = $pluginDestinationRoot; Files = $pluginFiles }
)
foreach ($artifact in $packages) {
  foreach ($relativePath in $artifact.Files) {
    Copy-VerifiedFile -SourcePath (Join-Path $artifact.SourceRoot $relativePath) -DestinationPath (Join-Path $artifact.DestinationRoot $relativePath)
  }
}

Write-Host "Theme package: $buildRoot"
Write-Host "Plugin package: $pluginBuildRoot"
Write-Host "Theme installed: $destinationRoot"
Write-Host "Plugin installed: $pluginDestinationRoot"
Write-Host 'Select Patchwork in Obsidian Settings > Appearance on first use.'
Write-Host 'Enable Claudian Note Actions in Community plugins on first use; disable and re-enable it after updates.'
Write-Host 'The script does not switch the active theme, enable plugins, or modify vault settings.'
