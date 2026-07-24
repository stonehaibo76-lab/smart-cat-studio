# Downloads Temurin JRE 17 (Windows x64) into runtime/jre for portable Smart-CAT Studio.
# Usage: powershell -ExecutionPolicy Bypass -File scripts/packaging/fetch-jre.ps1
param(
  [string]$TargetDir = ""
)

$ErrorActionPreference = "Stop"
$Root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
if (-not $TargetDir) {
  $TargetDir = Join-Path $Root "runtime\jre"
}

$ApiUrl = "https://api.adoptium.net/v3/assets/latest/17/hotspot?architecture=x64&image_type=jre&os=windows&vendor=eclipse"
Write-Host "[fetch-jre] Resolving Temurin JRE 17 download URL..."
$assets = Invoke-RestMethod -Uri $ApiUrl -Method Get
$zipAsset = $assets | Where-Object {
  $_.binary.package.link -and ($_.binary.package.link -match '\.zip$')
} | Select-Object -First 1
if (-not $zipAsset) {
  throw "Could not find Windows x64 JRE zip from Adoptium API."
}

$zipUrl = $zipAsset.binary.package.link
$zipName = Split-Path $zipUrl -Leaf
$cacheDir = Join-Path $Root ".pack-cache"
New-Item -ItemType Directory -Force -Path $cacheDir | Out-Null
$zipPath = Join-Path $cacheDir $zipName

if (-not (Test-Path $zipPath)) {
  Write-Host "[fetch-jre] Downloading $zipUrl ..."
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath -UseBasicParsing
}
else {
  Write-Host "[fetch-jre] Using cached $zipPath"
}

$extractRoot = Join-Path $cacheDir "jre-extract"
if (Test-Path $extractRoot) {
  Remove-Item -Recurse -Force $extractRoot
}
New-Item -ItemType Directory -Force -Path $extractRoot | Out-Null
Expand-Archive -Path $zipPath -DestinationPath $extractRoot -Force

$inner = Get-ChildItem -Path $extractRoot -Directory |
  Where-Object { $_.Name -match '^(jdk|jre)' } |
  Select-Object -First 1
if (-not $inner) {
  throw "Unexpected JRE zip layout under $extractRoot"
}

if (Test-Path $TargetDir) {
  Remove-Item -Recurse -Force $TargetDir
}
New-Item -ItemType Directory -Force -Path (Split-Path $TargetDir -Parent) | Out-Null
Move-Item -Path $inner.FullName -Destination $TargetDir
Write-Host "[fetch-jre] JRE installed to $TargetDir"
Write-Host "[fetch-jre] Verify: & `"$TargetDir\bin\java.exe`" -version"
