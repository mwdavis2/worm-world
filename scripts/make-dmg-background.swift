// Draws the dmg window background: an arrow from the app icon to the
// Applications shortcut. 660x400 points, rendered at 2x (144 dpi).
//
//   swift scripts/make-dmg-background.swift out.png
import AppKit

let out = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "dmg-background.png"
let width = 660.0, height = 400.0, scale = 2.0
let rep = NSBitmapImageRep(
  bitmapDataPlanes: nil, pixelsWide: Int(width * scale), pixelsHigh: Int(height * scale),
  bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
  colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
rep.size = NSSize(width: width, height: height)
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)

// soft light background
NSGradient(starting: NSColor(calibratedWhite: 0.97, alpha: 1), ending: NSColor(calibratedWhite: 0.88, alpha: 1))!
  .draw(in: NSRect(x: 0, y: 0, width: width, height: height), angle: 90)

// icons sit at (180, 170) and (480, 170) from the top: y = 400 - 170 = 230 from the bottom
let y = height - 170.0
let arrow = NSBezierPath()
arrow.lineWidth = 8
arrow.lineCapStyle = .round
arrow.move(to: NSPoint(x: 262, y: y))
arrow.line(to: NSPoint(x: 392, y: y))
NSColor(calibratedWhite: 0.45, alpha: 1).setStroke()
arrow.stroke()
let head = NSBezierPath()
head.lineWidth = 8
head.lineCapStyle = .round
head.lineJoinStyle = .round
head.move(to: NSPoint(x: 372, y: y + 22))
head.line(to: NSPoint(x: 398, y: y))
head.line(to: NSPoint(x: 372, y: y - 22))
head.stroke()

let text = "Drag WormWorld into Applications" as NSString
let attrs: [NSAttributedString.Key: Any] = [
  .font: NSFont.systemFont(ofSize: 15, weight: .medium),
  .foregroundColor: NSColor(calibratedWhite: 0.35, alpha: 1),
]
let size = text.size(withAttributes: attrs)
text.draw(at: NSPoint(x: (width - size.width) / 2, y: 52), withAttributes: attrs)

NSGraphicsContext.restoreGraphicsState()
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: out))
print("wrote \(out)")
