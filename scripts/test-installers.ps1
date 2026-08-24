$ErrorActionPreference = "Stop"

$installerPath = Join-Path $PSScriptRoot "..\install.ps1"
$source = Get-Content -Raw $installerPath
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseInput(
  $source,
  [ref]$null,
  [ref]$parseErrors
)
if ($parseErrors.Count -gt 0) {
  throw "install.ps1 did not parse: $($parseErrors[0].Message)"
}

$functionAst = $ast.Find(
  { param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq "Get-ExeoraWindowsArchitecture" },
  $true
)
if (-not $functionAst) {
  throw "install.ps1 does not define Get-ExeoraWindowsArchitecture."
}

$architectureScript = [scriptblock]::Create(
  "$($functionAst.Extent.Text)`nGet-ExeoraWindowsArchitecture"
)
$originalProcessorArchitecture = $env:PROCESSOR_ARCHITECTURE
$originalProcessorArchitew6432 = $env:PROCESSOR_ARCHITEW6432
try {
  $env:PROCESSOR_ARCHITECTURE = "x86"
  $env:PROCESSOR_ARCHITEW6432 = "AMD64"
  if ((& $architectureScript) -ne "AMD64") {
    throw "The WOW64 override was not detected as AMD64."
  }

  Remove-Item Env:PROCESSOR_ARCHITEW6432 -ErrorAction SilentlyContinue
  if ((& $architectureScript) -ne "x86") {
    throw "The native process architecture fallback was not detected as x86."
  }
} finally {
  if ($null -eq $originalProcessorArchitecture) {
    Remove-Item Env:PROCESSOR_ARCHITECTURE -ErrorAction SilentlyContinue
  } else {
    $env:PROCESSOR_ARCHITECTURE = $originalProcessorArchitecture
  }
  if ($null -eq $originalProcessorArchitew6432) {
    Remove-Item Env:PROCESSOR_ARCHITEW6432 -ErrorAction SilentlyContinue
  } else {
    $env:PROCESSOR_ARCHITEW6432 = $originalProcessorArchitew6432
  }
}

Write-Host "Windows installer architecture detection passed."
