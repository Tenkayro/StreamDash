param(
  [string]$ConfigPath,
  [string]$OutputName = 'StreamDash-Setup.msi'
)

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$tauri = Join-Path $projectRoot 'node_modules\.bin\tauri.cmd'
$bundleDirectory = Join-Path $projectRoot 'src-tauri\target\release\bundle\msi'
$finalMsi = Join-Path $bundleDirectory $OutputName
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
  $buildStarted = Get-Date
  $arguments = @('build', '--bundles', 'msi')
  if ($ConfigPath) { $arguments += @('--config', $ConfigPath) }
  & $tauri @arguments
  if ($LASTEXITCODE -ne 0) { throw "Tauri MSI build failed with exit code $LASTEXITCODE." }
  $generated = @(
    Get-ChildItem -LiteralPath $bundleDirectory -Filter '*.msi' -File |
      Where-Object { $_.LastWriteTime -ge $buildStarted -and $_.FullName -ne $finalMsi }
  )
  if ($generated.Count -ne 1) {
    throw "Expected exactly one newly generated MSI, found $($generated.Count)."
  }
  $generatedMsi = $generated[0].FullName
  $generatedSignature = "$generatedMsi.sig"
  if (-not (Test-Path -LiteralPath $generatedSignature)) { throw "Expected updater signature was not created: $generatedSignature" }
  Move-Item -LiteralPath $generatedMsi -Destination $finalMsi -Force
  Move-Item -LiteralPath $generatedSignature -Destination $finalSignature -Force
  Write-Host "MSI created: $finalMsi"
  Write-Host "Updater signature created: $finalSignature"
} finally {
  Pop-Location
}
