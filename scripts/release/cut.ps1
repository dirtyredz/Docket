<#
.SYNOPSIS
  Cut a Docket release: bump package.json to -Version, commit, and tag v<Version>. Pushes only with
  -Push AND a typed confirmation.

.DESCRIPTION
  Owner-run (ADR-31). Pushing the v<Version> tag starts .github/workflows/release.yml, which re-runs the
  full CI gate on the tagged commit and creates a DRAFT GitHub Release with docket-<Version>.tgz and its
  SHA-256. Publishing that draft stays a manual step on GitHub.

    1. Refuse unless -Version is major.minor.patch and greater than package.json's version, the
       checkout is on main with a clean working tree, main contains <Remote>/main, and the tag
       exists neither locally nor on <Remote>.
    2. Fast gate (skip with -SkipChecks): npm run lint, npm run format:check, dk check.
    3. npm version <Version> --no-git-tag-version (package.json and package-lock.json).
    4. git commit "Release v<Version>", git tag -a v<Version>.
    5. Only with -Push: asks you to type v<Version> (or pass -ConfirmPush v<Version>), then
       git push --atomic <Remote> main v<Version>. Without a confirmation nothing is pushed and
       the command to push later is printed.

  Works from any directory (cmd, PowerShell 5.1 or 7): the repo is found from $PSScriptRoot. Each run
  logs to <repo>\.tmp\owner-runs\cut-<stamp>-<pid>.log and ends with "OK (exit 0) log: <path>" or
  "FAILED (exit N) log: <path>". A dry run checks every precondition and runs the fast gate, then
  changes nothing; it fails (exit 1) when the real run would refuse.

  Exit codes: 0 cut (pushed, or left to push), or dry run passed; 1 a prerequisite, input or
  precondition failed (nothing changed); 2 a step failed after checks passed (see the log for what
  was already committed or tagged).

.PARAMETER Version
  The new version, like 0.8.1. Required.
.PARAMETER Push
  Push main and the tag after cutting, once confirmed.
.PARAMETER ConfirmPush
  Non-interactive confirmation for -Push: must equal v<Version> exactly.
.PARAMETER SkipChecks
  Skip the fast gate (CI and the release workflow still run the full gate).
.PARAMETER Remote
  Git remote to compare against and push to (default origin).
.PARAMETER DryRun
  Check and report; change nothing (no bump, commit, tag or push).

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\dirty\projects\docket\scripts\release\cut.ps1 -Version 0.8.1 -DryRun
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Version,
  [switch]$Push,
  [string]$ConfirmPush,
  [switch]$SkipChecks,
  [string]$Remote = 'origin',
  [switch]$DryRun
)
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'owner-run.ps1')
. (Join-Path $PSScriptRoot 'docket-release.ps1')
Initialize-OwnerRun 'cut'
$mode = if ($DryRun) { 'dry run' } else { 'execute' }
$tag = "v$Version"
Write-Log "Docket cut $tag ($mode). Repo: $script:RepoRoot"

try {
  $git = Get-RequiredTool 'git'
  $npm = Get-RequiredTool 'npm'
  $node = Get-RequiredTool 'node'

  # ---- 1. Preconditions (all reported, then refused together) ------------------------------------
  if (-not (Test-ReleaseVersion $Version)) { Complete-OwnerRun 1 "-Version must be major.minor.patch, not '$Version'." }
  $current = Get-PackageVersion
  Write-Log "package.json version: $current"
  $problems = @()
  if ([version]$Version -le [version]$current) { $problems += "$Version is not greater than the current version $current" }
  $branch = Invoke-Capture $git @('symbolic-ref', '--quiet', '--short', 'HEAD')
  $branchName = if ($branch.Code -eq 0) { ([string]$branch.Lines[0]).Trim() } else { '(detached)' }
  if ($branchName -ne 'main') { $problems += "the checkout is on '$branchName', not main" }
  $status = Invoke-Capture $git @('status', '--porcelain')
  if ($status.Code -ne 0) { $problems += 'git status failed' }
  elseif (@($status.Lines | Where-Object { $_ -match '\S' }).Count) { $problems += 'the working tree has uncommitted changes' }
  $localTag = Invoke-Capture $git @('tag', '--list', $tag)
  if (@($localTag.Lines | Where-Object { $_ -match '\S' }).Count) { $problems += "tag $tag already exists locally" }
  $remoteMain = Invoke-Capture $git @('ls-remote', $Remote, 'refs/heads/main', "refs/tags/$tag")
  if ($remoteMain.Code -ne 0) {
    $problems += "cannot read remote '$Remote'"
  } else {
    foreach ($line in $remoteMain.Lines) {
      $parts = ([string]$line) -split '\s+'
      if ($parts.Count -lt 2) { continue }
      if ($parts[1] -eq "refs/tags/$tag") { $problems += "tag $tag already exists on $Remote" }
      if ($parts[1] -eq 'refs/heads/main') {
        $ancestor = Invoke-Capture $git @('merge-base', '--is-ancestor', $parts[0], 'HEAD')
        if ($ancestor.Code -ne 0) { $problems += "$Remote/main ($($parts[0].Substring(0, 8))) is not in this main: pull first" }
      }
    }
  }
  foreach ($p in $problems) { Write-Log "REFUSE: $p" }
  if ($problems.Count) { Complete-OwnerRun 1 "$($problems.Count) precondition(s) failed; nothing changed." }

  # ---- 2. Fast gate ------------------------------------------------------------------------------
  if ($SkipChecks) {
    Write-Log 'Fast gate skipped (-SkipChecks).'
  } else {
    foreach ($step in @(@($npm, @('run', 'lint')), @($npm, @('run', 'format:check')), @($node, @('src/cli/main.mjs', 'check')))) {
      $code = Invoke-Native $step[0] $step[1]
      if ($code -ne 0) { Complete-OwnerRun 1 "fast gate failed: $($step[1] -join ' ') (exit $code); nothing changed." }
    }
  }

  # ---- 3-4. Bump, commit, tag --------------------------------------------------------------------
  if ($DryRun) {
    Write-Log "DRY RUN: would run npm version $Version --no-git-tag-version"
    Write-Log "DRY RUN: would commit 'Release $tag' and create the annotated tag $tag"
  } else {
    $code = Invoke-Native $npm @('version', $Version, '--no-git-tag-version')
    if ($code -ne 0) { Complete-OwnerRun 2 "npm version failed (exit $code)." }
    if ((Get-PackageVersion) -ne $Version) { Complete-OwnerRun 2 "package.json does not read $Version after npm version." }
    $files = @('package.json')
    if (Test-Path -LiteralPath (Join-Path $script:RepoRoot 'package-lock.json')) { $files += 'package-lock.json' }
    $code = Invoke-Native $git (@('add', '--') + $files)
    if ($code -ne 0) { Complete-OwnerRun 2 "git add failed (exit $code); the version bump is uncommitted." }
    $code = Invoke-Native $git @('commit', '-m', "Release $tag")
    if ($code -ne 0) { Complete-OwnerRun 2 "git commit failed (exit $code); the version bump is staged, not committed." }
    $code = Invoke-Native $git @('tag', '-a', $tag, '-m', "Docket $Version")
    if ($code -ne 0) { Complete-OwnerRun 2 "git tag failed (exit $code); the release commit exists without its tag." }
  }

  # ---- 5. Push, only when confirmed --------------------------------------------------------------
  $pushCommand = "git push --atomic $Remote main $tag"
  if (-not $Push) {
    Write-Log "Not pushed (no -Push). To release: $pushCommand"
  } elseif ($DryRun) {
    Write-Log "DRY RUN: would ask you to type $tag, then run $pushCommand"
  } else {
    $answer = $ConfirmPush
    if (-not $answer) {
      try { $answer = Read-Host "Type $tag to push main and $tag to $Remote (anything else skips the push)" }
      catch { $answer = '' }
    }
    if ($answer -ne $tag) {
      Write-Log "Push not confirmed; nothing pushed. To release: $pushCommand"
    } else {
      $code = Invoke-Native $git @('push', '--atomic', $Remote, 'main', $tag)
      if ($code -ne 0) { Complete-OwnerRun 2 "push failed (exit $code); the commit and tag are local only. Retry: $pushCommand" }
      Write-Log "Pushed. The release workflow builds the draft for $tag."
    }
  }
} catch {
  Complete-OwnerRun 1 "unexpected error: $($_.Exception.Message)"
}
Complete-OwnerRun 0
