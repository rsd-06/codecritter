//! macOS integration: overlay window behaviour, Input Monitoring permission, the keyboard/mouse
//! event tap (counts only) and fullscreen detection.
#![allow(dead_code)] // FFI halves are cfg(macos); pure halves are compiled everywhere for tests

pub mod access;
pub mod fullscreen;
#[cfg(target_os = "macos")]
pub mod input;
#[cfg(target_os = "macos")]
pub mod overlay;
