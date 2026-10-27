// aegir-reminders: reads and completes Apple Reminders for Aegir through EventKit.
// Apple's scripting bridge takes minutes to list a busy Reminders list; EventKit takes milliseconds.
//
//   aegir-reminders status                 {"ok":true,"access":"granted"}
//   aegir-reminders list <list name>       {"ok":true,"reminders":[{"id","externalId","title","notes","due","dueTime",
//                                            "created","modified","url","priority","recurring","hasAlarms","locationAlarm"}]}
//   aegir-reminders complete <identifier>  {"ok":true,"completed":true}
//
// Every command prints one JSON object. Failures print {"ok":false,"code","error"} and exit 1.
// Codes: usage, denied, timeout, noList, notFound, saveFailed.
import EventKit
import Foundation

func emit(_ object: [String: Any], exitCode: Int32 = 0) -> Never {
  let data = (try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])) ?? Data("{\"ok\":false,\"code\":\"encoding\",\"error\":\"Could not encode output\"}".utf8)
  FileHandle.standardOutput.write(data)
  FileHandle.standardOutput.write(Data("\n".utf8))
  exit(exitCode)
}

func fail(_ code: String, _ message: String) -> Never {
  emit(["ok": false, "code": code, "error": message], exitCode: 1)
}

func accessState() -> String {
  switch EKEventStore.authorizationStatus(for: .reminder) {
  case .fullAccess: return "granted"
  case .writeOnly: return "writeOnly"
  case .denied: return "denied"
  case .restricted: return "restricted"
  case .notDetermined: return "notDetermined"
  @unknown default: return "unknown"
  }
}

// Asks once (macOS shows its own prompt, attributed to Aegir), then returns a store that can read.
func readyStore() -> EKEventStore {
  if accessState() != "granted" {
    let semaphore = DispatchSemaphore(value: 0)
    var granted = false
    EKEventStore().requestFullAccessToReminders { ok, _ in
      granted = ok
      semaphore.signal()
    }
    if semaphore.wait(timeout: .now() + 300) == .timedOut {
      fail("timeout", "Timed out waiting for the Reminders permission prompt.")
    }
    if !granted {
      fail("denied", "Aegir has no access to Reminders. Allow it in System Settings, Privacy & Security, Reminders.")
    }
  }
  return EKEventStore()
}

let arguments = Array(CommandLine.arguments.dropFirst())
guard let command = arguments.first else {
  fail("usage", "Usage: aegir-reminders status | list <list name> | complete <identifier>")
}

switch command {
case "status":
  emit(["ok": true, "access": accessState()])

case "list":
  guard arguments.count == 2, !arguments[1].isEmpty else { fail("usage", "list needs exactly one list name") }
  let store = readyStore()
  let calendars = store.calendars(for: .reminder).filter { $0.title == arguments[1] }
  if calendars.isEmpty { fail("noList", "There is no Reminders list named \(arguments[1]).") }
  if calendars.count > 1 { fail("ambiguousList", "More than one Reminders list has this name. Choose a unique list name.") }
  let predicate = store.predicateForIncompleteReminders(withDueDateStarting: nil, ending: nil, calendars: calendars)
  let semaphore = DispatchSemaphore(value: 0)
  var found: [EKReminder] = []
  store.fetchReminders(matching: predicate) { reminders in
    found = reminders ?? []
    semaphore.signal()
  }
  if semaphore.wait(timeout: .now() + 60) == .timedOut { fail("timeout", "Reading Reminders took more than a minute.") }
  let iso = ISO8601DateFormatter()
  let rows: [[String: Any]] = found.map { reminder in
    var row: [String: Any] = [
      "id": reminder.calendarItemIdentifier,
      "title": reminder.title ?? "",
      "notes": reminder.notes ?? "",
      "priority": reminder.priority,
      "recurring": reminder.hasRecurrenceRules,
      // An alert is why a reminder exists in the first place; ticking it off would silence it.
      "hasAlarms": reminder.hasAlarms,
      "locationAlarm": (reminder.alarms ?? []).contains { $0.structuredLocation != nil },
    ]
    // Survives a full re-sync of the account better than calendarItemIdentifier does.
    if let external = reminder.calendarItemExternalIdentifier, !external.isEmpty { row["externalId"] = external }
    // Due dates are floating calendar dates; read the components, not an instant, so time zones can't shift the day.
    if let parts = reminder.dueDateComponents, let year = parts.year, let month = parts.month, let day = parts.day {
      row["due"] = String(format: "%04d-%02d-%02d", year, month, day)
      if let hour = parts.hour, let minute = parts.minute {
        row["dueTime"] = String(format: "%02d:%02d", hour, minute)
        // The exact moment the alert is due, in the reminder's own time zone when it has one.
        var moment = parts
        if moment.timeZone == nil { moment.timeZone = reminder.timeZone ?? TimeZone.current }
        if let date = Calendar(identifier: .gregorian).date(from: moment) { row["dueInstant"] = iso.string(from: date) }
      }
    }
    if let created = reminder.creationDate { row["created"] = iso.string(from: created) }
    if let modified = reminder.lastModifiedDate ?? reminder.creationDate { row["modified"] = iso.string(from: modified) }
    if let url = reminder.url { row["url"] = url.absoluteString }
    return row
  }
  emit(["ok": true, "reminders": rows])

case "complete":
  guard arguments.count == 2, !arguments[1].isEmpty else { fail("usage", "complete needs exactly one identifier") }
  let store = readyStore()
  guard let reminder = store.calendarItem(withIdentifier: arguments[1]) as? EKReminder else {
    fail("notFound", "No reminder with that identifier.")
  }
  if reminder.isCompleted { emit(["ok": true, "completed": false]) }
  reminder.isCompleted = true
  do {
    try store.save(reminder, commit: true)
  } catch {
    fail("saveFailed", "Could not complete the reminder: \(error.localizedDescription)")
  }
  emit(["ok": true, "completed": true])

default:
  fail("usage", "Unknown command \(command). Use status, list or complete.")
}
