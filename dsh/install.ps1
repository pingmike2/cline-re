# Installs the dsh-cline bundle row into the current DSH profile without touching the network.
# Usage:  pwsh -File dsh\install.ps1            (install)
#         pwsh -File dsh\install.ps1 -Remove    (uninstall)
param([switch]$Remove)

$ErrorActionPreference = "Stop"
$pluginDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$home_ = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE ".dsh" }
$profileName = if ($env:DSH_PROFILE) { $env:DSH_PROFILE } else { "desktop" }
$profileDir = Join-Path $home_ ("profiles\" + $profileName)
$manifestPath = Join-Path $profileDir "package.json"
$linkPath = Join-Path $profileDir "node_modules\dsh-cline"

if (-not (Test-Path $manifestPath)) { throw "profile manifest not found: $manifestPath" }
$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json

if ($Remove) {
	$manifest.dependencies.PSObject.Properties.Remove("dsh-cline")
	$manifest.dsh.profile.bundles = @($manifest.dsh.profile.bundles | Where-Object { $_ -ne "dsh-cline" })
	if (Test-Path $linkPath) { (Get-Item $linkPath).Delete() }
	[IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 20), (New-Object System.Text.UTF8Encoding($false)))
	Write-Host "dsh-cline removed from $manifestPath. Restart DSH."
	exit 0
}

$backup = "$manifestPath.dsh-cline.bak"
if (-not (Test-Path $backup)) { Copy-Item $manifestPath $backup }

if (-not $manifest.dependencies) { $manifest | Add-Member -NotePropertyName dependencies -NotePropertyValue ([pscustomobject]@{}) }
$manifest.dependencies | Add-Member -NotePropertyName "dsh-cline" -NotePropertyValue ("link:" + ($pluginDir -replace '\\','/')) -Force
if ($manifest.dsh.profile.bundles -notcontains "dsh-cline") {
	$manifest.dsh.profile.bundles = @($manifest.dsh.profile.bundles) + "dsh-cline"
}
[IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 20), (New-Object System.Text.UTF8Encoding($false)))

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $linkPath) | Out-Null
if (Test-Path $linkPath) { (Get-Item $linkPath).Delete() }
New-Item -ItemType Junction -Path $linkPath -Target $pluginDir | Out-Null

Write-Host "dsh-cline -> $pluginDir"
Write-Host "profile:  $manifestPath (backup: $backup)"
Write-Host "key file: $(Join-Path $home_ 'cline.json')   <- put {""apiKey"":""...""} here"
Write-Host "Restart DSH to load the bundle row."