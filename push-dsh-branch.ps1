# Publish the DSH plugin work on its own branch (does NOT touch main).
param(
	[switch]$DryRun
)

$ErrorActionPreference = "Stop"
Set-Location -LiteralPath "F:\cline-re"

$branch = "dsh-cline-plugin"
$remote = "origin"

Write-Host "== current branch ==" -ForegroundColor Cyan
$current = (& git branch --show-current).Trim()
Write-Host "  $current"

if ($current -ne $branch) {
	$exists = (& git rev-parse --verify --quiet "refs/heads/$branch") -ne $null
	if ($exists) { & git checkout $branch } else { & git checkout -b $branch }
	if ($LASTEXITCODE -ne 0) { throw "git checkout failed" }
	Write-Host "  switched to $branch" -ForegroundColor Green
}

$paths = @(
	".gitignore", "LICENSE", "CONTRIBUTING.md", "README.md", "package.json",
	"dsh/", "src/cli.js", "src/llm.js", "src/models.js",
	"push-dsh-branch.ps1"
)

& git add -- @paths
if ($LASTEXITCODE -ne 0) { throw "git add failed" }

# Guard: refuse if anything sensitive got staged.
$staged = @(& git diff --cached --name-only)
$bad = $staged | Where-Object {
	$_ -match '(^|/)node_modules/' -or
	$_ -match '(^|/)cline\.json$' -or
	$_ -match 'credentials\.json$' -or
	$_ -match '^\.dsh/' -or
	$_ -match '\.env(\.|$)'
}
if ($bad.Count -gt 0) {
	Write-Host "ABORT: sensitive paths staged:" -ForegroundColor Red
	$bad | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
	throw "remove them from the index before pushing"
}

Write-Host "== staged files ==" -ForegroundColor Cyan
$staged | ForEach-Object { Write-Host "  $_" }

if ($DryRun) {
	Write-Host "DryRun: stopping before commit/push." -ForegroundColor Yellow
	return
}

$msg = @'
feat(plugin): wrap cline-re as DSH plugin with Cline model provider and cline tool

- dsh/: new plugin registering the cline model provider and cline delegation
  tool, plus a browser half (Configure form) for the Cline API key
- lib/: provider (DSH chunk protocol -> OpenAI SSE), wire translation, tool,
  settings resolver (Configure form -> cline.json -> CLINE_API_KEY -> login)
- README/CONTRIBUTING: bilingual EN+ZH, audit surface and known limitations
- LICENSE: MIT
- Fix rc.5 crash: maxIterations schema min(1) rejected default 0 -> min(0)
- Tests: 19 dsh tests, 109 total passing
'@

# Only commit if there is something staged.
$hasStaged = (& git diff --cached --quiet; $LASTEXITCODE -ne 0)
if ($hasStaged) {
	& git commit -m $msg
	if ($LASTEXITCODE -ne 0) { throw "git commit failed" }
} else {
	Write-Host "nothing to commit (already committed)" -ForegroundColor Yellow
}

Write-Host "== pushing to $remote/$branch ==" -ForegroundColor Cyan
& git push -u $remote $branch
if ($LASTEXITCODE -ne 0) { throw "git push failed" }

Write-Host "OK -> https://github.com/pingmike2/cline-re/tree/$branch" -ForegroundColor Green
