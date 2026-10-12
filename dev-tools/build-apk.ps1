#Requires -Version 5.1
<#
.SYNOPSIS
    Build the AQSMS release APK.

.DESCRIPTION
    Runs the whole release sequence against the toolchain installed on this
    machine: prebuild -> release signing -> Gradle -> signature verification.

    Written for Windows PowerShell 5.1, so it avoids `&&`, ternaries and other
    syntax this shell does not have.

.PARAMETER Clean
    Delete the generated android/ directory first. Use when the native project
    looks wrong, or after changing app.json plugins. Slower: prebuild regenerates
    everything from scratch.

.PARAMETER SkipVerify
    Skip type-check and lint. They are cheap; prefer to leave them on.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File dev-tools\build-apk.ps1
#>
[CmdletBinding()]
param(
    [switch]$Clean,
    [switch]$SkipVerify
)

# NOT "Stop". In Windows PowerShell 5.1, $ErrorActionPreference = "Stop" turns
# any line a native tool writes to STDERR into a terminating error -- and both
# `expo prebuild` (plugin warnings) and Gradle (progress, deprecations) write to
# stderr routinely while succeeding. Every native call below is checked
# explicitly against $LASTEXITCODE instead, which is the reliable signal.
$ErrorActionPreference = "Continue"

# ---- Paths on this machine -------------------------------------------------
# Verified present on 2026-10-09: see BUILD_ANDROID.md section 1.
$Jdk        = "C:\Android\jdk21"
$Sdk        = "C:\Android\Sdk"
$BuildTools = Join-Path $Sdk "build-tools\36.1.0"
$ApkSigner  = Join-Path $BuildTools "apksigner.bat"
$KeyTool    = Join-Path $Jdk "bin\keytool.exe"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$Frontend = Join-Path $RepoRoot "frontend"
$Android  = Join-Path $Frontend "android"
$Apk      = Join-Path $Android "app\build\outputs\apk\release\app-release.apk"
$Cert     = Join-Path $Frontend "certs\aqsms-ca.crt"

function Fail($message) {
    Write-Host ""
    Write-Host "FAILED: $message" -ForegroundColor Red
    exit 1
}

# ---- 0. Toolchain present? -------------------------------------------------
foreach ($p in @($Jdk, $Sdk, $BuildTools, $ApkSigner, $KeyTool)) {
    if (-not (Test-Path $p)) { Fail "missing toolchain path: $p" }
}
if (-not (Test-Path (Join-Path $Frontend "package.json"))) {
    Fail "could not find frontend/ next to this script (looked in $Frontend)"
}

$env:JAVA_HOME        = $Jdk
$env:ANDROID_HOME     = $Sdk
$env:ANDROID_SDK_ROOT = $Sdk
$env:PATH             = "$Jdk\bin;$Sdk\platform-tools;$BuildTools;$env:PATH"

Write-Host "JDK    $Jdk"
Write-Host "SDK    $Sdk"
Write-Host ""

# ---- 1. Certificate --------------------------------------------------------
# The Pi's CA has to be in place BEFORE prebuild: the config plugin reads it at
# prebuild time and bakes the trust anchor into the generated Android project.
if (Test-Path $Cert) {
    if (Select-String -Path $Cert -Pattern "BEGIN PRIVATE KEY" -Quiet) {
        Fail "certs\aqsms-ca.crt contains a PRIVATE KEY. Delete it and copy only the Pi's public CA certificate. A private key must never enter the APK."
    }
    if (-not (Select-String -Path $Cert -Pattern "BEGIN CERTIFICATE" -Quiet)) {
        Fail "certs\aqsms-ca.crt is not a PEM certificate. Copy the Pi's certs/aqsms-ca.crt, not another file."
    }
    Write-Host "CA present - the APK will trust your Pi's HTTPS." -ForegroundColor Green
} else {
    Write-Host "WARNING: no certs\aqsms-ca.crt." -ForegroundColor Yellow
    Write-Host "  The APK will NOT trust the Pi's HTTPS and will fail on an https:// address." -ForegroundColor Yellow
    Write-Host "  Plain http:// still works. See PHONE_TO_PI_SETUP.md part 2." -ForegroundColor Yellow
}
Write-Host ""

# ---- 2. Correctness gates --------------------------------------------------
if (-not $SkipVerify) {
    Write-Host "== type-check ==" -ForegroundColor Cyan
    Push-Location $Frontend
    npx tsc --noEmit
    if ($LASTEXITCODE -ne 0) { Pop-Location; Fail "npx tsc --noEmit reported errors" }

    Write-Host "== lint ==" -ForegroundColor Cyan
    npx expo lint
    if ($LASTEXITCODE -ne 0) { Pop-Location; Fail "npx expo lint reported problems" }
    Pop-Location
    Write-Host ""
}

# ---- 3. Generate the native project ---------------------------------------
Push-Location $Frontend
try {
    if ($Clean -and (Test-Path $Android)) {
        Write-Host "== removing generated android/ ==" -ForegroundColor Cyan
        Remove-Item $Android -Recurse -Force
    }

    Write-Host "== expo prebuild ==" -ForegroundColor Cyan
    npx expo prebuild --platform android --no-install
    if ($LASTEXITCODE -ne 0) { Fail "expo prebuild failed" }

    # The Expo template defaults to debug signing. This must run after EVERY
    # prebuild, or the release APK is silently signed with Android's public
    # debug key.
    Write-Host "== apply release signing ==" -ForegroundColor Cyan
    node scripts/apply-release-signing.js
    if ($LASTEXITCODE -ne 0) { Fail "apply-release-signing.js failed" }
}
finally {
    Pop-Location
}

# ---- 4. Build --------------------------------------------------------------
Write-Host ""
Write-Host "== gradle assembleRelease ==" -ForegroundColor Cyan
# -p android keeps the working directory at frontend/, so the APK path below
# stays valid and never depends on where we happen to be standing.
& (Join-Path $Android "gradlew.bat") -p $Android :app:assembleRelease
if ($LASTEXITCODE -ne 0) { Fail "gradle assembleRelease failed" }

if (-not (Test-Path $Apk)) { Fail "gradle reported success but no APK at $Apk" }

# ---- 5. Verify -------------------------------------------------------------
Write-Host ""
Write-Host "== signature ==" -ForegroundColor Cyan
& $ApkSigner verify --verbose --print-certs $Apk
if ($LASTEXITCODE -ne 0) { Fail "apksigner verify rejected the APK" }

Write-Host ""
Write-Host "== APK ==" -ForegroundColor Cyan
$item = Get-Item $Apk
$hash = (Get-FileHash $Apk -Algorithm SHA256).Hash
Write-Host "path    $($item.FullName)"
Write-Host "size    $([math]::Round($item.Length / 1MB, 2)) MB"
Write-Host "sha256  $hash"
Write-Host ""
Write-Host "Confirm the signer above is CN=Aqua Smart Monitoring System, NOT 'CN=Android Debug'." -ForegroundColor Yellow
