# CodeCritter launch kit

Everything here is a draft for **you** to post from your own accounts. Replace `{SITE}` with the Vercel URL and `{REPO}` with https://github.com/rsd-06/codecritter.

Ground rules that make launches work (and keep accounts safe):
- Post each piece once per platform. No repeated identical posts, no mass tagging, no unsolicited replies under other people's posts. Platforms throttle or ban that, and devs hate it.
- Lead with the video or a GIF. A moving critter beats any text.
- Reply to every comment in the first 2 hours. That's what the algorithms reward.
- Be honest about rough edges (unsigned installer, Windows-first). It earns trust.

---

## X (Twitter)

### Launch post (attach launch.mp4)
> I built a tiny pixel buddy that lives on my desktop while I code.
>
> It follows my cursor, overheats when I type too fast, and reacts when Claude Code / Cursor / Codex are thinking, running tools or done.
>
> Free, open source, 1.5 MB.
>
> {SITE}

### Thread (reply to the launch post)
1. > How it works: your AI agent's hook sends a tiny status event to 127.0.0.1. The critter thinks along, hops when the agent is done, and panics on errors. One click installs the hook for Claude Code, Codex, Cursor, Gemini, Kiro, Copilot and OpenCode.
2. > It also nags me (nicely) to stretch and drink water, runs Pomodoros, and hides at the screen edge when I'm in a fullscreen video.
3. > Privacy: it counts keystrokes, it never knows which keys. No telemetry, no network calls.
4. > Built with Tauri + Rust + TypeScript. Started on Electron (~200 MB) and ported to Tauri: now ~55 MB RAM and a 1.5 MB installer.
5. > It's MIT and I'd love help: macOS/Linux testing, new characters, more agents. {REPO}

### Follow-up posts (spread over the next 1–2 weeks, one per day max)
- Build-in-public: "Electron → Tauri: what the memory numbers actually looked like" (use the table from README Performance).
- GIF of the overheat reaction: "what my critter looks like during a deadline".
- GIF of eye tracking: "spent a whole evening making pixel eyes follow the cursor properly".
- "Claude Code finished a refactor and my desk pet did a little hop" with a short screen recording.

Hashtags (max 2): #buildinpublic #opensource

---

## Threads

### Launch post (attach launch.mp4)
> Made a pixel desktop companion for developers 🧑‍💻
>
> It sits on your screen while you code: eyes follow your cursor, it gets stressed when you type fast, and it reacts to your AI coding agent (Claude Code, Cursor, Codex...) thinking and finishing tasks.
>
> Free + open source. Link in replies.

Reply 1: `{SITE}`
Reply 2: > Windows installer is 1.5 MB. Mac/Linux folks: it builds from source and I'd love testers. {REPO}

---

## Instagram (@rsd.exe)

### Reel (15–25 s, vertical 9:16)
Use the brag video re-cut to vertical, or record your real screen:

| Time | Shot | On-screen text |
|---|---|---|
| 0–2 s | Close-up of the critter on a real desktop, eyes snapping to the cursor | "my code has a new co-worker" |
| 2–5 s | Typing fast → critter overheats, steams | "type too fast → it overheats" |
| 5–10 s | Terminal: `claude` running → critter thinking → hop on done | "it reacts to my AI agent" |
| 10–13 s | Petting → hearts; drag and shake → dizzy | "you can pet it" |
| 13–16 s | Switch Stitch ↔ Yoda | "two moods" |
| 16–20 s | End card: name, "free & open source", "link in bio" | "link in bio" |

Audio: a trending lo-fi or chiptune sound from the Reels library (keeps reach up; don't use copyrighted music outside the library).

### Caption
> I built a tiny pixel buddy that lives on my desktop while I code 👾
> It follows my cursor, overheats when I type fast and reacts to my AI coding agent.
> Free & open source, link in bio.
>
> #coding #developer #programming #pixelart #opensource #setup #codinglife #ai

Put `{SITE}` in your bio link for launch week. Post 2–3 Stories the same day: the GIFs, a poll ("Stitch or Yoda?"), and the link sticker.

---

## Developer communities (highest-value for open source)

Post once each, spaced a day or two apart, and stay in the comments:

- **Show HN:** `Show HN: CodeCritter – a pixel desktop pet that reacts to your AI coding agent`. Body: 3–4 plain sentences on what it is, why you built it, the Electron→Tauri numbers, and the repo link. Post on a weekday morning US time.
- **Reddit:** r/SideProject, r/opensource, r/programming (only if framed as the Tauri/Rust write-up), r/ClaudeAI (Claude Code integration angle), r/tauri. Read each subreddit's self-promotion rules first.
- **Product Hunt:** tagline "A pixel desktop buddy that reacts to your code and your AI agent". Gallery: launch.mp4 + the gallery PNGs.
- **dev.to / Hashnode:** "Porting my desktop pet from Electron to Tauri: 200 MB → 55 MB" with code snippets. Long-tail traffic.

## Posting schedule (suggested)

| Day | Post |
|---|---|
| D0 (Tue/Wed) | X launch + thread, Threads post, Instagram reel + stories, GitHub release published |
| D1 | Show HN |
| D2 | r/SideProject + r/opensource |
| D3 | dev.to write-up, share on X |
| D5 | Product Hunt |
| D7+ | One build-in-public post every 2–3 days (GIFs, contributor shout-outs, new characters) |

## Before you post: trademark note

Stitch (Disney) and Yoda (Lucasfilm) are fan art here. A viral launch makes a takedown more likely. Consider adding an original third character before D0, so a takedown can never kill the project, and keep the disclaimer visible on the site and README.
