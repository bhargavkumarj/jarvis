#if os(macOS)
import AppKit
import Foundation
import JarvisCompanionCore

enum CompanionMain {
    static let version = "0.1.0"
    static var supportDirectory: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("JARVIS Companion", isDirectory: true)
    }
    static let configStore = FileConfigStore(url: supportDirectory.appendingPathComponent("config.json"))
    static let journalStore = FileJournalStore(url: supportDirectory.appendingPathComponent("journal.json"))
    static let secrets = KeychainStore()

    static func stderr(_ s: String) { FileHandle.standardError.write(Data((s + "\n").utf8)) }

    static func run(_ args: [String]) {
        if args.count >= 2, args[1].hasPrefix("chrome-extension://") { nativeHost(caller: args[1]); return }
        exit(CLI.run(Array(args.dropFirst())))
    }

    static func makeEngine(ui: MacUI) throws -> (CommandEngine, Backend) {
        guard let config = try configStore.load() else { throw ContractError("not_configured") }
        let backend = try HTTPBackend(origin: config.backendOrigin)
        let engine = CommandEngine(hostVersion: version, configStore: configStore, secrets: secrets, backend: backend, confirmer: ui, executor: MacExecutor(), journal: Journal(store: journalStore))
        return (engine, backend)
    }

    /// Chrome native-messaging mode. stdout carries only length-prefixed frames.
    static func nativeHost(caller: String) {
        guard let config = try? configStore.load(), HostRouter.callerAllowed(caller, config: config) else {
            stderr("jarvis-companion: caller not allowed or companion not configured"); exit(1)
        }
        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)
        let ui = MacUI()
        guard let made = try? makeEngine(ui: ui) else { stderr("jarvis-companion: configuration invalid"); exit(1) }
        let (engine, backend) = made
        let writer = FrameWriter { FileHandle.standardOutput.write($0) }
        let router = HostRouter(callerOrigin: caller, engine: engine, configStore: configStore, secrets: secrets, backend: backend, ui: ui, writer: writer)
        router.diagnostics = { diagnostics() }
        let menu = StatusMenu()
        menu.onStop = { _ = engine.cancel(commandId: nil) }
        menu.onDisable = {
            if var c = try? configStore.load() { c.disabled = true; try? configStore.save(c) }
            _ = engine.cancel(commandId: nil)
            router.refreshStatus()
        }
        ui.onStatus = { menu.update($0) }
        DispatchQueue.global().async { engine.reconcile(); router.refreshStatus() }
        // Reader thread: frames are bounded before allocation. Any protocol violation ends the session.
        Thread.detachNewThread {
            let reader = FrameReader(source: FileHandleSource(FileHandle.standardInput))
            while true {
                do { router.handle(try reader.next()) }
                catch {
                    // Chrome disconnected (EOF) or sent an invalid frame: finish in-flight work, then exit.
                    router.drain()
                    DispatchQueue.main.async { NSApp.terminate(nil) }
                    return
                }
            }
        }
        app.run()
    }

    static func diagnostics() -> [(code: String, message: String)] {
        var out: [(String, String)] = []
        if !ShortcutRunner.available { out.append(("shortcuts_unavailable", "The macOS Shortcuts command-line tool was not found; Shortcut actions will fail.")) }
        if let v = VolumeController.probe() { out.append(("volume_unsupported", v)) }
        return out
    }
}

/// Terminal management. Changes that widen access use native approval dialogs.
enum CLI {
    static let usage = """
    jarvis-companion <command>
      configure --origin <https://… | http://127.0.0.1:PORT> --extension-id <id> [--name "My Mac"]
      status | list | journal | journal-clear
      add <application|folder|website|shortcut>      (native picker + review)
      remove <application|folder|website|shortcut> <alias>
      actions <enable|disable> <open_application|open_website|set_volume|open_folder|run_shortcut>
      auto <allow|deny> <application|folder|website> <alias>   |   auto <allow|deny> volume
      disable | enable | unpair
      preview                                        (dry run: describes what each approved item would do; executes nothing)
      smoke-run <open_application|open_website|open_folder|run_shortcut> <alias> | smoke-run set_volume <0-100>
                                                     (deliberate local test with native confirmation; no JARVIS server involved)
    """
    static func say(_ s: String) { print(s) }
    static func load() -> CompanionConfig? { try? CompanionMain.configStore.load() }
    static func save(_ c: CompanionConfig) -> Bool { do { try CompanionMain.configStore.save(c); return true } catch { say("Not saved: \(error)"); return false } }
    static func ensureApp() { let a = NSApplication.shared; a.setActivationPolicy(.accessory) }
    static func sync(_ c: CompanionConfig) {
        guard let id = c.deviceId, let s = CompanionMain.secrets.load(account: CommandEngine.secretAccount(origin: c.backendOrigin)), let backend = try? HTTPBackend(origin: c.backendOrigin) else { return }
        if (try? backend.sync(c.syncPayload(hostVersion: CompanionMain.version), credential: DeviceCredential(deviceId: id, secret: s))) == nil { say("Saved locally; JARVIS could not be updated now (it will be on the next connection).") }
    }

    static func run(_ a: [String]) -> Int32 {
        guard let cmd = a.first else { say(usage); return 2 }
        func opt(_ name: String) -> String? { a.firstIndex(of: name).flatMap { $0 + 1 < a.count ? a[$0 + 1] : nil } }
        switch cmd {
        case "configure":
            guard let origin = opt("--origin"), let ext = opt("--extension-id") else { say(usage); return 2 }
            let name = opt("--name") ?? Host.current().localizedName ?? "Mac"
            var c = load() ?? CompanionConfig(backendOrigin: origin, allowedExtensionId: ext, deviceName: name)
            if c.deviceId != nil && (c.backendOrigin != origin || c.allowedExtensionId != ext) { say("This Mac is paired with \(c.backendOrigin). Run unpair first."); return 1 }
            c.backendOrigin = origin; c.allowedExtensionId = ext; c.deviceName = String(name.prefix(60))
            guard save(c) else { return 1 }
            say("Configured for \(origin) and extension \(ext). Trusted backend and extension are set only here, never by a web page."); return 0
        case "status":
            guard let c = load() else { say("Not configured."); return 1 }
            let paired = c.deviceId != nil && CompanionMain.secrets.load(account: CommandEngine.secretAccount(origin: c.backendOrigin)) != nil
            say("Origin: \(c.backendOrigin)\nExtension: \(c.allowedExtensionId)\nThis Mac: \(c.deviceName)\nPaired: \(paired ? "yes · \(c.accountLabel ?? "")" : "no")\nDisabled: \(c.disabled)\nEnabled actions: \(c.enabledActions.map(\.rawValue).joined(separator: ", "))\nVolume without asking: \(c.volumeAuto)\nApproved items: \(c.catalogue.count)")
            for d in CompanionMain.diagnostics() { say("Problem: \(d.message)") }
            return 0
        case "list":
            guard let c = load() else { say("Not configured."); return 1 }
            for e in c.catalogue { say("\(e.kind.rawValue)\t\(e.alias)\t\(e.label)\(e.auto ? "\t(runs without asking)" : "")") }
            return 0
        case "add":
            guard a.count == 2, let kind = ResourceKind(rawValue: a[1]), var c = load() else { say(usage); return 2 }
            ensureApp()
            guard let e = MacUI().pickResource(kind: kind, existingAliases: Set(c.catalogue.filter { $0.kind == kind }.map(\.alias))) else { say("Nothing added."); return 1 }
            c.catalogue.append(e); guard save(c) else { return 1 }; sync(c); say("Approved \(e.kind.rawValue) \(e.alias)."); return 0
        case "remove":
            guard a.count == 3, let kind = ResourceKind(rawValue: a[1]), var c = load() else { say(usage); return 2 }
            c.catalogue.removeAll { $0.kind == kind && $0.alias == a[2] }; guard save(c) else { return 1 }; sync(c); say("Removed."); return 0
        case "actions":
            guard a.count == 3, let t = ActionType(rawValue: a[2]), var c = load(), ["enable", "disable"].contains(a[1]) else { say(usage); return 2 }
            if a[1] == "enable" {
                if !c.enabledActions.contains(t) { c.enabledActions.append(t) }
            } else { c.enabledActions.removeAll { $0 == t } }
            guard save(c) else { return 1 }; sync(c); say("\(t.label): \(a[1])d."); return 0
        case "auto":
            guard a.count >= 3, var c = load(), ["allow", "deny"].contains(a[1]) else { say(usage); return 2 }
            let allow = a[1] == "allow"
            if a[2] == "volume" {
                if allow { ensureApp(); guard MacUI().approveAuto(label: "Set output volume") else { return 1 } }
                c.volumeAuto = allow
            } else {
                guard a.count == 4, let kind = ResourceKind(rawValue: a[2]), kind != .shortcut, let i = c.catalogue.firstIndex(where: { $0.kind == kind && $0.alias == a[3] }) else { say("Shortcuts always ask; other items must be approved first."); return 1 }
                if allow { ensureApp(); guard MacUI().approveAuto(label: c.catalogue[i].label) else { return 1 } }
                c.catalogue[i].auto = allow
            }
            guard save(c) else { return 1 }; sync(c); say("Updated."); return 0
        case "disable":
            guard var c = load() else { return 1 }; c.disabled = true; guard save(c) else { return 1 }; sync(c)
            say("Disabled on this Mac. A running companion stops its current plan at the next step; use the menu-bar Stop for an immediate stop."); return 0
        case "enable":
            guard var c = load() else { return 1 }; ensureApp(); guard MacUI().approveEnable() else { return 1 }
            c.disabled = false; guard save(c) else { return 1 }; sync(c); say("Enabled."); return 0
        case "unpair":
            guard var c = load() else { return 1 }
            let account = CommandEngine.secretAccount(origin: c.backendOrigin)
            if let id = c.deviceId, let s = CompanionMain.secrets.load(account: account), let b = try? HTTPBackend(origin: c.backendOrigin) {
                if (try? b.unpair(credential: DeviceCredential(deviceId: id, secret: s))) == nil { say("JARVIS could not be reached; also revoke this Mac in Settings → Computer.") }
            }
            CompanionMain.secrets.delete(account: account)
            c.deviceId = nil; c.accountLabel = nil; c.pairedAt = nil; _ = save(c); say("Unpaired; device credential removed from the Keychain."); return 0
        case "journal":
            for r in Journal(store: CompanionMain.journalStore).all { say("\(r.startedAt)\t\(r.commandId.prefix(8))\t\(r.state)\t\(r.steps.joined(separator: ", "))\(r.reported ? "" : "\t(unreported)")") }
            return 0
        case "journal-clear":
            Journal(store: CompanionMain.journalStore).clearFinished(); say("Cleared reported, finished entries. Unreported or running entries are kept to prevent replay."); return 0
        case "preview":
            guard let c = load() else { say("Not configured."); return 1 }
            let ex = MacExecutor()
            say("Dry run — nothing will be opened, changed or run.")
            for e in c.catalogue {
                let action: Action = { switch e.kind { case .application: return .openApplication(alias: e.alias); case .website: return .openWebsite(alias: e.alias); case .folder: return .openFolder(alias: e.alias); case .shortcut: return .runShortcut(alias: e.alias) } }()
                let d = ex.describe(action, entry: e)
                var verdict = "allowed"
                if case .reject(_, let m) = LocalPolicy(c).evaluate(action) { verdict = "blocked: \(m)" }
                say("• \(d.title): \(d.detail) — \(verdict)")
            }
            say("• Set output volume: \(VolumeController.probe() ?? "supported by the current output device")")
            for d in CompanionMain.diagnostics() { say("Problem: \(d.message)") }
            return 0
        case "smoke-run":
            // Deliberate, local-only acceptance test of one real executor. Native confirmation is mandatory.
            guard a.count == 3, let t = ActionType(rawValue: a[1]), let c = load() else { say(usage); return 2 }
            let action: Action
            switch t {
            case .setVolume: guard let p = Int(a[2]), (0...100).contains(p) else { say("Use 0–100."); return 2 }; action = .setVolume(percent: p)
            case .openApplication: action = .openApplication(alias: a[2])
            case .openWebsite: action = .openWebsite(alias: a[2])
            case .openFolder: action = .openFolder(alias: a[2])
            case .runShortcut: action = .runShortcut(alias: a[2])
            }
            guard case .allow(let entry, _) = LocalPolicy(c).evaluate(action) else { say("Blocked by local policy (not approved, type disabled, or companion disabled)."); return 1 }
            ensureApp()
            let ui = MacUI(), ex = MacExecutor(), token = CancelToken()
            let req = ConfirmationRequest(origin: "local smoke test (Terminal)", accountLabel: "no JARVIS account", commandShortId: "smoke", steps: [ex.describe(action, entry: entry)], includesShortcut: t == .runShortcut, timeout: 60)
            guard ui.confirm(req, cancel: token) == .approved else { say("Not run."); return 1 }
            let r = ex.perform(action, entry: entry, index: 0, cancel: token)
            say("Result: \(r.state.rawValue) · evidence \(r.evidence.rawValue) · \(r.code.rawValue)\n\(r.message)")
            if let prev = r.previousPercent { say("Previous volume was \(prev)%. To restore: jarvis-companion smoke-run set_volume \(prev)") }
            return r.state == .succeeded ? 0 : 1
        default:
            say(usage); return 2
        }
    }
}
#endif
