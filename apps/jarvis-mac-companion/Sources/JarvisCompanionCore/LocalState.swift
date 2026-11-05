import Foundation

/// A locally approved resource. Only `publicEntry` (alias, label, spoken names,
/// website hostname, auto flag) ever leaves the Mac. Bundle paths, folder
/// bookmarks, full URLs and Shortcut identifiers stay in the local config file.
public struct LocalEntry: Codable, Equatable, Sendable {
    public var kind: ResourceKind
    public var alias: String
    public var label: String
    public var names: [String]
    public var auto: Bool
    public var createdAt: Date
    public var bundleId: String?       // application
    public var url: String?            // website (exact HTTPS URL)
    public var bookmark: Data?         // folder (bookmark data created from the native picker)
    public var folderPath: String?     // folder path at approval / last validation (local only)
    public var shortcutName: String?   // shortcut
    public var shortcutId: String?     // shortcut identifier at approval, used to detect replacement

    public init(kind: ResourceKind, alias: String, label: String, names: [String] = [], auto: Bool = false, createdAt: Date = Date(),
                bundleId: String? = nil, url: String? = nil, bookmark: Data? = nil, folderPath: String? = nil, shortcutName: String? = nil, shortcutId: String? = nil) {
        self.kind = kind; self.alias = alias; self.label = label; self.names = names; self.auto = auto; self.createdAt = createdAt
        self.bundleId = bundleId; self.url = url; self.bookmark = bookmark; self.folderPath = folderPath; self.shortcutName = shortcutName; self.shortcutId = shortcutId
    }
    public var publicEntry: CatalogueEntry {
        CatalogueEntry(kind: kind, alias: alias, label: label, names: names, detail: kind == .website ? url.flatMap(Patterns.websiteHost) : nil, auto: kind == .shortcut ? false : auto)
    }
    public func validate() throws {
        guard Patterns.isAlias(alias) else { throw ContractError("invalid_alias") }
        guard Patterns.isPlainText(label, max: Protocol1.maxLabel) else { throw ContractError("invalid_label") }
        guard names.count <= Protocol1.maxNames, names.allSatisfy(Patterns.isName), Set(names).count == names.count else { throw ContractError("invalid_names") }
        if kind == .shortcut && auto { throw ContractError("invalid_auto") }
        switch kind {
        case .application:
            guard let b = bundleId, b.utf8.count <= 255, b.range(of: "^[A-Za-z0-9.-]+$", options: .regularExpression) != nil else { throw ContractError("invalid_target") }
        case .website:
            guard let u = url, Patterns.websiteHost(u) != nil else { throw ContractError("invalid_target") }
        case .folder:
            guard let bm = bookmark, !bm.isEmpty, bm.count <= 16384, let p = folderPath, p.hasPrefix("/"), p != "/" else { throw ContractError("invalid_target") }
        case .shortcut:
            // Name is passed as one argv element (never a shell string); a leading "-" could be read as a flag.
            guard let n = shortcutName, Patterns.isPlainText(n, max: 120), !n.hasPrefix("-") else { throw ContractError("invalid_target") }
        }
    }
}

public struct CompanionConfig: Codable, Equatable, Sendable {
    public var version = 1
    public var backendOrigin: String
    public var allowedExtensionId: String
    public var deviceName: String
    public var deviceId: String?
    public var accountLabel: String?
    public var pairedAt: Date?
    public var disabled = false
    public var enabledActions: [ActionType] = ActionType.allCases
    public var volumeAuto = false
    public var catalogue: [LocalEntry] = []

    public init(backendOrigin: String, allowedExtensionId: String, deviceName: String) {
        self.backendOrigin = backendOrigin; self.allowedExtensionId = allowedExtensionId; self.deviceName = deviceName
    }
    /// https:// origins, or an explicitly configured loopback http:// development origin. No paths, wildcards or userinfo.
    public static func validOrigin(_ s: String) -> Bool {
        guard let c = URLComponents(string: s), let scheme = c.scheme, let host = c.host, c.user == nil, c.password == nil,
              c.path.isEmpty, c.query == nil, c.fragment == nil, !host.contains("*") else { return false }
        let rebuilt = "\(scheme)://\(host)\(c.port.map { ":\($0)" } ?? "")"
        guard rebuilt == s else { return false }
        if scheme == "https" { return Patterns.isHostname(host) }
        return scheme == "http" && ["127.0.0.1", "localhost", "[::1]", "::1"].contains(host)
    }
    public func validate() throws {
        guard Self.validOrigin(backendOrigin) else { throw ContractError("invalid_origin") }
        guard Patterns.isExtensionId(allowedExtensionId) else { throw ContractError("invalid_extension") }
        guard Patterns.isPlainText(deviceName, max: 60) else { throw ContractError("invalid_device_name") }
        if let d = deviceId, !Patterns.isUUID(d) { throw ContractError("invalid_identifier") }
        guard catalogue.count <= Protocol1.maxCatalogueEntries else { throw ContractError("invalid_catalogue") }
        var seen = Set<String>()
        for e in catalogue {
            try e.validate()
            guard seen.insert("\(e.kind.rawValue):\(e.alias)").inserted else { throw ContractError("duplicate_alias") }
        }
    }
    public func entry(kind: ResourceKind, alias: String) -> LocalEntry? { catalogue.first { $0.kind == kind && $0.alias == alias } }
    public func syncPayload(hostVersion: String) -> JSONValue {
        .object([
            "protocolVersion": .int(Protocol1.version), "hostVersion": .string(hostVersion), "disabled": .bool(disabled),
            "enabledActions": .array(enabledActions.map { .string($0.rawValue) }), "volumeAuto": .bool(volumeAuto),
            "catalogue": .array(catalogue.map(\.publicEntry.json)),
        ])
    }
}

public enum PolicyDecision: Equatable {
    case allow(entry: LocalEntry?, auto: Bool)
    case reject(ResultCode, String)
}
/// Local policy is authoritative: a backend-authorized ticket still runs only
/// actions that this Mac enabled, for resources this Mac approved.
public struct LocalPolicy {
    public let config: CompanionConfig
    public init(_ config: CompanionConfig) { self.config = config }
    public func evaluate(_ action: Action) -> PolicyDecision {
        if config.disabled { return .reject(.locallyDisabled, "Computer control is disabled on this Mac.") }
        guard config.enabledActions.contains(action.type) else { return .reject(.actionDisabled, "\(action.type.label) is turned off in the companion.") }
        if case .setVolume = action { return .allow(entry: nil, auto: config.volumeAuto) }
        guard let kind = action.type.kind, let alias = action.alias, let entry = config.entry(kind: kind, alias: alias) else {
            return .reject(.notApproved, "This item is not approved on this Mac.")
        }
        return .allow(entry: entry, auto: entry.kind != .shortcut && entry.auto)
    }
}

public protocol ConfigStore: AnyObject {
    func load() throws -> CompanionConfig?
    func save(_ config: CompanionConfig) throws
    func delete() throws
}
public protocol SecretStore: AnyObject {
    func save(secret: String, account: String) throws
    func load(account: String) -> String?
    func delete(account: String)
}
public struct DeviceCredential: Equatable {
    public let deviceId: String; public let secret: String
    public init(deviceId: String, secret: String) { self.deviceId = deviceId; self.secret = secret }
}

/// JSON file, owner-only permissions, atomic replace. Not secret: no credentials.
public final class FileConfigStore: ConfigStore {
    public let url: URL
    public init(url: URL) { self.url = url }
    public func load() throws -> CompanionConfig? {
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        let data = try Data(contentsOf: url)
        guard data.count <= 1_048_576 else { throw ContractError("config_too_large") }
        let d = JSONDecoder(); d.dateDecodingStrategy = .iso8601
        let config = try d.decode(CompanionConfig.self, from: data)
        try config.validate()
        return config
    }
    public func save(_ config: CompanionConfig) throws {
        try config.validate()
        let e = JSONEncoder(); e.dateEncodingStrategy = .iso8601; e.outputFormatting = [.prettyPrinted, .sortedKeys]
        try PrivateFile.write(try e.encode(config), to: url)
    }
    public func delete() throws { try? FileManager.default.removeItem(at: url) }
}
public final class MemoryConfigStore: ConfigStore {
    public var config: CompanionConfig?
    public init(_ config: CompanionConfig? = nil) { self.config = config }
    public func load() throws -> CompanionConfig? { config }
    public func save(_ config: CompanionConfig) throws { try config.validate(); self.config = config }
    public func delete() throws { config = nil }
}
public final class MemorySecretStore: SecretStore {
    public var items: [String: String] = [:]
    public init() {}
    public func save(secret: String, account: String) throws { items[account] = secret }
    public func load(account: String) -> String? { items[account] }
    public func delete(account: String) { items.removeValue(forKey: account) }
}

public enum PrivateFile {
    /// Writes with 0600 into a 0700 directory, via a temporary file and atomic rename.
    public static func write(_ data: Data, to url: URL) throws {
        let dir = url.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let tmp = dir.appendingPathComponent(".\(url.lastPathComponent).\(UUID().uuidString).tmp")
        guard FileManager.default.createFile(atPath: tmp.path, contents: data, attributes: [.posixPermissions: 0o600]) else { throw ContractError("write_failed") }
        if let h = try? FileHandle(forWritingTo: tmp) { try? h.synchronize(); try? h.close() }
        // POSIX rename(2): atomic replacement within one directory on macOS and Linux.
        guard rename(tmp.path, url.path) == 0 else { try? FileManager.default.removeItem(at: tmp); throw ContractError("write_failed") }
        try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
    }
}
