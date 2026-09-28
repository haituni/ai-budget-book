# Device/emulator regression check: install the release APK, launch it, grab a
# screenshot and the app log.
#
# This catches the mistakes that a PC-side test cannot see, e.g. a wrong asset
# path inside MainActivity.buildHtml() or a missing Chaquopy PyApplication.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File tools\device_test.ps1
#   powershell -ExecutionPolicy Bypass -File tools\device_test.ps1 -Serial 127.0.0.1:16384
#
# Keep this file ASCII-only (see sync-sources.ps1 for the reason).

param(
    [string]$Serial = '',
    [int]$WaitSeconds = 12,
    [switch]$SkipInstall
)

$ErrorActionPreference = 'Stop'

$androidRoot = Split-Path -Parent $PSScriptRoot
$adb = Join-Path $androidRoot 'toolchain\android-sdk\platform-tools\adb.exe'
$apk = Join-Path $androidRoot 'dist\MonthlyLedger-1.0-release.apk'
$package = 'com.cost.ledger'

if (-not (Test-Path $adb)) { throw "adb not found. Run tools\fetch-toolchain.ps1 first." }
if (-not (Test-Path $apk)) { throw "APK not found: $apk (build it first)" }

$deviceArgs = @()
if ($Serial) { $deviceArgs += @('-s', $Serial) }

$devices = & $adb devices | Select-String -Pattern 'device$'
if (-not $devices) {
    throw 'No device detected. Start the emulator (MuMu / AVD) or enable USB debugging.'
}
if (-not $Serial -and @($devices).Count -gt 1) {
    Write-Host 'More than one device is attached; using the first one. Pass -Serial to choose.' -ForegroundColor Yellow
}

if (-not $SkipInstall) {
    Write-Host 'installing APK ...' -ForegroundColor Cyan
    & $adb @deviceArgs install -r $apk
    if ($LASTEXITCODE -ne 0) { throw "adb install failed ($LASTEXITCODE)" }
}

& $adb @deviceArgs shell am force-stop $package
& $adb @deviceArgs logcat -c
Write-Host 'launching ...' -ForegroundColor Cyan
& $adb @deviceArgs shell am start -n "$package/.MainActivity" | Out-Null
Start-Sleep -Seconds $WaitSeconds

$shots = Join-Path $androidRoot 'screenshots'
New-Item -ItemType Directory -Force -Path $shots | Out-Null
$remote = '/sdcard/ledger-device-test.png'
$local = Join-Path $shots 'device-latest.png'
& $adb @deviceArgs shell screencap -p $remote
& $adb @deviceArgs pull $remote $local | Out-Null
Write-Host "screenshot: $local" -ForegroundColor Green

$log = & $adb @deviceArgs logcat -d -s MonthlyLedger:*
$log | Select-Object -First 12

$errors = @($log | Select-String -Pattern ' E MonthlyLedger:')
$ready = @($log | Select-String -Pattern 'Python ready in')
if ($errors.Count -gt 0 -or $ready.Count -eq 0) {
    Write-Host ''
    Write-Host 'FAILED: the app logged an error or Python never reported ready.' -ForegroundColor Red
    exit 1
}
Write-Host ''
Write-Host 'OK: Python started and no error was logged.' -ForegroundColor Green
