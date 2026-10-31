<#
.SYNOPSIS
  Install a Docket release: download its tarball (gh), verify the SHA-256, npm install --global it,
  promote it as the last-good gate and opt repos into the gate.

.DESCRIPTION
  Owner-run (ADR-31). The release workflow attaches docket-<version>.tgz and docket-<version>.tgz.sha256
  to a draft GitHub Release; this script installs either asset pair:

    1. Resolve the release: -Tag, or the latest PUBLISHED release (a draft needs -Tag).
    2. Download both assets with gh into <repo>\.tmp\releases\<tag>-<stamp>\ (a new, empty folder).
    3. Refuse unless the tarball is docket-<version>.tgz for tag v<version> and its SHA-256 matches.
    4. npm install --global <absolute tarball path>   (a relative path would be read as a GitHub spec)
    5. docket gate promote <absolute tarball path>     (the tested last-good copy the pre-push hook runs)
    6. docket gate install --repo <repo>                for each -GateRepo (default: this Docket checkout)

  Steps 5 and 6 run the INSTALLED package (node <npm root -g>\docket\src\cli\main.mjs), never this
  checkout. Works from any directory (cmd, PowerShell 5.1 or 7): the repo is found from $PSScriptRoot.
  Each run logs to <repo>\.tmp\owner-runs\install-<stamp>-<pid>.log and ends with
  "OK (exit 0) log: <path>" or "FAILED (exit N) log: <path>".

  Exit codes: 0 installed (or dry run completed), 1 a prerequisite or input is missing or invalid,
  2 the download or verification failed (nothing installed), 3 an install step failed.

.PARAMETER Tag
  Release tag to install, like v0.8.1. Default: the latest published release.
.PARAMETER TarballPath
  Install a local docket-<version>.tgz instead of downloading. Its checksum file
  (<TarballPath>.sha256) must sit beside it. No gh needed.
.PARAMETER GateRepo
  Repositories to run `docket gate install --repo` on. Default: this Docket checkout.
.PARAMETER SkipGateInstall
  Install and promote only; opt no repository in.
.PARAMETER DryRun
  Change nothing: no download, no install, no promote. Resolves the latest tag with a read-only gh call
  when -Tag is not given, and verifies -TarballPath's checksum (read-only) when given.
.PARAMETER Repository
  GitHub repository (default dirtyredz/Docket).

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\dirty\projects\docket\scripts\release\install.ps1 -Tag v0.8.1 -DryRun
#>
[CmdletBinding()]
param(
  [string]$Tag,
  [string]$TarballPath,
  [string[]]$GateRepo,
  [switch]$SkipGateInstall,
  [switch]$DryRun,
  [string]$Repository = 'dirtyredz/Docket'
)
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'owner-run.ps1')
. (Join-Path $PSScriptRoot 'docket-release.ps1')
Initialize-OwnerRun 'install'
$mode = if ($DryRun) { 'dry run' } else { 'execute' }
Write-Log "Docket install ($mode). Repo: $script:RepoRoot"

try {
  $node = Get-RequiredTool 'node'
  $npm = Get-RequiredTool 'npm'
  if (-not $GateRepo) { $GateRepo = @($script:RepoRoot) }
  $GateRepo = @($GateRepo | ForEach-Object { [System.IO.Path]::GetFullPath($_) })

  # ---- 1-2. The tarball and its checksum ---------------------------------------------------------
  if ($TarballPath) {
    if (-not (Test-Path -LiteralPath $TarballPath -PathType Leaf)) { Complete-OwnerRun 1 "tarball not found: $TarballPath" }
    $tarball = (Resolve-Path -LiteralPath $TarballPath).Path
    Write-Log "Local tarball: $tarball"
  } else {
    $gh = Get-RequiredTool 'gh'
    if (-not $Tag) {
      $latest = Invoke-Capture $gh @('release', 'view', '--repo', $Repository, '--json', 'tagName', '--jq', '.tagName')
      if ($latest.Code -ne 0 -or -not $latest.Lines) { Complete-OwnerRun 1 "no published release found in $Repository (a draft needs -Tag)." }
      $Tag = ([string]$latest.Lines[0]).Trim()
      Write-Log "Latest published release: $Tag"
    }
    $version = $Tag -replace '^v', ''
    if (-not $Tag.StartsWith('v') -or -not (Test-ReleaseVersion $version)) { Complete-OwnerRun 1 "tag must be v<major.minor.patch>, not '$Tag'." }
    $dir = Join-Path $script:RepoRoot (".tmp/releases/{0}-{1}" -f $Tag, (Get-Date -Format 'yyyyMMdd-HHmmss'))
    $tarball = Join-Path $dir "docket-$version.tgz"
    if ($DryRun) {
      Write-Log "DRY RUN: would download docket-$version.tgz and its .sha256 from $Repository $Tag into $dir"
    } else {
      New-Item -ItemType Directory -Path $dir -Force | Out-Null
      $code = Invoke-Native $gh @('release', 'download', $Tag, '--repo', $Repository, '--pattern', "docket-$version.tgz*", '--dir', $dir)
      if ($code -ne 0) { Complete-OwnerRun 2 "gh release download failed (exit $code)." }
    }
  }

  # ---- 3. Name, version and SHA-256 --------------------------------------------------------------
  $leaf = Split-Path -Leaf $tarball
  $tarVersion = $leaf -replace '^docket-(.*)\.tgz$', '$1'
  if ($tarVersion -eq $leaf -or -not (Test-ReleaseVersion $tarVersion)) { Complete-OwnerRun 1 "not a Docket release tarball name: $leaf" }
  if ($Tag -and $Tag -ne "v$tarVersion") { Complete-OwnerRun 2 "tarball $leaf does not match tag $Tag." }
  if (Test-Path -LiteralPath $tarball) {
    $problem = Test-TarballChecksum $tarball "$tarball.sha256"
    if ($problem) { Complete-OwnerRun 2 $problem }
  } elseif (-not $DryRun) {
    Complete-OwnerRun 2 "download produced no $leaf."
  } else {
    Write-Log "DRY RUN: would verify $leaf against $leaf.sha256"
  }

  # ---- 4-6. Install, promote, opt in -------------------------------------------------------------
  $cli = $null
  if (-not $DryRun) {
    $code = Invoke-Native $npm @('install', '--global', $tarball)
    if ($code -ne 0) { Complete-OwnerRun 3 "npm install --global failed (exit $code)." }
    $root = Invoke-Capture $npm @('root', '--global')
    if ($root.Code -ne 0 -or -not $root.Lines) { Complete-OwnerRun 3 'npm root --global failed.' }
    $cli = Join-Path ([string]$root.Lines[-1]).Trim() 'docket\src\cli\main.mjs'
    if (-not (Test-Path -LiteralPath $cli)) { Complete-OwnerRun 3 "installed CLI not found: $cli" }
    $installed = Invoke-Capture $node @($cli, '--version')
    Write-Log "Installed docket: $(($installed.Lines -join ' ').Trim())"
  }
  if ($DryRun) {
    Write-Log "DRY RUN: would run npm install --global $tarball"
    Write-Log "DRY RUN: would run docket gate promote $tarball"
  } else {
    $code = Invoke-Native $node @($cli, 'gate', 'promote', $tarball)
    if ($code -ne 0) { Complete-OwnerRun 3 "docket gate promote failed (exit $code); the previous last-good gate stays active." }
  }
  if ($SkipGateInstall) {
    Write-Log 'Gate install skipped (-SkipGateInstall).'
  } else {
    foreach ($repo in $GateRepo) {
      if ($DryRun) { Write-Log "DRY RUN: would run docket gate install --repo $repo"; continue }
      $code = Invoke-Native $node @($cli, 'gate', 'install', '--repo', $repo)
      if ($code -ne 0) { Complete-OwnerRun 3 "docket gate install --repo $repo failed (exit $code)." }
    }
  }
} catch {
  Complete-OwnerRun 1 "unexpected error: $($_.Exception.Message)"
}
Complete-OwnerRun 0
