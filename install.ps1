$ErrorActionPreference = "Stop"

function Get-ExeoraWindowsArchitecture {
  if ($env:PROCESSOR_ARCHITEW6432) {
    return $env:PROCESSOR_ARCHITEW6432
  }
  return $env:PROCESSOR_ARCHITECTURE
}

$version = if ($env:EXEORA_VERSION) { $env:EXEORA_VERSION } else { "latest" }
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

New-Item -ItemType Directory -Force -Path $destination | Out-Null
$executable = Join-Path $destination "exeora.exe"
$checksumFile = Join-Path ([System.IO.Path]::GetTempPath()) "exeora-checksums-$PID.txt"
$temporaryExecutable = Join-Path ([System.IO.Path]::GetTempPath()) "exeora-$PID.exe"
try {
  Invoke-WebRequest -UseBasicParsing -Uri "$releaseUrl/$asset" -OutFile $temporaryExecutable
  Invoke-WebRequest -UseBasicParsing -Uri "$releaseUrl/checksums-sha256.txt" -OutFile $checksumFile
  $line = Get-Content $checksumFile | Where-Object { $_ -match "\s+$([regex]::Escape($asset))$" }
  if (-not $line) { throw "The release has no checksum for $asset." }
  $expected = ($line -split "\s+")[0].ToLowerInvariant()
  $actual = (Get-FileHash -Algorithm SHA256 $temporaryExecutable).Hash.ToLowerInvariant()
  if ($actual -ne $expected) { throw "Exeora checksum verification failed." }
  Move-Item -Force $temporaryExecutable $executable
} finally {
  Remove-Item -Force -ErrorAction SilentlyContinue $checksumFile
  Remove-Item -Force -ErrorAction SilentlyContinue $temporaryExecutable
}

$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if (($userPath -split ";") -notcontains $destination) {
  [Environment]::SetEnvironmentVariable("Path", "$userPath;$destination", "User")
}
Write-Host "Installed exeora in $destination. Open a new terminal to use it."
