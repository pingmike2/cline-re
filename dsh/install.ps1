# Installs the dsh-cline bundle row into the current DSH profile.
# Thin wrapper: all logic lives in install.mjs so Windows/macOS/Linux behave the same.
#
#   pwsh -File dsh\install.ps1               install
#   pwsh -File dsh\install.ps1 -- --remove   uninstall
#   pwsh -File dsh\install.ps1 -- --dry-run  show the plan
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$node = (Get-Command node -ErrorAction SilentlyContinue)
if (-not $node) { throw "node not found on PATH; install Node.js >= 20 first" }
& $node.Source (Join-Path $here "install.mjs") @args
exit $LASTEXITCODE
