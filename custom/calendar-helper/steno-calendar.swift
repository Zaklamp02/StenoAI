// steno-calendar: read the macOS Calendar (EventKit) for StenoAI.
//
// Everything Calendar.app shows is visible here, including Exchange / iCloud /
// Google accounts added in System Settings, with attendees. Output is one JSON
// object on stdout; events use the same shape main.js's normalizeCalendarEvent
// produces for Google and Outlook, plus attendees.
//
//   steno-calendar status
//   steno-calendar request-access
//   steno-calendar events --from 2026-10-16T00:00:00Z --to 2026-10-18T00:00:00Z
//
// Calendar access is attributed to the app that spawns this helper (StenoAI),
// whose Info.plist carries NSCalendarsFullAccessUsageDescription.
import EventKit
import Foundation

let store = EKEventStore()

func emit(_ object: [String: Any]) -> Never {
    let data = (try? JSONSerialization.data(withJSONObject: object, options: [])) ?? Data("{}".utf8)
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data("\n".utf8))
    exit(object["success"] as? Bool == false ? 1 : 0)
}

func fail(_ message: String) -> Never {
    emit(["success": false, "error": message])
}

func authorizationString() -> String {
    switch EKEventStore.authorizationStatus(for: .event) {
    case .fullAccess: return "full"
    case .writeOnly: return "write-only"
    case .denied: return "denied"
    case .restricted: return "restricted"
    case .notDetermined: return "not-determined"
    @unknown default: return "unknown"
    }
}

let iso = ISO8601DateFormatter()
iso.formatOptions = [.withInternetDateTime]

let dayFormatter: DateFormatter = {
    let f = DateFormatter()
    f.calendar = Calendar(identifier: .gregorian)
    f.locale = Locale(identifier: "en_US_POSIX")
    f.dateFormat = "yyyy-MM-dd"
    return f
}()

func localISO(_ date: Date) -> String {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime]
    f.timeZone = TimeZone.current
    return f.string(from: date)
}

func hexColor(_ cg: CGColor?) -> String? {
    guard let cg = cg, let rgb = cg.converted(to: CGColorSpace(name: CGColorSpace.sRGB)!, intent: .defaultIntent, options: nil),
          let c = rgb.components, c.count >= 3 else { return nil }
    return String(format: "#%02x%02x%02x", Int(c[0] * 255), Int(c[1] * 255), Int(c[2] * 255))
}

// Teams / Zoom / Meet / Webex links usually live in the notes or location.
let meetingURLPattern = try! NSRegularExpression(
    pattern: #"https://(?:teams\.microsoft\.com/l/meetup-join|teams\.live\.com/meet|[\w.-]*zoom\.us/(?:j|my)|meet\.google\.com|[\w.-]*webex\.com/(?:meet|join))[^\s<>"']*"#,
    options: [.caseInsensitive])

func meetingURL(_ event: EKEvent) -> String? {
    if let url = event.url?.absoluteString, url.hasPrefix("https://") { return url }
    for text in [event.notes, event.location].compactMap({ $0 }) {
        let range = NSRange(text.startIndex..., in: text)
        if let m = meetingURLPattern.firstMatch(in: text, options: [], range: range),
           let r = Range(m.range, in: text) {
            return String(text[r])
        }
    }
    return nil
}

/// The organiser's own text of an invitation. Teams (and Zoom) append a long
/// join-instructions block after a line of underscores; drop it, the join link
/// is already in meeting_url.
func invitationText(_ notes: String?) -> String? {
    guard let notes = notes else { return nil }
    var kept: [Substring] = []
    for line in notes.split(separator: "\n", omittingEmptySubsequences: false) {
        if line.trimmingCharacters(in: .whitespaces).hasPrefix("__________") { break }
        kept.append(line)
    }
    let text = kept.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
    if text.isEmpty { return nil }
    return text.count > 4000 ? String(text.prefix(4000)) + "…" : text
}

func responseStatus(_ status: EKParticipantStatus) -> String {
    switch status {
    case .accepted: return "accepted"
    case .declined: return "declined"
    case .tentative: return "tentative"
    case .pending: return "needsAction"
    default: return "unknown"
    }
}

func email(_ participant: EKParticipant) -> String? {
    let url = participant.url
    if url.scheme?.lowercased() == "mailto" {
        return url.absoluteString.replacingOccurrences(of: "mailto:", with: "", options: .caseInsensitive)
    }
    return nil
}

func eventDict(_ event: EKEvent) -> [String: Any] {
    var d: [String: Any] = [
        "id": event.calendarItemExternalIdentifier ?? event.eventIdentifier ?? UUID().uuidString,
        "title": event.title ?? "No title",
        "is_all_day": event.isAllDay,
        "calendar": event.calendar.title,
    ]
    // All-day events use date-only strings, like Google's, so the "in a
    // meeting now" matcher skips them.
    if event.isAllDay {
        d["start"] = dayFormatter.string(from: event.startDate)
        d["end"] = dayFormatter.string(from: event.endDate)
    } else {
        d["start"] = localISO(event.startDate)
        d["end"] = localISO(event.endDate)
    }
    if let loc = event.location, !loc.isEmpty { d["location"] = loc }
    if let notes = invitationText(event.notes) { d["description"] = notes }
    if let url = meetingURL(event) { d["meeting_url"] = url }
    if let color = hexColor(event.calendar.cgColor) { d["color"] = color }

    var attendees: [[String: Any]] = []
    var selfStatus: String? = nil
    for p in event.attendees ?? [] {
        if p.participantType == .room || p.participantType == .resource { continue }
        var a: [String: Any] = ["status": responseStatus(p.participantStatus)]
        if let name = p.name, !name.isEmpty { a["name"] = name }
        if let mail = email(p) { a["email"] = mail }
        if p.isCurrentUser { a["self"] = true; selfStatus = responseStatus(p.participantStatus) }
        if a["name"] != nil || a["email"] != nil { attendees.append(a) }
    }
    if let organizer = event.organizer {
        if organizer.isCurrentUser { selfStatus = selfStatus ?? "organizer" }
        var o: [String: Any] = [:]
        if let name = organizer.name, !name.isEmpty { o["name"] = name }
        if let mail = email(organizer) { o["email"] = mail }
        if !o.isEmpty { d["organizer"] = o }
    }
    d["attendees"] = attendees
    d["response_status"] = selfStatus ?? (attendees.isEmpty ? "organizer" : "unknown")
    return d
}

func argument(_ name: String) -> String? {
    let args = CommandLine.arguments
    guard let i = args.firstIndex(of: name), i + 1 < args.count else { return nil }
    return args[i + 1]
}

let command = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "status"

switch command {
case "status":
    emit(["success": true, "authorization": authorizationString()])

case "request-access":
    if authorizationString() == "full" {
        emit(["success": true, "authorization": "full"])
    }
    let done = DispatchSemaphore(value: 0)
    var granted = false
    var errorText: String? = nil
    store.requestFullAccessToEvents { ok, error in
        granted = ok
        errorText = error?.localizedDescription
        done.signal()
    }
    // The system prompt waits for the user; give them time to answer.
    if done.wait(timeout: .now() + 120) == .timedOut {
        fail("Timed out waiting for calendar permission")
    }
    var result: [String: Any] = ["success": true, "granted": granted, "authorization": authorizationString()]
    if let errorText = errorText { result["error"] = errorText }
    emit(result)

case "events":
    guard authorizationString() == "full" else {
        emit(["success": false, "error": "Calendar access not granted", "authorization": authorizationString()])
    }
    let now = Date()
    let from = argument("--from").flatMap { iso.date(from: $0) } ?? now.addingTimeInterval(-24 * 3600)
    let to = argument("--to").flatMap { iso.date(from: $0) } ?? now.addingTimeInterval(7 * 24 * 3600)
    let calendars = store.calendars(for: .event)
    let predicate = store.predicateForEvents(withStart: from, end: to, calendars: calendars)
    let events = store.events(matching: predicate)
        .filter { $0.status != .canceled }
        .sorted { $0.startDate < $1.startDate }
        .map(eventDict)
    emit(["success": true, "events": events])

default:
    fail("Unknown command: \(command)")
}
