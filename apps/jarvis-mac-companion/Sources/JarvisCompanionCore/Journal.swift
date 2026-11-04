import Foundation

/// Bounded local execution journal. A record is written (and flushed) BEFORE an
/// action is invoked so a crash leaves evidence; recovery turns ambiguous
/// in-flight work into outcome_unknown and never replays it.
/// Retains metadata only: command ID, digest, aliases/percent, states, codes, times.
public struct JournalRecord: Codable, Equatable, Sendable {
    public var commandId: String
    public var digest: String
    public var steps: [String]            // "type:alias" or "set_volume:30"
    public var state: String              // ExecutionState raw value
    public var currentIndex: Int?
    public var startedAt: Date
    public var finishedAt: Date?
    public var result: JSONValue?         // final CommandResult JSON (bounded, already redacted)
    public var reported: Bool
}

public protocol JournalStore: AnyObject {
    func load() -> [JournalRecord]
    func save(_ records: [JournalRecord]) throws
}
public final class MemoryJournalStore: JournalStore {
    public var records: [JournalRecord] = []
    public var failSaves = false
    public init() {}
    public func load() -> [JournalRecord] { records }
    public func save(_ records: [JournalRecord]) throws { if failSaves { throw ContractError("journal_unavailable") }; self.records = records }
}
public final class FileJournalStore: JournalStore {
    let url: URL
    public init(url: URL) { self.url = url }
    public func load() -> [JournalRecord] {
        guard let data = try? Data(contentsOf: url), data.count <= 4_194_304 else { return [] }
        let d = JSONDecoder(); d.dateDecodingStrategy = .iso8601
        return (try? d.decode([JournalRecord].self, from: data)) ?? []
    }
    public func save(_ records: [JournalRecord]) throws {
        let e = JSONEncoder(); e.dateEncodingStrategy = .iso8601
        try PrivateFile.write(try e.encode(records), to: url)
    }
}

public final class Journal {
    public static let maxRecords = 200
    public static let retention: TimeInterval = 30 * 86400
    private let store: JournalStore
    private let lock = NSLock()
    private var records: [JournalRecord]
    private let now: () -> Date
    public init(store: JournalStore, now: @escaping () -> Date = Date.init) {
        self.store = store; self.now = now; self.records = store.load()
    }
    private func persist() throws {
        let cutoff = now().addingTimeInterval(-Self.retention)
        records = records.filter { $0.finishedAt == nil || $0.finishedAt! > cutoff || !$0.reported }
        if records.count > Self.maxRecords { records = Array(records.suffix(Self.maxRecords)) }
        try store.save(records)
    }
    public var active: JournalRecord? { lock.lock(); defer { lock.unlock() }; return records.first { $0.finishedAt == nil } }
    public func record(_ id: String) -> JournalRecord? { lock.lock(); defer { lock.unlock() }; return records.first { $0.commandId == id } }
    public var all: [JournalRecord] { lock.lock(); defer { lock.unlock() }; return records }

    /// Fails (busy/duplicate) rather than allowing a second concurrent or repeated execution.
    public func begin(commandId: String, digest: String, actions: [Action]) throws {
        lock.lock(); defer { lock.unlock() }
        if records.contains(where: { $0.commandId == commandId }) { throw ContractError("duplicate") }
        if records.contains(where: { $0.finishedAt == nil }) { throw ContractError("busy") }
        records.append(JournalRecord(commandId: commandId, digest: digest, steps: actions.map { "\($0.type.rawValue):\($0.target)" }, state: ExecutionState.running.rawValue, currentIndex: nil, startedAt: now(), finishedAt: nil, result: nil, reported: false))
        do { try persist() } catch { records.removeAll { $0.commandId == commandId }; throw ContractError("journal_unavailable") }
    }
    public func mark(commandId: String, state: ExecutionState, index: Int?) throws {
        lock.lock(); defer { lock.unlock() }
        guard let i = records.firstIndex(where: { $0.commandId == commandId }) else { return }
        records[i].state = state.rawValue; records[i].currentIndex = index
        try persist()
    }
    public func finish(_ result: CommandResult) {
        lock.lock(); defer { lock.unlock() }
        guard let i = records.firstIndex(where: { $0.commandId == result.commandId }) else { return }
        records[i].state = result.state.rawValue; records[i].finishedAt = result.finishedAt; records[i].result = result.json; records[i].currentIndex = nil
        try? persist()
    }
    public func markReported(_ commandId: String) {
        lock.lock(); defer { lock.unlock() }
        guard let i = records.firstIndex(where: { $0.commandId == commandId }) else { return }
        records[i].reported = true
        try? persist()
    }
    public var unreported: [JournalRecord] { lock.lock(); defer { lock.unlock() }; return records.filter { $0.finishedAt != nil && !$0.reported } }

    /// After a crash/restart: anything still in flight is outcome_unknown. Nothing is replayed.
    @discardableResult public func recoverInterrupted() -> [CommandResult] {
        lock.lock(); defer { lock.unlock() }
        var recovered: [CommandResult] = []
        for i in records.indices where records[i].finishedAt == nil {
            let at = now()
            let results: [ActionResult] = records[i].steps.enumerated().compactMap { offset, step in
                guard let type = ActionType(rawValue: String(step.split(separator: ":").first ?? "")) else { return nil }
                let current = records[i].currentIndex
                if let c = current, offset < c { return ActionResult(index: offset, type: type, state: .outcomeUnknown, evidence: .none, code: .interrupted, message: "The companion stopped before recording this step's result.") }
                if let c = current, offset == c { return ActionResult(index: offset, type: type, state: .outcomeUnknown, evidence: .none, code: .interrupted, message: "The companion stopped while this step was running. It may or may not have taken effect.") }
                return ActionResult(index: offset, type: type, state: .skipped, evidence: .none, code: .interrupted, message: "Not started because the companion stopped.")
            }
            let nothingStarted = records[i].currentIndex == nil
            let result = CommandResult(commandId: records[i].commandId, state: nothingStarted ? .cancelled : .outcomeUnknown,
                                       results: results, startedAt: records[i].startedAt, finishedAt: at,
                                       summary: nothingStarted ? "The companion stopped before any step started. Nothing ran and nothing will be retried." : "The companion stopped unexpectedly. The outcome is unknown and nothing will be retried automatically.")
            records[i].state = result.state.rawValue; records[i].finishedAt = at; records[i].result = result.json; records[i].currentIndex = nil
            recovered.append(result)
        }
        try? persist()
        return recovered
    }
    public func clearFinished() {
        lock.lock(); defer { lock.unlock() }
        records.removeAll { $0.finishedAt != nil && $0.reported }
        try? persist()
    }
}
