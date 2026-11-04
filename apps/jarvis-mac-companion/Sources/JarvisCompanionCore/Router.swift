import Foundation

/// Native approvals and pickers. Implemented with AppKit on macOS; faked in tests.
public protocol CompanionUI: AnyObject {
    func approvePairing(origin: String, accountLabel: String, deviceName: String, extensionId: String) -> Bool
    /// Native picker + review dialog. Returns nil if the user cancelled. Never driven by page-supplied paths/URLs.
    func pickResource(kind: ResourceKind, existingAliases: Set<String>) -> LocalEntry?
    func approveAuto(label: String) -> Bool
    func approveEnable() -> Bool
    func approveUnpair(accountLabel: String) -> Bool
    func statusChanged(_ status: CompanionStatus)
}
public struct CompanionStatus: Equatable {
    public var paired: Bool, disabled: Bool, origin: String, accountLabel: String?, activeCommandId: String?
    public init(paired: Bool, disabled: Bool, origin: String, accountLabel: String?, activeCommandId: String?) {
        self.paired = paired; self.disabled = disabled; self.origin = origin; self.accountLabel = accountLabel; self.activeCommandId = activeCommandId
    }
}

/// Routes validated bridge frames. Control messages (hello, cancel, disable) are
/// answered immediately; state-changing work runs on one serial queue.
public final class HostRouter {
    let callerOrigin: String
    let engine: CommandEngine
    let configStore: ConfigStore
    let secrets: SecretStore
    let backend: Backend
    let ui: CompanionUI
    let writer: FrameWriter
    let work = DispatchQueue(label: "jarvis.companion.work")
    public var diagnostics: () -> [(code: String, message: String)] = { [] }

    public init(callerOrigin: String, engine: CommandEngine, configStore: ConfigStore, secrets: SecretStore, backend: Backend, ui: CompanionUI, writer: FrameWriter) {
        self.callerOrigin = callerOrigin; self.engine = engine; self.configStore = configStore; self.secrets = secrets
        self.backend = backend; self.ui = ui; self.writer = writer
    }
    /// Chrome passes the caller as argv[1] ("chrome-extension://<id>/"). Must equal the pinned ID.
    public static func callerAllowed(_ argument: String?, config: CompanionConfig) -> Bool {
        argument == "chrome-extension://\(config.allowedExtensionId)/"
    }

    func respond(_ id: String, _ name: String, payload: JSONValue? = nil, error: (String, String)? = nil) {
        writer.write(.object([
            "v": .int(1), "id": .string(id), "kind": .string("response"), "name": .string(name), "ok": .bool(error == nil),
            "payload": payload ?? .null,
            "error": error.map { .object(["code": .string($0.0), "message": .string(Redaction.message($0.1))]) } ?? .null,
        ]))
    }
    func event(_ name: String, _ payload: JSONValue) {
        writer.write(.object(["v": .int(1), "id": .null, "kind": .string("event"), "name": .string(name), "ok": .bool(true), "payload": payload, "error": .null]))
    }
    public func statusPayload() -> JSONValue {
        let config = try? configStore.load()
        let paired = config.flatMap { engine.credential($0) } != nil
        var problems: [JSONValue] = diagnostics().map { .object(["code": .string($0.code), "message": .string($0.message)]) }
        if config == nil { problems.append(.object(["code": .string("not_configured"), "message": .string("Run the companion configure step for this JARVIS origin.")])) }
        else if !paired { problems.append(.object(["code": .string("not_paired"), "message": .string("This Mac is not paired. Use Pair this Mac in Settings → Computer.")])) }
        return .object(["companion": .object([
            "version": .string(engine.hostVersion), "paired": .bool(paired),
            "deviceId": config?.deviceId.map { .string($0) } ?? .null, "deviceName": config.map { .string($0.deviceName) } ?? .null,
            "accountLabel": config?.accountLabel.map { .string($0) } ?? .null, "backendOrigin": config.map { .string($0.backendOrigin) } ?? .null,
            "disabled": .bool(config?.disabled ?? false), "enabledActions": .array((config?.enabledActions ?? []).map { .string($0.rawValue) }),
            "volumeAuto": .bool(config?.volumeAuto ?? false), "catalogue": .array((config?.catalogue ?? []).map(\.publicEntry.json)),
            "activeCommandId": engine.activeCommandId.map { .string($0) } ?? .null, "problems": .array(problems),
        ])])
    }
    func publishStatus() {
        event("status", statusPayload())
        let c = try? configStore.load()
        ui.statusChanged(CompanionStatus(paired: c.flatMap { engine.credential($0) } != nil, disabled: c?.disabled ?? false, origin: c?.backendOrigin ?? "", accountLabel: c?.accountLabel, activeCommandId: engine.activeCommandId))
    }
    func syncCatalogue() {
        guard let c = try? configStore.load(), let cred = engine.credential(c) else { return }
        if let r = try? backend.sync(c.syncPayload(hostVersion: engine.hostVersion), credential: cred), !r.accountLabel.isEmpty, r.accountLabel != c.accountLabel {
            var updated = c; updated.accountLabel = r.accountLabel; try? configStore.save(updated)
        }
    }

    /// Waits for queued state-changing work (used before exiting on Chrome disconnect).
    public func drain() { work.sync {} }
    /// Re-sync the catalogue and publish status after a local change (menu bar, reconcile).
    public func refreshStatus() { work.async { self.syncCatalogue(); self.publishStatus() } }

    /// Entry point for each inbound frame (already length-bounded and JSON-decoded).
    public func handle(_ frame: [String: JSONValue]) {
        guard frame.count == 5, Set(frame.keys) == ["v", "id", "type", "payload", "origin"], frame["v"] == .int(1),
              let id = frame["id"]?.stringValue, Patterns.isUUID(id), let type = frame["type"]?.stringValue,
              let payload = frame["payload"]?.objectValue, let origin = frame["origin"]?.stringValue else { return }
        guard let config = try? configStore.load() else { respond(id, type, payload: statusPayload(), error: ("not_paired", "The companion is not configured on this Mac.")); return }
        // The page origin observed by Chrome must be the backend this Mac trusts.
        guard origin == config.backendOrigin else { respond(id, type, error: ("origin_rejected", "This page origin is not the JARVIS server this Mac trusts.")); return }
        switch type {
        case "hello": respond(id, type, payload: statusPayload())
        case "cancel":
            let target = payload["commandId"]?.stringValue
            let stopped = engine.cancel(commandId: target)
            respond(id, type, payload: .object(["stopped": .bool(stopped)]))
        case "disable":
            // Emergency local disable: immediate, persisted, no backend needed.
            var c = config; c.disabled = true; try? configStore.save(c)
            engine.cancel(commandId: nil)
            respond(id, type, payload: statusPayload()); publishStatus()
            work.async { self.syncCatalogue() }
        default:
            work.async { self.handleWork(id: id, type: type, payload: payload) }
        }
    }

    func handleWork(id: String, type: String, payload: [String: JSONValue]) {
        guard var config = try? configStore.load() else { respond(id, type, error: ("not_paired", "The companion is not configured.")); return }
        switch type {
        case "execute":
            guard payload.count == 2, let commandId = payload["commandId"]?.stringValue, let ticket = payload["ticket"]?.stringValue,
                  Patterns.isUUID(commandId), Patterns.isToken(ticket) else { respond(id, type, error: ("invalid_message", "Malformed execute request.")); return }
            publishStatus()
            let outcome = engine.execute(commandId: commandId, ticket: ticket) { e in
                if case .progress(let c, let s, let i) = e { self.event("command_progress", .object(["commandId": .string(c), "state": .string(s.rawValue), "index": i.map { .int($0) } ?? .null])) }
            }
            switch outcome {
            case .success(let result):
                event("command_result", .object(["commandId": .string(commandId), "result": result.json]))
                respond(id, type, payload: .object(["commandId": .string(commandId), "result": result.json]))
            case .failure(let refusal):
                respond(id, type, error: (refusal.code, refusal.message))
            }
            publishStatus()
        case "pair":
            guard payload.count == 2, let pairingId = payload["pairingId"]?.stringValue, let code = payload["code"]?.stringValue,
                  Patterns.isUUID(pairingId), Patterns.isToken(code) else { respond(id, type, error: ("invalid_message", "Malformed pairing request.")); return }
            if engine.credential(config) != nil { respond(id, type, error: ("already_paired", "This Mac is already paired. Unpair it first.")); return }
            let inspected: (accountLabel: String, origin: String)
            do { inspected = try backend.pairingInspect(pairingId: pairingId, code: code, extensionId: config.allowedExtensionId) }
            catch BackendError.unauthorized { respond(id, type, error: ("authorization_failed", "The pairing request is invalid, expired or already used.")); return }
            catch { respond(id, type, error: ("backend_unavailable", "JARVIS could not be reached to verify pairing.")); return }
            guard inspected.origin == config.backendOrigin else { respond(id, type, error: ("origin_rejected", "Pairing was issued for a different JARVIS origin.")); return }
            guard ui.approvePairing(origin: config.backendOrigin, accountLabel: inspected.accountLabel, deviceName: config.deviceName, extensionId: config.allowedExtensionId) else {
                respond(id, type, error: ("declined", "Pairing was not approved on the Mac.")); return
            }
            let secret = RandomToken.make()
            let account = CommandEngine.secretAccount(origin: config.backendOrigin)
            do { try secrets.save(secret: secret, account: account) }
            catch { respond(id, type, error: ("internal", "The device credential could not be stored in the Keychain. Nothing was paired.")); return }
            do {
                let done = try backend.pairingComplete(pairingId: pairingId, code: code, extensionId: config.allowedExtensionId, deviceName: config.deviceName, credentialHash: SHA256.hex(Array(secret.utf8)))
                config.deviceId = done.deviceId; config.accountLabel = done.accountLabel; config.pairedAt = Date()
                try configStore.save(config)
            } catch {
                secrets.delete(account: account)
                respond(id, type, error: ("authorization_failed", "Pairing could not be completed. Nothing was paired.")); return
            }
            syncCatalogue()
            respond(id, type, payload: statusPayload()); publishStatus()
        case "enable":
            guard ui.approveEnable() else { respond(id, type, error: ("declined", "Not re-enabled.")); return }
            config.disabled = false; try? configStore.save(config)
            syncCatalogue(); respond(id, type, payload: statusPayload()); publishStatus()
        case "manage_add":
            guard payload.count == 1, let kind = payload["kind"]?.stringValue.flatMap(ResourceKind.init(rawValue:)) else { respond(id, type, error: ("invalid_message", "Malformed request.")); return }
            guard config.catalogue.count < Protocol1.maxCatalogueEntries else { respond(id, type, error: ("policy_rejected", "The approved-item limit was reached.")); return }
            guard let entry = ui.pickResource(kind: kind, existingAliases: Set(config.catalogue.filter { $0.kind == kind }.map(\.alias))) else { respond(id, type, error: ("declined", "Nothing was added.")); return }
            do { try entry.validate() } catch { respond(id, type, error: ("policy_rejected", "That item could not be approved.")); return }
            guard config.entry(kind: entry.kind, alias: entry.alias) == nil else { respond(id, type, error: ("policy_rejected", "That alias is already used.")); return }
            config.catalogue.append(entry); try? configStore.save(config)
            syncCatalogue(); respond(id, type, payload: statusPayload()); publishStatus()
        case "manage_remove":
            // Removing access needs no extra approval.
            guard payload.count == 2, let kind = payload["kind"]?.stringValue.flatMap(ResourceKind.init(rawValue:)), let alias = payload["alias"]?.stringValue, Patterns.isAlias(alias) else { respond(id, type, error: ("invalid_message", "Malformed request.")); return }
            config.catalogue.removeAll { $0.kind == kind && $0.alias == alias }; try? configStore.save(config)
            syncCatalogue(); respond(id, type, payload: statusPayload()); publishStatus()
        case "manage_auto":
            guard payload.count == 3, let enabled = payload["enabled"]?.boolValue, let kindRaw = payload["kind"]?.stringValue else { respond(id, type, error: ("invalid_message", "Malformed request.")); return }
            if kindRaw == "volume" {
                if enabled && !ui.approveAuto(label: "Set output volume") { respond(id, type, error: ("declined", "Not changed.")); return }
                config.volumeAuto = enabled
            } else {
                guard let kind = ResourceKind(rawValue: kindRaw), kind != .shortcut, let alias = payload["alias"]?.stringValue,
                      let index = config.catalogue.firstIndex(where: { $0.kind == kind && $0.alias == alias }) else { respond(id, type, error: ("policy_rejected", "Shortcuts always ask, and only approved items can run automatically.")); return }
                if enabled && !ui.approveAuto(label: config.catalogue[index].label) { respond(id, type, error: ("declined", "Not changed.")); return }
                config.catalogue[index].auto = enabled
            }
            try? configStore.save(config)
            syncCatalogue(); respond(id, type, payload: statusPayload()); publishStatus()
        case "unpair":
            guard ui.approveUnpair(accountLabel: config.accountLabel ?? "this account") else { respond(id, type, error: ("declined", "Still paired.")); return }
            if let cred = engine.credential(config) { try? backend.unpair(credential: cred) }
            secrets.delete(account: CommandEngine.secretAccount(origin: config.backendOrigin))
            config.deviceId = nil; config.accountLabel = nil; config.pairedAt = nil; try? configStore.save(config)
            respond(id, type, payload: statusPayload()); publishStatus()
        default:
            respond(id, type, error: ("invalid_message", "Unsupported request."))
        }
    }
}
