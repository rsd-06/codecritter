# Connecting coding agents to CodeCritter

CodeCritter reacts to your coding agent: it looks thoughtful while the agent thinks, jumps when it finishes and
perks up when the agent needs you. Agents talk to CodeCritter through a tiny local HTTP API; most agents are wired
up for you from Settings > Agents (one click install/uninstall).

```
agent hook  ->  node critter-hook.mjs <agent> <type>  ->  POST http://127.0.0.1:47626/v1/event  ->  overlay
```

Event types: `thinking`, `tool`, `done`, `error`, `attention`, `idle`.

## What the installers write

Every installer is idempotent, never overwrites foreign settings, refuses (and leaves untouched) files it cannot
parse, and identifies its own entries by the text `critter-hook` in the command. JSON settings files are backed up to
`<file>.codecritter.bak` before the first write. Commands look like
`node "C:/path/to/critter-hook.mjs" claude-code thinking` (backslashes are converted to forward slashes, which every
shell and Node accept).

| Agent | File | What is added |
| --- | --- | --- |
| Claude Code | `~/.claude/settings.json` | `hooks`: `UserPromptSubmit`=thinking, `PreToolUse`=tool, `Stop`=done, `SubagentStop`=tool, `Notification`=attention (each `[{matcher:"", hooks:[{type:"command", command}]}]`) |
| Codex CLI | `~/.codex/config.toml` | top-level `notify = ["node", "<hook>", "codex", "done"]`. Codex appends a JSON argument (`agent-turn-complete`) which the hook parses. If you already have a `notify`, we do not touch it (add our command to your script instead). |
| Cursor | `~/.cursor/hooks.json` | `{version:1, hooks:{beforeSubmitPrompt, stop, afterFileEdit}}` = thinking / done / tool |
| Gemini CLI | `~/.gemini/settings.json` | `hooks`: `BeforeAgent`=thinking, `AfterAgent`=done, `Notification`=attention (Claude-style nested schema) |
| Antigravity | `~/.gemini/settings.json` | Shares Gemini's file. Installing/uninstalling either one affects both; events are reported as `gemini`. |
| Kiro | `~/.kiro/hooks/codecritter-done.kiro.hook`, `codecritter-thinking.kiro.hook` | `agentStop` -> done, `promptSubmit` -> thinking (`runCommand`) |
| Copilot CLI | `~/.copilot/hooks/codecritter.json` | `userPromptSubmitted`=thinking, `sessionEnd`=done (`bash` and `powershell` commands) |
| OpenCode | `~/.config/opencode/plugin/codecritter.js` | ESM plugin: `session.status` busy=thinking, `session.idle`=done, `session.error`=error. Posts directly to the server (reads `~/.codecritter`). |
| Devin, others | none | Manual, see below |

Schema notes: these formats are best-effort and track each tool's documented hooks at the time of writing. If a
tool changes its format, use the manual setup below; the installer will never corrupt a file it does not understand.

## Manual setup

Add the same command yourself wherever your agent supports "run a command on event". `<hook>` is the absolute path to
`bin/critter-hook.mjs` (shown in Settings > Agents).

```json
{ "hooks": { "Stop": [ { "matcher": "", "hooks": [ { "type": "command", "command": "node \"<hook>\" claude-code done" } ] } ] } }
```

`critter-hook <agent> <type> [--message "text"]` also reads the hook's JSON from stdin (Claude Code, Gemini,
Cursor) or from its last argument (Codex) to pick up the message, working directory and session. Pass `auto` as the
type to derive it from `hook_event_name`. It always exits 0, prints nothing to stdout, and gives up after 300 ms, so
it can never slow down or confuse your agent. Set `CRITTER_DEBUG=1` to see why an event was not delivered.

## Devin and any other tool: call the API directly

The token lives in `~/.codecritter/token` (`%USERPROFILE%\.codecritter\token` on Windows); the port in
`~/.codecritter/port` (default 47626).

curl:

```sh
curl -s -X POST http://127.0.0.1:47626/v1/event \
  -H "Content-Type: application/json" \
  -H "X-Critter-Token: $(cat ~/.codecritter/token)" \
  -d '{"agent":"devin","type":"done","message":"Task finished"}'
```

PowerShell:

```powershell
$token = (Get-Content "$HOME\.codecritter\token").Trim()
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:47626/v1/event `
  -Headers @{ "X-Critter-Token" = $token } -ContentType "application/json" `
  -Body '{"agent":"devin","type":"thinking"}'
```

Fields: `agent` (one of `claude-code codex cursor gemini antigravity kiro copilot opencode devin generic`, anything else
becomes `generic`), `type` (required), optional `message` (max 200 chars), `session`, `cwd`. The server sets the
timestamp. `GET /v1/health` (no token) returns `{"ok":true,"version":"...","name":"codecritter"}`.

## Uninstall

Settings > Agents > Uninstall removes only our entries (and deletes the files we own: Kiro hooks, Copilot hooks file,
OpenCode plugin). Your other settings are left exactly as they were. To remove by hand, delete anything containing
`critter-hook`, or restore `<file>.codecritter.bak`.

## Troubleshooting

- Nothing happens: run `node bin/critter-hook.mjs generic done` with `CRITTER_DEBUG=1`. "no token" means CodeCritter
  has never run; "timeout/ECONNREFUSED" means it is not running or uses another port (check `~/.codecritter/port`).
- HTTP 401: token mismatch. The hook reads `~/.codecritter/token`; do not set a stale `CRITTER_TOKEN`.
- HTTP 403: a browser Origin header or non-loopback Host was sent; use curl or the hook, not a web page.
- HTTP 429: more than 30 requests/second; slow down.
- Port busy: CodeCritter tries the next 5 ports and records the one it used in `~/.codecritter/port`.
- Environment overrides for the hook: `CRITTER_HOME` (replaces the home directory), `CRITTER_PORT`, `CRITTER_TOKEN`.
- Gemini/Antigravity: hooks require a Gemini CLI version with hooks support; Codex notify requires a recent Codex.

## Security model

- The server binds to `127.0.0.1` only; it is never reachable from the network.
- Every event needs the `X-Critter-Token` header (32 random bytes, file mode 0600 where supported, compared in
  constant time). Anything that can read your home directory can already do far worse; the token stops other
  local users and web pages.
- Requests with any `Origin` header or a non-loopback `Host` are rejected, blocking browser CSRF and DNS rebinding.
- Bodies are limited to 16 KB, messages to 200 characters with control characters stripped, and requests are rate
  limited. Events are display-only: they can only animate the critter.
- Nothing leaves your machine: no telemetry, and the only network use is this loopback server.
- Prompt text and assistant replies reach CodeCritter only as a short message for speech bubbles; they are not
  stored or logged.
