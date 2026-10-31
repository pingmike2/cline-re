---
description: Delegate a self-contained coding task to the cline-re agent (Cline free model pool)
---

Run the cline-re CLI delegate flow for the task below, then relay the agent's final answer verbatim to the user.

Task: $ARGUMENTS

Steps:

1. Resolve the CLI entry. Use the `ZCODE_CLINE_CLI` environment variable if it is set; otherwise use the default repository path `F:\cline-re\src\cli.js`. Verify the file exists; if it does not, stop and tell the user to set `ZCODE_CLINE_CLI` to `src/cli.js` of their cline-re checkout.
2. Parse the task text for these optional leading directives and strip them from the prompt:
   - `-m <model>` or `--model <model>` — model id or alias (`nemotron` default, also `solar-mini4`, `lightning`, `beam`).
   - `-p` / `--plan` — read-only plan mode.
   - `-y` / `--yolo` — headless background mode.
   - `-c <path>` / `--cwd <path>` — working directory (default: current workspace directory).
3. Run via the Bash tool (adjust the path to a forward-slash form for Git Bash):

   ```bash
   node "<cli-path>" -c "<cwd>" <model/plan/yolo flags> "<task>"
   ```

   Quote the task as a single argument. If the command exits with code 2 and mentions credentials, tell the user to run `cline-re login` once or set `CLINE_API_KEY`; do not retry.
4. Relay the agent's final answer — the text after the `--- completed after N iteration(s) ---` marker — to the user, and mention the iteration count. If the run ends with a non-completed status, say so plainly and include the error line.
5. The cline agent edits files itself with its own tools — do not redo its edits in this session. If the user asks for a follow-up instead of a fresh task, run it as a new prompt by default; only pass `-r <session-id>` (resume a saved session) or `--session <id>` (explicit session id) when the user names one.
