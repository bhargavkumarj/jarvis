import JarvisCompanionCore
#if os(macOS)
CompanionMain.run(CommandLine.arguments)
#else
// The executable's adapters (NSWorkspace, CoreAudio, Keychain, AppKit) exist only on macOS.
// On other platforms only JarvisCompanionCore and its tests are built.
print("jarvis-companion runs only on macOS. Core library \(Protocol1.nativeHostName) protocol v\(Protocol1.version) built for tests.")
#endif
