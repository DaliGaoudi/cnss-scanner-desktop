<#
  scan.ps1 — drive a Windows scanner via WIA and save one page to a file.

  Invoked by bridge.js. Not meant to be run by hand, but you can:
    powershell -ExecutionPolicy Bypass -File scan.ps1 -Out C:\temp\page.jpg

  Params:
    -Out     output file path (required)
    -Format  jpeg | png | tiff | bmp   (default jpeg)
    -Device  substring of the scanner name to prefer (optional)
    -Dpi     scan resolution (default 200)
    -Dialog  show the native scan dialog instead of scanning headless

  Prints "OK <path>" on success; writes the reason to stderr and exits non-zero
  on failure.
#>
param(
    [Parameter(Mandatory = $true)][string]$Out,
    [string]$Format = "jpeg",
    [string]$Device = "",
    [int]$Dpi = 150,
    [switch]$Gray,
    [switch]$Dialog
)

$ErrorActionPreference = "Stop"

# WIA image format GUIDs
$formats = @{
    "jpeg" = "{B96B3CAE-0728-11D3-9D7B-0000F81EF32E}"
    "jpg"  = "{B96B3CAE-0728-11D3-9D7B-0000F81EF32E}"
    "png"  = "{B96B3CAF-0728-11D3-9D7B-0000F81EF32E}"
    "tiff" = "{B96B3CB1-0728-11D3-9D7B-0000F81EF32E}"
    "bmp"  = "{B96B3CAB-0728-11D3-9D7B-0000F81EF32E}"
}
$fmt = $formats[$Format.ToLower()]
if (-not $fmt) { $fmt = $formats["jpeg"] }

# Setting a property that the driver doesn't expose throws — ignore those.
function Set-WiaProp($props, $id, $value) {
    try {
        foreach ($p in $props) {
            if ($p.PropertyID -eq $id) { $p.Value = $value; return }
        }
    } catch { }
}

if (Test-Path $Out) { Remove-Item $Out -Force }

$image = $null

if ($Dialog) {
    # ScannerDeviceType = 1. Shows the native UI so the user can pick source/settings.
    $cd = New-Object -ComObject WIA.CommonDialog
    $image = $cd.ShowAcquireImage(1, 0, 131072, $fmt, $false, $true, $false)
} else {
    $dm = New-Object -ComObject WIA.DeviceManager
    $devInfo = $null
    foreach ($d in $dm.DeviceInfos) {
        if ($d.Type -eq 1) {        # 1 = Scanner
            if ($Device -ne "") {
                $name = ""
                try { $name = $d.Properties.Item("Name").Value } catch { }
                if ($name -like "*$Device*") { $devInfo = $d; break }
            } else {
                $devInfo = $d; break
            }
        }
    }
    if (-not $devInfo) {
        [Console]::Error.WriteLine("No scanner found. Make sure the scanner is powered on and its driver is installed.")
        exit 2
    }

    $dev  = $devInfo.Connect()
    $item = $dev.Items.Item(1)

    Set-WiaProp $item.Properties 6147 $Dpi   # horizontal resolution (DPI)
    Set-WiaProp $item.Properties 6148 $Dpi   # vertical resolution (DPI)
    if ($Gray) {
        Set-WiaProp $item.Properties 6146 2  # current intent: 2 = grayscale
    } else {
        Set-WiaProp $item.Properties 6146 1  # current intent: 1 = color
    }

    $image = $item.Transfer($fmt)
}

if (-not $image) {
    [Console]::Error.WriteLine("Scan produced no image (cancelled or empty feeder).")
    exit 3
}

$image.SaveFile($Out)
Write-Output "OK $Out"
