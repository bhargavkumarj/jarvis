import XCTest
@testable import JarvisCompanionCore

/// Same fixture file as tests/unit/computer-contracts.test.ts (TypeScript).
final class ContractFixtureTests: XCTestCase {
    static let fixtureURL = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        .deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("packages/computer-control-contracts/fixtures/contract-cases.json")
    lazy var fixtures: [String: JSONValue] = try! JSON.parse(Data(contentsOf: Self.fixtureURL)).objectValue!

    func code(_ body: () throws -> Any) -> String {
        do { _ = try body(); return "ok" } catch let e as ContractError { return e.code } catch { return "unexpected" }
    }
    func testDigestAgreement() throws {
        for case .object(let d) in fixtures["digest"]!.arrayValue! {
            let actions = try Contracts.parseActions(d["actions"])
            let canonical = Canonical.command(deviceId: d["deviceId"]!.stringValue!, commandId: d["commandId"]!.stringValue!, actions: actions)
            XCTAssertEqual(canonical, d["canonical"]!.stringValue!)
            XCTAssertEqual(SHA256.hex(Array(canonical.utf8)), d["sha256"]!.stringValue!)
        }
    }
    func testActions() {
        for a in fixtures["validActions"]!.arrayValue! { XCTAssertEqual(code { try Contracts.parseAction(a) }, "ok", "\(a)") }
        for case .object(let c) in fixtures["invalidActions"]!.arrayValue! { XCTAssertEqual(code { try Contracts.parseAction(c["value"]!) }, c["code"]!.stringValue!, "\(c)") }
    }
    func testEnvelopes() {
        for e in fixtures["validEnvelopes"]!.arrayValue! { XCTAssertEqual(code { try Contracts.parseEnvelope(e) }, "ok") }
        for case .object(let c) in fixtures["invalidEnvelopes"]!.arrayValue! { XCTAssertEqual(code { try Contracts.parseEnvelope(c["value"]!) }, c["code"]!.stringValue!, "\(c["code"]!)") }
    }
    func testResults() throws {
        for r in fixtures["validResults"]!.arrayValue! {
            XCTAssertEqual(code { try Contracts.parseCommandResult(r) }, "ok")
            // Round trip: what Swift emits, TypeScript's parser accepts (same keys/format).
            let parsed = try Contracts.parseCommandResult(r)
            XCTAssertEqual(code { try Contracts.parseCommandResult(parsed.json) }, "ok")
            XCTAssertEqual(parsed.json, r)
        }
        for case .object(let c) in fixtures["invalidResults"]!.arrayValue! { XCTAssertEqual(code { try Contracts.parseCommandResult(c["value"]!) }, c["code"]!.stringValue!, "\(c["code"]!)") }
    }
    func testCatalogue() throws {
        for e in fixtures["validCatalogue"]!.arrayValue! {
            XCTAssertEqual(code { try Contracts.parseCatalogueEntry(e) }, "ok")
            XCTAssertEqual(try Contracts.parseCatalogueEntry(e).json, e)
        }
        for case .object(let c) in fixtures["invalidCatalogue"]!.arrayValue! { XCTAssertEqual(code { try Contracts.parseCatalogueEntry(c["value"]!) }, c["code"]!.stringValue!, "\(c["code"]!)") }
    }
    func testWebsites() {
        let w = fixtures["websites"]!.objectValue!
        for case .array(let pair) in w["valid"]!.arrayValue! { XCTAssertEqual(Patterns.websiteHost(pair[0].stringValue!), pair[1].stringValue!) }
        for u in w["invalid"]!.arrayValue! { XCTAssertNil(Patterns.websiteHost(u.stringValue!), u.stringValue!) }
        XCTAssertNil(Patterns.websiteHost("https://example.com/\n"))
        XCTAssertFalse(Patterns.isAlias("safari\n"), "a trailing newline must not satisfy an anchored pattern")
    }
    func testFrames() {
        for case .object(let f) in fixtures["frames"]!.arrayValue! {
            let hex = f["hex"]!.stringValue!
            var bytes = [UInt8]()
            var i = hex.startIndex
            while i < hex.endIndex { let j = hex.index(i, offsetBy: 2); bytes.append(UInt8(hex[i..<j], radix: 16)!); i = j }
            let reader = FrameReader(source: DataSource(Data(bytes)))
            let outcome: String
            do { _ = try reader.next(); outcome = "ok" }
            catch FrameError.tooLarge { outcome = "too_large" }
            catch FrameError.truncated { outcome = "truncated" }
            catch FrameError.empty { outcome = "empty" }
            catch FrameError.invalidJSON { outcome = "invalid_json" }
            catch { outcome = "other" }
            XCTAssertEqual(outcome, f["expect"]!.stringValue!, f["name"]!.stringValue!)
        }
    }
    func testSHA256NISTVectors() {
        XCTAssertEqual(SHA256.hex([]), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
        XCTAssertEqual(SHA256.hex(Array("abc".utf8)), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
        XCTAssertEqual(SHA256.hex(Array("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq".utf8)), "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1")
        XCTAssertEqual(SHA256.hex([UInt8](repeating: 0x61, count: 1_000_000)), "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0")
    }
    func testFrameWriterRoundTrip() throws {
        var out = Data()
        FrameWriter { out.append($0) }.write(.object(["v": .int(1), "name": .string("status")]))
        XCTAssertEqual(try FrameReader(source: DataSource(out)).next(), ["v": .int(1), "name": .string("status")])
        XCTAssertThrowsError(try FrameReader(source: DataSource(Data())).next()) { XCTAssertEqual($0 as? FrameError, .endOfStream) }
    }
    func testRandomTokenShape() {
        let a = RandomToken.make(), b = RandomToken.make()
        XCTAssertTrue(Patterns.isToken(a)); XCTAssertNotEqual(a, b)
    }
}
