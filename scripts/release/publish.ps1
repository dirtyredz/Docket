<#
.SYNOPSIS
  Publish the DRAFT GitHub Release for -Tag (the release workflow creates it as a draft, ADR-31).

.DESCRIPTION
  Refuses unless the release exists, is a draft, and carries docket-<version>.tgz and its .sha256.
  Logs to <repo>\.tmp\owner-runs\publish-<stamp>-<pid>.log and ends with "OK (exit 0) log: <path>" or
  "FAILED (exit N) log: <path>". Exit codes: 0 published (or dry run), 1 bad input or prerequisite,
  2 the release is missing, already published or lacks its assets, 3 gh failed.

.PARAMETER Tag
  Release tag, like v0.10.0.
.PARAMETER DryRun
  Check the draft and its assets; publish nothing.
.PARAMETER Repository
  GitHub repository (default dirtyredz/Docket).

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\dirty\projects\docket\scripts\release\publish.ps1 -Tag v0.10.0 -DryRun
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$Tag,
  [switch]$DryRun,
  [string]$Repository = 'dirtyredz/Docket'
)
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'owner-run.ps1')
. (Join-Path $PSScriptRoot 'docket-release.ps1')
Initialize-OwnerRun 'publish'
Write-Log ("Docket publish ({0}). Repo: {1}" -f $(if ($DryRun) { 'dry run' } else { 'execute' }), $script:RepoRoot)

try {
  $version = $Tag -replace '^v', ''
  if (-not $Tag.StartsWith('v') -or -not (Test-ReleaseVersion $version)) { Complete-OwnerRun 1 "tag must be v<major.minor.patch>, not '$Tag'." }
  $gh = Get-RequiredTool 'gh'
  $draftQ = Invoke-Capture $gh @('release', 'view', $Tag, '--repo', $Repository, '--json', 'isDraft', '--jq', '.isDraft')
  if ($draftQ.Code -ne 0 -or -not $draftQ.Lines) { Complete-OwnerRun 2 "no release $Tag in $Repository (is the release workflow done?)." }
  if (([string]$draftQ.Lines[-1]).Trim() -ne 'true') { Complete-OwnerRun 2 "release $Tag is already published; nothing to do." }
  $namesQ = Invoke-Capture $gh @('release', 'view', $Tag, '--repo', $Repository, '--json', 'assets', '--jq', '.assets[].name')
  $assets = @($namesQ.Lines | ForEach-Object { ([string]$_).Trim() })
  foreach ($need in @("docket-$version.tgz", "docket-$version.tgz.sha256")) {
    if ($assets -notcontains $need) { Complete-OwnerRun 2 "draft $Tag lacks asset $need." }
  }
  if ($DryRun) { Write-Log "DRY RUN: would publish draft $Tag (assets present)."; Complete-OwnerRun 0 'dry run completed' }
  $code = Invoke-Native $gh @('release', 'edit', $Tag, '--repo', $Repository, '--draft=false')
  if ($code -ne 0) { Complete-OwnerRun 3 "gh release edit failed (exit $code)." }
  Write-Log "Published $Tag."
  Complete-OwnerRun 0 "published $Tag"
} catch {
  Complete-OwnerRun 1 $_.Exception.Message
}
