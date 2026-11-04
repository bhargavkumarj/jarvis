import XCTest
@testable import JarvisCompanionCore

// Test doubles only: nothing here launches apps, changes volume or runs Shortcuts.
final class FakeBackend: Backend {
    var redeemStatus = "claimed"
    var redeemError: BackendError?
    var envelope: CommandEnvelope!
    var progressReplies: [Result<(Bool, String?), BackendError>] = []
    var finishError: BackendError?
    var finished: [CommandResult] = []
    var redeemCalls = 0, progressCalls: [(ExecutionState, Int)] = []
    var pairingLabel = "s•••@example.test", pairingOrigin = "http://127.0.0.1:3000", completedHash: String?
    func pairingInspect(pairingId: String, code: String, extensionId: String) throws -> (accountLabel: String, origin: String) { (pairingLabel, pairingOrigin) }
    func pairingComplete(pairingId: String, code: String, extensionId: String, deviceName: String, credentialHash: String) throws -> (deviceId: String, accountLabel: String) {
        completedHash = credentialHash; return ("3f0c1a52-8d4e-4b6a-9c1d-2e7f5a6b8c90", pairingLabel)
    }
    func sync(_ payload: JSONValue, credential: DeviceCredential) throws -> (controlEnabled: Bool, accountLabel: String) { (true, pairingLabel) }
    func redeem(commandId: String, ticket: String, credential: DeviceCredential) throws -> RedeemResponse {
        redeemCalls += 1
        if let redeemError { throw redeemError }
        return RedeemResponse(status: redeemStatus, envelope: redeemStatus == "claimed" ? envelope : nil, accountLabel: "s•••@example.test", origin: "http://127.0.0.1:3000")
    }
    func progress(commandId: String, state: ExecutionState, index: Int, credential: DeviceCredential) throws -> (proceed: Bool, reason: String?) {
        progressCalls.append((state, index))
        guard !progressReplies.isEmpty else { return (true, nil) }
        switch progressReplies.removeFirst() { case .success(let r): return (r.0, r.1); case .failure(let e): throw e }
    }
    func finish(_ result: CommandResult, credential: DeviceCredential) throws { if let finishError { throw finishError }; finished.append(result) }
    func unpair(credential: DeviceCredential) throws {}
}
final class FakeConfirmer: Confirmer {
    var outcome: ConfirmationOutcome = .approved
    var requests: [ConfirmationRequest] = []
    var onConfirm: ((CancelToken) -> Void)?
    func confirm(_ request: ConfirmationRequest, cancel: CancelToken) -> ConfirmationOutcome { requests.append(request); onConfirm?(cancel); return cancel.isCancelled ? .cancelled : outcome }
}
final class FakeExecutor: ActionExecutor {
    var performed: [Action] = []
    var overrides: [Int: ActionResult] = [:]
    var onPerform: ((Int, CancelToken) -> Void)?
    func perform(_ action: Action, entry: LocalEntry?, index: Int, cancel: CancelToken) -> ActionResult {
        performed.append(action); onPerform?(index, cancel)
        return overrides[index] ?? ActionResult(index: index, type: action.type, state: .succeeded, evidence: .observed, code: action.type == .setVolume ? .volumeSet : .appRunningObserved, message: "Synthetic success.")
    }
    func describe(_ action: Action, entry: LocalEntry?) -> ConfirmationStep { ConfirmationStep(title: action.type.label, detail: entry?.label ?? action.target) }
}

final class EngineTests: XCTestCase {
    let device = "3f0c1a52-8d4e-4b6a-9c1d-2e7f5a6b8c90", command = "7b2e9d41-5c3a-4f8b-a1e6-0d9c8b7a6f54", ticket = String(repeating: "T", count: 43)
    var backend: FakeBackend!, confirmer: FakeConfirmer!, executor: FakeExecutor!, store: MemoryConfigStore!, secrets: MemorySecretStore!, journalStore: MemoryJournalStore!, engine: CommandEngine!

    func config(_ edit: (inout CompanionConfig) -> Void = { _ in }) -> CompanionConfig {
        var c = CompanionConfig(backendOrigin: "http://127.0.0.1:3000", allowedExtensionId: "fomkddjghmfjocinjmbdagahcbilimof", deviceName: "Synthetic Mac")
        c.deviceId = device
        c.catalogue = [
            LocalEntry(kind: .application, alias: "safari", label: "Safari", bundleId: "com.apple.Safari"),
            LocalEntry(kind: .shortcut, alias: "study-setup", label: "Study Setup", shortcutName: "Study Setup", shortcutId: "ABC"),
        ]
        edit(&c); return c
    }
    func envelope(_ actions: [Action], digest: String? = nil, deviceId: String? = nil) -> CommandEnvelope {
        let d = deviceId ?? device
        return CommandEnvelope(commandId: command, requestId: "c4d5e6f7-1a2b-4c3d-8e9f-0a1b2c3d4e5f", deviceId: d, actions: actions, issuedAt: Date(), expiresAt: Date().addingTimeInterval(60),
                               digest: digest ?? Canonical.digest(deviceId: d, commandId: command, actions: actions))
    }
    override func setUp() {
        backend = FakeBackend(); confirmer = FakeConfirmer(); executor = FakeExecutor(); store = MemoryConfigStore(config()); secrets = MemorySecretStore(); journalStore = MemoryJournalStore()
        secrets.items[CommandEngine.secretAccount(origin: "http://127.0.0.1:3000")] = String(repeating: "S", count: 43)
        engine = CommandEngine(hostVersion: "test", configStore: store, secrets: secrets, backend: backend, confirmer: confirmer, executor: executor, journal: Journal(store: journalStore))
    }
    func run() -> Result<CommandResult, EngineRefusal> { engine.execute(commandId: command, ticket: ticket) { _ in } }
    func success(_ r: Result<CommandResult, EngineRefusal>) -> CommandResult { guard case .success(let v) = r else { XCTFail("expected result, got \(r)"); fatalError() }; return v }
    func refusal(_ r: Result<CommandResult, EngineRefusal>) -> String { guard case .failure(let e) = r else { XCTFail("expected refusal"); return "" }; return e.code }

    func testApprovedPlanRunsInOrderAndReportsObservedEvidence() {
        backend.envelope = envelope([.openApplication(alias: "safari"), .setVolume(percent: 30)])
        let r = success(run())
        XCTAssertEqual(r.state, .succeeded)
        XCTAssertEqual(executor.performed, [.openApplication(alias: "safari"), .setVolume(percent: 30)])
        XCTAssertEqual(confirmer.requests.count, 1, "every plan is confirmed natively by default")
        XCTAssertEqual(backend.finished.map(\.commandId), [command])
        XCTAssertEqual(journalStore.records.first?.reported, true)
    }
    func testLocalPolicyRejectsEvenAfterBackendAuthorization() {
        backend.envelope = envelope([.openApplication(alias: "terminal")])
        let r = success(run())
        XCTAssertEqual(r.state, .failed); XCTAssertEqual(r.results.first?.code, .notApproved)
        XCTAssertTrue(executor.performed.isEmpty); XCTAssertTrue(confirmer.requests.isEmpty)
    }
    func testDisabledActionTypeRejected() {
        store.config = config { $0.enabledActions = [.openApplication] }
        backend.envelope = envelope([.setVolume(percent: 10)])
        XCTAssertEqual(success(run()).results.first?.code, .actionDisabled); XCTAssertTrue(executor.performed.isEmpty)
    }
    func testTamperedDigestOrWrongDeviceNeverExecutes() {
        backend.envelope = envelope([.setVolume(percent: 30)], digest: Canonical.digest(deviceId: device, commandId: command, actions: [.setVolume(percent: 31)]))
        XCTAssertEqual(success(run()).state, .failed); XCTAssertTrue(executor.performed.isEmpty)
        setUp()
        backend.envelope = envelope([.setVolume(percent: 30)], deviceId: "11111111-1111-4111-8111-111111111111")
        XCTAssertEqual(success(run()).state, .failed); XCTAssertTrue(executor.performed.isEmpty)
    }
    func testReplayOfSameCommandIsSuppressedWithoutSecondRedeem() {
        backend.envelope = envelope([.openApplication(alias: "safari")])
        _ = success(run())
        XCTAssertEqual(refusal(run()), "duplicate")
        XCTAssertEqual(backend.redeemCalls, 1); XCTAssertEqual(executor.performed.count, 1)
    }
    func testAlreadyClaimedAndExpiredTicketsDoNotRun() {
        backend.redeemStatus = "already_claimed"; XCTAssertEqual(refusal(run()), "duplicate")
        backend.redeemStatus = "expired"; XCTAssertEqual(refusal(run()), "expired")
        backend.redeemStatus = "session_ended"; XCTAssertEqual(refusal(run()), "authorization_failed")
        XCTAssertTrue(executor.performed.isEmpty)
    }
    func testFailClosedWhenAuthorizationUnavailableOrRevoked() {
        backend.redeemError = .unavailable; XCTAssertEqual(refusal(run()), "backend_unavailable")
        backend.redeemError = .unauthorized; XCTAssertEqual(refusal(run()), "revoked")
        XCTAssertTrue(executor.performed.isEmpty)
    }
    func testLocallyDisabledRefusesBeforeContactingBackend() {
        store.config = config { $0.disabled = true }
        XCTAssertEqual(refusal(run()), "disabled"); XCTAssertEqual(backend.redeemCalls, 0)
    }
    func testDeclinedOrTimedOutConfirmationRunsNothing() {
        backend.envelope = envelope([.openApplication(alias: "safari")]); confirmer.outcome = .declined
        let r = success(run()); XCTAssertEqual(r.state, .cancelled); XCTAssertEqual(r.results.first?.code, .confirmationDeclined)
        setUp(); backend.envelope = envelope([.openApplication(alias: "safari")]); confirmer.outcome = .timedOut
        XCTAssertEqual(success(run()).results.first?.code, .confirmationTimeout)
        XCTAssertTrue(executor.performed.isEmpty)
    }
    func testAutoAllowedLowRiskSkipsDialogButShortcutAlwaysAsks() {
        store.config = config { $0.catalogue[0].auto = true; $0.volumeAuto = true }
        backend.envelope = envelope([.openApplication(alias: "safari"), .setVolume(percent: 20)])
        XCTAssertEqual(success(run()).state, .succeeded); XCTAssertTrue(confirmer.requests.isEmpty)
        setUp(); store.config = config { $0.catalogue[0].auto = true }
        backend.envelope = envelope([.openApplication(alias: "safari"), .runShortcut(alias: "study-setup")])
        _ = success(run()); XCTAssertEqual(confirmer.requests.count, 1); XCTAssertTrue(confirmer.requests[0].includesShortcut)
    }
    func testRevocationOrSignOutBetweenStepsStopsRemainingActions() {
        backend.envelope = envelope([.openApplication(alias: "safari"), .setVolume(percent: 30)])
        backend.progressReplies = [.success((true, nil)), .success((true, nil)), .success((false, "session_ended"))]
        let r = success(run())
        XCTAssertEqual(executor.performed, [.openApplication(alias: "safari")])
        XCTAssertEqual(r.results.map(\.state), [.succeeded, .skipped]); XCTAssertEqual(r.results[1].code, .authorizationRevoked)
    }
    func testProgressNetworkFailureFailsClosed() {
        backend.envelope = envelope([.openApplication(alias: "safari")])
        backend.progressReplies = [.success((true, nil)), .failure(.unavailable)]
        let r = success(run()); XCTAssertTrue(executor.performed.isEmpty); XCTAssertEqual(r.results.first?.code, .authorizationUnavailable)
    }
    func testFailureStopsPlanAndUnknownPropagates() {
        backend.envelope = envelope([.runShortcut(alias: "study-setup"), .openApplication(alias: "safari")])
        executor.overrides[0] = ActionResult(index: 0, type: .runShortcut, state: .outcomeUnknown, evidence: .none, code: .shortcutTimeout, message: "Timed out.")
        let r = success(run())
        XCTAssertEqual(r.state, .outcomeUnknown); XCTAssertEqual(executor.performed.count, 1); XCTAssertEqual(r.results[1].state, .skipped)
    }
    func testStopDuringConfirmationAndBetweenSteps() {
        backend.envelope = envelope([.openApplication(alias: "safari")])
        confirmer.onConfirm = { $0.cancel() }
        XCTAssertEqual(success(run()).state, .cancelled); XCTAssertTrue(executor.performed.isEmpty)
        setUp(); backend.envelope = envelope([.openApplication(alias: "safari"), .setVolume(percent: 5)])
        executor.onPerform = { i, token in if i == 0 { token.cancel() } }
        let r = success(run()); XCTAssertEqual(r.state, .cancelled); XCTAssertEqual(executor.performed.count, 1); XCTAssertEqual(r.results[1].code, .cancelledByUser)
    }
    func testOneActiveCommandPerDevice() {
        journalStore.records = [JournalRecord(commandId: "99999999-9999-4999-8999-999999999999", digest: String(repeating: "a", count: 64), steps: ["set_volume:1"], state: "running", currentIndex: 0, startedAt: Date(), finishedAt: nil, result: nil, reported: false)]
        engine = CommandEngine(hostVersion: "test", configStore: store, secrets: secrets, backend: backend, confirmer: confirmer, executor: executor, journal: Journal(store: journalStore))
        XCTAssertEqual(refusal(run()), "busy"); XCTAssertEqual(backend.redeemCalls, 0)
    }
    func testCrashRecoveryMarksUnknownAndNeverReplays() throws {
        journalStore.records = [JournalRecord(commandId: command, digest: String(repeating: "a", count: 64), steps: ["open_application:safari", "run_shortcut:study-setup"], state: "running", currentIndex: 1, startedAt: Date(), finishedAt: nil, result: nil, reported: false)]
        engine = CommandEngine(hostVersion: "test", configStore: store, secrets: secrets, backend: backend, confirmer: confirmer, executor: executor, journal: Journal(store: journalStore))
        engine.reconcile()
        XCTAssertEqual(backend.finished.first?.state, .outcomeUnknown)
        XCTAssertEqual(backend.finished.first?.results.map(\.state), [.outcomeUnknown, .outcomeUnknown])
        XCTAssertTrue(executor.performed.isEmpty)
        backend.envelope = envelope([.openApplication(alias: "safari")])
        XCTAssertEqual(refusal(run()), "duplicate", "a recovered command cannot be re-run")
    }
    func testUnreportedResultIsRetriedOnReconcile() {
        backend.envelope = envelope([.openApplication(alias: "safari")]); backend.finishError = .unavailable
        _ = success(run())
        XCTAssertEqual(engine.journal.unreported.count, 1)
        backend.finishError = nil; engine.reconcile()
        XCTAssertEqual(engine.journal.unreported.count, 0); XCTAssertEqual(backend.finished.count, 1)
    }
    func testJournalWriteFailurePreventsExecution() {
        backend.envelope = envelope([.openApplication(alias: "safari")]); journalStore.failSaves = true
        XCTAssertEqual(success(run()).state, .failed); XCTAssertTrue(executor.performed.isEmpty)
    }
}
