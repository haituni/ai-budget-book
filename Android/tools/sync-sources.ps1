# Copies the shared Python backend and the web UI into the Android project.
# The repository root stays the single source of truth: edit core/ and ui/
# there, then re-run this script (build-apk.ps1 calls it automatically).
# Keep this file ASCII-only (Windows PowerShell 5.1 reads BOM-less files
# using the ANSI code page).

$ErrorActionPreference = 'Stop'

$androidRoot = Split-Path -Parent $PSScriptRoot
$projectRoot = Split-Path -Parent $androidRoot

function Sync-Dir($source, $target) {
    if (-not (Test-Path $source)) { throw "missing source directory: $source" }
    if (Test-Path $target) { Remove-Item -Recurse -Force $target }
    New-Item -ItemType Directory -Force -Path $target | Out-Null
    robocopy $source $target /E /XD __pycache__ .git /NFL /NDL /NJH /NJS /NP | Out-Null
    # robocopy exit codes below 8 mean success
    if ($LASTEXITCODE -ge 8) { throw "robocopy failed ($LASTEXITCODE): $source -> $target" }
    Write-Host "synced: $source -> $target"
}

Sync-Dir (Join-Path $projectRoot 'core') (Join-Path $androidRoot 'app\src\main\python\core')
Sync-Dir (Join-Path $projectRoot 'ui') (Join-Path $androidRoot 'app\src\main\assets\ui')
