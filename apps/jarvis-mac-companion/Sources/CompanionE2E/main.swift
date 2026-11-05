import Foundation
import JarvisCompanionCore

// Cross-language integration harness. Uses the REAL HTTPBackend, HostRouter and
// CommandEngine against a running JARVIS server, with a FAKE confirmer that
// approves and a FAKE executor that only records. It launches nothing, changes
// no volume, runs no Shortcut and touches no Keychain.
//   CompanionE2E pair    <state-dir> <origin> <extension-id> <pairing-id> <code>
//   CompanionE2E execute <state-dir> <command-id> <ticket>
//   CompanionE2E cancel-during-confirm <state-dir> <command-id> <ticket>
//   CompanionE2E configure <state-dir> <origin> <extension-id>     (demo catalogue)
//   CompanionE2E native-host <state-dir> <chrome-extension://id/>   (launched by Chrome; Linux demo)
// native-host mode runs the companion's real framing loop + router + engine + HTTP client,
// with a SIMULATED approval (auto "Run" after 1.5 s) and the record-only executor.
final class FileSecrets: SecretStore {
    let url: URL
    init(_ dir: URL) { url = dir.appendingPathComponent("secret.json") }
    func all() -> [String: String] { (try? JSONDecoder().decode([String: String].self, from: Data(contentsOf: url))) ?? [:] }
    func save(secret: String, account: String) throws { var a = all(); a[account] = secret; try PrivateFile.write(JSONEncoder().encode(a), to: url) }
    func load(account: String) -> String? { all()[account] }
    func delete(account: String) { var a = all(); a.removeValue(forKey: account); try? PrivateFile.write(JSONEncoder().encode(a), to: url) }
}
final class Approver: Confirmer {
    var cancelInstead = false, delay: TimeInterval = 0
    func confirm(_ request: ConfirmationRequest, cancel: CancelToken) -> ConfirmationOutcome {
        if cancelInstead { cancel.cancel(); return .cancelled }
        let end = Date().addingTimeInterval(delay)
        while Date() < end { if cancel.isCancelled { return .cancelled }; Thread.sleep(forTimeInterval: 0.05) }
        return .approved
    }
}
final class Recorder: ActionExecutor {
    static var demo = false
    func perform(_ action: Action, entry: LocalEntry?, index: Int, cancel: CancelToken) -> ActionResult {
        ActionResult(index: index, type: action.type, state: .succeeded, evidence: .dispatched, code: action.type == .setVolume ? .volumeSet : action.type == .openWebsite ? .urlDispatched : action.type == .openFolder ? .folderOpened : action.type == .runShortcut ? .shortcutCompleted : .appLaunched,
                     message: Recorder.demo ? "Linux demo host: recorded only, nothing was executed on a Mac." : "Test double: recorded, not executed.", startedAt: Date(), finishedAt: Date())
    }
    func describe(_ action: Action, entry: LocalEntry?) -> ConfirmationStep { ConfirmationStep(title: action.type.label, detail: action.target) }
}
final class AutoUI: CompanionUI {
    func approvePairing(origin: String, accountLabel: String, deviceName: String, extensionId: String) -> Bool { true }
    func pickResource(kind: ResourceKind, existingAliases: Set<String>) -> LocalEntry? { nil }
    func approveAuto(label: String) -> Bool { false }
    func approveEnable() -> Bool { false }
    func approveUnpair(accountLabel: String) -> Bool { true }
    func statusChanged(_ status: CompanionStatus) {}
}
let args = CommandLine.arguments
guard args.count >= 3 else { print("usage"); exit(2) }
let dir = URL(fileURLWithPath: args[2], isDirectory: true)
let store = FileConfigStore(url: dir.appendingPathComponent("config.json"))
if args[1] == "pair" {
    var c = CompanionConfig(backendOrigin: args[3], allowedExtensionId: args[4], deviceName: "E2E test double")
    c.catalogue = [LocalEntry(kind: .application, alias: "safari", label: "Safari", bundleId: "com.apple.Safari")]
    c.enabledActions = [.openApplication, .setVolume]
    try! store.save(c)
}
if args[1] == "configure" {
    var c = CompanionConfig(backendOrigin: args[3], allowedExtensionId: args[4], deviceName: "Demo Mac (Linux test host)")
    c.catalogue = [
        LocalEntry(kind: .application, alias: "safari", label: "Safari", bundleId: "com.apple.Safari"),
        LocalEntry(kind: .application, alias: "vs-code", label: "Visual Studio Code", names: ["vs code", "vscode"], bundleId: "com.microsoft.VSCode"),
        LocalEntry(kind: .website, alias: "youtube", label: "YouTube", url: "https://www.youtube.com/"),
        LocalEntry(kind: .folder, alias: "jarvis-project", label: "Jarvis project", names: ["jarvis project folder"], bookmark: Data([0]), folderPath: "/Users/demo/Projects/jarvis"),
        LocalEntry(kind: .shortcut, alias: "study-setup", label: "Study Setup", shortcutName: "Study Setup", shortcutId: "00000000-0000-4000-8000-000000000000"),
    ]
    try! store.save(c); print("configured"); exit(0)
}
guard let config = try? store.load() else { print("{\"error\":\"no config\"}"); exit(1) }
let secrets = FileSecrets(dir), approver = Approver()
let backend = try! HTTPBackend(origin: config.backendOrigin)
let engine = CommandEngine(hostVersion: "e2e", configStore: store, secrets: secrets, backend: backend, confirmer: approver, executor: Recorder(), journal: Journal(store: FileJournalStore(url: dir.appendingPathComponent("journal.json"))))
if args[1] == "native-host" {
    guard HostRouter.callerAllowed(args.count > 3 ? args[3] : nil, config: config) else { FileHandle.standardError.write(Data("caller not allowed\n".utf8)); exit(1) }
    Recorder.demo = true; approver.delay = 1.5
    let out = FrameWriter { FileHandle.standardOutput.write($0) }
    let host = HostRouter(callerOrigin: args[3], engine: engine, configStore: store, secrets: secrets, backend: backend, ui: AutoUI(), writer: out)
    engine.reconcile()
    let reader = FrameReader(source: FileHandleSource(FileHandle.standardInput))
    while let frame = try? reader.next() { host.handle(frame) }
    host.drain(); exit(0)
}
var frames: [JSONValue] = []
let lock = NSLock()
let router = HostRouter(callerOrigin: "chrome-extension://\(config.allowedExtensionId)/", engine: engine, configStore: store, secrets: secrets, backend: backend, ui: AutoUI(),
                        writer: FrameWriter { d in lock.lock(); frames.append(try! JSON.parse(d.dropFirst(4))); lock.unlock() })
func send(_ type: String, _ payload: [String: JSONValue]) {
    router.handle(["v": .int(1), "id": .string(UUID().uuidString.lowercased()), "type": .string(type), "payload": .object(payload), "origin": .string(config.backendOrigin)])
    router.drain()
}
switch args[1] {
case "pair": send("pair", ["pairingId": .string(args[5]), "code": .string(args[6])])
case "execute": send("execute", ["commandId": .string(args[3]), "ticket": .string(args[4])])
case "cancel-during-confirm": approver.cancelInstead = true; send("execute", ["commandId": .string(args[3]), "ticket": .string(args[4])])
default: print("usage"); exit(2)
}
let responses = frames.compactMap(\.objectValue).filter { $0["kind"] == .string("response") }
print(String(decoding: try! JSON.encode(.object(["responses": .array(responses.map { .object($0) }), "deviceId": (try? store.load())??.deviceId.map { .string($0) } ?? .null])), as: UTF8.self))
