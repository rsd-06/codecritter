# Security policy

## Reporting a vulnerability

Please open a [GitHub security advisory](https://github.com/rsd-06/codecritter/security/advisories/new) (preferred, private) or, for low-severity issues, a regular [GitHub issue](https://github.com/rsd-06/codecritter/issues). Include steps to reproduce, the affected version and your OS. We will acknowledge reports as soon as we can and credit reporters who want credit.

Only the latest release is supported.

## Threat model

CodeCritter is a local desktop app. It has no accounts, no servers and no telemetry, and makes no outbound network requests.

**What it touches**

- A global keyboard/mouse hook (`uiohook-napi`). Events are aggregated into counts and rates inside `src/main/input/monitor.ts`; key identities never leave that file and are never stored or logged.
- A loopback HTTP server (`127.0.0.1:47626`, falls back up to +5 ports) that accepts agent status events.
- Agent installers that edit config files of coding agents in your home directory, only when you press Install in Settings.
- `~/.codecritter/` containing the token, port and a copy of the hook script, and `config.json` in the app data folder.

**Local server hardening**

- Binds to loopback only; non-loopback `Host` headers are rejected (DNS rebinding).
- Any request carrying an `Origin` header is rejected (browser pages cannot call it; CLI hooks never send one).
- Every event requires `X-Critter-Token` (32 random bytes per install, compared in constant time, stored with mode 0600 where the OS supports it).
- Request bodies are capped at 16 KB, messages at 200 characters with control characters stripped, and requests are rate limited. Events can only drive animations and speech bubbles; they cannot execute anything.

**In scope**: bypassing the token/origin/host checks, anything that makes the server reachable off-host, installers that corrupt or escalate through agent config files, leaking key identities, path traversal in sync/import, renderer-to-main privilege escalation.

**Out of scope**: an attacker who can already read your home directory or run code as you (they can read the token, and much worse); the fact that unsigned builds trigger SmartScreen/Gatekeeper warnings; denial of service by a local process spamming a loopback port.

## Supply chain

Release builds are produced by the public GitHub Actions workflow from tagged commits. They are currently **unsigned**. Verify downloads come from the official Releases page. Windows and macOS code signing is on the roadmap.
