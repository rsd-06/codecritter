//! X11 foreground-window probe for peek mode (EWMH). Reads only `_NET_ACTIVE_WINDOW`, its
//! `_NET_WM_STATE` (fullscreen / hidden), window type (desktop / dock), pid (to skip our own windows),
//! geometry and frame extents. Window titles and process names are never read. The verdict itself is the
//! pure `peek::decide_x11`. Under XWayland only X11 clients are visible; native Wayland windows are not.

use crate::peek::{Rect, X11Fg};
use x11rb::{
    connection::Connection,
    protocol::xproto::{AtomEnum, ConnectionExt},
    rust_connection::RustConnection,
};

type Conn = RustConnection;

fn atom(c: &Conn, name: &str) -> Option<u32> {
    Some(c.intern_atom(false, name.as_bytes()).ok()?.reply().ok()?.atom)
}

fn prop32(c: &Conn, win: u32, prop: u32, ty: AtomEnum, max: u32) -> Option<Vec<u32>> {
    let r = c.get_property(false, win, prop, ty, 0, max).ok()?.reply().ok()?;
    Some(r.value32()?.collect())
}

/// Facts about the active window, or None when there is none / no X display / any query fails.
pub fn query() -> Option<X11Fg> {
    let (c, screen) = RustConnection::connect(None).ok()?;
    let root = c.setup().roots.get(screen)?.root;
    let active = prop32(&c, root, atom(&c, "_NET_ACTIVE_WINDOW")?, AtomEnum::WINDOW, 1)?;
    let win = *active.first().filter(|w| **w != 0)?;

    let state = prop32(&c, win, atom(&c, "_NET_WM_STATE")?, AtomEnum::ATOM, 64).unwrap_or_default();
    let fullscreen_state = state.contains(&atom(&c, "_NET_WM_STATE_FULLSCREEN")?);
    let hidden = state.contains(&atom(&c, "_NET_WM_STATE_HIDDEN")?);

    let types = prop32(&c, win, atom(&c, "_NET_WM_WINDOW_TYPE")?, AtomEnum::ATOM, 16).unwrap_or_default();
    let shell = types.contains(&atom(&c, "_NET_WM_WINDOW_TYPE_DESKTOP")?)
        || types.contains(&atom(&c, "_NET_WM_WINDOW_TYPE_DOCK")?);

    let pid = prop32(&c, win, atom(&c, "_NET_WM_PID")?, AtomEnum::CARDINAL, 1).and_then(|v| v.first().copied());
    let own = pid == Some(std::process::id());

    let extents = prop32(&c, win, atom(&c, "_NET_FRAME_EXTENTS")?, AtomEnum::CARDINAL, 4).unwrap_or_default();
    let captioned = extents.get(2).copied().unwrap_or(0) > 0;

    let geo = c.get_geometry(win).ok()?.reply().ok()?;
    let abs = c.translate_coordinates(win, root, 0, 0).ok()?.reply().ok()?;
    let frame: Rect = (
        abs.dst_x as i32,
        abs.dst_y as i32,
        abs.dst_x as i32 + geo.width as i32,
        abs.dst_y as i32 + geo.height as i32,
    );
    Some(X11Fg { fullscreen_state, hidden, shell, own, captioned, frame })
}
