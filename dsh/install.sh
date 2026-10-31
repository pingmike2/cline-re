#!/bin/sh
# Installs the dsh-cline bundle row into the current DSH profile.
# Thin wrapper: all logic lives in install.mjs so Windows/macOS/Linux behave the same.
#
#   ./dsh/install.sh              install
#   ./dsh/install.sh --remove     uninstall
#   ./dsh/install.sh --dry-run    print the plan, write nothing
set -eu
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec node "$here/install.mjs" "$@"
