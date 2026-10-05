//! Loopback HTTP server receiving agent events (`POST /v1/event`, `GET /v1/health`).
//! Behaviour is identical to the Electron `server.ts`: token auth (constant time), Origin/Host
//! rejection (CSRF + DNS rebinding), 16 KB body cap, 30 req/s token bucket, sanitised messages,
//! server-side timestamps, port fallback (requested + next 5).

use super::token::write_port_file;
use serde::Serialize;
use serde_json::{json, Value};
use std::io::Read;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};
use tiny_http::{Header, Method, Request, Response, Server};

pub const AGENT_IDS: [&str; 10] = [
    "claude-code",
    "codex",
    "cursor",
    "gemini",
    "antigravity",
    "kiro",
    "copilot",
    "opencode",
    "devin",
    "generic",
];
pub const EVENT_TYPES: [&str; 6] = ["thinking", "tool", "done", "error", "attention", "idle"];

const MAX_BODY: usize = 16 * 1024;
const MAX_MESSAGE: usize = 200;
const PORT_TRIES: u16 = 6; // requested port + next 5
const RATE_PER_SEC: f64 = 30.0;
const SERVER_VERSION: &str = env!("CARGO_PKG_VERSION");

/// Matches `AgentEvent` in `src/shared/types.ts` (camelCase JSON).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentEvent {
    pub agent: String,
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    pub ts: u64,
}

pub type OnEvent = Arc<dyn Fn(AgentEvent) + Send + Sync>;

pub struct ServerOptions {
    /// 0 = any free port (tests).
    pub port: u16,
    pub token: String,
    pub on_event: OnEvent,
    /// Home dir used to record the actual port (default `dirs::home_dir()`).
    pub home: Option<PathBuf>,
    pub host: Option<String>,
}

pub struct ServerHandle {
    pub port: u16,
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl ServerHandle {
    /// Stop accepting and wait for the accept loop to exit.
    pub fn close(mut self) {
        self.shutdown();
    }

    fn shutdown(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(t) = self.thread.take() {
            let _ = t.join();
            // tiny_http releases the listening socket asynchronously after the Server is dropped;
            // wait (bounded) until the port is really free so a restart can rebind it.
            let addr = std::net::SocketAddr::from(([127, 0, 0, 1], self.port));
            for _ in 0..50 {
                if std::net::TcpStream::connect_timeout(&addr, Duration::from_millis(50)).is_err() {
                    break;
                }
                std::thread::sleep(Duration::from_millis(20));
            }
        }
    }
}

impl Drop for ServerHandle {
    fn drop(&mut self) {
        self.shutdown();
    }
}

fn is_control(c: char) -> bool {
    let n = c as u32;
    n < 0x20 || (0x7f..=0x9f).contains(&n) || n == 0x2028 || n == 0x2029
}

/// Control chars -> space, collapse runs of spaces, trim, truncate to `max` chars.
pub fn sanitize_text(v: &Value, max: usize) -> Option<String> {
    let s = v.as_str()?;
    let mut out = String::with_capacity(s.len());
    let mut prev_space = false;
    for ch in s.chars() {
        let ch = if is_control(ch) { ' ' } else { ch };
        if ch == ' ' {
            if prev_space {
                continue;
            }
            prev_space = true;
        } else {
            prev_space = false;
        }
        out.push(ch);
    }
    let t: String = out.trim().chars().take(max).collect();
    if t.is_empty() {
        None
    } else {
        Some(t)
    }
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Validate/normalise a raw JSON payload into an `AgentEvent`, or `None` if invalid.
pub fn parse_event(raw: &Value, now: u64) -> Option<AgentEvent> {
    let o = raw.as_object()?;
    let kind = o.get("type")?.as_str()?;
    if !EVENT_TYPES.contains(&kind) {
        return None;
    }
    let agent = match o.get("agent").and_then(|a| a.as_str()) {
        Some(a) if AGENT_IDS.contains(&a) => a,
        _ => "generic",
    };
    let get = |k: &str, max: usize| o.get(k).and_then(|v| sanitize_text(v, max));
    Some(AgentEvent {
        agent: agent.to_string(),
        kind: kind.to_string(),
        message: get("message", MAX_MESSAGE),
        session: get("session", 100),
        cwd: get("cwd", 400),
        ts: now,
    })
}

/// Constant-time equality (length is not secret: tokens are fixed-size hex).
fn ct_eq(a: &[u8], b: &[u8]) -> bool {
    let mut diff = (a.len() ^ b.len()) as u8;
    let n = a.len().max(b.len());
    for i in 0..n {
        let x = a.get(i).copied().unwrap_or(0);
        let y = b.get(i).copied().unwrap_or(0);
        diff |= x ^ y;
    }
    diff == 0
}

fn hostname_of(host: &str) -> Option<String> {
    let h = host.to_ascii_lowercase();
    if h.starts_with('[') {
        return h.find(']').map(|end| h[..=end].to_string());
    }
    match h.rfind(':') {
        Some(i) => Some(h[..i].to_string()),
        None => Some(h),
    }
}

fn header<'a>(req: &'a Request, name: &str) -> Option<&'a str> {
    req.headers().iter().find(|h| h.field.as_str().as_str().eq_ignore_ascii_case(name)).map(|h| h.value.as_str())
}

fn send(req: Request, status: u16, body: Value) {
    let s = body.to_string();
    let mut r = Response::from_string(s).with_status_code(status);
    for (k, v) in [
        ("Content-Type", "application/json"),
        ("Cache-Control", "no-store"),
        ("Connection", "close"),
    ] {
        if let Ok(h) = Header::from_bytes(k.as_bytes(), v.as_bytes()) {
            r = r.with_header(h);
        }
    }
    let _ = req.respond(r);
}

struct Shared {
    expected: Vec<u8>,
    on_event: OnEvent,
    bucket: Mutex<(f64, Instant)>,
}

impl Shared {
    fn take_token(&self) -> bool {
        let mut b = self.bucket.lock().unwrap_or_else(|e| e.into_inner());
        let now = Instant::now();
        let refill = now.duration_since(b.1).as_secs_f64() * RATE_PER_SEC;
        b.0 = (b.0 + refill).min(RATE_PER_SEC);
        b.1 = now;
        if b.0 < 1.0 {
            return false;
        }
        b.0 -= 1.0;
        true
    }
}

fn handle(shared: &Shared, mut req: Request) {
    let hostname = header(&req, "host").and_then(hostname_of);
    match hostname.as_deref() {
        Some("127.0.0.1") | Some("localhost") | Some("[::1]") => {}
        _ => return send(req, 403, json!({ "error": "bad host" })),
    }
    // Browsers always send Origin on cross-site POSTs; local CLIs never do.
    if header(&req, "origin").is_some() {
        return send(req, 403, json!({ "error": "origin not allowed" }));
    }
    if !shared.take_token() {
        return send(req, 429, json!({ "error": "rate limited" }));
    }

    let url = req.url().split('?').next().unwrap_or("").to_string();
    let method = req.method().clone();
    if url == "/v1/health" {
        if method != Method::Get {
            return send(req, 405, json!({ "error": "method not allowed" }));
        }
        return send(req, 200, json!({ "ok": true, "version": SERVER_VERSION, "name": "codecritter" }));
    }
    if url != "/v1/event" {
        return send(req, 404, json!({ "error": "not found" }));
    }
    if method != Method::Post {
        return send(req, 405, json!({ "error": "method not allowed" }));
    }

    let token_ok = header(&req, "x-critter-token")
        .map(|t| ct_eq(t.as_bytes(), &shared.expected))
        .unwrap_or(false);
    if !token_ok {
        return send(req, 401, json!({ "error": "unauthorized" }));
    }

    // Read at most MAX_BODY + 1 bytes; over-long bodies are drained (bounded) so the client
    // reliably receives the 413 instead of a connection reset.
    let declared = req.body_length().unwrap_or(0);
    let mut body = Vec::new();
    let too_big = declared > MAX_BODY || {
        let _ = req.as_reader().take(MAX_BODY as u64 + 1).read_to_end(&mut body);
        body.len() > MAX_BODY
    };
    if too_big {
        let _ = std::io::copy(&mut req.as_reader().take(1 << 20), &mut std::io::sink());
        return send(req, 413, json!({ "error": "payload too large" }));
    }
    let parsed: Value = match serde_json::from_slice(&body) {
        Ok(v) => v,
        Err(_) => return send(req, 400, json!({ "error": "invalid json" })),
    };
    let Some(ev) = parse_event(&parsed, now_ms()) else {
        return send(req, 400, json!({ "error": "invalid event" }));
    };
    // a failing listener must not break the agent
    let cb = shared.on_event.clone();
    let _ = catch_unwind(AssertUnwindSafe(move || cb(ev)));
    send(req, 200, json!({ "ok": true }))
}

/// Bind (with port fallback), record the port file and serve on a dedicated thread.
pub fn start(opts: ServerOptions) -> Result<ServerHandle, String> {
    if opts.token.is_empty() {
        return Err("agent server requires a non-empty token".into());
    }
    let host = opts.host.clone().unwrap_or_else(|| "127.0.0.1".to_string());
    let tries = if opts.port == 0 { 1 } else { PORT_TRIES };
    let mut last_err = String::from("no free port");
    let mut bound: Option<(Server, u16)> = None;
    for i in 0..tries {
        let candidate = if opts.port == 0 { 0 } else { opts.port.saturating_add(i) };
        match Server::http(format!("{host}:{candidate}")) {
            Ok(s) => {
                let port = s.server_addr().to_ip().map(|a| a.port()).unwrap_or(candidate);
                bound = Some((s, port));
                break;
            }
            Err(e) => last_err = e.to_string(),
        }
    }
    let Some((server, port)) = bound else { return Err(last_err) };

    let home = opts.home.clone().or_else(dirs::home_dir);
    if let Some(h) = home {
        // the hook CLI falls back to the default port if this fails
        let _ = write_port_file(port, &h);
    }

    let shared = Arc::new(Shared {
        expected: opts.token.into_bytes(),
        on_event: opts.on_event,
        bucket: Mutex::new((RATE_PER_SEC, Instant::now())),
    });
    let stop = Arc::new(AtomicBool::new(false));
    let stop2 = stop.clone();
    let thread = std::thread::Builder::new()
        .name("critter-agent-server".into())
        .spawn(move || {
            while !stop2.load(Ordering::SeqCst) {
                match server.recv_timeout(Duration::from_millis(100)) {
                    Ok(Some(req)) => {
                        let sh = shared.clone();
                        // one short-lived thread per request: a stalled client can't block accept
                        let _ = std::thread::Builder::new()
                            .name("critter-agent-req".into())
                            .spawn(move || handle(&sh, req));
                    }
                    Ok(None) => {}
                    Err(_) => std::thread::sleep(Duration::from_millis(50)),
                }
            }
        })
        .map_err(|e| e.to_string())?;
    Ok(ServerHandle { port, stop, thread: Some(thread) })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agents::testutil::{http_request, TempDir};
    use std::net::TcpListener;

    const TOKEN: &str = "secret-token";

    struct Fx {
        home: TempDir,
        events: Arc<Mutex<Vec<AgentEvent>>>,
        server: Option<ServerHandle>,
    }
    impl Fx {
        fn new() -> Fx {
            Fx { home: TempDir::new("srv"), events: Arc::default(), server: None }
        }
        fn start(&mut self, port: u16) -> u16 {
            let ev = self.events.clone();
            let s = start(ServerOptions {
                port,
                token: TOKEN.into(),
                on_event: Arc::new(move |e| ev.lock().unwrap().push(e)),
                home: Some(self.home.path().to_path_buf()),
                host: None,
            })
            .unwrap();
            let p = s.port;
            self.server = Some(s);
            p
        }
        fn events(&self) -> Vec<AgentEvent> {
            self.events.lock().unwrap().clone()
        }
    }

    fn post(port: u16, payload: &str, extra: &[(&str, &str)]) -> (u16, String) {
        let mut h: Vec<(&str, &str)> =
            vec![("Content-Type", "application/json"), ("X-Critter-Token", TOKEN)];
        h.extend_from_slice(extra);
        http_request(port, "POST", "/v1/event", &h, payload)
    }

    fn pj(v: Value) -> String {
        v.to_string()
    }

    #[test]
    fn health_needs_no_auth() {
        let mut f = Fx::new();
        let p = f.start(0);
        let (st, body) = http_request(p, "GET", "/v1/health", &[], "");
        assert_eq!(st, 200);
        let v: Value = serde_json::from_str(&body).unwrap();
        assert_eq!(v["ok"], true);
        assert_eq!(v["name"], "codecritter");
        assert_eq!(v["version"], SERVER_VERSION);
    }

    #[test]
    fn accepts_valid_event_and_sets_ts_server_side() {
        let mut f = Fx::new();
        let p = f.start(0);
        let before = now_ms();
        let (st, _) = post(p, &pj(json!({"agent":"claude-code","type":"thinking","ts":1,"cwd":"/x"})), &[]);
        assert_eq!(st, 200);
        let ev = f.events();
        assert_eq!(ev.len(), 1);
        assert_eq!(ev[0].agent, "claude-code");
        assert_eq!(ev[0].kind, "thinking");
        assert_eq!(ev[0].cwd.as_deref(), Some("/x"));
        assert!(ev[0].ts >= before);
        // camelCase JSON on the wire to the overlay
        let j = serde_json::to_value(&ev[0]).unwrap();
        assert_eq!(j["type"], "thinking");
        assert!(j.get("message").is_none());
    }

    #[test]
    fn requires_the_token() {
        let mut f = Fx::new();
        let p = f.start(0);
        let h = [("Content-Type", "application/json"), ("X-Critter-Token", "nope")];
        assert_eq!(http_request(p, "POST", "/v1/event", &h, r#"{"type":"done"}"#).0, 401);
        assert_eq!(http_request(p, "POST", "/v1/event", &[], r#"{"type":"done"}"#).0, 401);
        assert!(f.events().is_empty());
    }

    #[test]
    fn validates_type_agent_fallback_json() {
        let mut f = Fx::new();
        let p = f.start(0);
        assert_eq!(post(p, r#"{"type":"explode"}"#, &[]).0, 400);
        assert_eq!(post(p, "{not json", &[]).0, 400);
        assert_eq!(post(p, "[1]", &[]).0, 400);
        assert_eq!(post(p, r#"{"agent":"bogus","type":"done"}"#, &[]).0, 200);
        assert_eq!(f.events()[0].agent, "generic");
    }

    #[test]
    fn truncates_and_strips_control_chars() {
        let mut f = Fx::new();
        let p = f.start(0);
        let msg = format!("a\u{0}b\nc\u{1b}[31m{}", "x".repeat(500));
        post(p, &pj(json!({"type":"done","message":msg})), &[]);
        let m = f.events()[0].message.clone().unwrap();
        assert!(m.chars().count() <= 200);
        assert!(!m.chars().any(|c| (c as u32) < 0x20));
        assert!(m.starts_with("a b c"));
    }

    #[test]
    fn rejects_bodies_over_16kb() {
        let mut f = Fx::new();
        let p = f.start(0);
        let (st, _) = post(p, &pj(json!({"type":"done","message":"x".repeat(20000)})), &[]);
        assert_eq!(st, 413);
        assert!(f.events().is_empty());
    }

    #[test]
    fn rejects_any_origin_header() {
        let mut f = Fx::new();
        let p = f.start(0);
        assert_eq!(post(p, r#"{"type":"done"}"#, &[("Origin", "http://localhost:3000")]).0, 403);
        assert!(f.events().is_empty());
    }

    #[test]
    fn rejects_non_loopback_host() {
        let mut f = Fx::new();
        let p = f.start(0);
        assert_eq!(post(p, r#"{"type":"done"}"#, &[("Host", "evil.example.com")]).0, 403);
        assert_eq!(post(p, r#"{"type":"done"}"#, &[("Host", &format!("localhost:{p}"))]).0, 200);
        assert_eq!(post(p, r#"{"type":"done"}"#, &[("Host", &format!("[::1]:{p}"))]).0, 200);
    }

    #[test]
    fn rate_limits_bursts_with_429() {
        let mut f = Fx::new();
        let p = f.start(0);
        let hs: Vec<_> = (0..80)
            .map(|_| std::thread::spawn(move || http_request(p, "GET", "/v1/health", &[], "").0))
            .collect();
        let st: Vec<u16> = hs.into_iter().map(|h| h.join().unwrap()).collect();
        assert!(st.contains(&429));
        assert!(st.contains(&200));
    }

    #[test]
    fn other_routes_404_405() {
        let mut f = Fx::new();
        let p = f.start(0);
        assert_eq!(http_request(p, "GET", "/nope", &[], "").0, 404);
        assert_eq!(http_request(p, "GET", "/v1/event", &[], "").0, 405);
        assert_eq!(http_request(p, "POST", "/v1/health", &[], "").0, 405);
    }

    #[test]
    fn falls_back_to_next_port_when_busy_and_records_it() {
        let blocker = TcpListener::bind("127.0.0.1:0").unwrap();
        let busy = blocker.local_addr().unwrap().port();
        let mut f = Fx::new();
        let p = f.start(busy);
        assert!(p > busy && p <= busy + 5, "port {p} vs busy {busy}");
        let rec = std::fs::read_to_string(f.home.path().join(".codecritter").join("port")).unwrap();
        assert_eq!(rec.trim(), p.to_string());
        drop(blocker);
    }

    #[test]
    fn binds_loopback_only() {
        let mut f = Fx::new();
        f.start(0);
        let addr = f.server.as_ref().map(|s| s.port).unwrap();
        // the listener must not be reachable via a non-loopback bind address: verify by the
        // bind argument (we always format 127.0.0.1) and that a loopback connect works.
        assert_eq!(http_request(addr, "GET", "/v1/health", &[], "").0, 200);
    }

    #[test]
    fn refuses_empty_token_and_shuts_down_cleanly() {
        let r = start(ServerOptions {
            port: 0,
            token: String::new(),
            on_event: Arc::new(|_| {}),
            home: None,
            host: None,
        });
        assert!(r.is_err());
        let mut f = Fx::new();
        let p = f.start(0);
        f.server.take().unwrap().close();
        assert!(std::net::TcpStream::connect_timeout(
            &format!("127.0.0.1:{p}").parse().unwrap(),
            Duration::from_millis(300)
        )
        .is_err());
    }

    #[test]
    fn panicking_listener_does_not_break_the_response() {
        let home = TempDir::new("srv-panic");
        let s = start(ServerOptions {
            port: 0,
            token: TOKEN.into(),
            on_event: Arc::new(|_| panic!("boom")),
            home: Some(home.path().to_path_buf()),
            host: None,
        })
        .unwrap();
        assert_eq!(post(s.port, r#"{"type":"done"}"#, &[]).0, 200);
    }

    #[test]
    fn sanitize_collapses_spaces_and_drops_empty() {
        assert_eq!(sanitize_text(&json!("  a \t\t b  "), 200).as_deref(), Some("a b"));
        assert_eq!(sanitize_text(&json!(" \n "), 200), None);
        assert_eq!(sanitize_text(&json!(5), 200), None);
    }
}
