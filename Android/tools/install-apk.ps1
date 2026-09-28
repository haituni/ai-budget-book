# Installs the built APK on a connected device / emulator through adb.
# Usage: powershell -ExecutionPolicy Bypass -File tools\install-apk.ps1 [-Debug]
# Keep this file ASCII-only (see sync-sources.ps1 for the reason).

param(
    [switch]$Debug
)

$ErrorActionPreference = 'Stop'

$androidRoot = Split-Path -Parent $PSScriptRoot
$adb = Join-Path $androidRoot 'toolchain\android-sdk\platform-tools\adb.exe'

if (-not (Test-Path $adb)) {
    throw "adb not found. Run tools\fetch-toolchain.ps1 first."
}

$kind = if ($Debug) { 'debug' } else { 'release' }
$apk = Join-Path $androidRoot "dist\MonthlyLedger-1.0-$kind.apk"
if (-not (Test-Path $apk)) {
    throw "APK not found: $apk (build it first with tools\build-apk.ps1)"
}

$devices = & $adb devices | Select-String -Pattern '\tdevice$'
if (-not $devices) {
    throw 'No device detected. Enable USB debugging and confirm the authorization prompt on the phone.'
}

Write-Host "installing $apk ..." -ForegroundColor Cyan
& $adb install -r $apk
if ($LASTEXITCODE -ne 0) { throw "adb install failed with exit code $LASTEXITCODE" }
Write-Host 'done. The launcher entry is named after strings.xml (app_name).' -ForegroundColor Green
