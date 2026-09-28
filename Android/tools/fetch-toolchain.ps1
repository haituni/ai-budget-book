# Downloads and installs the Android build toolchain (JDK 17 / Android SDK / Gradle).
# Everything stays inside Android/toolchain so the machine stays clean.
# Safe to re-run: files that already exist are skipped.
# NOTE: keep this file ASCII-only. Windows PowerShell 5.1 reads BOM-less files
# using the ANSI code page, which corrupts non-ASCII characters.

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$androidRoot = Split-Path -Parent $PSScriptRoot
$tc = Join-Path $androidRoot 'toolchain'
$dl = Join-Path $tc 'dl'
New-Item -ItemType Directory -Force -Path $dl | Out-Null

function Write-Step($message) {
    Write-Host ''
    Write-Host "=== $message ===" -ForegroundColor Cyan
}

function Fetch($urls, $dest) {
    if ((Test-Path $dest) -and ((Get-Item $dest).Length -gt 1MB)) {
        Write-Host "skip existing: $dest"
        return
    }
    $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
    foreach ($url in $urls) {
        Write-Host "download: $url"
        if ($curl) {
            & curl.exe -L --fail --connect-timeout 20 --retry 2 --retry-delay 3 -o $dest $url
            if ($LASTEXITCODE -eq 0) { return }
            Write-Host "  ... failed, trying next mirror"
        } else {
            try {
                Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing -TimeoutSec 3600
                return
            } catch {
                Write-Host "  ... failed: $($_.Exception.Message)"
            }
        }
    }
    throw "all mirrors failed for $dest"
}

function Expand-Zip($zip, $dest) {
    New-Item -ItemType Directory -Force -Path $dest | Out-Null
    Write-Host "extract: $(Split-Path -Leaf $zip) -> $dest"
    & tar.exe -xf $zip -C $dest
    if ($LASTEXITCODE -ne 0) { throw "extract failed: $zip" }
}

# ---------------------------------------------------------------- JDK 17
Write-Step 'JDK 17 (Temurin)'
$jdkZip = Join-Path $dl 'jdk17.zip'
$jdkUrls = @(
    # Tsinghua mirror of Adoptium: reachable from China, the official Adoptium
    # API redirects to github.com which is often blocked here.
    'https://mirrors.tuna.tsinghua.edu.cn/Adoptium/17/jdk/x64/windows/OpenJDK17U-jdk_x64_windows_hotspot_17.0.20.1_1.zip',
    'https://mirrors.huaweicloud.com/openjdk/17.0.2/openjdk-17.0.2_windows-x64_bin.zip'
)
Fetch $jdkUrls $jdkZip
$jdkDir = Join-Path $tc 'jdk17'
if (-not (Test-Path (Join-Path $jdkDir 'bin\java.exe'))) {
    $tmp = Join-Path $tc 'jdk17-tmp'
    if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
    Expand-Zip $jdkZip $tmp
    $inner = Get-ChildItem $tmp -Directory | Select-Object -First 1
    if (Test-Path $jdkDir) { Remove-Item -Recurse -Force $jdkDir }
    Move-Item $inner.FullName $jdkDir
    Remove-Item -Recurse -Force $tmp
}
$env:JAVA_HOME = $jdkDir
Write-Host ("JAVA_HOME = " + $jdkDir)
& (Join-Path $jdkDir 'bin\java.exe') -version

# ------------------------------------------------- Android command line tools
Write-Step 'Android command line tools'
$cmdlineZip = Join-Path $dl 'commandlinetools-win.zip'
$cmdlineUrls = @(
    'https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip',
    'https://mirrors.cloud.tencent.com/AndroidSDK/commandlinetools-win-11076708_latest.zip'
)
Fetch $cmdlineUrls $cmdlineZip
$sdk = Join-Path $tc 'android-sdk'
$cmdlineLatest = Join-Path $sdk 'cmdline-tools\latest'
if (-not (Test-Path (Join-Path $cmdlineLatest 'bin\sdkmanager.bat'))) {
    $tmp = Join-Path $sdk 'cmdline-tools\_tmp'
    if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
    Expand-Zip $cmdlineZip $tmp
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $cmdlineLatest) | Out-Null
    if (Test-Path $cmdlineLatest) { Remove-Item -Recurse -Force $cmdlineLatest }
    Move-Item (Join-Path $tmp 'cmdline-tools') $cmdlineLatest
    Remove-Item -Recurse -Force $tmp
}

# ----------------------------------------------------------- Android SDK parts
Write-Step 'Android SDK components (platform-tools / android-35 / build-tools 35)'
$sdkmanager = Join-Path $cmdlineLatest 'bin\sdkmanager.bat'
$yesFile = Join-Path $dl 'yes.txt'
if (-not (Test-Path $yesFile)) {
    $lines = 1..80 | ForEach-Object { 'y' }
    Set-Content -Path $yesFile -Value $lines -Encoding ASCII
}
Write-Host 'accepting SDK licenses ...'
Get-Content $yesFile | & $sdkmanager "--sdk_root=$sdk" --licenses | Out-Null
Write-Host 'installing SDK components ...'
& $sdkmanager "--sdk_root=$sdk" 'platform-tools' 'platforms;android-35' 'build-tools;35.0.0'
if ($LASTEXITCODE -ne 0) { throw 'sdkmanager failed to install components' }

# ------------------------------------------------------------------- Gradle
Write-Step 'Gradle 8.9'
$gradleZip = Join-Path $dl 'gradle-8.9-bin.zip'
$gradleUrls = @(
    'https://mirrors.cloud.tencent.com/gradle/gradle-8.9-bin.zip',
    'https://mirrors.huaweicloud.com/gradle/gradle-8.9-bin.zip',
    'https://services.gradle.org/distributions/gradle-8.9-bin.zip'
)
Fetch $gradleUrls $gradleZip
if (-not (Test-Path (Join-Path $tc 'gradle-8.9\bin\gradle.bat'))) {
    Expand-Zip $gradleZip $tc
}

# ------------------------------------------------------------------ local.properties
Write-Step 'writing local.properties'
$localProps = Join-Path $androidRoot 'local.properties'
# local.properties cannot carry a non-ASCII path reliably (Java reads that file
# as ISO-8859-1), so when this project lives under a non-ASCII path we skip it
# entirely. build-apk.ps1 exports ANDROID_HOME / ANDROID_SDK_ROOT,
# which Gradle honours just as well.
if ($sdk -match '^[\x00-\x7F]+$') {
    $sdkDirEscaped = $sdk -replace '\\', '/'
    Set-Content -Path $localProps -Value "sdk.dir=$sdkDirEscaped" -Encoding ASCII
    Write-Host "wrote $localProps"
} else {
    if (Test-Path $localProps) { Remove-Item -Force $localProps }
    Write-Host 'SDK path has non-ASCII characters: using ANDROID_HOME instead'
}

Write-Step 'done'
Write-Host "JDK    : $jdkDir"
Write-Host "SDK    : $sdk"
Write-Host "Gradle : $(Join-Path $tc 'gradle-8.9\bin\gradle.bat')"
