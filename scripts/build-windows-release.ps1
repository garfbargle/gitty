$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

Write-Host "Building Windows release bundles (NSIS + MSI)..."
npm run tauri build -- --bundles nsis,msi

$Version = (Get-Content "$Root\src-tauri\tauri.conf.json" | ConvertFrom-Json).version
$BundleRoot = "$Root\src-tauri\target\release\bundle"

Write-Host ""
Write-Host "Build finished."
Write-Host "  NSIS: $BundleRoot\nsis\Gitty_${Version}_x64-setup.exe"
Write-Host "  MSI:  $BundleRoot\msi\Gitty_${Version}_x64_en-US.msi"
