---
name: cline
description: Delegate a self-contained coding task to the cline-re agent, a clean-room Cline CLI reimplementation that runs on Cline's free model pool (nemotron, solar-mini4, lightning, beam) with its own read_files/editor/run_commands/search_codebase tools, plan/yolo modes and loop guardrails. Use when the user asks to run a task "with cline", "via cline-re", or to hand a whole task off to the Cline agent instead of doing it in this session.
---

# cline — delegate a task to the cline-re agent

`cline-re` is a standalone agent (`node src/cli.js`) that talks to the real Cline
gateway with a Cline account's free model pool. Delegating a task to it means it
runs its own agent loop with its own tools (`read_files`, `editor`,
`run_commands`, `search_codebase`), its own plan/act/yolo modes, and its own
loop and mistake guardrails — this session only launches it and relays the
answer.

## When to use

- The user explicitly wants the Cline agent to do a task.
- The user wants a second opinion or a run on a free-pool model instead of this
  session's model.
- The task is self-contained and the user is fine with cline editing files
  directly.

Do not use it for tiny one-line answers or when the user wants to watch and
approve each step in this session.

## How to invoke

1. CLI path: `$ZCODE_CLINE_CLI` if set, else `F:\cline-re\src\cli.js`. If
   missing, ask the user to point `ZCODE_CLINE_CLI` at their checkout's
   `src/cli.js`.
2. Useful flags (from `cline --help`):
   - `-m <model|alias>` — `nemotron` (default), `solar-mini4`, `lightning`, `beam`.
   - `-p` plan mode (read-only), `-y` yolo/headless.
   - `-c <path>` working directory; default is the current directory, use the
     workspace root for repo tasks.
   - `--max-iterations <n>` hard cap; `--retries <n>` max consecutive mistakes.
   - `--session <id>` explicit session id; `-r <session-id>` resume a saved
     session (they are separate flags); `--sessions` lists them.
3. Run it with the Bash tool, quoting the whole prompt as one argument:

   ```bash
   node "<cli-path>" -c "<workspace-root>" -m nemotron "<complete task>"
   ```

4. Credentials: the CLI uses `CLINE_API_KEY`, or the stored credentials from a
   previous `cline-re login` (`~/.cline-re/credentials.json`). Exit code 2 with
   a credential message (for example `run \`cline-re login\``) means the user
   must log in once — report it, do not retry. Note exit code 2 alone is not
   always a credential error (a missing prompt returns 2 too); go by the
   message.

## Reporting

- Relay the final answer (the text after `--- completed after N iteration(s) ---`)
  essentially verbatim, plus the iteration count.
- A non-`completed` status (for example `blocked` or a mistake-guardrail stop)
  is a real failure: say so and include the error line.
- cline edits files itself; never re-apply or second-guess its edits here unless
  the user asks for a review.
