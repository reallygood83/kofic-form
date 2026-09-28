# kofic-hwp-form installer for Windows (PowerShell 5.1+)
#
#   irm https://raw.githubusercontent.com/reallygood83/kofic-form/main/install.ps1 | iex
#
# Env vars: KOFIC_FORM_DEST (default %USERPROFILE%\.agents\skills\kofic-hwp-form),
#           KOFIC_FORM_BRANCH (default main), HWPFORM_HOME (form library folder)
# Messages are ASCII on purpose (PowerShell 5.1 console encoding).
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$Repo   = if ($env:KOFIC_FORM_REPO)   { $env:KOFIC_FORM_REPO }   else { 'reallygood83/kofic-form' }
$Branch = if ($env:KOFIC_FORM_BRANCH) { $env:KOFIC_FORM_BRANCH } else { 'main' }
$Skill  = 'kofic-hwp-form'
$Dest   = if ($env:KOFIC_FORM_DEST)   { $env:KOFIC_FORM_DEST }   else { Join-Path $HOME ".agents\skills\$Skill" }
$NodeDir = Join-Path $env:LOCALAPPDATA 'kofic-hwp-form\node'

function Say($m) { Write-Host "[kofic-hwp-form] $m" -ForegroundColor Cyan }
function NodeOk($p) {
  if (-not $p -or -not (Test-Path $p)) { return $false }
  & $p -e "process.exit(Number(process.versions.node.split('.')[0])>=20?0:1)" 2>$null
  return ($LASTEXITCODE -eq 0)
}

# 1) Node.js 20+ (portable install into LOCALAPPDATA if missing; no admin rights needed)
$node = $null
$cmd = Get-Command node -ErrorAction SilentlyContinue
if ($cmd) { $node = $cmd.Source }
if (-not (NodeOk $node)) {
  $local = Join-Path $NodeDir 'node.exe'
  if (NodeOk $local) { $node = $local }
  else {
    Say "Node.js 20+ not found. Installing a portable copy into $NodeDir"
    $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
    $base = 'https://nodejs.org/dist/latest-v22.x'
    $sums = (Invoke-WebRequest "$base/SHASUMS256.txt" -UseBasicParsing).Content
    $file = $sums -split "`n" | ForEach-Object { ($_.Trim() -split '\s+')[-1] } | Where-Object { $_ -match "^node-v[\d.]+-win-$arch\.zip$" } | Select-Object -First 1
    if (-not $file) { throw 'Could not find a Node.js package. Install Node.js LTS from https://nodejs.org and run again.' }
    $zip = Join-Path $env:TEMP ("kofic-node-" + [guid]::NewGuid() + '.zip')
    $tmp = Join-Path $env:TEMP ("kofic-node-" + [guid]::NewGuid())
    Invoke-WebRequest "$base/$file" -OutFile $zip -UseBasicParsing
    Expand-Archive $zip -DestinationPath $tmp -Force
    New-Item -ItemType Directory -Force -Path $NodeDir | Out-Null
    $inner = (Get-ChildItem $tmp -Directory | Select-Object -First 1).FullName
    Copy-Item -Path (Join-Path $inner '*') -Destination $NodeDir -Recurse -Force
    Remove-Item $zip, $tmp -Recurse -Force
    $node = $local
  }
}
$env:Path = (Split-Path $node) + ';' + $env:Path
Say ('Node.js ' + (& $node -v))

# 2) Get skill files (use local repo files when run from a clone)
$src = $null
if ($PSScriptRoot -and (Test-Path (Join-Path $PSScriptRoot "skills\$Skill\SKILL.md"))) {
  $src = Join-Path $PSScriptRoot "skills\$Skill"
} else {
  $zip = Join-Path $env:TEMP ("kofic-form-" + [guid]::NewGuid() + '.zip')
  $tmp = Join-Path $env:TEMP ("kofic-form-" + [guid]::NewGuid())
  Say "Downloading github.com/$Repo ($Branch)"
  Invoke-WebRequest "https://codeload.github.com/$Repo/zip/refs/heads/$Branch" -OutFile $zip -UseBasicParsing
  Expand-Archive $zip -DestinationPath $tmp -Force
  $src = (Get-ChildItem $tmp -Recurse -Directory | Where-Object { $_.FullName -like "*\skills\$Skill" } | Select-Object -First 1).FullName
  if (-not $src) { throw "skills\$Skill folder not found in the downloaded repository." }
}

# 3) Copy into the install folder (keep an existing node_modules)
New-Item -ItemType Directory -Force -Path $Dest | Out-Null
if ((Resolve-Path $src).Path -ne (Resolve-Path $Dest).Path) {
  Get-ChildItem $Dest -Force | Where-Object { $_.Name -ne 'node_modules' } | Remove-Item -Recurse -Force
  Get-ChildItem $src -Force | Where-Object { $_.Name -ne 'node_modules' } | Copy-Item -Destination $Dest -Recurse -Force
}
Say "Installed to $Dest"

# 4) Install kordoc + rhwp, link into agents (Claude Code, Codex, Grok, Aside ...), run doctor
& $node (Join-Path $Dest 'scripts\setup.mjs') --link @args
Say 'Done. Ask your agent: "Learn this HWP file as a form template."'
