//! Codex CLI: `~/.codex/config.toml`, top-level `notify = ["cmd", "arg", ...]`.
//! Codex appends one JSON argument (`{"type":"agent-turn-complete",...}`) when it runs the command.
//! We edit just the notify line(s): no TOML re-serialisation, nothing else is rewritten.

use super::util::*;
use std::fs;
use std::path::{Path, PathBuf};

const MARKER: &str = "# codecritter";

struct NotifySpan {
    start: usize, // line index
    end: usize,   // inclusive line index
    text: String,
}

fn is_notify_line(t: &str) -> bool {
    match t.strip_prefix("notify") {
        Some(rest) => rest.trim_start().starts_with('='),
        None => false,
    }
}

/// Find a top-level `notify = ...` assignment (possibly a multi-line array).
fn find_notify(lines: &[String]) -> Option<NotifySpan> {
    for i in 0..lines.len() {
        let t = lines[i].trim();
        if t.starts_with('[') {
            return None; // reached the first table: no longer top-level
        }
        if !is_notify_line(t) {
            continue;
        }
        let mut depth: i32 = 0;
        let mut in_str: Option<char> = None;
        let mut end = i;
        'scan: for j in i..lines.len() {
            let l: Vec<char> = if j == i {
                let s = &lines[j];
                let eq = s.find('=').map(|p| p + 1).unwrap_or(0);
                s[eq..].chars().collect()
            } else {
                lines[j].chars().collect()
            };
            let mut k = 0;
            while k < l.len() {
                let c = l[k];
                if let Some(q) = in_str {
                    if c == '\\' && q == '"' {
                        k += 1;
                    } else if c == q {
                        in_str = None;
                    }
                } else if c == '"' || c == '\'' {
                    in_str = Some(c);
                } else if c == '#' {
                    break;
                } else if c == '[' {
                    depth += 1;
                } else if c == ']' {
                    depth -= 1;
                    if depth <= 0 {
                        end = j;
                        break 'scan;
                    }
                }
                k += 1;
            }
            end = j;
        }
        return Some(NotifySpan { start: i, end, text: lines[i..=end].join("\n") });
    }
    None
}

fn path(home: &Path) -> PathBuf {
    home.join(".codex").join("config.toml")
}

fn eol(text: &str) -> &'static str {
    if text.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    }
}

fn split_lines(text: &str) -> Vec<String> {
    text.split('\n').map(|l| l.strip_suffix('\r').unwrap_or(l).to_string()).collect()
}

fn load(home: &Path) -> Option<String> {
    fs::read_to_string(path(home)).ok()
}

fn ours(span: &NotifySpan) -> bool {
    span.text.contains(OURS)
}

pub struct CodexInstaller;

impl Installer for CodexInstaller {
    fn id(&self) -> &'static str {
        "codex"
    }
    fn label(&self) -> &'static str {
        "Codex CLI"
    }
    fn detect(&self, home: &Path) -> bool {
        exists(&home.join(".codex"))
    }
    fn status(&self, home: &Path) -> Status {
        let installed = load(home)
            .filter(|t| !t.is_empty())
            .and_then(|t| find_notify(&split_lines(&t)))
            .map_or(false, |s| ours(&s));
        Status { installed, path: p2s(&path(home)) }
    }
    fn install(&self, home: &Path, hook_cmd: &[String]) -> OpResult {
        if let Some(bad) = validate_hook_cmd(hook_cmd) {
            return OpResult::err(bad);
        }
        let p = path(home);
        let text = load(home).unwrap_or_default();
        let nl = eol(&text);
        let mut lines = if text.is_empty() { Vec::new() } else { split_lines(&text) };
        let span = find_notify(&lines);
        if let Some(s) = &span {
            if !ours(s) {
                return OpResult::err(format!(
                    "{} already has a notify command that is not CodeCritter's; not overwriting. \
                     Add this to your existing notify script instead: {} codex done",
                    p2s(&p),
                    hook_cmd.join(" ")
                ));
            }
        }
        let args: Vec<String> = hook_cmd
            .iter()
            .map(|s| s.as_str())
            .chain(["codex", "done"])
            .map(|a| serde_json::to_string(a).unwrap_or_default())
            .collect();
        let line = format!("notify = [{}]", args.join(", "));
        match span {
            Some(s) => {
                lines.splice(s.start..=s.end, [line]);
            }
            None => {
                lines.insert(0, line);
                lines.insert(0, MARKER.to_string());
            }
        }
        let joined = lines.join(nl);
        let body = format!("{}{}", joined.trim_end_matches(['\r', '\n']), nl);
        if let Err(e) = backup_once(&p).and_then(|_| write_file_atomic(&p, &body)) {
            return OpResult::err(format!("could not write {}: {e}", p2s(&p)));
        }
        OpResult::ok(format!("Installed Codex notify hook in {}", p2s(&p)))
    }
    fn uninstall(&self, home: &Path) -> OpResult {
        let p = path(home);
        let Some(text) = load(home) else { return OpResult::ok("Nothing to remove") };
        let nl = eol(&text);
        let mut lines = split_lines(&text);
        let span = match find_notify(&lines) {
            Some(s) if ours(&s) => s,
            _ => return OpResult::ok("Nothing to remove"),
        };
        let from = if span.start > 0 && lines[span.start - 1].trim() == MARKER {
            span.start - 1
        } else {
            span.start
        };
        lines.drain(from..=span.end);
        if let Err(e) = write_file_atomic(&p, &lines.join(nl)) {
            return OpResult::err(format!("could not write {}: {e}", p2s(&p)));
        }
        OpResult::ok(format!("Removed Codex notify hook from {}", p2s(&p)))
    }
}
