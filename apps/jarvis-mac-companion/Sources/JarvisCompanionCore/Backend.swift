import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

public enum BackendError: Error, Equatable {
    case unauthorized      // credential/ticket/pairing refused, device revoked, account ineligible
    case unavailable       // network, timeout, 5xx: authorization could not be checked → fail closed
    case rejected(String)  // 4xx with a fixed code
    case invalidResponse
}
public struct RedeemResponse: Equatable {
    public let status: String              // claimed | already_claimed | expired | disabled | session_ended
    public let envelope: CommandEnvelope?
    public let accountLabel: String?
    public let origin: String?
}
public protocol Backend: AnyObject {
    func pairingInspect(pairingId: String, code: String, extensionId: String) throws -> (accountLabel: String, origin: String)
    func pairingComplete(pairingId: String, code: String, extensionId: String, deviceName: String, credentialHash: String) throws -> (deviceId: String, accountLabel: String)
    func sync(_ payload: JSONValue, credential: DeviceCredential) throws -> (controlEnabled: Bool, accountLabel: String)
    func redeem(commandId: String, ticket: String, credential: DeviceCredential) throws -> RedeemResponse
    func progress(commandId: String, state: ExecutionState, index: Int, credential: DeviceCredential) throws -> (proceed: Bool, reason: String?)
    func finish(_ result: CommandResult, credential: DeviceCredential) throws
    func unpair(credential: DeviceCredential) throws
}

/// HTTPS (or explicitly configured loopback HTTP) client for the one trusted backend
/// origin from the local config. Default TLS validation; no cookies, no cache.
public final class HTTPBackend: Backend {
    let origin: String
    let session: URLSession
    public init(origin: String) throws {
        guard CompanionConfig.validOrigin(origin) else { throw ContractError("invalid_origin") }
        self.origin = origin
        let c = URLSessionConfiguration.ephemeral
        c.httpCookieAcceptPolicy = .never; c.httpShouldSetCookies = false; c.urlCache = nil
        c.requestCachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        c.timeoutIntervalForRequest = 10; c.timeoutIntervalForResource = 15
        self.session = URLSession(configuration: c)
    }
    func call(_ path: String, _ body: JSONValue, credential: DeviceCredential?) throws -> [String: JSONValue] {
        guard let url = URL(string: origin + "/api/v1/computer/device/" + path) else { throw BackendError.invalidResponse }
        var r = URLRequest(url: url)
        r.httpMethod = "POST"
        r.httpShouldHandleCookies = false
        r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        r.setValue("1", forHTTPHeaderField: "X-Jarvis-Device-Protocol")
        if let credential {
            r.setValue(credential.deviceId, forHTTPHeaderField: "X-Jarvis-Device")
            r.setValue("Bearer \(credential.secret)", forHTTPHeaderField: "Authorization")
        }
        r.httpBody = try JSON.encode(body)
        let done = DispatchSemaphore(value: 0)
        let box = ResponseBox()
        session.dataTask(with: r) { d, resp, e in box.set(d, resp, e); done.signal() }.resume()
        if done.wait(timeout: .now() + 20) == .timedOut { throw BackendError.unavailable }
        let out = box.get()
        guard out.2 == nil, let http = out.1 as? HTTPURLResponse, let data = out.0, data.count <= 65536 else { throw BackendError.unavailable }
        let parsed = (try? JSON.parse(data))?.objectValue
        switch http.statusCode {
        case 200: guard let parsed else { throw BackendError.invalidResponse }; return parsed
        case 401, 403: throw BackendError.unauthorized
        case 400...499: throw BackendError.rejected(parsed?["error"]?.stringValue ?? "rejected")
        default: throw BackendError.unavailable
        }
    }
    public func pairingInspect(pairingId: String, code: String, extensionId: String) throws -> (accountLabel: String, origin: String) {
        let r = try call("pairing-inspect", .object(["pairingId": .string(pairingId), "code": .string(code), "extensionId": .string(extensionId)]), credential: nil)
        guard let label = r["accountLabel"]?.stringValue, let o = r["origin"]?.stringValue else { throw BackendError.invalidResponse }
        return (label, o)
    }
    public func pairingComplete(pairingId: String, code: String, extensionId: String, deviceName: String, credentialHash: String) throws -> (deviceId: String, accountLabel: String) {
        let r = try call("pairing-complete", .object(["pairingId": .string(pairingId), "code": .string(code), "extensionId": .string(extensionId), "deviceName": .string(deviceName), "credentialHash": .string(credentialHash)]), credential: nil)
        guard let id = r["deviceId"]?.stringValue, Patterns.isUUID(id), let label = r["accountLabel"]?.stringValue else { throw BackendError.invalidResponse }
        return (id, label)
    }
    public func sync(_ payload: JSONValue, credential: DeviceCredential) throws -> (controlEnabled: Bool, accountLabel: String) {
        let r = try call("sync", payload, credential: credential)
        return (r["controlEnabled"]?.boolValue ?? false, r["accountLabel"]?.stringValue ?? "")
    }
    public func redeem(commandId: String, ticket: String, credential: DeviceCredential) throws -> RedeemResponse {
        let r = try call("redeem", .object(["commandId": .string(commandId), "ticket": .string(ticket)]), credential: credential)
        guard let status = r["status"]?.stringValue else { throw BackendError.invalidResponse }
        if status != "claimed" { return RedeemResponse(status: status, envelope: nil, accountLabel: nil, origin: nil) }
        guard let command = r["command"] else { throw BackendError.invalidResponse }
        let envelope = try Contracts.parseEnvelope(command)
        return RedeemResponse(status: status, envelope: envelope, accountLabel: r["accountLabel"]?.stringValue, origin: r["origin"]?.stringValue)
    }
    public func progress(commandId: String, state: ExecutionState, index: Int, credential: DeviceCredential) throws -> (proceed: Bool, reason: String?) {
        let r = try call("progress", .object(["commandId": .string(commandId), "state": .string(state.rawValue), "index": .int(index)]), credential: credential)
        guard let c = r["continue"]?.boolValue else { throw BackendError.invalidResponse }
        return (c, r["reason"]?.stringValue)
    }
    public func finish(_ result: CommandResult, credential: DeviceCredential) throws { _ = try call("finish", result.json, credential: credential) }
    public func unpair(credential: DeviceCredential) throws { _ = try call("unpair", .object([:]), credential: credential) }
}

/// Lock-protected hand-off from URLSession's delegate queue to the waiting caller.
final class ResponseBox: @unchecked Sendable {
    private let lock = NSLock()
    private var value: (Data?, URLResponse?, Error?) = (nil, nil, nil)
    func set(_ d: Data?, _ r: URLResponse?, _ e: Error?) { lock.lock(); value = (d, r, e); lock.unlock() }
    func get() -> (Data?, URLResponse?, Error?) { lock.lock(); defer { lock.unlock() }; return value }
}
