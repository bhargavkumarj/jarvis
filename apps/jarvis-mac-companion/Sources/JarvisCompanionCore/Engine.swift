import Foundation

/// Cooperative cancellation shared by the engine, the confirmation UI and executors.
public final class CancelToken: @unchecked Sendable {
    private let lock = NSLock()
    private var cancelled = false
    private var handlers: [() -> Void] = []
    public init() {}
    public var isCancelled: Bool { lock.lock(); defer { lock.unlock() }; return cancelled }
    public func cancel() {
        lock.lock()
        guard !cancelled else { lock.unlock(); return }
        cancelled = true
        let hs = handlers; handlers = []
        lock.unlock()
        hs.forEach { $0() }
    }
    /// Runs immediately if already cancelled (e.g. terminate a just-started Shortcut process).
    public func onCancel(_ h: @escaping () -> Void) {
        lock.lock()
        if cancelled { lock.unlock(); h(); return }
        handlers.append(h); lock.unlock()
    }
}

public struct ConfirmationStep: Equatable {
    public let title: String; public let detail: String
    public init(title: String, detail: String) { self.title = title; self.detail = detail }
}
public struct ConfirmationRequest: Equatable {
    public let origin: String, accountLabel: String, commandShortId: String
    public let steps: [ConfirmationStep]
    public let includesShortcut: Bool
    public let timeout: TimeInterval
    public init(origin: String, accountLabel: String, commandShortId: String, steps: [ConfirmationStep], includesShortcut: Bool, timeout: TimeInterval) {
        self.origin = origin; self.accountLabel = accountLabel; self.commandShortId = commandShortId; self.steps = steps; self.includesShortcut = includesShortcut; self.timeout = timeout
    }
}
public enum ConfirmationOutcome: Equatable { case approved, declined, timedOut, cancelled }
public protocol Confirmer: AnyObject { func confirm(_ request: ConfirmationRequest, cancel: CancelToken) -> ConfirmationOutcome }
public protocol ActionExecutor: AnyObject {
    /// Performs one fixed, validated action. Never invoked for actions local policy rejected.
    func perform(_ action: Action, entry: LocalEntry?, index: Int, cancel: CancelToken) -> ActionResult
    /// Human-readable target for native confirmation (local detail such as bundle ID or URL).
    func describe(_ action: Action, entry: LocalEntry?) -> ConfirmationStep
}

public struct EngineRefusal: Error, Equatable { public let code: String; public let message: String }
public enum EngineEvent { case progress(commandId: String, state: ExecutionState, index: Int?) }

public final class CommandEngine {
    public let hostVersion: String
    let configStore: ConfigStore, secrets: SecretStore, backend: Backend, confirmer: Confirmer, executor: ActionExecutor
    public let journal: Journal
    let now: () -> Date
    private let lock = NSLock()
    private var current: (id: String, token: CancelToken)?

    public init(hostVersion: String, configStore: ConfigStore, secrets: SecretStore, backend: Backend, confirmer: Confirmer, executor: ActionExecutor, journal: Journal, now: @escaping () -> Date = Date.init) {
        self.hostVersion = hostVersion; self.configStore = configStore; self.secrets = secrets; self.backend = backend
        self.confirmer = confirmer; self.executor = executor; self.journal = journal; self.now = now
    }
    public static func secretAccount(origin: String) -> String { "jarvis-device:\(origin)" }
    public func credential(_ config: CompanionConfig) -> DeviceCredential? {
        guard let id = config.deviceId, let s = secrets.load(account: Self.secretAccount(origin: config.backendOrigin)), Patterns.isToken(s) else { return nil }
        return DeviceCredential(deviceId: id, secret: s)
    }
    public var activeCommandId: String? { lock.lock(); defer { lock.unlock() }; return current?.id }

    /// Local emergency stop: no backend round-trip needed.
    @discardableResult public func cancel(commandId: String?) -> Bool {
        lock.lock(); let c = current; lock.unlock()
        guard let c, commandId == nil || commandId == c.id else { return false }
        c.token.cancel(); return true
    }

    public func execute(commandId: String, ticket: String, emit: @escaping (EngineEvent) -> Void) -> Result<CommandResult, EngineRefusal> {
        guard let config = try? configStore.load() else { return .failure(EngineRefusal(code: "not_paired", message: "This Mac is not set up. Run the companion configure step.")) }
        if config.disabled { return .failure(EngineRefusal(code: "disabled", message: "Computer control is disabled on this Mac. Nothing was run.")) }
        guard let cred = credential(config) else { return .failure(EngineRefusal(code: "not_paired", message: "This Mac is not paired. Pair it from Settings → Computer.")) }
        if journal.record(commandId) != nil { return .failure(EngineRefusal(code: "duplicate", message: "This approval was already handled on this Mac. It will not run again.")) }
        let token = CancelToken()
        lock.lock()
        if current != nil || journal.active != nil { lock.unlock(); return .failure(EngineRefusal(code: "busy", message: "Another computer action is in progress on this Mac.")) }
        current = (commandId, token)
        lock.unlock()
        defer { lock.lock(); current = nil; lock.unlock() }

        // 1. Redeem the one-use ticket with the trusted backend. Fail closed.
        let redeemed: RedeemResponse
        do { redeemed = try backend.redeem(commandId: commandId, ticket: ticket, credential: cred) }
        catch BackendError.unauthorized { return .failure(EngineRefusal(code: "revoked", message: "The JARVIS server refused this Mac's credential or the approval. Nothing was run.")) }
        catch { return .failure(EngineRefusal(code: "backend_unavailable", message: "Authorization could not be checked with JARVIS, so nothing was run.")) }
        switch redeemed.status {
        case "claimed": break
        case "already_claimed": return .failure(EngineRefusal(code: "duplicate", message: "This approval was already used. It cannot run a second time."))
        case "expired": return .failure(EngineRefusal(code: "expired", message: "This approval expired before the Mac received it. Nothing was run."))
        case "disabled": return .failure(EngineRefusal(code: "disabled", message: "Computer control is off for this JARVIS account. Nothing was run."))
        case "session_ended": return .failure(EngineRefusal(code: "authorization_failed", message: "The signed-in session that approved this has ended. Nothing was run."))
        default: return .failure(EngineRefusal(code: "authorization_failed", message: "JARVIS did not authorize this action. Nothing was run."))
        }
        guard let env = redeemed.envelope, env.commandId == commandId, env.deviceId == cred.deviceId,
              Canonical.digest(deviceId: env.deviceId, commandId: env.commandId, actions: env.actions) == env.digest else {
            // Claimed but untrustworthy: report and refuse rather than guessing.
            let r = finalize(commandId: commandId, state: .failed, results: [], started: now(), summary: "The authorization did not match this Mac or its approved parameters. Nothing was run.", cred: cred, journaled: false)
            return .success(r)
        }
        let started = now()
        do { try journal.begin(commandId: commandId, digest: env.digest, actions: env.actions) }
        catch let e as ContractError where e.code == "busy" || e.code == "duplicate" { return .failure(EngineRefusal(code: e.code, message: "This Mac already has a record of this or another running action. Nothing new was run.")) }
        catch { return .success(finalize(commandId: commandId, state: .failed, results: [], started: started, summary: "The local execution journal could not be written, so nothing was run.", cred: cred, journaled: false)) }

        // 2. Local policy for every step BEFORE asking for approval.
        let policy = LocalPolicy(config)
        var decisions: [(LocalEntry?, Bool)] = []
        for (i, action) in env.actions.enumerated() {
            switch policy.evaluate(action) {
            case .allow(let entry, let auto): decisions.append((entry, auto))
            case .reject(let code, let message):
                var results = [ActionResult(index: i, type: action.type, state: .rejected, evidence: .none, code: code, message: message)]
                results += env.actions.enumerated().filter { $0.offset != i }.map { ActionResult(index: $0.offset, type: $0.element.type, state: .skipped, evidence: .none, code: .skippedAfterFailure, message: "Not run because another step was rejected by this Mac.") }
                results.sort { $0.index < $1.index }
                return .success(finalize(commandId: commandId, state: .failed, results: results, started: started, summary: "This Mac's local policy rejected the plan. Nothing was run.", cred: cred))
            }
        }
        // 3. Native confirmation unless every step was locally allowed to run automatically.
        let needsConfirmation = decisions.contains { !$0.1 } || env.actions.contains { $0.type == .runShortcut }
        if needsConfirmation {
            try? journal.mark(commandId: commandId, state: .awaitingConfirmation, index: nil)
            emit(.progress(commandId: commandId, state: .awaitingConfirmation, index: nil))
            if let stop = check(commandId: commandId, state: .awaitingConfirmation, index: 0, cred: cred) {
                return .success(finalize(commandId: commandId, state: .cancelled, results: skipAll(env.actions, from: 0, code: stop.0, message: stop.1), started: started, summary: stop.1, cred: cred))
            }
            let request = ConfirmationRequest(origin: config.backendOrigin, accountLabel: redeemed.accountLabel ?? config.accountLabel ?? "your JARVIS account", commandShortId: String(commandId.prefix(8)),
                                              steps: env.actions.enumerated().map { executor.describe($0.element, entry: decisions[$0.offset].0) }, includesShortcut: env.actions.contains { $0.type == .runShortcut }, timeout: Protocol1.confirmationTimeoutSeconds)
            let outcome = confirmer.confirm(request, cancel: token)
            if outcome != .approved {
                let code: ResultCode = outcome == .timedOut ? .confirmationTimeout : outcome == .declined ? .confirmationDeclined : .cancelledByUser
                let message = outcome == .timedOut ? "No approval on the Mac within 60 seconds." : outcome == .declined ? "Declined on the Mac." : "Stopped before approval."
                return .success(finalize(commandId: commandId, state: .cancelled, results: skipAll(env.actions, from: 0, code: code, message: message, state: .cancelled), started: started, summary: "\(message) Nothing was run.", cred: cred))
            }
            // Expiration rather than late execution after sleep or an abandoned dialog.
            if now().timeIntervalSince(started) > Protocol1.confirmationTimeoutSeconds + 30 {
                return .success(finalize(commandId: commandId, state: .expired, results: skipAll(env.actions, from: 0, code: .expired, message: "Approval arrived too late; this plan expired."), started: started, summary: "The plan expired before it could run. Nothing was run.", cred: cred))
            }
        }
        // 4. Execute in order; re-check authorization before each step; stop on first failure.
        var results: [ActionResult] = []
        for (i, action) in env.actions.enumerated() {
            if token.isCancelled {
                results += skipAll(env.actions, from: i, code: .cancelledByUser, message: "Stopped before this step.", state: .cancelled)
                return .success(finalize(commandId: commandId, state: .cancelled, results: results, started: started, summary: "Stopped on the Mac. Steps already completed are not reversed.", cred: cred))
            }
            if let stop = check(commandId: commandId, state: .running, index: i, cred: cred) {
                results += skipAll(env.actions, from: i, code: stop.0, message: stop.1)
                return .success(finalize(commandId: commandId, state: results.contains { $0.state == .succeeded } ? .failed : .cancelled, results: results, started: started, summary: stop.1, cred: cred))
            }
            do { try journal.mark(commandId: commandId, state: .running, index: i) }
            catch {
                results += skipAll(env.actions, from: i, code: .osError, message: "The local journal could not be updated, so this step was not run.")
                return .success(finalize(commandId: commandId, state: .failed, results: results, started: started, summary: "Stopped: local journal unavailable.", cred: cred))
            }
            emit(.progress(commandId: commandId, state: .running, index: i))
            var r = executor.perform(action, entry: decisions[i].0, index: i, cancel: token)
            r.index = i; r.type = action.type
            results.append(r)
            if r.state != .succeeded {
                results += skipAll(env.actions, from: i + 1, code: .skippedAfterFailure, message: "Not run because an earlier step did not succeed.")
                let state: ExecutionState = r.state == .outcomeUnknown ? .outcomeUnknown : r.state == .cancelled ? .cancelled : .failed
                return .success(finalize(commandId: commandId, state: state, results: results, started: started, summary: "Step \(i + 1) did not succeed; later steps were not run. Completed steps are not reversed.", cred: cred))
            }
        }
        return .success(finalize(commandId: commandId, state: .succeeded, results: results, started: started, summary: "\(results.count) of \(results.count) action\(results.count == 1 ? "" : "s") completed with the evidence shown.", cred: cred))
    }

    /// nil = proceed. Network failure fails closed.
    func check(commandId: String, state: ExecutionState, index: Int, cred: DeviceCredential) -> (ResultCode, String)? {
        do {
            let p = try backend.progress(commandId: commandId, state: state, index: index, credential: cred)
            if p.proceed { return nil }
            switch p.reason {
            case "cancel_requested": return (.cancelledByUser, "Stop was requested from JARVIS.")
            case "control_disabled": return (.authorizationRevoked, "Computer control was turned off for this account.")
            case "session_ended": return (.authorizationRevoked, "The approving JARVIS session ended (for example, sign-out).")
            default: return (.authorizationRevoked, "JARVIS no longer authorizes this plan.")
            }
        } catch BackendError.unauthorized {
            return (.authorizationRevoked, "This Mac's access was revoked or the account is unavailable.")
        } catch {
            return (.authorizationUnavailable, "Authorization could not be re-checked with JARVIS, so this step was not run.")
        }
    }
    func skipAll(_ actions: [Action], from: Int, code: ResultCode, message: String, state: ActionResultState = .skipped) -> [ActionResult] {
        guard from < actions.count else { return [] }
        return (from..<actions.count).map { ActionResult(index: $0, type: actions[$0].type, state: state, evidence: .none, code: code, message: message) }
    }
    func finalize(commandId: String, state: ExecutionState, results: [ActionResult], started: Date, summary: String, cred: DeviceCredential, journaled: Bool = true) -> CommandResult {
        let result = CommandResult(commandId: commandId, state: state, results: results, startedAt: started, finishedAt: now(), summary: summary)
        if journaled { journal.finish(result) }
        report(result, cred: cred, journaled: journaled)
        return result
    }
    func report(_ result: CommandResult, cred: DeviceCredential, journaled: Bool) {
        for attempt in 0..<3 {
            do { try backend.finish(result, credential: cred); if journaled { journal.markReported(result.commandId) }; return }
            catch BackendError.unauthorized { return } // revoked: nothing more to report to
            catch { if attempt < 2 { Thread.sleep(forTimeInterval: Double(1 << attempt)) } }
        }
        // Left unreported in the journal; reconcile() retries on the next connection.
    }
    /// On start-up: interrupted work becomes outcome_unknown (never replayed); unreported results are re-sent.
    public func reconcile() {
        _ = journal.recoverInterrupted()
        guard let config = try? configStore.load(), let cred = credential(config) else { return }
        for record in journal.unreported {
            guard let json = record.result, let result = try? Contracts.parseCommandResult(json) else { journal.markReported(record.commandId); continue }
            if (try? backend.finish(result, credential: cred)) != nil { journal.markReported(record.commandId) }
        }
    }
}
