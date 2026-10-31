<#
.SYNOPSIS
  Tests for cut.ps1 and install.ps1 (plain PowerShell asserts, no Pester). Exit code = number of failures.

.DESCRIPTION
  Every case runs a script as a child process from the temp directory (never the repo), and asserts its exit
  code, exactly one final OK/FAILED line, and a log under .tmp\owner-runs. The scripts run from a COPY inside a
  disposable git repo (main branch, a local bare remote, signing off), so cut.ps1 really bumps, commits, tags
  and pushes there and nothing touches this checkout or GitHub.

  The install case packs this checkout and installs it for real into a sandbox: npm_config_prefix and
  DOCKET_HOME point into the temp folder and DOCKET_HOOK_TEMPLATE at the vendored hook template, so the
  machine's global npm, gate and hooks are untouched. -Quick skips it.

  Run: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\release\release-scripts.test.ps1 [-Quick]
  (npm run test:scripts). Works from any directory.
.PARAMETER Quick
  Skip the sandboxed real install (npm pack + npm install).
#>
[CmdletBinding()]
param([switch]$Quick)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
$shell = (Get-Process -Id $PID).Path
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$work = Join-Path ([System.IO.Path]::GetTempPath()) ("docket-release-test-{0}" -f [guid]::NewGuid().ToString('N').Substring(0, 8))
$script:failures = 0
. (Join-Path $PSScriptRoot 'docket-release.ps1')

function Invoke-Git([string]$Dir, [string[]]$GitArgs) {
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { $out = @(& git -C $Dir @GitArgs 2>&1 | ForEach-Object { [string]$_ }) } finally { $ErrorActionPreference = $prev }
  if ($LASTEXITCODE -ne 0) { throw "git $($GitArgs -join ' ') failed: $($out -join ' ')" }
  return $out
}

function Assert([bool]$Condition, [string]$Message) {
  if (-not $Condition) { $script:caseProblems += $Message }
}

function Invoke-Case([string]$Title, [string]$Script, [string[]]$Arguments, [int]$ExpectExit, [scriptblock]$Check, [hashtable]$Env) {
  $script:caseProblems = @()
  $file = Join-Path $script:scripts $Script
  $saved = @{}
  if ($Env) { foreach ($k in $Env.Keys) { $saved[$k] = [Environment]::GetEnvironmentVariable($k); [Environment]::SetEnvironmentVariable($k, $Env[$k]) } }
  Push-Location -LiteralPath ([System.IO.Path]::GetTempPath())
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { $out = @(& $shell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $file @Arguments 2>&1 | ForEach-Object { [string]$_ }) }
  finally {
    $ErrorActionPreference = $prev
    Pop-Location
    foreach ($k in $saved.Keys) { [Environment]::SetEnvironmentVariable($k, $saved[$k]) }
  }
  $code = $LASTEXITCODE
  $kind = if ($ExpectExit -eq 0) { 'OK' } else { 'FAILED' }
  Assert ($code -eq $ExpectExit) "exit $code, expected $ExpectExit"
  $verdicts = @($out | Where-Object { $_ -match '^(OK|FAILED) \(exit \d+\) log: ' })
  Assert ($verdicts.Count -eq 1) "$($verdicts.Count) verdict lines, expected exactly 1"
  $last = $out | Where-Object { $_ -match '\S' } | Select-Object -Last 1
  if ($last -match ('^{0} \(exit (\d+)\) log: (.+)$' -f $kind)) {
    $log = $Matches[2].Trim()
    Assert (Test-Path -LiteralPath $log) "log missing: $log"
    Assert ($log -like "*\.tmp\owner-runs\*") "log not under .tmp\owner-runs: $log"
  } else {
    Assert $false "last line: $last"
  }
  if ($Check) { & $Check $out }
  if ($script:caseProblems.Count) {
    $script:failures++
    Write-Host "FAIL: $Title -> $($script:caseProblems -join '; ')" -ForegroundColor Red
    $out | ForEach-Object { Write-Host "  $_" }
  } else {
    Write-Host "PASS: $Title" -ForegroundColor Green
  }
}

function Write-Checksum([string]$Tarball, [string]$Hash) {
  if (-not $Hash) { $Hash = Get-Sha256Hex $Tarball }
  [System.IO.File]::WriteAllText("$Tarball.sha256", "$Hash  $(Split-Path -Leaf $Tarball)`n")
}

try {
  # ---- A disposable repo with a copy of the scripts, on main, with a bare origin -----------------
  $repo = Join-Path $work 'repo'
  $remote = Join-Path $work 'remote.git'
  $script:scripts = Join-Path $repo 'scripts\release'
  New-Item -ItemType Directory -Path $script:scripts -Force | Out-Null
  foreach ($f in 'owner-run.ps1', 'docket-release.ps1', 'cut.ps1', 'install.ps1') { Copy-Item (Join-Path $PSScriptRoot $f) $script:scripts }
  [System.IO.File]::WriteAllText((Join-Path $repo 'package.json'), "{`n  `"name`": `"docket`",`n  `"version`": `"0.8.0`"`n}`n")
  [System.IO.File]::WriteAllText((Join-Path $repo '.gitignore'), ".tmp/`n")
  Invoke-Git $work @('init', '-q', '--bare', '--initial-branch=main', $remote) | Out-Null
  Invoke-Git $work @('init', '-q', '-b', 'main', $repo) | Out-Null
  foreach ($kv in @(@('user.name', 'test'), @('user.email', 'test@docket'), @('commit.gpgsign', 'false'), @('tag.gpgsign', 'false'), @('core.autocrlf', 'false'))) {
    Invoke-Git $repo @('config', $kv[0], $kv[1]) | Out-Null
  }
  Invoke-Git $repo @('add', '-A') | Out-Null
  Invoke-Git $repo @('commit', '-q', '-m', 'initial') | Out-Null
  Invoke-Git $repo @('remote', 'add', 'origin', $remote) | Out-Null
  Invoke-Git $repo @('push', '-q', 'origin', 'main') | Out-Null
  $version = { ((Get-Content -Raw (Join-Path $repo 'package.json')) | ConvertFrom-Json).version }
  $remoteTags = { @(Invoke-Git $repo @('ls-remote', '--tags', 'origin') | ForEach-Object { ($_ -split '\s+')[1] }) }

  # ---- cut.ps1 ------------------------------------------------------------------------------------
  Invoke-Case 'cut -DryRun passes its preconditions and changes nothing' 'cut.ps1' @('-Version', '0.8.1', '-SkipChecks', '-DryRun') 0 {
    Assert ((& $version) -eq '0.8.0') 'package.json changed'
    Assert (-not (Invoke-Git $repo @('tag', '--list'))) 'a tag was created'
  }
  Invoke-Case 'cut refuses a version that is not greater' 'cut.ps1' @('-Version', '0.8.0', '-SkipChecks', '-DryRun') 1 {
    param($out) Assert (@($out | Where-Object { $_ -match 'not greater' }).Count -eq 1) 'no "not greater" refusal'
  }
  Invoke-Case 'cut refuses a malformed version' 'cut.ps1' @('-Version', '0.9', '-SkipChecks', '-DryRun') 1
  [System.IO.File]::WriteAllText((Join-Path $repo 'dirty.txt'), 'x')
  Invoke-Case 'cut refuses a dirty working tree' 'cut.ps1' @('-Version', '0.8.1', '-SkipChecks', '-DryRun') 1
  Remove-Item -LiteralPath (Join-Path $repo 'dirty.txt')
  Invoke-Git $repo @('switch', '-q', '-c', 'feature') | Out-Null
  Invoke-Case 'cut refuses a branch other than main' 'cut.ps1' @('-Version', '0.8.1', '-SkipChecks', '-DryRun') 1
  Invoke-Git $repo @('switch', '-q', 'main') | Out-Null

  Invoke-Case 'cut bumps, commits and tags without pushing' 'cut.ps1' @('-Version', '0.8.1', '-SkipChecks') 0 {
    Assert ((& $version) -eq '0.8.1') 'package.json not bumped'
    Assert ((Invoke-Git $repo @('tag', '--list', 'v0.8.1')) -eq 'v0.8.1') 'tag v0.8.1 missing'
    Assert ((Invoke-Git $repo @('log', '-1', '--format=%s')) -eq 'Release v0.8.1') 'release commit missing'
    Assert (-not ((& $remoteTags) -contains 'refs/tags/v0.8.1')) 'pushed without -Push'
  }
  Invoke-Case 'cut refuses a tag that already exists' 'cut.ps1' @('-Version', '0.8.1', '-SkipChecks', '-DryRun') 1
  Invoke-Case 'cut -Push with a wrong confirmation pushes nothing' 'cut.ps1' @('-Version', '0.8.2', '-SkipChecks', '-Push', '-ConfirmPush', 'yes') 0 {
    Assert (-not ((& $remoteTags) -contains 'refs/tags/v0.8.2')) 'pushed without the typed tag'
  }
  Invoke-Case 'cut -Push with no confirmation (non-interactive) pushes nothing' 'cut.ps1' @('-Version', '0.8.3', '-SkipChecks', '-Push') 0 {
    Assert (-not ((& $remoteTags) -contains 'refs/tags/v0.8.3')) 'pushed without confirmation'
  }
  Invoke-Case 'cut -Push -ConfirmPush v<version> pushes main and the tag atomically' 'cut.ps1' @('-Version', '0.8.4', '-SkipChecks', '-Push', '-ConfirmPush', 'v0.8.4') 0 {
    Assert ((& $remoteTags) -contains 'refs/tags/v0.8.4') 'tag not pushed'
    $head = Invoke-Git $repo @('rev-parse', 'HEAD')
    $remoteMain = (Invoke-Git $repo @('ls-remote', 'origin', 'refs/heads/main') | Select-Object -First 1) -split '\s+'
    Assert ($remoteMain[0] -eq $head) 'main not pushed'
  }
  # Someone else pushed to main: this checkout no longer contains origin/main.
  $other = Join-Path $work 'other'
  Invoke-Git $work @('clone', '-q', '-b', 'main', $remote, $other) | Out-Null
  foreach ($kv in @(@('user.name', 'test'), @('user.email', 'test@docket'), @('commit.gpgsign', 'false'))) { Invoke-Git $other @('config', $kv[0], $kv[1]) | Out-Null }
  Invoke-Git $other @('commit', '-q', '--allow-empty', '-m', 'elsewhere') | Out-Null
  Invoke-Git $other @('push', '-q', 'origin', 'main') | Out-Null
  Invoke-Case 'cut refuses when origin/main is not in this main' 'cut.ps1' @('-Version', '0.8.5', '-SkipChecks', '-DryRun') 1 {
    param($out) Assert (@($out | Where-Object { $_ -match 'pull first' }).Count -eq 1) 'no "pull first" refusal'
  }

  # ---- install.ps1 --------------------------------------------------------------------------------
  $fake = Join-Path $work 'fake'
  New-Item -ItemType Directory -Path $fake -Force | Out-Null
  $tgz = Join-Path $fake 'docket-0.8.4.tgz'
  [System.IO.File]::WriteAllBytes($tgz, [byte[]](1..64))
  Write-Checksum $tgz
  Invoke-Case 'install -DryRun verifies a local tarball checksum' 'install.ps1' @('-TarballPath', $tgz, '-DryRun') 0 {
    param($out) Assert (@($out | Where-Object { $_ -match 'SHA-256 verified' }).Count -eq 1) 'checksum not verified'
  }
  Invoke-Case 'install -DryRun -Tag (no gh call) plans the download' 'install.ps1' @('-Tag', 'v0.8.4', '-DryRun') 0
  Invoke-Case 'install refuses a tag that does not match the tarball' 'install.ps1' @('-TarballPath', $tgz, '-Tag', 'v0.9.0', '-DryRun') 2
  Invoke-Case 'install refuses a malformed tag' 'install.ps1' @('-Tag', '0.8.4', '-DryRun') 1
  # pwsh 7 parents leak their PSModulePath into 5.1 children; the checksum path must not depend on Utility .psm1 functions.
  $pwshMods = @{ PSModulePath = ((Join-Path $work 'pwsh7Modules') + ';' + $env:PSModulePath) }
  Invoke-Case 'install -DryRun verifies the checksum under a pwsh-7-style PSModulePath' 'install.ps1' @('-TarballPath', $tgz, '-DryRun') 0 -Env $pwshMods -Check {
    param($out) Assert (@($out | Where-Object { $_ -match 'SHA-256 verified' }).Count -eq 1) 'checksum not verified'
  }
  $offenders = @(Get-ChildItem -LiteralPath $PSScriptRoot -Filter '*.ps1' | Where-Object { $_.Name -ne 'release-scripts.test.ps1' } |
    Select-String -Pattern '(Get-FileHash|New-TemporaryFile|Format-Hex|Import-PowerShellDataFile)' | ForEach-Object { "$($_.Filename):$($_.LineNumber)" })
  if ($offenders.Count) { $script:failures++; Write-Host "FAIL: pwsh-7-fragile Utility function used: $($offenders -join ', ')" -ForegroundColor Red }
  else { Write-Host 'PASS: no 5.1 Utility script functions in the release scripts' -ForegroundColor Green }
  Write-Checksum $tgz ('0' * 64)
  Invoke-Case 'install refuses a checksum mismatch' 'install.ps1' @('-TarballPath', $tgz, '-DryRun') 2 {
    param($out) Assert (@($out | Where-Object { $_ -match 'SHA-256 mismatch' }).Count -ge 1) 'no mismatch reason'
  }
  Remove-Item -LiteralPath "$tgz.sha256"
  Invoke-Case 'install refuses a tarball without a checksum file' 'install.ps1' @('-TarballPath', $tgz, '-DryRun') 2
  $odd = Join-Path $fake 'other-1.0.0.tgz'
  [System.IO.File]::WriteAllBytes($odd, [byte[]](1..8))
  Write-Checksum $odd
  Invoke-Case 'install refuses a tarball that is not docket-<version>.tgz' 'install.ps1' @('-TarballPath', $odd, '-DryRun') 1

  if ($Quick) {
    Write-Host 'SKIP: sandboxed real install (-Quick)' -ForegroundColor Yellow
  } else {
    # Pack THIS checkout, then install it for real into a sandboxed npm prefix and DOCKET_HOME.
    $packDir = Join-Path $work 'pack'
    New-Item -ItemType Directory -Path $packDir -Force | Out-Null
    $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    Push-Location -LiteralPath $repoRoot
    try { $packed = @(& npm.cmd pack --pack-destination $packDir --silent 2>&1 | ForEach-Object { [string]$_ }) } finally { Pop-Location; $ErrorActionPreference = $prev }
    if ($LASTEXITCODE -ne 0) { throw "npm pack failed: $($packed -join ' ')" }
    $real = Get-ChildItem -LiteralPath $packDir -Filter 'docket-*.tgz' | Select-Object -First 1
    Write-Checksum $real.FullName
    $gated = Join-Path $work 'gated'
    Invoke-Git $work @('init', '-q', $gated) | Out-Null
    $sandbox = @{
      npm_config_prefix              = (Join-Path $work 'prefix')
      DOCKET_HOME                    = (Join-Path $work 'home')
      DOCKET_HOOK_TEMPLATE           = (Join-Path $repoRoot 'tests\fixtures\hooks\pre-push.template.sh')
    }
    Invoke-Case 'install installs, promotes and opts a repo in (sandboxed)' 'install.ps1' @('-TarballPath', $real.FullName, '-GateRepo', $gated) 0 -Env $sandbox -Check {
      Assert (Test-Path -LiteralPath (Join-Path $work 'prefix\node_modules\docket\src\cli\main.mjs')) 'not installed into the sandbox prefix'
      Assert (Test-Path -LiteralPath (Join-Path $work 'home\gate\active.json')) 'gate not promoted into the sandbox DOCKET_HOME'
      $launcher = @(Invoke-Git $gated @('config', '--get', 'docket.gateLauncher'))
      Assert ($launcher.Count -eq 1 -and $launcher[0] -like '*home/gate/*') "gate not installed in the repo: $launcher"
      Assert (Test-Path -LiteralPath (Join-Path $gated '.git\hooks\pre-push')) 'pre-push hook not written'
    }
  }
} catch {
  $script:failures++
  Write-Host "FAIL: harness error: $($_.Exception.Message)" -ForegroundColor Red
} finally {
  Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host "`nFailures: $script:failures"
exit $script:failures
