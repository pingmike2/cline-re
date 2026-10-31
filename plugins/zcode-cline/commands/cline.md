---
description: Delegate a self-contained coding task to the cline-re agent (Cline free model pool)
---

Run the cline-re CLI delegate flow for the task below, then relay the agent's final answer verbatim to the user.

Task: $ARGUMENTS

Steps:

1. Resolve the CLI entry, in this order (works on Windows, macOS and Linux):
   - the `ZCODE_CLINE_CLI` environment variable if it is set;
   - `cline-re` on `PATH` (available after `npm link` in the cline-re checkout) — check with `command -v cline-re` (POSIX) or `where cline-re` (Windows);
   - `./src/cli.js` if the current workspace is the cline-re checkout itself;
   - otherwise stop and tell the user to either run `npm link` inside their cline-re checkout or set `ZCODE_CLINE_CLI` to its `src/cli.js`.
2. Parse the task text for these optional leading directives and strip them from the prompt:
   - `-m <model>` or `--model <model>` — model id or alias (`nemotron` default, also `solar-mini4`, `lightning`, `beam`).
   - `-p` / `--plan` — read-only plan mode.
   - `-y` / `--yolo` — headless background mode.
   - `-c <path>` / `--cwd <path>` — working directory (default: current workspace directory).
3. Run via the Bash tool, using the resolved entry:

   ```bash
   cline-re -c "<cwd>" <model/plan/yolo flags> "<task>"     # PATH entry, any OS
   node "<path-to>/src/cli.js" -c "<cwd>" ... "<task>"      # file entry
   ```

   Quote the task as a single argument. On Windows the Bash tool is Git Bash, so use forward slashes for file paths. If the command exits with code 2 and mentions credentials, tell the user to run `cline-re login` once or set `CLINE_API_KEY`; do not retry.
4. Relay the agent's final answer — the text after the `--- completed after N iteration(s) ---` marker — to the user, and mention the iteration count. If the run ends with a non-completed status, say so plainly and include the error line.
5. The cline agent edits files itself with its own tools — do not redo its edits in this session. If the user asks for a follow-up instead of a fresh task, run it as a new prompt by default; only pass `-r <session-id>` (resume a saved session) or `--session <id>` (explicit session id) when the user names one.
