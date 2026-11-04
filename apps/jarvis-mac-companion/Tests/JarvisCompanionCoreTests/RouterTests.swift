import XCTest
@testable import JarvisCompanionCore

final class FakeUI: CompanionUI {
    var approvePair = true, approve = true, picked: LocalEntry?
    var pairPrompts = 0
    func approvePairing(origin: String, accountLabel: String, deviceName: String, extensionId: String) -> Bool { pairPrompts += 1; return approvePair }
    func pickResource(kind: ResourceKind, existingAliases: Set<String>) -> LocalEntry? { picked }
    func approveAuto(label: String) -> Bool { approve }
    func approveEnable() -> Bool { approve }
    func approveUnpair(accountLabel: String) -> Bool { approve }
    func statusChanged(_ status: CompanionStatus) {}
}

final class RouterTests: XCTestCase {
    var frames: [JSONValue] = []
    var router: HostRouter!, store: MemoryConfigStore!, secrets: MemorySecretStore!, backend: FakeBackend!, ui: FakeUI!
    let origin = "http://127.0.0.1:3000"
    override func setUp() {
        frames = []
        store = MemoryConfigStore(CompanionConfig(backendOrigin: origin, allowedExtensionId: "fomkddjghmfjocinjmbdagahcbilimof", deviceName: "Synthetic Mac"))
        secrets = MemorySecretStore(); backend = FakeBackend(); ui = FakeUI()
        let engine = CommandEngine(hostVersion: "test", configStore: store, secrets: secrets, backend: backend, confirmer: FakeConfirmer(), executor: FakeExecutor(), journal: Journal(store: MemoryJournalStore()))
        router = HostRouter(callerOrigin: "chrome-extension://fomkddjghmfjocinjmbdagahcbilimof/", engine: engine, configStore: store, secrets: secrets, backend: backend, ui: ui,
                            writer: FrameWriter { [unowned self] data in self.frames.append(try! JSON.parse(data.dropFirst(4))) })
    }
    func send(_ type: String, _ payload: [String: JSONValue] = [:], origin: String? = nil) -> [String: JSONValue]? {
        let id = UUID().uuidString.lowercased()
        router.handle(["v": .int(1), "id": .string(id), "type": .string(type), "payload": .object(payload), "origin": .string(origin ?? self.origin)])
        router.work.sync {}
        return frames.compactMap(\.objectValue).first { $0["id"] == .string(id) }
    }
    func testPinnedExtensionCallerOnly() {
        let c = store.config!
        XCTAssertTrue(HostRouter.callerAllowed("chrome-extension://fomkddjghmfjocinjmbdagahcbilimof/", config: c))
        XCTAssertFalse(HostRouter.callerAllowed("chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/", config: c))
        XCTAssertFalse(HostRouter.callerAllowed(nil, config: c))
    }
    func testWrongPageOriginIsRejectedEvenFromTheAllowedExtension() {
        let r = send("hello", origin: "http://127.0.0.1:3001")
        XCTAssertEqual(r?["ok"], .bool(false)); XCTAssertEqual(r?["error"]?.objectValue?["code"], .string("origin_rejected"))
    }
    func testMalformedFramesAreDropped() {
        router.handle(["v": .int(1), "id": .string("x"), "type": .string("hello"), "payload": .object([:]), "origin": .string(origin)])
        router.handle(["v": .int(2), "id": .string(UUID().uuidString.lowercased()), "type": .string("hello"), "payload": .object([:]), "origin": .string(origin)])
        router.handle(["v": .int(1), "id": .string(UUID().uuidString.lowercased()), "type": .string("hello"), "payload": .object([:]), "origin": .string(origin), "extra": .bool(true)])
        router.work.sync {}
        XCTAssertTrue(frames.isEmpty)
    }
    func testPairingRequiresNativeApprovalAndStoresOnlyAHashServerSide() {
        let pairing: [String: JSONValue] = ["pairingId": .string("c4d5e6f7-1a2b-4c3d-8e9f-0a1b2c3d4e5f"), "code": .string(String(repeating: "C", count: 43))]
        ui.approvePair = false
        XCTAssertEqual(send("pair", pairing)?["error"]?.objectValue?["code"], .string("declined"))
        XCTAssertTrue(secrets.items.isEmpty); XCTAssertNil(backend.completedHash)
        ui.approvePair = true
        XCTAssertEqual(send("pair", pairing)?["ok"], .bool(true))
        let secret = secrets.items.values.first!
        XCTAssertEqual(backend.completedHash, SHA256.hex(Array(secret.utf8)))
        XCTAssertNotEqual(backend.completedHash, secret)
        XCTAssertEqual(store.config?.deviceId, "3f0c1a52-8d4e-4b6a-9c1d-2e7f5a6b8c90")
        XCTAssertEqual(send("pair", pairing)?["error"]?.objectValue?["code"], .string("already_paired"))
        XCTAssertFalse(frames.contains { (try? JSON.encode($0)).map { String(decoding: $0, as: UTF8.self).contains(secret) } ?? false }, "the device secret never reaches the bridge")
    }
    func testPairingIssuedForAnotherOriginIsRefusedBeforeApproval() {
        backend.pairingOrigin = "https://other.example"
        let r = send("pair", ["pairingId": .string("c4d5e6f7-1a2b-4c3d-8e9f-0a1b2c3d4e5f"), "code": .string(String(repeating: "C", count: 43))])
        XCTAssertEqual(r?["error"]?.objectValue?["code"], .string("origin_rejected")); XCTAssertEqual(ui.pairPrompts, 0)
    }
    func testDisableIsImmediateAndEnableNeedsNativeApproval() {
        XCTAssertEqual(send("disable")?["ok"], .bool(true)); XCTAssertEqual(store.config?.disabled, true)
        ui.approve = false; XCTAssertEqual(send("enable")?["ok"], .bool(false)); XCTAssertEqual(store.config?.disabled, true)
        ui.approve = true; XCTAssertEqual(send("enable")?["ok"], .bool(true)); XCTAssertEqual(store.config?.disabled, false)
    }
    func testShortcutsCannotBeSetToRunAutomatically() {
        store.config!.catalogue = [LocalEntry(kind: .shortcut, alias: "study-setup", label: "Study Setup", shortcutName: "Study Setup")]
        XCTAssertEqual(send("manage_auto", ["kind": .string("shortcut"), "alias": .string("study-setup"), "enabled": .bool(true)])?["ok"], .bool(false))
    }
    func testStatusSharesAliasesNotLocalPathsOrURLs() throws {
        store.config!.catalogue = [
            LocalEntry(kind: .website, alias: "youtube", label: "YouTube", url: "https://www.youtube.com/feed/subscriptions"),
            LocalEntry(kind: .folder, alias: "jarvis-project", label: "Jarvis project", bookmark: Data([1, 2, 3]), folderPath: "/Users/synthetic/Projects/jarvis"),
        ]
        let text = String(decoding: try JSON.encode(send("hello")!["payload"]!), as: UTF8.self)
        XCTAssertTrue(text.contains("www.youtube.com")); XCTAssertFalse(text.contains("subscriptions")); XCTAssertFalse(text.contains("/Users/"))
    }
    func testConfigValidation() {
        XCTAssertTrue(CompanionConfig.validOrigin("http://127.0.0.1:3000"))
        XCTAssertTrue(CompanionConfig.validOrigin("https://jarvis.example"))
        for bad in ["http://jarvis.example", "http://192.168.1.2:3000", "https://jarvis.example/", "https://*.example", "https://u:p@jarvis.example", "file:///x", "chrome-extension://abc"] { XCTAssertFalse(CompanionConfig.validOrigin(bad), bad) }
        XCTAssertThrowsError(try LocalEntry(kind: .website, alias: "x", label: "X", url: "http://insecure.example/").validate())
        XCTAssertThrowsError(try LocalEntry(kind: .shortcut, alias: "x", label: "X", auto: true, shortcutName: "X").validate())
        XCTAssertThrowsError(try LocalEntry(kind: .shortcut, alias: "x", label: "X", shortcutName: "--input-path").validate())
        XCTAssertThrowsError(try LocalEntry(kind: .folder, alias: "root", label: "Root", bookmark: Data([1]), folderPath: "/").validate())
    }
    func testRedaction() {
        let s = Redaction.message("Failed for /Users/synthetic/Secret Folder/file with token \(String(repeating: "A", count: 43))\nnext line")
        XCTAssertFalse(s.contains("/Users/")); XCTAssertFalse(s.contains(String(repeating: "A", count: 43))); XCTAssertFalse(s.contains("\n"))
    }
}
