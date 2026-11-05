// Standalone installation proof. Run outside both app bundles; never modifies userData.
import Foundation
import Darwin

struct Receipt: Codable {
    let target: String
    let candidate: String
    let backup: String
    var phase: String
}
struct UpdateError: Error, CustomStringConvertible {
    let description: String
    init(_ message: String) { description = message }
}
let fm = FileManager.default
func require(_ condition: Bool, _ message: String) throws {
    if !condition { throw UpdateError(message) }
}
func exists(_ path: String) -> Bool { fm.fileExists(atPath: path) }
func canonical(_ path: String) throws -> String {
    try require(path.hasPrefix("/") && !path.split(separator: "/").contains("..") && !path.split(separator: "/").contains(".") && !path.contains("//") && !path.hasSuffix("/"), "Use an absolute, normalized path")
    let check = exists(path) ? path : (path as NSString).deletingLastPathComponent
    guard let resolved = realpath(check, nil) else { throw UpdateError("Installation parent does not exist") }
    defer { free(resolved) }
    try require(String(cString: resolved) == check, "Symlinked installation paths are unsupported; use the resolved path")
    return path
}
func bundleID(_ path: String) throws -> String {
    let info = URL(fileURLWithPath: path).appendingPathComponent("Contents/Info.plist")
    let object = try PropertyListSerialization.propertyList(from: Data(contentsOf: info), format: nil)
    guard let values = object as? [String: Any], let id = values["CFBundleIdentifier"] as? String,
          let executable = values["CFBundleExecutable"] as? String else { throw UpdateError("Invalid application bundle") }
    try require(!executable.contains("/") && executable != "." && executable != "..", "Invalid executable name")
    try require(fm.isExecutableFile(atPath: path + "/Contents/MacOS/" + executable), "Missing application executable")
    return id
}
func save(_ receipt: Receipt, _ journal: String) throws {
    try JSONEncoder().encode(receipt).write(to: URL(fileURLWithPath: journal), options: .atomic)
}
func load(_ journal: String) throws -> Receipt {
    let receipt = try JSONDecoder().decode(Receipt.self, from: Data(contentsOf: URL(fileURLWithPath: journal)))
    _ = try canonical(receipt.target)
    try require(receipt.candidate == receipt.target + ".aegir-update-new" && receipt.backup == receipt.target + ".aegir-update-old", "Invalid transaction paths")
    _ = try canonical(receipt.candidate)
    _ = try canonical(receipt.backup)
    try require(["staging", "waiting", "replacing", "installed"].contains(receipt.phase), "Invalid transaction phase")
    try require(journal == receipt.target + ".aegir-update.json", "Invalid transaction journal")
    return receipt
}
func copyBundle(_ source: String, _ destination: String) throws {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/ditto")
    process.arguments = [source, destination]
    try process.run(); process.waitUntilExit()
    try require(process.terminationStatus == 0, "Could not stage application")
}
func run(_ args: [String]) throws {
    guard let command = args.first else { throw UpdateError("Usage: aegir-updater install <target.app> <staged.app> <exited-pid> | recover <journal> | confirm <journal>") }
    if command == "install" {
        try require(args.count == 4, "install requires target, staged bundle and PID")
        let target = try canonical(args[1]), source = try canonical(args[2])
        try require(target.hasSuffix(".app") && source.hasSuffix(".app") && target != source, "Use distinct .app bundles")
        try require(!source.hasPrefix(target + "/") && !target.hasPrefix(source + "/"), "Bundles must not overlap")
        try require(try bundleID(target) == "dev.personal.aegir", "Target must be Aegir")
        try require(try bundleID(source) == "dev.personal.aegir", "Candidate must be Aegir")
        guard let pid = Int32(args[3]), pid > 1, pid != getpid() else { throw UpdateError("Invalid parent PID") }
        let journal = target + ".aegir-update.json"
        var receipt = Receipt(target: target, candidate: target + ".aegir-update-new", backup: target + ".aegir-update-old", phase: "staging")
        try require(!exists(journal) && !exists(receipt.candidate) && !exists(receipt.backup), "An earlier update needs recovery or confirmation")
        try require(fm.isWritableFile(atPath: URL(fileURLWithPath: target).deletingLastPathComponent().path), "Installation folder is not writable")
        try save(receipt, journal)
        try copyBundle(source, receipt.candidate)
        _ = try bundleID(receipt.candidate)
        receipt.phase = "waiting"; try save(receipt, journal)
        let deadline = Date().addingTimeInterval(30)
        while kill(pid, 0) == 0 || errno == EPERM {
            try require(Date() < deadline, "Aegir did not exit; original app is unchanged")
            Thread.sleep(forTimeInterval: 0.1)
        }
        // Persist intent before moving anything. Recovery uses actual paths if interrupted.
        receipt.phase = "replacing"; try save(receipt, journal)
        try fm.moveItem(atPath: target, toPath: receipt.backup)
        try fm.moveItem(atPath: receipt.candidate, toPath: target)
        receipt.phase = "installed"; try save(receipt, journal)
        print("Installed. Launch and verify Aegir before confirming. Journal: \(journal)")
    } else {
        try require(args.count == 2 && ["recover", "confirm"].contains(command), "Expected recover or confirm with journal")
        let journal = try canonical(args[1]), receipt = try load(journal)
        // Operator must close all copies first. This proof deliberately does not guess process ownership.
        if command == "recover" {
            if exists(receipt.backup) {
                if exists(receipt.target) {
                    try require(!exists(receipt.candidate), "Ambiguous transaction; inspect paths before recovery")
                    try fm.moveItem(atPath: receipt.target, toPath: receipt.candidate)
                }
                try fm.moveItem(atPath: receipt.backup, toPath: receipt.target)
            }
            try require(exists(receipt.target), "No original application available")
            if exists(receipt.candidate) { try fm.removeItem(atPath: receipt.candidate) }
        } else {
            try require(receipt.phase == "installed" && exists(receipt.target) && !exists(receipt.candidate), "Update is not ready to confirm")
            _ = try bundleID(receipt.target)
            if exists(receipt.backup) { try fm.removeItem(atPath: receipt.backup) }
        }
        try fm.removeItem(atPath: journal)
        print(command == "recover" ? "Original app restored" : "Update confirmed")
    }
}
do { try run(Array(CommandLine.arguments.dropFirst())) }
catch { FileHandle.standardError.write(Data("\(error)\n".utf8)); exit(1) }
