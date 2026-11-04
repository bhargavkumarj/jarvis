// swift-tools-version:5.9
// JARVIS Mac companion: Chrome native-messaging host + local policy/executors.
// JarvisCompanionCore is portable (its tests also run on Linux CI/containers);
// the jarvis-companion executable's macOS adapters compile only on macOS.
import PackageDescription

let package = Package(
    name: "JarvisCompanion",
    platforms: [.macOS(.v13)],
    products: [
        .executable(name: "jarvis-companion", targets: ["JarvisCompanion"]),
        .library(name: "JarvisCompanionCore", targets: ["JarvisCompanionCore"]),
    ],
    targets: [
        .target(name: "JarvisCompanionCore", path: "Sources/JarvisCompanionCore"),
        .executableTarget(name: "JarvisCompanion", dependencies: ["JarvisCompanionCore"], path: "Sources/JarvisCompanion"),
        // Development harness: real HTTP backend + engine + router, FAKE confirmer/executor. Never ships.
        .executableTarget(name: "CompanionE2E", dependencies: ["JarvisCompanionCore"], path: "Sources/CompanionE2E"),
        .testTarget(name: "JarvisCompanionCoreTests", dependencies: ["JarvisCompanionCore"], path: "Tests/JarvisCompanionCoreTests"),
    ]
)
