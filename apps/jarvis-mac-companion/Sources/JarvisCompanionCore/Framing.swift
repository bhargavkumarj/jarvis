import Foundation

/// Chrome native messaging: 32-bit length in native byte order (little-endian on
/// Apple Silicon and x86), followed by UTF-8 JSON. The declared length is checked
/// against our own limit BEFORE any body buffer is allocated.
public enum FrameError: Error, Equatable { case truncated, tooLarge(Int), empty, invalidJSON, endOfStream }

public protocol ByteSource { func read(upTo count: Int) -> Data? }

public final class FrameReader {
    private let source: ByteSource
    private let maxBytes: Int
    public init(source: ByteSource, maxBytes: Int = Protocol1.maxFrameBytes) { self.source = source; self.maxBytes = maxBytes }

    private func readExactly(_ count: Int) -> Data? {
        var out = Data()
        while out.count < count {
            guard let chunk = source.read(upTo: count - out.count), !chunk.isEmpty else { return out.isEmpty ? nil : out }
            out.append(chunk)
        }
        return out
    }
    /// Returns the next JSON object, or throws. endOfStream means a clean EOF between frames.
    public func next() throws -> [String: JSONValue] {
        guard let header = readExactly(4) else { throw FrameError.endOfStream }
        guard header.count == 4 else { throw FrameError.truncated }
        let length = Int(UInt32(header[header.startIndex]) | UInt32(header[header.startIndex + 1]) << 8 | UInt32(header[header.startIndex + 2]) << 16 | UInt32(header[header.startIndex + 3]) << 24)
        if length == 0 { throw FrameError.empty }
        if length > maxBytes { throw FrameError.tooLarge(length) }
        guard let body = readExactly(length), body.count == length else { throw FrameError.truncated }
        guard let value = try? JSON.parse(body), let object = value.objectValue else { throw FrameError.invalidJSON }
        return object
    }
}

public final class FrameWriter {
    private let lock = NSLock()
    private let sink: (Data) -> Void
    public init(sink: @escaping (Data) -> Void) { self.sink = sink }
    /// Serialised writes: stdout carries frames only (diagnostics never go to stdout).
    public func write(_ value: JSONValue) {
        guard let body = try? JSON.encode(value), body.count <= 1_000_000 else { return }
        var length = UInt32(body.count).littleEndian
        var frame = Data(bytes: &length, count: 4)
        frame.append(body)
        lock.lock(); defer { lock.unlock() }
        sink(frame)
    }
}

public final class DataSource: ByteSource {
    private var data: Data
    public init(_ data: Data) { self.data = data }
    public func read(upTo count: Int) -> Data? {
        guard !data.isEmpty else { return nil }
        let n = min(count, data.count)
        let chunk = data.prefix(n)
        data.removeFirst(n)
        return Data(chunk)
    }
}

public final class FileHandleSource: ByteSource {
    private let handle: FileHandle
    public init(_ handle: FileHandle) { self.handle = handle }
    public func read(upTo count: Int) -> Data? {
        let d = (try? handle.read(upToCount: count)) ?? nil
        return (d?.isEmpty ?? true) ? nil : d
    }
}
