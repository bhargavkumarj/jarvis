import Foundation

/// User-facing text leaving the companion is short, single-line and free of
/// tickets, secrets, paths and raw process output.
public enum Redaction {
    static let tokenLike = try! NSRegularExpression(pattern: "[A-Za-z0-9_-]{32,}")
    static let pathLike = try! NSRegularExpression(pattern: "(?:/Users|/private|/var|/Volumes|~)/[^\\s,;)]*")

    public static func clean(_ s: String, max: Int) -> String {
        var t = s.unicodeScalars.map { ($0.value < 0x20 || (0x7f...0x9f).contains($0.value) || $0.value == 0x2028 || $0.value == 0x2029) ? " " : String($0) }.joined()
        for r in [tokenLike, pathLike] {
            t = r.stringByReplacingMatches(in: t, range: NSRange(t.startIndex..<t.endIndex, in: t), withTemplate: "[redacted]")
        }
        t = t.split(separator: " ", omittingEmptySubsequences: true).joined(separator: " ")
        if t.utf16.count > max { t = String(t.utf16.prefix(max - 1)).map { $0 + "…" } ?? String(t.prefix(max - 1)) + "…" }
        return t.isEmpty ? "No details." : t
    }
    public static func message(_ s: String) -> String { clean(s, max: Protocol1.maxMessage) }
    public static func summary(_ s: String) -> String { clean(s, max: Protocol1.maxSummary) }
}
