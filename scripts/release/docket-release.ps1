<#
.SYNOPSIS
  Docket release helpers shared by install.ps1 and cut.ps1 (dot-source after owner-run.ps1; functions only).

.DESCRIPTION
  owner-run.ps1 is the verbatim template copy (logging, final line, Invoke-Native); this file holds what is
  Docket-specific: required tools, captured native output, the package version, and the SHA-256 check
  that matches the release workflow's `sha256sum` file format.

  Functions: Get-RequiredTool, Invoke-Capture, Get-PackageVersion, Test-ReleaseVersion, Get-Sha256Hex, Test-TarballChecksum.

  The built-in file-hash cmdlet is deliberately not used: in Windows PowerShell 5.1 it is a script function in the Utility .psm1,
  which fails to load when the parent shell is pwsh 7 (its PSModulePath leaks in). .NET works from any shell.
#>

# The path of a tool on PATH, or end the run with exit 1 (a missing prerequisite).
function Get-RequiredTool([string]$Name) {
  $exe = Find-Tool $Name
  if (-not $exe) { Complete-OwnerRun 1 "$Name was not found on PATH." }
  Write-Log "${Name}: $exe"
  return $exe
}

# Runs a native command and returns @{ Code; Lines } without echoing it (for values the script reads).
# The command line is logged; its output is logged only when it fails.
function Invoke-Capture([string]$Exe, [string[]]$Arguments, [string]$WorkingDirectory) {
  if (-not $WorkingDirectory) { $WorkingDirectory = $script:RepoRoot }
  Write-Log ('> {0} {1}' -f $Exe, ($Arguments -join ' '))
  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  Push-Location -LiteralPath $WorkingDirectory
  try {
    $lines = @(& $Exe @Arguments 2>&1 | ForEach-Object { [string]$_ })
    $code = [int]$LASTEXITCODE
  } finally {
    Pop-Location
    $ErrorActionPreference = $prevEap
  }
  if ($code -ne 0) { foreach ($line in $lines) { Write-Log "  $line" } }
  return @{ Code = $code; Lines = $lines }
}

function Get-PackageVersion {
  $pkg = Get-Content -LiteralPath (Join-Path $script:RepoRoot 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  return [string]$pkg.version
}

# A release version is plain major.minor.patch (no prerelease or build suffix).
function Test-ReleaseVersion([string]$Value) {
  return $Value -match '^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$'
}

# Lowercase hex SHA-256 of a file via .NET (see the header note).
function Get-Sha256Hex([string]$Path) {
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $stream = [System.IO.File]::OpenRead((Resolve-Path -LiteralPath $Path).ProviderPath)
    try { return ([System.BitConverter]::ToString($sha.ComputeHash($stream)) -replace '-', '').ToLowerInvariant() }
    finally { $stream.Dispose() }
  } finally { $sha.Dispose() }
}

# Verifies $Tarball against its "<hex>  <name>" checksum file (sha256sum format, optional '*' binary marker).
# Returns $null when it matches, otherwise the reason.
function Test-TarballChecksum([string]$Tarball, [string]$ChecksumFile) {
  if (-not (Test-Path -LiteralPath $ChecksumFile)) { return "checksum file not found: $ChecksumFile" }
  $line = @(Get-Content -LiteralPath $ChecksumFile -Encoding UTF8 | Where-Object { $_ -match '\S' })
  if ($line.Count -ne 1 -or $line[0] -notmatch '^([0-9a-fA-F]{64}) [ *](.+)$') {
    return "checksum file is not one '<sha256>  <file>' line: $ChecksumFile"
  }
  $expected = $Matches[1].ToLowerInvariant()
  $named = $Matches[2].Trim()
  $leaf = Split-Path -Leaf $Tarball
  if ($named -ne $leaf) { return "checksum file names '$named', not '$leaf'" }
  $actual = Get-Sha256Hex $Tarball
  if ($actual -ne $expected) { return "SHA-256 mismatch for ${leaf}: expected $expected, got $actual" }
  Write-Log "SHA-256 verified: $actual  $leaf"
  return $null
}
