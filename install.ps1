$ErrorActionPreference = "Stop"

function Get-ExeoraWindowsArchitecture {
  if ($env:PROCESSOR_ARCHITEW6432) {
    return $env:PROCESSOR_ARCHITEW6432
  }
  return $env:PROCESSOR_ARCHITECTURE
}

$version = if ($env:EXEORA_VERSION) { $env:EXEORA_VERSION } else { "latest" }
if ($version -ne "latest" -and $version -notmatch '^[0-9A-Za-z][0-9A-Za-z.+-]*$') {
  throw "EXEORA_VERSION must contain only semver characters (for example 0.8.4 or 0.8.4-beta.1)."
}
$architecture = Get-ExeoraWindowsArchitecture
if ($architecture -ne "AMD64") {
  throw "Exeora currently supports Windows x64. Detected architecture: $architecture."
}
$asset = "exeora-x86_64-pc-windows-msvc.exe"
$base = "https://github.com/leynier/exeora/releases"
$releaseUrl = if ($version -eq "latest") {
  "$base/latest/download"
} else {
  "$base/download/cli-v$version"
}
$destination = if ($env:EXEORA_INSTALL_DIR) {
  $env:EXEORA_INSTALL_DIR
} else {
  Join-Path $env:LOCALAPPDATA "Exeora\bin"
}

$executable = Join-Path $destination "exeora.exe"
$tempDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ("exeora-" + [guid]::NewGuid().ToString("N"))
$checksumFile = Join-Path $tempDirectory "checksums-sha256.txt"
$temporaryExecutable = Join-Path $tempDirectory "exeora.exe"
try {
  New-Item -ItemType Directory -Path $tempDirectory -ErrorAction Stop | Out-Null
  Invoke-WebRequest -UseBasicParsing -MaximumRedirection 5 -TimeoutSec 120 -Uri "$releaseUrl/$asset" -OutFile $temporaryExecutable
  Invoke-WebRequest -UseBasicParsing -MaximumRedirection 5 -TimeoutSec 120 -Uri "$releaseUrl/checksums-sha256.txt" -OutFile $checksumFile
  $escapedAsset = [regex]::Escape($asset)
  $lines = @(Get-Content -LiteralPath $checksumFile | Where-Object { $_ -match "^\s*[0-9A-Fa-f]{64}\s+$escapedAsset\s*$" })
  if ($lines.Count -ne 1) { throw "The release must contain exactly one valid checksum for $asset." }
  $expected = ([regex]::Match($lines[0], '^\s*([0-9A-Fa-f]{64})\s+').Groups[1].Value).ToLowerInvariant()
  $actual = (Get-FileHash -Algorithm SHA256 $temporaryExecutable).Hash.ToLowerInvariant()
  if ($actual -ne $expected) { throw "Exeora checksum verification failed." }
  New-Item -ItemType Directory -Force -Path $destination -ErrorAction Stop | Out-Null
  Move-Item -Force $temporaryExecutable $executable
} finally {
  Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $tempDirectory
}

$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
$pathEntries = @()
if ($userPath) {
  $pathEntries = $userPath -split ";"
}
if ($pathEntries -notcontains $destination) {
  $newPath = if ($userPath) { "$userPath;$destination" } else { $destination }
  [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
}
Write-Host "Installed exeora in $destination. Open a new terminal to use it."
