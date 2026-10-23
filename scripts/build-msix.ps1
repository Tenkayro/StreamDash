param(
  [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$tauri = Join-Path $projectRoot 'node_modules\.bin\tauri.cmd'
$packageJsonPath = Join-Path $projectRoot 'package.json'
$storeConfigPath = Join-Path $projectRoot 'src-tauri\msix\store.json'
$releaseDirectory = Join-Path $projectRoot 'src-tauri\target\release'
$executablePath = Join-Path $releaseDirectory 'streamdash.exe'
$bundleDirectory = Join-Path $releaseDirectory 'bundle\msix'
$packageDirectory = Join-Path $bundleDirectory 'package'
$assetsDirectory = Join-Path $packageDirectory 'Assets'
$outputPath = Join-Path $bundleDirectory 'StreamDash-Store.msix'
$iconDirectory = Join-Path $projectRoot 'src-tauri\icons'

if ($env:OS -ne 'Windows_NT') {
  throw 'The StreamDash MSIX package must be built on Windows.'
}

$packageJson = Get-Content -Raw -LiteralPath $packageJsonPath | ConvertFrom-Json
$storeConfig = Get-Content -Raw -LiteralPath $storeConfigPath | ConvertFrom-Json
$version = '{0}.0' -f $packageJson.version

$identityName = if ($env:MSIX_IDENTITY_NAME) { $env:MSIX_IDENTITY_NAME } else { $storeConfig.identityName }
$publisher = if ($env:MSIX_PUBLISHER) { $env:MSIX_PUBLISHER } else { $storeConfig.publisher }
$publisherDisplayName = if ($env:MSIX_PUBLISHER_DISPLAY_NAME) { $env:MSIX_PUBLISHER_DISPLAY_NAME } else { $storeConfig.publisherDisplayName }
$displayName = if ($env:MSIX_DISPLAY_NAME) { $env:MSIX_DISPLAY_NAME } else { $storeConfig.displayName }
$description = if ($env:MSIX_DESCRIPTION) { $env:MSIX_DESCRIPTION } else { $storeConfig.description }

function ConvertTo-XmlText([string]$Value) {
  return [System.Security.SecurityElement]::Escape($Value)
}

function Find-MakeAppx {
  $command = Get-Command 'makeappx.exe' -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }

  $sdkBin = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\bin'
  if (-not (Test-Path -LiteralPath $sdkBin)) {
    throw 'MakeAppx.exe was not found. Install the Windows 10/11 SDK.'
  }

  $candidate = Get-ChildItem -LiteralPath $sdkBin -Directory |
    Where-Object { $_.Name -as [version] } |
    Sort-Object { [version]$_.Name } -Descending |
    ForEach-Object { Join-Path $_.FullName 'x64\makeappx.exe' } |
    Where-Object { Test-Path -LiteralPath $_ } |
    Select-Object -First 1

  if (-not $candidate) {
    throw 'MakeAppx.exe was not found. Install the Windows 10/11 SDK.'
  }
  return $candidate
}

Push-Location $projectRoot
try {
  if (-not $SkipBuild) {
    & $tauri build --no-bundle
    if ($LASTEXITCODE -ne 0) { throw "Tauri build failed with exit code $LASTEXITCODE." }
  }

  if (-not (Test-Path -LiteralPath $executablePath)) {
    throw "Release executable was not found: $executablePath"
  }

  if (Test-Path -LiteralPath $packageDirectory) {
    Remove-Item -LiteralPath $packageDirectory -Recurse -Force
  }
  New-Item -ItemType Directory -Path $assetsDirectory -Force | Out-Null

  Copy-Item -LiteralPath $executablePath -Destination (Join-Path $packageDirectory 'StreamDash.exe')
  Copy-Item -LiteralPath (Join-Path $iconDirectory 'StoreLogo.png') -Destination $assetsDirectory
  Copy-Item -LiteralPath (Join-Path $iconDirectory 'Square44x44Logo.png') -Destination $assetsDirectory
  Copy-Item -LiteralPath (Join-Path $iconDirectory 'Square150x150Logo.png') -Destination $assetsDirectory

  $manifest = @"
<?xml version="1.0" encoding="utf-8"?>
<Package
  xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
  xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
  xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities"
  IgnorableNamespaces="uap rescap">
  <Identity Name="$(ConvertTo-XmlText $identityName)" Publisher="$(ConvertTo-XmlText $publisher)" Version="$version" ProcessorArchitecture="x64" />
  <Properties>
    <DisplayName>$(ConvertTo-XmlText $displayName)</DisplayName>
    <PublisherDisplayName>$(ConvertTo-XmlText $publisherDisplayName)</PublisherDisplayName>
    <Description>$(ConvertTo-XmlText $description)</Description>
    <Logo>Assets\StoreLogo.png</Logo>
  </Properties>
  <Resources>
    <Resource Language="en-US" />
  </Resources>
  <Dependencies>
    <TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.17763.0" MaxVersionTested="10.0.26100.0" />
  </Dependencies>
  <Applications>
    <Application Id="StreamDash" Executable="StreamDash.exe" EntryPoint="Windows.FullTrustApplication">
      <uap:VisualElements
        DisplayName="$(ConvertTo-XmlText $displayName)"
        Description="$(ConvertTo-XmlText $description)"
        BackgroundColor="transparent"
        Square44x44Logo="Assets\Square44x44Logo.png"
        Square150x150Logo="Assets\Square150x150Logo.png" />
    </Application>
  </Applications>
  <Capabilities>
    <Capability Name="internetClient" />
    <rescap:Capability Name="runFullTrust" />
  </Capabilities>
</Package>
"@
  Set-Content -LiteralPath (Join-Path $packageDirectory 'AppxManifest.xml') -Value $manifest -Encoding utf8

  $makeAppx = Find-MakeAppx
  New-Item -ItemType Directory -Path $bundleDirectory -Force | Out-Null
  & $makeAppx pack /o /h SHA256 /d $packageDirectory /p $outputPath
  if ($LASTEXITCODE -ne 0) { throw "MSIX packaging failed with exit code $LASTEXITCODE." }
  if (-not (Test-Path -LiteralPath $outputPath)) { throw "Expected MSIX was not created: $outputPath" }

  Write-Host "MSIX created: $outputPath"
  Write-Host 'Store packages are intentionally left unsigned; Microsoft signs them after certification.'
} finally {
  Pop-Location
}
