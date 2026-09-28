# Builds the APK(s) and copies them into Android/dist.
# Usage: powershell -ExecutionPolicy Bypass -File tools\build-apk.ps1
#        powershell -ExecutionPolicy Bypass -File tools\build-apk.ps1 -ReleaseOnly
# Keep this file ASCII-only (see sync-sources.ps1 for the reason).

param(
    [switch]$ReleaseOnly,
    [switch]$DebugOnly
)

$ErrorActionPreference = 'Stop'

$androidRoot = Split-Path -Parent $PSScriptRoot
$toolchain = Join-Path $androidRoot 'toolchain'
$jdk = Join-Path $toolchain 'jdk17'
$sdk = Join-Path $toolchain 'android-sdk'
$gradle = Join-Path $toolchain 'gradle-8.9\bin\gradle.bat'

if (-not (Test-Path $gradle)) {
    throw "toolchain missing, run tools\fetch-toolchain.ps1 first"
}

# Everything Gradle downloads (plugin jars, Chaquopy runtime) stays in the
# project folder instead of polluting the user profile.
$env:JAVA_HOME = $jdk
$env:ANDROID_HOME = $sdk
$env:ANDROID_SDK_ROOT = $sdk
$env:GRADLE_USER_HOME = Join-Path $androidRoot '.gradle-home'

& (Join-Path $PSScriptRoot 'sync-sources.ps1')

$tasks = @()
if (-not $ReleaseOnly) { $tasks += 'assembleDebug' }
if (-not $DebugOnly) { $tasks += 'assembleRelease' }

Write-Host ''
Write-Host "=== gradle $($tasks -join ' ') ===" -ForegroundColor Cyan
Push-Location $androidRoot
try {
    & $gradle --no-configuration-cache @tasks
    if ($LASTEXITCODE -ne 0) { throw "gradle failed with exit code $LASTEXITCODE" }
} finally {
    Pop-Location
}

$dist = Join-Path $androidRoot 'dist'
New-Item -ItemType Directory -Force -Path $dist | Out-Null

$version = '1.0'
Get-ChildItem (Join-Path $androidRoot 'app\build\outputs\apk') -Recurse -Filter *.apk |
    ForEach-Object {
        $kind = if ($_.FullName -match 'release') { 'release' } else { 'debug' }
        $target = Join-Path $dist "MonthlyLedger-$version-$kind.apk"
        Copy-Item $_.FullName $target -Force
        $size = [math]::Round((Get-Item $target).Length / 1MB, 1)
        Write-Host "APK: $target ($size MB)" -ForegroundColor Green
    }
