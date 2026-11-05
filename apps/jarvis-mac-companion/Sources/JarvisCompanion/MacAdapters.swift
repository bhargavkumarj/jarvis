#if os(macOS)
import AppKit
import CoreAudio
import Foundation
import Security
import UniformTypeIdentifiers
import JarvisCompanionCore

// Real macOS adapters. NOT compiled or executed in the Linux verification
// environment; see STATUS.md for which behaviours remain physically unverified.

/// Runs `body` on the main thread (inline when already there, e.g. the CLI).
func onMain<T>(_ body: () -> T) -> T { Thread.isMainThread ? body() : DispatchQueue.main.sync(execute: body) }

// MARK: - Keychain (device credential)
final class KeychainStore: SecretStore {
    static let service = "com.jarvis.companion.device"
    func base(_ account: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: Self.service, kSecAttrAccount as String: account]
    }
    func save(secret: String, account: String) throws {
        SecItemDelete(base(account) as CFDictionary)
        var q = base(account)
        q[kSecValueData as String] = Data(secret.utf8)
        q[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        q[kSecAttrLabel as String] = "JARVIS computer-control device credential"
        let status = SecItemAdd(q as CFDictionary, nil)
        guard status == errSecSuccess else { throw ContractError("keychain_\(status)") }
    }
    func load(account: String) -> String? {
        var q = base(account)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }
    func delete(account: String) { SecItemDelete(base(account) as CFDictionary) }
}

// MARK: - Output volume (CoreAudio, absolute level, observed read-back)
enum VolumeController {
    static func defaultOutputDevice() -> AudioObjectID? {
        var id = AudioObjectID(kAudioObjectUnknown)
        var size = UInt32(MemoryLayout<AudioObjectID>.size)
        var addr = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDefaultOutputDevice, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        let status = AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &id)
        return status == noErr && id != AudioObjectID(kAudioObjectUnknown) ? id : nil
    }
    static func address(_ element: UInt32) -> AudioObjectPropertyAddress {
        AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyVolumeScalar, mScope: kAudioObjectPropertyScopeOutput, mElement: element)
    }
    /// Elements whose software volume is settable: the main element, else stereo channels 1 and 2.
    static func settableElements(_ device: AudioObjectID) -> [UInt32] {
        func settable(_ e: UInt32) -> Bool {
            var a = address(e); var s = DarwinBoolean(false)
            return AudioObjectIsPropertySettable(device, &a, &s) == noErr && s.boolValue
        }
        if settable(kAudioObjectPropertyElementMain) { return [kAudioObjectPropertyElementMain] }
        return [1, 2].filter(settable)
    }
    static func read(_ device: AudioObjectID, _ elements: [UInt32]) -> Int? {
        var values: [Float32] = []
        for e in elements {
            var a = address(e); var v = Float32(0); var size = UInt32(MemoryLayout<Float32>.size)
            if AudioObjectGetPropertyData(device, &a, 0, nil, &size, &v) == noErr { values.append(v) }
        }
        guard !values.isEmpty else { return nil }
        return Int((values.reduce(0, +) / Float32(values.count) * 100).rounded())
    }
    static func probe() -> String? {
        guard let d = defaultOutputDevice() else { return "No default output device is available." }
        return settableElements(d).isEmpty ? "The current output device does not expose a software volume control (common for HDMI/DisplayPort and some USB devices)." : nil
    }
    static func set(_ percent: Int, index: Int) -> ActionResult {
        let started = Date()
        func result(_ state: ActionResultState, _ evidence: Evidence, _ code: ResultCode, _ message: String, observed: Int? = nil, previous: Int? = nil) -> ActionResult {
            ActionResult(index: index, type: .setVolume, state: state, evidence: evidence, code: code, message: message, observedPercent: observed, previousPercent: previous, startedAt: started, finishedAt: Date())
        }
        guard let device = defaultOutputDevice() else { return result(.failed, .none, .volumeUnsupported, "No default output device is available.") }
        let elements = settableElements(device)
        guard !elements.isEmpty else { return result(.failed, .none, .volumeUnsupported, "This output device does not allow software volume changes. Nothing was changed.") }
        let previous = read(device, elements)
        var value = Float32(percent) / 100
        for e in elements {
            var a = address(e)
            if AudioObjectSetPropertyData(device, &a, 0, nil, UInt32(MemoryLayout<Float32>.size), &value) != noErr {
                return result(.outcomeUnknown, .none, .osError, "macOS refused part of the volume change; the level may be partly changed.", previous: previous)
            }
        }
        // The HAL may apply changes asynchronously; read back for up to 0.5 s.
        var observed: Int? = nil
        for _ in 0..<10 { observed = read(device, elements); if let o = observed, abs(o - percent) <= 1 { break }; Thread.sleep(forTimeInterval: 0.05) }
        guard let o = observed else { return result(.outcomeUnknown, .dispatched, .osError, "Volume change was sent but the level could not be read back.", previous: previous) }
        if abs(o - percent) <= 2 { return result(.succeeded, .observed, .volumeSet, "Output volume reads \(o)%.", observed: o, previous: previous) }
        return result(.failed, .observed, .osError, "Requested \(percent)%, but the device reports \(o)% (it may only support coarse steps).", observed: o, previous: previous)
    }
}

// MARK: - Shortcuts (fixed executable, separate argv, no input, bounded)
enum ShortcutRunner {
    static let executable = URL(fileURLWithPath: "/usr/bin/shortcuts")
    static var available: Bool { FileManager.default.isExecutableFile(atPath: executable.path) }
    static func environment() -> [String: String] {
        let p = ProcessInfo.processInfo.environment
        var env = ["PATH": "/usr/bin:/bin"]
        for k in ["HOME", "USER", "LOGNAME", "TMPDIR", "LANG"] { if let v = p[k] { env[k] = v } }
        return env
    }
    /// Runs a fixed helper invocation; output is counted, never logged or returned.
    static func runProcess(_ args: [String], timeout: TimeInterval, cancel: CancelToken?, keepOutput: Int) -> (status: Int32?, output: Data, timedOut: Bool, cancelled: Bool) {
        let p = Process()
        p.executableURL = executable; p.arguments = args; p.environment = environment()
        p.standardInput = FileHandle.nullDevice
        let out = Pipe(); p.standardOutput = out; p.standardError = Pipe()
        var kept = Data(); let lock = NSLock()
        out.fileHandleForReading.readabilityHandler = { h in
            let d = h.availableData
            lock.lock(); if kept.count < keepOutput { kept.append(d.prefix(keepOutput - kept.count)) }; lock.unlock()
        }
        (p.standardError as! Pipe).fileHandleForReading.readabilityHandler = { h in _ = h.availableData }
        do { try p.run() } catch { return (nil, Data(), false, false) }
        cancel?.onCancel { if p.isRunning { p.terminate() } }
        let deadline = Date().addingTimeInterval(timeout)
        while p.isRunning && Date() < deadline && !(cancel?.isCancelled ?? false) { Thread.sleep(forTimeInterval: 0.1) }
        var timedOut = false
        if p.isRunning {
            timedOut = !(cancel?.isCancelled ?? false)
            p.terminate()
            let grace = Date().addingTimeInterval(2)
            while p.isRunning && Date() < grace { Thread.sleep(forTimeInterval: 0.1) }
            if p.isRunning { kill(p.processIdentifier, SIGKILL) }
        }
        p.waitUntilExit()
        out.fileHandleForReading.readabilityHandler = nil
        lock.lock(); let data = kept; lock.unlock()
        return (p.terminationStatus, data, timedOut, cancel?.isCancelled ?? false)
    }
    /// Installed Shortcuts as (name, identifier). Requires macOS 12+ `shortcuts list --show-identifiers`.
    static func list() -> [(name: String, id: String)]? {
        let r = runProcess(["list", "--show-identifiers"], timeout: 15, cancel: nil, keepOutput: 262_144)
        guard r.status == 0, !r.timedOut else { return nil }
        let regex = try! NSRegularExpression(pattern: "^(.+) \\(([0-9A-Fa-f-]{36})\\)$")
        return String(decoding: r.output, as: UTF8.self).split(separator: "\n").compactMap { line in
            let s = String(line)
            guard let m = regex.firstMatch(in: s, range: NSRange(s.startIndex..<s.endIndex, in: s)),
                  let n = Range(m.range(at: 1), in: s), let i = Range(m.range(at: 2), in: s) else { return nil }
            return (String(s[n]), String(s[i]).uppercased())
        }
    }
    static func run(_ entry: LocalEntry, index: Int, cancel: CancelToken) -> ActionResult {
        let started = Date()
        func result(_ state: ActionResultState, _ evidence: Evidence, _ code: ResultCode, _ message: String) -> ActionResult {
            ActionResult(index: index, type: .runShortcut, state: state, evidence: evidence, code: code, message: message, startedAt: started, finishedAt: Date())
        }
        guard available else { return result(.failed, .none, .targetMissing, "The macOS Shortcuts command-line tool is not available.") }
        guard let name = entry.shortcutName else { return result(.failed, .none, .invalidParameters, "This Shortcut entry is incomplete. Re-approve it.") }
        // Detect deletion or replacement by a different Shortcut with the same name.
        guard let installed = list() else { return result(.failed, .none, .osError, "Installed Shortcuts could not be listed, so nothing was run.") }
        let matches = installed.filter { $0.name == name }
        guard !matches.isEmpty else { return result(.failed, .none, .targetMissing, "The approved Shortcut was not found. It may have been renamed or deleted.") }
        if let approvedId = entry.shortcutId?.uppercased(), !matches.contains(where: { $0.id == approvedId }) || matches.count > 1 {
            return result(.failed, .none, .targetChanged, "A different Shortcut now has this name. Re-approve it on the Mac before running.")
        }
        let r = runProcess(["run", name], timeout: Protocol1.shortcutTimeoutSeconds, cancel: cancel, keepOutput: Protocol1.shortcutOutputBytes)
        if r.cancelled { return result(.outcomeUnknown, .none, .cancelledDuringRun, "Stopped while the Shortcut was running. Steps it already performed are not reversed.") }
        if r.timedOut { return result(.outcomeUnknown, .none, .shortcutTimeout, "The Shortcut did not finish in \(Int(Protocol1.shortcutTimeoutSeconds)) seconds and was stopped. Steps it already ran are not reversed.") }
        guard let status = r.status else { return result(.failed, .none, .osError, "The Shortcuts tool could not be started.") }
        if status == 0 { return result(.succeeded, .processExit, .shortcutCompleted, "The Shortcut runner finished successfully. Its individual steps were not verified by JARVIS.") }
        return result(.failed, .processExit, .shortcutFailed, "The Shortcut runner reported a failure (exit \(status)). Steps before the failure may already have run.")
    }
}

// MARK: - Executor for the five fixed action types
final class MacExecutor: ActionExecutor {
    func describe(_ action: Action, entry: LocalEntry?) -> ConfirmationStep {
        switch action {
        case .openApplication: return ConfirmationStep(title: "Open application", detail: "\(entry?.label ?? "?") (\(entry?.bundleId ?? "?"))")
        case .openWebsite: return ConfirmationStep(title: "Open website in your default browser", detail: "\(entry?.label ?? "?") — \(entry?.url ?? "?")")
        case .setVolume(let p): return ConfirmationStep(title: "Set output volume", detail: "to exactly \(p)% on the current output device")
        case .openFolder: return ConfirmationStep(title: "Open folder in Finder", detail: "\(entry?.label ?? "?") — \(entry?.folderPath ?? "?") (opens only; nothing is read or uploaded)")
        case .runShortcut: return ConfirmationStep(title: "Run Shortcut", detail: "“\(entry?.shortcutName ?? "?")”. This runs the Shortcut’s own configured steps, which can send messages, change files or take other actions. JARVIS cannot see, verify or undo them.")
        }
    }
    func perform(_ action: Action, entry: LocalEntry?, index: Int, cancel: CancelToken) -> ActionResult {
        let started = Date()
        func r(_ state: ActionResultState, _ evidence: Evidence, _ code: ResultCode, _ message: String) -> ActionResult {
            ActionResult(index: index, type: action.type, state: state, evidence: evidence, code: code, message: message, startedAt: started, finishedAt: Date())
        }
        switch action {
        case .setVolume(let p): return VolumeController.set(p, index: index)
        case .runShortcut:
            guard let entry else { return r(.rejected, .none, .notApproved, "Not approved on this Mac.") }
            return ShortcutRunner.run(entry, index: index, cancel: cancel)
        case .openApplication:
            guard let bid = entry?.bundleId else { return r(.rejected, .none, .notApproved, "Not approved on this Mac.") }
            guard let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bid) else { return r(.failed, .none, .targetMissing, "The approved application is no longer installed.") }
            guard Bundle(url: url)?.bundleIdentifier == bid else { return r(.failed, .none, .targetChanged, "The application found does not match the approved one.") }
            let config = NSWorkspace.OpenConfiguration(); config.activates = true; config.addsToRecentItems = false
            let done = DispatchSemaphore(value: 0); var launchError: Error?
            NSWorkspace.shared.openApplication(at: url, configuration: config) { _, error in launchError = error; done.signal() }
            if done.wait(timeout: .now() + 15) == .timedOut { return r(.outcomeUnknown, .none, .osError, "macOS did not confirm the launch within 15 seconds.") }
            if launchError != nil { return r(.failed, .none, .osError, "macOS could not open the application.") }
            for _ in 0..<50 {
                if NSRunningApplication.runningApplications(withBundleIdentifier: bid).contains(where: { !$0.isTerminated }) { return r(.succeeded, .observed, .appRunningObserved, "\(entry?.label ?? "The application") is running.") }
                Thread.sleep(forTimeInterval: 0.1)
            }
            return r(.succeeded, .dispatched, .appLaunched, "macOS accepted the launch; a running process was not yet observed.")
        case .openWebsite:
            guard let s = entry?.url, Patterns.websiteHost(s) != nil, let url = URL(string: s), url.scheme == "https" else { return r(.rejected, .none, .notApproved, "Not an approved HTTPS website.") }
            return NSWorkspace.shared.open(url) ? r(.succeeded, .dispatched, .urlDispatched, "Sent to your default browser. Whether the page loaded was not observed.") : r(.failed, .none, .osError, "macOS could not hand the URL to a browser.")
        case .openFolder:
            guard let entry, let bookmark = entry.bookmark, let approvedPath = entry.folderPath else { return r(.rejected, .none, .notApproved, "Not approved on this Mac.") }
            var stale = false
            guard let url = try? URL(resolvingBookmarkData: bookmark, options: [.withoutUI, .withoutMounting], relativeTo: nil, bookmarkDataIsStale: &stale) else { return r(.failed, .none, .targetMissing, "The approved folder could not be found. It may have been deleted or is on a disconnected volume.") }
            if stale || url.standardizedFileURL.path != approvedPath { return r(.failed, .none, .bookmarkStale, "The approved folder was moved or renamed. Re-approve it on the Mac before opening it.") }
            let values = try? url.resourceValues(forKeys: [.isDirectoryKey, .isPackageKey, .isSymbolicLinkKey])
            guard values?.isDirectory == true, values?.isPackage != true, values?.isSymbolicLink != true else { return r(.failed, .none, .targetChanged, "The approved location is no longer a plain folder.") }
            return NSWorkspace.shared.open(url) ? r(.succeeded, .dispatched, .folderOpened, "Finder was asked to open the folder. Its contents were not read.") : r(.failed, .none, .osError, "Finder could not open the folder.")
        }
    }
}

// MARK: - Native dialogs (non-approving default button, timeout, Stop-aware)
final class MacUI: CompanionUI, Confirmer {
    var onStatus: ((CompanionStatus) -> Void)?
    func statusChanged(_ status: CompanionStatus) { DispatchQueue.main.async { self.onStatus?(status) } }

    /// The FIRST button is the default (Return). It is always the non-approving choice.
    private func modal(title: String, text: String, decline: String, approve: String, timeout: TimeInterval?, cancel: CancelToken?, accessory: NSView? = nil, style: NSAlert.Style = .warning) -> ConfirmationOutcome {
        onMain {
            NSApp.activate(ignoringOtherApps: true)
            let alert = NSAlert()
            alert.alertStyle = style; alert.messageText = title; alert.informativeText = text; alert.accessoryView = accessory
            let declineButton = alert.addButton(withTitle: decline)
            let approveButton = alert.addButton(withTitle: approve)
            approveButton.keyEquivalent = ""
            alert.window.initialFirstResponder = accessory ?? declineButton
            var timedOut = false
            let deadline = timeout.map { Date().addingTimeInterval($0) }
            let timer = Timer(timeInterval: 0.25, repeats: true) { _ in
                if cancel?.isCancelled == true { NSApp.abortModal() }
                else if let d = deadline, Date() >= d { timedOut = true; NSApp.abortModal() }
            }
            RunLoop.main.add(timer, forMode: .modalPanel)
            defer { timer.invalidate() }
            switch alert.runModal() {
            case .alertSecondButtonReturn: return .approved
            case .alertFirstButtonReturn: return .declined
            default: return timedOut ? .timedOut : .cancelled
            }
        }
    }
    func confirm(_ request: ConfirmationRequest, cancel: CancelToken) -> ConfirmationOutcome {
        let steps = request.steps.enumerated().map { "\($0.offset + 1). \($0.element.title): \($0.element.detail)" }.joined(separator: "\n")
        let text = "Requested by \(request.origin) for \(request.accountLabel).\n\n\(steps)\n\n" + (request.includesShortcut ? "Shortcuts are always confirmed here, every run.\n" : "") + "Plan \(request.commandShortId) · expires in \(Int(request.timeout)) seconds if not approved."
        return modal(title: "Run this on your Mac?", text: text, decline: "Don’t Run", approve: "Run", timeout: request.timeout, cancel: cancel)
    }
    func approvePairing(origin: String, accountLabel: String, deviceName: String, extensionId: String) -> Bool {
        modal(title: "Pair this Mac with JARVIS?", text: "Website: \(origin)\nAccount: \(accountLabel)\nThis Mac: \(deviceName)\nBrowser extension: \(extensionId)\n\nPairing lets this JARVIS account request only the actions you approve on this Mac. Plans still ask here unless you allow a specific low-risk item. Shortcuts always ask.", decline: "Don’t Pair", approve: "Pair This Mac", timeout: 120, cancel: nil) == .approved
    }
    func approveAuto(label: String) -> Bool {
        modal(title: "Run “\(label)” without asking?", text: "After you review and send a JARVIS command, this item will run without a second approval here. You can turn this off at any time. Shortcuts cannot be set to run without asking.", decline: "Keep Asking", approve: "Allow Without Asking", timeout: 120, cancel: nil) == .approved
    }
    func approveEnable() -> Bool { modal(title: "Re-enable JARVIS computer control?", text: "JARVIS will again be able to request approved actions on this Mac.", decline: "Keep Disabled", approve: "Enable", timeout: 120, cancel: nil) == .approved }
    func approveUnpair(accountLabel: String) -> Bool { modal(title: "Unpair this Mac?", text: "This Mac will stop accepting commands from \(accountLabel), and its device credential will be removed from the Keychain.", decline: "Keep Paired", approve: "Unpair", timeout: 120, cancel: nil) == .approved }

    // Pickers: selection happens in native panels; pages never supply paths or URLs.
    func pickResource(kind: ResourceKind, existingAliases: Set<String>) -> LocalEntry? {
        onMain {
            NSApp.activate(ignoringOtherApps: true)
            switch kind {
            case .application:
                let panel = NSOpenPanel()
                panel.message = "Choose one application JARVIS may open"; panel.prompt = "Choose"
                panel.canChooseFiles = true; panel.canChooseDirectories = false; panel.allowsMultipleSelection = false
                panel.allowedContentTypes = [.application]; panel.directoryURL = URL(fileURLWithPath: "/Applications")
                guard panel.runModal() == .OK, let url = panel.url, let bundle = Bundle(url: url), let bid = bundle.bundleIdentifier else { return nil }
                let name = (bundle.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String) ?? (bundle.object(forInfoDictionaryKey: "CFBundleName") as? String) ?? url.deletingPathExtension().lastPathComponent
                return review(kind: .application, label: name, target: bid, existing: existingAliases) { LocalEntry(kind: .application, alias: $0, label: $1, names: $2, bundleId: bid) }
            case .folder:
                let panel = NSOpenPanel()
                panel.message = "Choose one folder JARVIS may open in Finder (it will not read or upload its contents)"; panel.prompt = "Choose"
                panel.canChooseFiles = false; panel.canChooseDirectories = true; panel.allowsMultipleSelection = false; panel.treatsFilePackagesAsDirectories = false
                guard panel.runModal() == .OK, let url = panel.url?.standardizedFileURL, url.path != "/",
                      let bookmark = try? url.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil) else { return nil }
                return review(kind: .folder, label: url.lastPathComponent, target: url.path, existing: existingAliases) { LocalEntry(kind: .folder, alias: $0, label: $1, names: $2, bookmark: bookmark, folderPath: url.path) }
            case .website:
                let urlField = NSTextField(string: "https://"); urlField.placeholderString = "https://www.example.com/"
                urlField.frame = NSRect(x: 0, y: 0, width: 360, height: 24)
                guard modal(title: "Approve a website", text: "Enter one exact HTTPS address. Other schemes and addresses with user names are refused.", decline: "Cancel", approve: "Next", timeout: nil, cancel: nil, accessory: urlField, style: .informational) == .approved else { return nil }
                let s = urlField.stringValue.trimmingCharacters(in: .whitespaces)
                guard let host = Patterns.websiteHost(s) else { info("That is not an exact HTTPS address this version accepts. Nothing was added."); return nil }
                return review(kind: .website, label: host.replacingOccurrences(of: "www.", with: ""), target: s, existing: existingAliases) { LocalEntry(kind: .website, alias: $0, label: $1, names: $2, url: s) }
            case .shortcut:
                guard let shortcuts = ShortcutRunner.list(), !shortcuts.isEmpty else { info("No Shortcuts were found (or the Shortcuts tool is unavailable)."); return nil }
                let popup = NSPopUpButton(frame: NSRect(x: 0, y: 0, width: 360, height: 26), pullsDown: false)
                popup.addItems(withTitles: shortcuts.map(\.name))
                guard modal(title: "Approve one Shortcut", text: "Choose a Shortcut you created and reviewed. It will always ask here before every run, and JARVIS cannot pass it input.", decline: "Cancel", approve: "Next", timeout: nil, cancel: nil, accessory: popup, style: .informational) == .approved else { return nil }
                let chosen = shortcuts[popup.indexOfSelectedItem]
                guard !chosen.name.hasPrefix("-") else { info("Shortcuts whose names start with “-” are not supported."); return nil }
                return review(kind: .shortcut, label: chosen.name, target: chosen.name, existing: existingAliases) { LocalEntry(kind: .shortcut, alias: $0, label: $1, names: $2, shortcutName: chosen.name, shortcutId: chosen.id) }
            }
        }
    }
    private func info(_ text: String) { let a = NSAlert(); a.messageText = "JARVIS companion"; a.informativeText = text; a.addButton(withTitle: "OK"); a.runModal() }
    static func slug(_ s: String) -> String {
        let folded = s.lowercased().folding(options: .diacriticInsensitive, locale: nil)
        let parts = folded.split { !$0.isLetter && !$0.isNumber }.map(String.init).filter { $0.allSatisfy { $0.isASCII } }
        return String(parts.joined(separator: "-").prefix(40)).trimmingCharacters(in: CharacterSet(charactersIn: "-"))
    }
    private func review(kind: ResourceKind, label: String, target: String, existing: Set<String>, make: (String, String, [String]) -> LocalEntry) -> LocalEntry? {
        let stack = NSStackView(frame: NSRect(x: 0, y: 0, width: 360, height: 84)); stack.orientation = .vertical; stack.alignment = .leading
        let labelField = NSTextField(string: String(label.prefix(Protocol1.maxLabel))); labelField.placeholderString = "Display name"
        let aliasField = NSTextField(string: Self.slug(label)); aliasField.placeholderString = "alias (a-z, 0-9, -)"
        let namesField = NSTextField(string: ""); namesField.placeholderString = "Other spoken names, comma separated (optional)"
        for f in [labelField, aliasField, namesField] { f.frame.size.width = 360; stack.addArrangedSubview(f) }
        let kindName = ["application": "Application", "website": "Website", "folder": "Folder", "shortcut": "Shortcut"][kind.rawValue]!
        guard modal(title: "Approve this \(kindName.lowercased()) for JARVIS?", text: "\(kindName): \(target)\n\nJARVIS will be able to request this by its name or alias. Each plan still asks here unless you later allow it to run without asking" + (kind == .shortcut ? " (never for Shortcuts)." : "."), decline: "Cancel", approve: "Approve", timeout: nil, cancel: nil, accessory: stack, style: .informational) == .approved else { return nil }
        let alias = aliasField.stringValue.trimmingCharacters(in: .whitespaces)
        let names = namesField.stringValue.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces).lowercased() }.filter { !$0.isEmpty }
        let entry = make(alias, labelField.stringValue.trimmingCharacters(in: .whitespaces), Array(Set(names)).sorted())
        guard (try? entry.validate()) != nil, !existing.contains(alias) else { info("The alias, name or spoken names are invalid or already used. Use lowercase letters, numbers and hyphens. Nothing was added."); return nil }
        return entry
    }
}

// MARK: - Menu-bar status with local Stop / Disable (no backend needed)
final class StatusMenu: NSObject {
    let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    let stateItem = NSMenuItem(title: "JARVIS companion", action: nil, keyEquivalent: "")
    let stopItem = NSMenuItem(title: "Stop current action", action: #selector(stop), keyEquivalent: "")
    let disableItem = NSMenuItem(title: "Disable computer control", action: #selector(disable), keyEquivalent: "")
    var onStop: () -> Void = {}, onDisable: () -> Void = {}
    override init() {
        super.init()
        item.button?.title = "JARVIS"
        item.button?.toolTip = "JARVIS computer control (connected to Chrome)"
        let menu = NSMenu()
        stateItem.isEnabled = false
        stopItem.target = self; disableItem.target = self
        let quit = NSMenuItem(title: "Quit companion", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        [stateItem, .separator(), stopItem, disableItem, .separator(), quit].forEach(menu.addItem)
        item.menu = menu
    }
    func update(_ s: CompanionStatus) {
        stateItem.title = s.disabled ? "Disabled on this Mac" : !s.paired ? "Not paired" : "Paired · \(s.accountLabel ?? "") · \(s.origin)"
        stopItem.isEnabled = s.activeCommandId != nil
        disableItem.isEnabled = !s.disabled
        item.button?.title = s.activeCommandId != nil ? "JARVIS ●" : s.disabled ? "JARVIS ⏸" : "JARVIS"
    }
    @objc func stop() { onStop() }
    @objc func disable() { onDisable() }
}
#endif
