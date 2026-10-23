param(
  [Parameter(Mandatory = $true)][string]$PosterBackground,
  [Parameter(Mandatory = $true)][string]$SquareBackground
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$projectRoot = Split-Path -Parent $PSScriptRoot
$outputDirectory = Join-Path $projectRoot 'store-assets\graphics'
$logoPath = Join-Path $projectRoot 'src-tauri\icons\streamdash-master.png'
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null

function New-Canvas([int]$Width, [int]$Height) {
  return [System.Drawing.Bitmap]::new($Width, $Height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
}

function New-Graphics([System.Drawing.Bitmap]$Canvas) {
  $graphics = [System.Drawing.Graphics]::FromImage($Canvas)
  $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceOver
  $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  return $graphics
}

function Add-CoverImage(
  [System.Drawing.Graphics]$Graphics,
  [System.Drawing.Image]$Image,
  [int]$Width,
  [int]$Height
) {
  $scale = [Math]::Max($Width / $Image.Width, $Height / $Image.Height)
  $drawWidth = [int][Math]::Ceiling($Image.Width * $scale)
  $drawHeight = [int][Math]::Ceiling($Image.Height * $scale)
  $x = [int](($Width - $drawWidth) / 2)
  $y = [int](($Height - $drawHeight) / 2)
  $Graphics.DrawImage($Image, $x, $y, $drawWidth, $drawHeight)
}

function Add-CenteredImage(
  [System.Drawing.Graphics]$Graphics,
  [System.Drawing.Image]$Image,
  [int]$CenterX,
  [int]$Top,
  [int]$Size
) {
  $x = [int]($CenterX - ($Size / 2))
  $Graphics.DrawImage($Image, $x, $Top, $Size, $Size)
}

function Add-CenteredText(
  [System.Drawing.Graphics]$Graphics,
  [string]$Text,
  [float]$Y,
  [float]$Width,
  [float]$Height,
  [System.Drawing.Font]$Font,
  [System.Drawing.Color]$Color
) {
  $format = [System.Drawing.StringFormat]::new()
  $format.Alignment = [System.Drawing.StringAlignment]::Center
  $format.LineAlignment = [System.Drawing.StringAlignment]::Center
  $shadow = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(115, 0, 0, 0))
  $brush = [System.Drawing.SolidBrush]::new($Color)
  try {
    $Graphics.DrawString($Text, $Font, $shadow, [System.Drawing.RectangleF]::new(3, $Y + 4, $Width, $Height), $format)
    $Graphics.DrawString($Text, $Font, $brush, [System.Drawing.RectangleF]::new(0, $Y, $Width, $Height), $format)
  } finally {
    $shadow.Dispose()
    $brush.Dispose()
    $format.Dispose()
  }
}

function Save-Png([System.Drawing.Bitmap]$Canvas, [string]$FileName) {
  $path = Join-Path $outputDirectory $FileName
  if ([System.IO.File]::Exists($path)) { [System.IO.File]::Delete($path) }
  $Canvas.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  Write-Host "Created: $path"
}

$posterSource = [System.Drawing.Image]::FromFile((Resolve-Path -LiteralPath $PosterBackground))
$squareSource = [System.Drawing.Image]::FromFile((Resolve-Path -LiteralPath $SquareBackground))
$logo = [System.Drawing.Image]::FromFile($logoPath)

try {
  $poster = New-Canvas 1440 2160
  $graphics = New-Graphics $poster
  try {
    Add-CoverImage $graphics $posterSource 1440 2160
    $shade = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(28, 0, 0, 0))
    $graphics.FillRectangle($shade, 0, 0, 1440, 2160)
    $shade.Dispose()
    Add-CenteredImage $graphics $logo 720 640 500
    $titleFont = [System.Drawing.Font]::new('Segoe UI', 104, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $taglineFont = [System.Drawing.Font]::new('Segoe UI', 29, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    try {
      Add-CenteredText $graphics 'StreamDash' 1155 1440 150 $titleFont ([System.Drawing.Color]::White)
      Add-CenteredText $graphics 'YOUR STREAM. ONE DASHBOARD.' 1300 1440 70 $taglineFont ([System.Drawing.Color]::FromArgb(255, 188, 198, 220))
    } finally {
      $titleFont.Dispose()
      $taglineFont.Dispose()
    }
    Save-Png $poster '01-poster-9x16-1440x2160.png'
  } finally {
    $graphics.Dispose()
    $poster.Dispose()
  }

  $square = New-Canvas 2160 2160
  $graphics = New-Graphics $square
  try {
    Add-CoverImage $graphics $squareSource 2160 2160
    $shade = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(24, 0, 0, 0))
    $graphics.FillRectangle($shade, 0, 0, 2160, 2160)
    $shade.Dispose()
    Add-CenteredImage $graphics $logo 1080 420 650
    $titleFont = [System.Drawing.Font]::new('Segoe UI', 132, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $taglineFont = [System.Drawing.Font]::new('Segoe UI', 40, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    try {
      Add-CenteredText $graphics 'StreamDash' 1080 2160 190 $titleFont ([System.Drawing.Color]::White)
      Add-CenteredText $graphics 'YOUR STREAM. ONE DASHBOARD.' 1260 2160 90 $taglineFont ([System.Drawing.Color]::FromArgb(255, 188, 198, 220))
    } finally {
      $titleFont.Dispose()
      $taglineFont.Dispose()
    }
    Save-Png $square '02-packaging-art-1x1-2160x2160.png'
  } finally {
    $graphics.Dispose()
    $square.Dispose()
  }

  foreach ($tile in @(
    @{ Size = 300; Logo = 218; Name = '03-app-tile-300x300.png' },
    @{ Size = 150; Logo = 110; Name = '04-app-logo-150x150.png' },
    @{ Size = 71; Logo = 54; Name = '05-app-logo-71x71.png' }
  )) {
    $canvas = New-Canvas $tile.Size $tile.Size
    $graphics = New-Graphics $canvas
    try {
      $bounds = [System.Drawing.Rectangle]::new(0, 0, $tile.Size, $tile.Size)
      $background = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
        $bounds,
        [System.Drawing.Color]::FromArgb(255, 20, 17, 39),
        [System.Drawing.Color]::FromArgb(255, 5, 18, 31),
        135.0
      )
      $graphics.FillRectangle($background, $bounds)
      $background.Dispose()
      $top = [int](($tile.Size - $tile.Logo) / 2)
      Add-CenteredImage $graphics $logo ([int]($tile.Size / 2)) $top $tile.Logo
      Save-Png $canvas $tile.Name
    } finally {
      $graphics.Dispose()
      $canvas.Dispose()
    }
  }
} finally {
  $posterSource.Dispose()
  $squareSource.Dispose()
  $logo.Dispose()
}
