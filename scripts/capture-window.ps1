param(
  [string]$ProcessName = "streamdash",
  [int]$Width = 0,
  [int]$Height = 0,
  [int]$Fps = 60,
  [switch]$QuerySize
)

$ErrorActionPreference = "Stop"

Add-Type -TypeDefinition @"
using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;

public static class WindowCapture {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct BITMAPINFOHEADER {
    public uint biSize;
    public int biWidth;
    public int biHeight;
    public ushort biPlanes;
    public ushort biBitCount;
    public uint biCompression;
    public uint biSizeImage;
    public int biXPelsPerMeter;
    public int biYPelsPerMeter;
    public uint biClrUsed;
    public uint biClrImportant;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct BITMAPINFO {
    public BITMAPINFOHEADER bmiHeader;
  }

  [DllImport("user32.dll")]
  public static extern bool SetProcessDpiAwarenessContext(IntPtr dpiContext);

  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

  [DllImport("user32.dll")]
  public static extern bool IsWindow(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint nFlags);

  [DllImport("user32.dll")]
  public static extern IntPtr GetDC(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);

  [DllImport("gdi32.dll")]
  public static extern IntPtr CreateCompatibleDC(IntPtr hdc);

  [DllImport("gdi32.dll")]
  public static extern bool DeleteDC(IntPtr hdc);

  [DllImport("gdi32.dll")]
  public static extern IntPtr SelectObject(IntPtr hdc, IntPtr hgdiobj);

  [DllImport("gdi32.dll")]
  public static extern bool DeleteObject(IntPtr hObject);

  [DllImport("gdi32.dll")]
  public static extern IntPtr CreateDIBSection(
    IntPtr hdc,
    ref BITMAPINFO pbmi,
    uint iUsage,
    out IntPtr ppvBits,
    IntPtr hSection,
    uint dwOffset
  );

  public static void InitDpi() {
    try {
      SetProcessDpiAwarenessContext(new IntPtr(-4)); // PER_MONITOR_AWARE_V2
    } catch {
      try {
        SetProcessDpiAwarenessContext(new IntPtr(-3)); // PER_MONITOR_AWARE
      } catch {
      }
    }
  }

  public static IntPtr FindTargetWindow(string processName) {
    foreach (var proc in Process.GetProcessesByName(processName)) {
      if (proc.MainWindowHandle != IntPtr.Zero) {
        return proc.MainWindowHandle;
      }
    }
    return IntPtr.Zero;
  }

  public static int[] GetSize(IntPtr hwnd) {
    RECT r;
    if (!GetWindowRect(hwnd, out r)) return new[] { 0, 0 };
    int w = (r.Right - r.Left) & ~1;
    int h = (r.Bottom - r.Top) & ~1;
    return new[] { w, h };
  }

  public static void StreamFrames(IntPtr hwnd, int width, int height, int fps) {
    IntPtr screenDc = GetDC(IntPtr.Zero);
    IntPtr memDc = CreateCompatibleDC(screenDc);

    BITMAPINFO bmi = new BITMAPINFO();
    bmi.bmiHeader.biSize = (uint)Marshal.SizeOf(typeof(BITMAPINFOHEADER));
    bmi.bmiHeader.biWidth = width;
    bmi.bmiHeader.biHeight = -height; // top-down BGRA
    bmi.bmiHeader.biPlanes = 1;
    bmi.bmiHeader.biBitCount = 32;
    bmi.bmiHeader.biCompression = 0; // BI_RGB

    IntPtr bitsPtr;
    IntPtr hBitmap = CreateDIBSection(screenDc, ref bmi, 0, out bitsPtr, IntPtr.Zero, 0);
    IntPtr oldObj = SelectObject(memDc, hBitmap);

    int byteCount = width * height * 4;
    byte[] buffer = new byte[byteCount];
    Stream stdout = Console.OpenStandardOutput();
    double frameMs = 1000.0 / Math.Max(1, fps);
    Stopwatch sw = Stopwatch.StartNew();
    long frameIndex = 0;

    try {
      while (IsWindow(hwnd)) {
        // PW_RENDERFULLCONTENT = 2 captures DirectComposition / WebView2 layers
        if (!PrintWindow(hwnd, memDc, 2)) {
          PrintWindow(hwnd, memDc, 0);
        }
        Marshal.Copy(bitsPtr, buffer, 0, byteCount);
        stdout.Write(buffer, 0, byteCount);
        stdout.Flush();

        frameIndex++;
        double targetMs = frameIndex * frameMs;
        double waitMs = targetMs - sw.Elapsed.TotalMilliseconds;
        if (waitMs > 1.0) {
          Thread.Sleep((int)waitMs);
        }
      }
    } catch {
      // Pipe closed by ffmpeg on shutdown
    } finally {
      SelectObject(memDc, oldObj);
      DeleteObject(hBitmap);
      DeleteDC(memDc);
      ReleaseDC(IntPtr.Zero, screenDc);
    }
  }
}
"@

[WindowCapture]::InitDpi()
$hwnd = [WindowCapture]::FindTargetWindow($ProcessName)
if ($hwnd -eq [IntPtr]::Zero) {
  Write-Error "Window for process '$ProcessName' not found."
  exit 1
}

if ($QuerySize) {
  $size = [WindowCapture]::GetSize($hwnd)
  Write-Output "$($size[0])x$($size[1])"
  exit 0
}

if ($Width -le 0 -or $Height -le 0) {
  $size = [WindowCapture]::GetSize($hwnd)
  $Width = $size[0]
  $Height = $size[1]
}

if ($Width -le 0 -or $Height -le 0) {
  Write-Error "Invalid window size: ${Width}x${Height}"
  exit 1
}

[WindowCapture]::StreamFrames($hwnd, $Width, $Height, $Fps)
