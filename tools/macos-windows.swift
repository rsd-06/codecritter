// Prints the on-screen windows owned by a process id as lines "layer=<n> alpha=<a> x=<x> y=<y> w=<w> h=<h>".
// Only bounds / layer / alpha / owner pid are read (same data the app's fullscreen detector uses).
// Usage: swift tools/macos-windows.swift <pid>
import CoreGraphics
import Foundation

guard CommandLine.arguments.count > 1, let pid = Int32(CommandLine.arguments[1]) else {
    print("usage: macos-windows.swift <pid>")
    exit(2)
}
let list = (CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]]) ?? []
var found = 0
for w in list where (w[kCGWindowOwnerPID as String] as? Int32) == pid {
    let layer = w[kCGWindowLayer as String] as? Int ?? -1
    let alpha = w[kCGWindowAlpha as String] as? Double ?? -1
    let b = w[kCGWindowBounds as String] as? [String: Any] ?? [:]
    let n = { (k: String) -> Int in Int((b[k] as? Double) ?? Double((b[k] as? Int) ?? 0)) }
    print("layer=\(layer) alpha=\(alpha) x=\(n("X")) y=\(n("Y")) w=\(n("Width")) h=\(n("Height"))")
    found += 1
}
if found == 0 { print("no on-screen windows for pid \(pid)") }
