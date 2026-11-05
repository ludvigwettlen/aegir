// Runs outside the application bundle. No shell interpolation or security-setting changes.
import Foundation
import Darwin

struct Request: Codable {
    let target: String
    let source: String
    let parentPID: Int32
    let token: String
    let root: String
    let userData: String
    let version: String
}
struct Failure: Error, CustomStringConvertible {
    let description: String
    init(_ text: String) { description = text }
}
let fm = FileManager.default
func check(_ condition: Bool, _ text: String) throws { if !condition { throw Failure(text) } }
func exists(_ path: String) -> Bool { fm.fileExists(atPath: path) }
func write(_ text: String, _ path: String) throws { try Data(text.utf8).write(to: URL(fileURLWithPath: path), options: .atomic) }
func text(_ path: String) -> String? { try? String(contentsOfFile: path, encoding: .utf8) }
func resolved(_ path: String) throws -> String {
    guard let pointer = realpath(path, nil) else { throw Failure("An update path is unavailable.") }
    defer { free(pointer) }; return String(cString: pointer)
}
func command(_ binary: String, _ args: [String]) throws {
    let child = Process(); child.executableURL = URL(fileURLWithPath: binary); child.arguments = args
    try child.run(); child.waitUntilExit()
    try check(child.terminationStatus == 0, "Update operation failed: \(binary)")
}
func info(_ path: String) throws -> [String: Any] {
    let data = try Data(contentsOf: URL(fileURLWithPath: path + "/Contents/Info.plist"))
    guard let result = try PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any] else { throw Failure("Invalid app bundle.") }
    try check(result["CFBundleIdentifier"] as? String == "dev.personal.aegir", "Unexpected app identity.")
    try check(result["CFBundleExecutable"] as? String == "Aegir" && fm.isExecutableFile(atPath: path + "/Contents/MacOS/Aegir"), "Missing app executable.")
    return result
}
func processPath(_ pid: Int32) -> String? {
    var buffer = [CChar](repeating: 0, count: 4096)
    guard proc_pidpath(pid, &buffer, UInt32(buffer.count)) > 0 else { return nil }
    return String(cString: buffer)
}
func running(_ target: String, root: String? = nil, token: String? = nil) -> [Int32] {
    var prefixes = [target + "/Contents/"]
    // An explicitly recorded startup path also covers macOS App Translocation.
    if let root = root, let data = try? Data(contentsOf: URL(fileURLWithPath: root + "/started.json")),
       let value = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
       value["token"] as? String == token, let executable = value["executable"] as? String,
       executable.hasPrefix("/"), executable.hasSuffix("/Contents/MacOS/Aegir") {
        prefixes.append(String(executable.dropLast("MacOS/Aegir".count)))
    }
    let count = max(1024, Int(proc_listallpids(nil, 0)) * 2 + 1024)
    var pids = [Int32](repeating: 0, count: min(count, 1000000))
    let found = proc_listallpids(&pids, Int32(pids.count * MemoryLayout<Int32>.size))
    guard found > 0 else { return [] }
    return pids.prefix(Int(found)).filter { pid in
        guard pid > 1, pid != getpid(), let path = processPath(pid) else { return false }
        return prefixes.contains { path.hasPrefix($0) }
    }
}
func terminate(_ pid: Int32, target: String, root: String, token: String, force: Bool) {
    // Recheck membership immediately before signalling to limit PID reuse races.
    if running(target, root: root, token: token).contains(pid) { kill(pid, force ? SIGKILL : SIGTERM) }
}
func launch(_ target: String, token: String?, userData: String) throws {
    var args = ["-n", target, "--args", "--user-data-dir=" + userData]
    if let token = token { args += ["--aegir-update-token", token] }
    try command("/usr/bin/open", args)
}
func perform(_ request: Request) throws {
    let target = try resolved(request.target), source = try resolved(request.source), root = try resolved(request.root)
    let userData = try resolved(request.userData)
    try check(target == request.target && source == request.source && root == request.root && userData == request.userData, "Update paths changed.")
    try check(target.hasSuffix(".app") && source.hasSuffix(".app") && !source.hasPrefix(target + "/") && target != source, "Invalid bundle paths.")
    try check(root.hasPrefix(userData + "/updates/transaction-") && source.hasPrefix(userData + "/updates/download-"), "Invalid staging directory.")
    try check(UUID(uuidString: request.token) != nil && request.parentPID > 1 && request.parentPID != getpid(), "Invalid update request.")
    _ = try info(target)
    try check(try info(source)["CFBundleShortVersionString"] as? String == request.version, "Candidate version mismatch.")
    let candidate = target + ".aegir-update-new", backup = target + ".aegir-update-old"
    let lockPath = target + ".aegir-update.lock"
    let lock = open(lockPath, O_CREAT | O_RDWR | O_NOFOLLOW, S_IRUSR | S_IWUSR)
    try check(lock >= 0, "Installation directory is not writable.")
    defer { close(lock) }
    try check(flock(lock, LOCK_EX | LOCK_NB) == 0, "Another installer is running.")
    let ready = root + "/ready", healthy = root + "/healthy", result = root + "/result.json"
    func report(_ status: String, _ message: String) {
        if let data = try? JSONSerialization.data(withJSONObject: ["status": status, "message": message, "version": request.version, "token": request.token]) {
            try? data.write(to: URL(fileURLWithPath: result), options: .atomic)
        }
    }
    try check(!exists(candidate) && !exists(backup), "An earlier update needs recovery. Previous app backup was retained.")
    try write(request.token, root + "/owns-staging")
    try command("/usr/bin/ditto", [source, candidate])
    _ = try info(candidate)
    try write("prepared", root + "/phase")
    try write(request.token, ready)
    let exitDeadline = Date().addingTimeInterval(90)
    while kill(request.parentPID, 0) == 0 || errno == EPERM {
        if Date() > exitDeadline {
            try? fm.removeItem(atPath: candidate); report("failed", "Aegir did not exit. The installed app was not changed."); return
        }
        Thread.sleep(forTimeInterval: 0.1)
    }
    // The old app writes this marker only after a consistent database backup and normal cleanup.
    guard text(root + "/shutdown-ready") == request.token else {
        try? fm.removeItem(atPath: candidate); report("failed", "Shutdown did not finish safely. Original app retained."); return
    }
    let childrenDeadline = Date().addingTimeInterval(10)
    while !running(target).isEmpty && Date() < childrenDeadline { Thread.sleep(forTimeInterval: 0.1) }
    try check(running(target).isEmpty, "Aegir is still running. Original app retained.")
    let db = userData + "/aegir.sqlite", dbBackup = root + "/aegir.sqlite.backup"
    try check(exists(dbBackup), "Database backup is missing. Original app retained.")
    var movedOriginal = false
    do {
        try write("replacing", root + "/phase")
        try fm.moveItem(atPath: target, toPath: backup); movedOriginal = true
        try fm.moveItem(atPath: candidate, toPath: target)
        try write("starting", root + "/phase")
        try launch(target, token: request.token, userData: userData)
        let deadline = Date().addingTimeInterval(120)
        while Date() < deadline {
            if text(healthy) == request.token {
                try write("confirmed", root + "/phase")
                // Success is durable before cleanup. The new app waits for this result before starting background work.
                report("updated", "Aegir updated successfully to \(request.version).")
                try? fm.removeItem(atPath: backup)
                try? fm.removeItem(atPath: dbBackup)
                return
            }
            Thread.sleep(forTimeInterval: 0.1)
        }
        throw Failure("The updated app did not confirm startup. Restoring the previous version.")
    } catch {
        guard movedOriginal else { throw error }
        // Never restore files/database while a replacement process is still running.
        for pid in running(target, root: root, token: request.token) { terminate(pid, target: target, root: root, token: request.token, force: false) }
        let deadline = Date().addingTimeInterval(10)
        while !running(target, root: root, token: request.token).isEmpty && Date() < deadline { Thread.sleep(forTimeInterval: 0.1) }
        for pid in running(target, root: root, token: request.token) { terminate(pid, target: target, root: root, token: request.token, force: true) }
        Thread.sleep(forTimeInterval: 0.5)
        guard running(target, root: root, token: request.token).isEmpty else {
            report("failed", "Could not stop the replacement app. Previous app and database backups were retained for recovery.")
            return
        }
        if exists(target) { try fm.moveItem(atPath: target, toPath: root + "/failed.app") }
        try fm.moveItem(atPath: backup, toPath: target)
        // No user work was admitted before healthy startup; restoring this backup cannot discard resumed work.
        for suffix in ["-wal", "-shm"] { if exists(db + suffix) { try fm.removeItem(atPath: db + suffix) } }
        let restored = userData + "/aegir.sqlite.update-restore"
        try fm.copyItem(atPath: dbBackup, toPath: restored)
        if exists(db) { try fm.removeItem(atPath: db) }
        try fm.moveItem(atPath: restored, toPath: db)
        try write("rolled-back", root + "/phase")
        report("rolledBack", "The update could not start. Your previous app and pre-update database were restored.")
        try launch(target, token: nil, userData: userData)
    }
}
func recover(_ request: Request, exitingPID: Int32) throws {
    let root = try resolved(request.root), userData = try resolved(request.userData)
    try check(root == request.root && userData == request.userData && root.hasPrefix(userData + "/updates/transaction-"), "Invalid recovery directory.")
    let parent = (request.target as NSString).deletingLastPathComponent
    try check(try resolved(parent) == parent && request.target.hasSuffix(".app") && UUID(uuidString: request.token) != nil, "Invalid recovery target.")
    try check(text(root + "/healthy") != request.token && text(root + "/phase") != "confirmed", "A healthy update cannot be rolled back automatically.")
    let lock = open(request.target + ".aegir-update.lock", O_CREAT | O_RDWR | O_NOFOLLOW, S_IRUSR | S_IWUSR)
    try check(lock >= 0, "Could not open recovery lock.")
    defer { close(lock) }
    try check(flock(lock, LOCK_EX | LOCK_NB) == 0, "An installer is still running. Wait before recovering.")
    try write(request.token, root + "/recovery-ready")
    let deadline = Date().addingTimeInterval(45)
    while kill(exitingPID, 0) == 0 || errno == EPERM {
        try check(Date() < deadline, "Aegir did not exit for recovery.")
        Thread.sleep(forTimeInterval: 0.1)
    }
    try check(running(request.target, root: root, token: request.token).isEmpty, "Close all copies of Aegir before recovery.")
    let backup = request.target + ".aegir-update-old", candidate = request.target + ".aegir-update-new"
    if exists(backup) {
        _ = try info(backup)
        let dbBackup = root + "/aegir.sqlite.backup"
        try check(exists(dbBackup), "Database backup is missing; app backup retained.")
        if exists(request.target) { try fm.moveItem(atPath: request.target, toPath: root + "/interrupted.app") }
        try fm.moveItem(atPath: backup, toPath: request.target)
        let db = userData + "/aegir.sqlite", restored = root + "/restore.sqlite"
        try fm.copyItem(atPath: dbBackup, toPath: restored)
        for suffix in ["-wal", "-shm"] { if exists(db + suffix) { try fm.removeItem(atPath: db + suffix) } }
        // Same userData volume: rename replaces the database atomically.
        try check(rename(restored, db) == 0, "Could not restore database; backup retained.")
    }
    _ = try info(request.target)
    if exists(candidate) { try fm.removeItem(atPath: candidate) }
    try write("rolled-back", root + "/phase")
    let result = try JSONSerialization.data(withJSONObject: ["status": "rolledBack", "message": "An interrupted update was recovered. Previous app and data retained.", "token": request.token])
    try result.write(to: URL(fileURLWithPath: root + "/result.json"), options: .atomic)
    try launch(request.target, token: nil, userData: userData)
}
func discard(_ request: Request) throws {
    let root = try resolved(request.root), userData = try resolved(request.userData)
    try check(root == request.root && root.hasPrefix(userData + "/updates/transaction-"), "Invalid staging directory.")
    let parent = (request.target as NSString).deletingLastPathComponent
    try check(try resolved(parent) == parent && request.target.hasSuffix(".app"), "Invalid target.")
    let lock = open(request.target + ".aegir-update.lock", O_CREAT | O_RDWR | O_NOFOLLOW, S_IRUSR | S_IWUSR)
    try check(lock >= 0, "Could not open staging lock.")
    defer { close(lock) }
    try check(flock(lock, LOCK_EX | LOCK_NB) == 0, "An installer is still using staging.")
    guard text(root + "/owns-staging") == request.token else { return }
    try check(!exists(request.target + ".aegir-update-old") && !["replacing", "starting", "confirmed"].contains(text(root + "/phase") ?? ""), "Replacement already started; use recovery.")
    if exists(request.target + ".aegir-update-new") { try fm.removeItem(atPath: request.target + ".aegir-update-new") }
    try write("cancelled", root + "/phase")
}
let args = CommandLine.arguments
if args.count < 2 || args.count > 4 { fputs("Expected an update request file.\n", stderr); exit(1) }
do {
    let request = try JSONDecoder().decode(Request.self, from: Data(contentsOf: URL(fileURLWithPath: args[1])))
    if args.count == 3 {
        try check(args[2] == "--discard", "Invalid staging command.")
        try discard(request)
    } else if args.count == 4 {
        guard args[2] == "--recover", let pid = Int32(args[3]), pid > 1 && pid != getpid() else { throw Failure("Invalid recovery request.") }
        try recover(request, exitingPID: pid)
    } else { try perform(request) }
} catch { fputs("\(error)\n", stderr); exit(1) }
