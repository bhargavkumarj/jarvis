import Foundation

// Swift mirror of packages/computer-control-contracts/src/index.ts (protocol v1).
// Both are tested against packages/computer-control-contracts/fixtures/contract-cases.json.

public enum Protocol1 {
    public static let version = 1
    public static let nativeHostName = "com.jarvis.companion"
    public static let digestDomain = "jarvis-computer-control/v1"
    public static let maxFrameBytes = 65536
    public static let maxPlanActions = 5
    public static let maxCatalogueEntries = 100
    public static let maxNames = 5
    public static let maxLabel = 60
    public static let maxMessage = 200
    public static let maxSummary = 300
    public static let maxWebsiteURL = 2048
    public static let shortcutTimeoutSeconds: TimeInterval = 120
    public static let shortcutOutputBytes = 4096
    public static let confirmationTimeoutSeconds: TimeInterval = 60
}

public struct ContractError: Error, Equatable, CustomStringConvertible {
    public let code: String
    public init(_ code: String) { self.code = code }
    public var description: String { code }
}

public enum ActionType: String, CaseIterable, Sendable, Codable {
    case openApplication = "open_application", openWebsite = "open_website", setVolume = "set_volume", openFolder = "open_folder", runShortcut = "run_shortcut"
    public var kind: ResourceKind? {
        switch self {
        case .openApplication: return .application
        case .openWebsite: return .website
        case .openFolder: return .folder
        case .runShortcut: return .shortcut
        case .setVolume: return nil
        }
    }
    public var label: String {
        switch self {
        case .openApplication: return "Open application"
        case .openWebsite: return "Open website"
        case .setVolume: return "Set output volume"
        case .openFolder: return "Open folder in Finder"
        case .runShortcut: return "Run Shortcut"
        }
    }
}
public enum ResourceKind: String, CaseIterable, Sendable, Codable {
    case application, website, folder, shortcut
    public var action: ActionType {
        switch self {
        case .application: return .openApplication
        case .website: return .openWebsite
        case .folder: return .openFolder
        case .shortcut: return .runShortcut
        }
    }
}
public enum ExecutionState: String, CaseIterable, Sendable, Codable {
    case proposed, awaitingConfirmation = "awaiting_confirmation", authorized, running, succeeded, failed, cancelled, expired, outcomeUnknown = "outcome_unknown"
    public static let final: Set<ExecutionState> = [.succeeded, .failed, .cancelled, .expired, .outcomeUnknown]
}
public enum ActionResultState: String, CaseIterable, Sendable, Codable {
    case succeeded, failed, cancelled, skipped, rejected, outcomeUnknown = "outcome_unknown"
}
public enum Evidence: String, CaseIterable, Sendable, Codable {
    case observed, dispatched, processExit = "process_exit", none
}
public enum ResultCode: String, CaseIterable, Sendable, Codable {
    case appLaunched = "app_launched", appRunningObserved = "app_running_observed", urlDispatched = "url_dispatched", volumeSet = "volume_set"
    case folderOpened = "folder_opened", shortcutCompleted = "shortcut_completed", shortcutFailed = "shortcut_failed", shortcutTimeout = "shortcut_timeout"
    case cancelledByUser = "cancelled_by_user", cancelledDuringRun = "cancelled_during_run", confirmationDeclined = "confirmation_declined", confirmationTimeout = "confirmation_timeout"
    case notApproved = "not_approved", actionDisabled = "action_disabled", locallyDisabled = "locally_disabled", targetMissing = "target_missing", targetChanged = "target_changed"
    case bookmarkStale = "bookmark_stale", volumeUnsupported = "volume_unsupported", invalidParameters = "invalid_parameters", osError = "os_error"
    case authorizationUnavailable = "authorization_unavailable", authorizationRevoked = "authorization_revoked", expired, interrupted, skippedAfterFailure = "skipped_after_failure"
}

public enum Action: Equatable, Sendable {
    case openApplication(alias: String), openWebsite(alias: String), setVolume(percent: Int), openFolder(alias: String), runShortcut(alias: String)
    public var type: ActionType {
        switch self {
        case .openApplication: return .openApplication
        case .openWebsite: return .openWebsite
        case .setVolume: return .setVolume
        case .openFolder: return .openFolder
        case .runShortcut: return .runShortcut
        }
    }
    public var alias: String? {
        switch self {
        case .openApplication(let a), .openWebsite(let a), .openFolder(let a), .runShortcut(let a): return a
        case .setVolume: return nil
        }
    }
    public var target: String {
        if case .setVolume(let p) = self { return String(p) }
        return alias ?? ""
    }
    public var json: JSONValue {
        if case .setVolume(let p) = self { return .object(["type": .string(type.rawValue), "percent": .int(p)]) }
        return .object(["type": .string(type.rawValue), "alias": .string(alias ?? "")])
    }
}

public struct CommandEnvelope: Equatable, Sendable {
    public let commandId: String, requestId: String, deviceId: String
    public let actions: [Action]
    public let issuedAt: Date, expiresAt: Date
    public let digest: String
}
public struct ActionResult: Equatable, Sendable {
    public var index: Int
    public var type: ActionType
    public var state: ActionResultState
    public var evidence: Evidence
    public var code: ResultCode
    public var message: String
    public var observedPercent: Int?
    public var previousPercent: Int?
    public var startedAt: Date?
    public var finishedAt: Date?
    public init(index: Int, type: ActionType, state: ActionResultState, evidence: Evidence, code: ResultCode, message: String, observedPercent: Int? = nil, previousPercent: Int? = nil, startedAt: Date? = nil, finishedAt: Date? = nil) {
        self.index = index; self.type = type; self.state = state; self.evidence = evidence; self.code = code
        self.message = Redaction.message(message); self.observedPercent = observedPercent; self.previousPercent = previousPercent
        self.startedAt = startedAt; self.finishedAt = finishedAt
    }
    public var json: JSONValue {
        .object([
            "index": .int(index), "type": .string(type.rawValue), "state": .string(state.rawValue), "evidence": .string(evidence.rawValue),
            "code": .string(code.rawValue), "message": .string(message),
            "observedPercent": observedPercent.map { .int($0) } ?? .null, "previousPercent": previousPercent.map { .int($0) } ?? .null,
            "startedAt": startedAt.map { .string(Instant.format($0)) } ?? .null, "finishedAt": finishedAt.map { .string(Instant.format($0)) } ?? .null,
        ])
    }
}
public struct CommandResult: Equatable, Sendable {
    public var commandId: String
    public var state: ExecutionState
    public var results: [ActionResult]
    public var startedAt: Date?
    public var finishedAt: Date
    public var summary: String
    public var json: JSONValue {
        .object([
            "protocolVersion": .int(Protocol1.version), "commandId": .string(commandId), "state": .string(state.rawValue),
            "results": .array(results.map(\.json)), "startedAt": startedAt.map { .string(Instant.format($0)) } ?? .null,
            "finishedAt": .string(Instant.format(finishedAt)), "summary": .string(Redaction.summary(summary)),
        ])
    }
}
public struct CatalogueEntry: Equatable, Sendable {
    public var kind: ResourceKind, alias: String, label: String, names: [String], detail: String?, auto: Bool
    public init(kind: ResourceKind, alias: String, label: String, names: [String], detail: String?, auto: Bool) {
        self.kind = kind; self.alias = alias; self.label = label; self.names = names; self.detail = detail; self.auto = auto
    }
    public var json: JSONValue {
        .object(["kind": .string(kind.rawValue), "alias": .string(alias), "label": .string(label), "names": .array(names.map { .string($0) }), "detail": detail.map { .string($0) } ?? .null, "auto": .bool(auto)])
    }
}

// MARK: - Patterns (full-string matches only; `$` must not accept a trailing newline)
public enum Patterns {
    static func regex(_ p: String) -> NSRegularExpression { try! NSRegularExpression(pattern: p) }
    static let uuid = regex("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
    static let alias = regex("^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$")
    static let name = regex("^[a-z0-9](?:[a-z0-9 ]{0,38}[a-z0-9])?$")
    static let token = regex("^[A-Za-z0-9_-]{43}$")
    static let digest = regex("^[a-f0-9]{64}$")
    static let extensionId = regex("^[a-p]{32}$")
    static let hostname = regex("^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$")
    static let website = regex("^https://((?=.{1,253}(?::|/|$))[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*)(?::([0-9]{1,5}))?(/[A-Za-z0-9\\-._~%!$&'()*+,;=:@/?#]*)?$")
    static let instant = regex("^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})(?:\\.([0-9]{1,6}))?Z$")

    static func full(_ r: NSRegularExpression, _ s: String) -> NSTextCheckingResult? {
        let range = NSRange(s.startIndex..<s.endIndex, in: s)
        guard let m = r.firstMatch(in: s, options: [], range: range), m.range == range else { return nil }
        return m
    }
    public static func isUUID(_ s: String) -> Bool { full(uuid, s) != nil }
    public static func isAlias(_ s: String) -> Bool { full(alias, s) != nil }
    public static func isName(_ s: String) -> Bool { full(name, s) != nil }
    public static func isToken(_ s: String) -> Bool { full(token, s) != nil }
    public static func isDigest(_ s: String) -> Bool { full(digest, s) != nil }
    public static func isExtensionId(_ s: String) -> Bool { full(extensionId, s) != nil }
    public static func isHostname(_ s: String) -> Bool { full(hostname, s) != nil }
    public static func isPlainText(_ s: String, max: Int, min: Int = 1) -> Bool {
        let n = s.utf16.count
        guard n >= min, n <= max, s == s.trimmingCharacters(in: .whitespacesAndNewlines) else { return false }
        return !s.unicodeScalars.contains { ($0.value <= 0x1f) || (0x7f...0x9f).contains($0.value) || $0.value == 0x2028 || $0.value == 0x2029 }
    }
    /// Hostname of an exact v1 HTTPS website URL, or nil.
    public static func websiteHost(_ url: String) -> String? {
        guard url.utf16.count <= Protocol1.maxWebsiteURL, let m = full(website, url), let hostRange = Range(m.range(at: 1), in: url) else { return nil }
        if let portRange = Range(m.range(at: 2), in: url) {
            guard let port = Int(url[portRange]), (1...65535).contains(port) else { return nil }
        }
        return String(url[hostRange])
    }
}

public enum Instant {
    public static func parse(_ s: String) -> Date? {
        guard let m = Patterns.full(Patterns.instant, s) else { return nil }
        func group(_ i: Int) -> Int? { Range(m.range(at: i), in: s).flatMap { Int(s[$0]) } }
        guard let y = group(1), let mo = group(2), let d = group(3), let h = group(4), let mi = group(5), let se = group(6),
              (1...12).contains(mo), (1...31).contains(d), (0...23).contains(h), (0...59).contains(mi), (0...59).contains(se) else { return nil }
        var fraction = 0.0
        if let r = Range(m.range(at: 7), in: s) { fraction = Double("0." + s[r]) ?? 0 }
        var c = DateComponents(); c.year = y; c.month = mo; c.day = d; c.hour = h; c.minute = mi; c.second = se
        var cal = Calendar(identifier: .gregorian); cal.timeZone = TimeZone(identifier: "UTC")!
        return cal.date(from: c).map { $0.addingTimeInterval(fraction) }
    }
    public static func format(_ date: Date) -> String {
        var cal = Calendar(identifier: .gregorian); cal.timeZone = TimeZone(identifier: "UTC")!
        let c = cal.dateComponents([.year, .month, .day, .hour, .minute, .second, .nanosecond], from: date)
        let ms = min(999, Int((Double(c.nanosecond ?? 0) / 1_000_000).rounded(.down)))
        return String(format: "%04d-%02d-%02dT%02d:%02d:%02d.%03dZ", c.year!, c.month!, c.day!, c.hour!, c.minute!, c.second!, ms)
    }
}

// MARK: - Strict parsers (same check order and error codes as TypeScript)
enum Strict {
    static func record(_ v: JSONValue, _ code: String) throws -> [String: JSONValue] {
        guard let o = v.objectValue else { throw ContractError(code) }
        return o
    }
    static func exactKeys(_ o: [String: JSONValue], _ keys: [String], _ code: String) throws {
        guard o.count == keys.count, Set(o.keys) == Set(keys) else { throw ContractError(code) }
    }
    static func version(_ o: [String: JSONValue]) throws {
        guard o["protocolVersion"] == .int(Protocol1.version) else { throw ContractError("unsupported_version") }
    }
}

public enum Contracts {
    public static func parseAction(_ v: JSONValue) throws -> Action {
        let o = try Strict.record(v, "invalid_action")
        guard let t = o["type"]?.stringValue, let type = ActionType(rawValue: t) else { throw ContractError("unknown_action") }
        if type == .setVolume {
            try Strict.exactKeys(o, ["type", "percent"], "invalid_action")
            guard let p = o["percent"]?.intValue, (0...100).contains(p) else { throw ContractError("invalid_volume") }
            return .setVolume(percent: p)
        }
        try Strict.exactKeys(o, ["type", "alias"], "invalid_action")
        guard let a = o["alias"]?.stringValue, Patterns.isAlias(a) else { throw ContractError("invalid_alias") }
        switch type {
        case .openApplication: return .openApplication(alias: a)
        case .openWebsite: return .openWebsite(alias: a)
        case .openFolder: return .openFolder(alias: a)
        case .runShortcut: return .runShortcut(alias: a)
        case .setVolume: throw ContractError("invalid_action")
        }
    }
    public static func parseActions(_ v: JSONValue?) throws -> [Action] {
        guard let a = v?.arrayValue, !a.isEmpty else { throw ContractError("invalid_plan") }
        guard a.count <= Protocol1.maxPlanActions else { throw ContractError("plan_too_long") }
        return try a.map(parseAction)
    }
    public static func parseEnvelope(_ v: JSONValue) throws -> CommandEnvelope {
        let o = try Strict.record(v, "invalid_command")
        try Strict.version(o)
        try Strict.exactKeys(o, ["protocolVersion", "commandId", "requestId", "deviceId", "actions", "issuedAt", "expiresAt", "digest"], "invalid_command")
        guard let c = o["commandId"]?.stringValue, let r = o["requestId"]?.stringValue, let d = o["deviceId"]?.stringValue,
              Patterns.isUUID(c), Patterns.isUUID(r), Patterns.isUUID(d) else { throw ContractError("invalid_identifier") }
        guard let i = o["issuedAt"]?.stringValue.flatMap(Instant.parse), let e = o["expiresAt"]?.stringValue.flatMap(Instant.parse), e > i else { throw ContractError("invalid_time") }
        guard let g = o["digest"]?.stringValue, Patterns.isDigest(g) else { throw ContractError("invalid_digest") }
        return CommandEnvelope(commandId: c, requestId: r, deviceId: d, actions: try parseActions(o["actions"]), issuedAt: i, expiresAt: e, digest: g)
    }
    static func nullablePercent(_ v: JSONValue?) -> Int?? {
        guard let v else { return .none }
        if v.isNull { return .some(nil) }
        if let p = v.intValue, (0...100).contains(p) { return .some(p) }
        return .none
    }
    static func nullableInstant(_ v: JSONValue?) -> Date?? {
        guard let v else { return .none }
        if v.isNull { return .some(nil) }
        if let s = v.stringValue, let d = Instant.parse(s) { return .some(d) }
        return .none
    }
    public static func parseActionResult(_ v: JSONValue, index: Int) throws -> ActionResult {
        let o = try Strict.record(v, "invalid_result")
        try Strict.exactKeys(o, ["index", "type", "state", "evidence", "code", "message", "observedPercent", "previousPercent", "startedAt", "finishedAt"], "invalid_result")
        guard o["index"] == .int(index) else { throw ContractError("invalid_result") }
        guard let type = o["type"]?.stringValue.flatMap(ActionType.init(rawValue:)) else { throw ContractError("unknown_action") }
        guard let state = o["state"]?.stringValue.flatMap(ActionResultState.init(rawValue:)) else { throw ContractError("invalid_state") }
        guard let evidence = o["evidence"]?.stringValue.flatMap(Evidence.init(rawValue:)) else { throw ContractError("invalid_evidence") }
        guard let code = o["code"]?.stringValue.flatMap(ResultCode.init(rawValue:)) else { throw ContractError("invalid_code") }
        guard let message = o["message"]?.stringValue, Patterns.isPlainText(message, max: Protocol1.maxMessage) else { throw ContractError("invalid_message") }
        guard case .some(let observed) = nullablePercent(o["observedPercent"]), case .some(let previous) = nullablePercent(o["previousPercent"]) else { throw ContractError("invalid_volume") }
        guard case .some(let started) = nullableInstant(o["startedAt"]), case .some(let finished) = nullableInstant(o["finishedAt"]) else { throw ContractError("invalid_time") }
        if state == .succeeded && evidence == Evidence.none { throw ContractError("invalid_evidence") }
        if (state == .skipped || state == .rejected) && evidence != Evidence.none { throw ContractError("invalid_evidence") }
        return ActionResult(index: index, type: type, state: state, evidence: evidence, code: code, message: message, observedPercent: observed, previousPercent: previous, startedAt: started, finishedAt: finished)
    }
    public static func parseCommandResult(_ v: JSONValue) throws -> CommandResult {
        let o = try Strict.record(v, "invalid_result")
        try Strict.version(o)
        try Strict.exactKeys(o, ["protocolVersion", "commandId", "state", "results", "startedAt", "finishedAt", "summary"], "invalid_result")
        guard let c = o["commandId"]?.stringValue, Patterns.isUUID(c) else { throw ContractError("invalid_identifier") }
        guard let state = o["state"]?.stringValue.flatMap(ExecutionState.init(rawValue:)), ExecutionState.final.contains(state) else { throw ContractError("invalid_state") }
        guard let raw = o["results"]?.arrayValue, raw.count <= Protocol1.maxPlanActions else { throw ContractError("invalid_result") }
        let results = try raw.enumerated().map { try parseActionResult($0.element, index: $0.offset) }
        guard case .some(let started) = nullableInstant(o["startedAt"]), let finished = o["finishedAt"]?.stringValue.flatMap(Instant.parse) else { throw ContractError("invalid_time") }
        guard let summary = o["summary"]?.stringValue, Patterns.isPlainText(summary, max: Protocol1.maxSummary) else { throw ContractError("invalid_message") }
        if state == .succeeded && (results.isEmpty || results.contains { $0.state != .succeeded }) { throw ContractError("invalid_state") }
        return CommandResult(commandId: c, state: state, results: results, startedAt: started, finishedAt: finished, summary: summary)
    }
    public static func parseCatalogueEntry(_ v: JSONValue) throws -> CatalogueEntry {
        let o = try Strict.record(v, "invalid_catalogue")
        try Strict.exactKeys(o, ["kind", "alias", "label", "names", "detail", "auto"], "invalid_catalogue")
        guard let kind = o["kind"]?.stringValue.flatMap(ResourceKind.init(rawValue:)) else { throw ContractError("invalid_catalogue") }
        guard let alias = o["alias"]?.stringValue, Patterns.isAlias(alias) else { throw ContractError("invalid_alias") }
        guard let label = o["label"]?.stringValue, Patterns.isPlainText(label, max: Protocol1.maxLabel) else { throw ContractError("invalid_label") }
        guard let rawNames = o["names"]?.arrayValue, rawNames.count <= Protocol1.maxNames else { throw ContractError("invalid_names") }
        let names = rawNames.compactMap(\.stringValue)
        guard names.count == rawNames.count, names.allSatisfy(Patterns.isName), Set(names).count == names.count else { throw ContractError("invalid_names") }
        let detail = o["detail"]
        if kind == .website {
            guard let host = detail?.stringValue, Patterns.isHostname(host) else { throw ContractError("invalid_detail") }
        } else if detail?.isNull != true { throw ContractError("invalid_detail") }
        guard let auto = o["auto"]?.boolValue, !(kind == .shortcut && auto) else { throw ContractError("invalid_auto") }
        return CatalogueEntry(kind: kind, alias: alias, label: label, names: names, detail: detail?.stringValue, auto: auto)
    }
}
