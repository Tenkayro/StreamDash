$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$tauri = Join-Path $projectRoot 'node_modules\.bin\tauri.cmd'
$packageJson = Get-Content -Raw -LiteralPath (Join-Path $projectRoot 'package.json') | ConvertFrom-Json
$bundleDirectory = Join-Path $projectRoot 'src-tauri\target\release\bundle\msi'
$generatedMsi = Join-Path $bundleDirectory ("StreamDash_{0}_x64_en-US.msi" -f $packageJson.version)
$finalMsi = Join-Path $bundleDirectory 'StreamDash-Setup.msi'
$generatedSignature = "$generatedMsi.sig"
$finalSignature = "$finalMsi.sig"
$defaultSigningKey = Join-Path $env:USERPROFILE '.tauri\streamdash-updater.key'

if (-not $env:TAURI_SIGNING_PRIVATE_KEY) {
  if (-not (Test-Path -LiteralPath $defaultSigningKey)) {
    throw "Updater signing key not found. Expected: $defaultSigningKey"
  }
  $env:TAURI_SIGNING_PRIVATE_KEY = $defaultSigningKey
}

Push-Location $projectRoot
try {
  & $tauri build --bundles msi
  if ($LASTEXITCODE -ne 0) { throw "Tauri MSI build failed with exit code $LASTEXITCODE." }
  if (-not (Test-Path -LiteralPath $generatedMsi)) { throw "Expected MSI was not created: $generatedMsi" }
  if (-not (Test-Path -LiteralPath $generatedSignature)) { throw "Expected updater signature was not created: $generatedSignature" }
  Move-Item -LiteralPath $generatedMsi -Destination $finalMsi -Force
  Move-Item -LiteralPath $generatedSignature -Destination $finalSignature -Force
  Write-Host "MSI created: $finalMsi"
  Write-Host "Updater signature created: $finalSignature"
} finally {
  Pop-Location
}
