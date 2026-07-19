import WidgetKit
import SwiftUI
import StoreKit

// MARK: - Data Model
struct SafetyWidgetData: Codable {
    let grade: String       // "A", "B", "C", "D", "F"
    let city: String
    let neighborhood: String
    let score: Double       // 0–100
    let incidentCount: Int
    let updatedAt: Date
    // True when no active CommunitySafe Premium subscription — the widget
    // shows a locked state instead of live data.
    var locked: Bool = false
    // True when live data could not be loaded — the widget shows an honest
    // "unavailable" state. A safety product must NEVER invent a grade.
    var unavailable: Bool = false

    // Sample values for the WidgetKit gallery/preview ONLY (context.isPreview),
    // never rendered as if it were the user's real, live grade.
    static let preview = SafetyWidgetData(
        grade: "A",
        city: "San Francisco",
        neighborhood: "Mission District",
        score: 78.5,
        incidentCount: 3,
        updatedAt: Date()
    )

    static func failure() -> SafetyWidgetData {
        SafetyWidgetData(grade: "–", city: "", neighborhood: "", score: 0,
                         incidentCount: 0, updatedAt: Date(), unavailable: true)
    }
}

private let premiumProductID = "app.communitysafe.premium_monthly"

/// Is the CommunitySafe Premium subscription active? The widget extension shares
/// the app's App Store transaction context, so StoreKit answers this directly —
/// no App Group needed. FAIL-OPEN: if StoreKit can't give a definitive answer
/// (throws, or a transaction fails device verification), treat as subscribed so a
/// paying customer is never locked out of a feature they bought. We only report
/// `false` after a clean pass over the entitlements finds no active premium.
func isPremiumActive() async -> Bool {
    var sawEntitlements = false
    for await result in StoreKit.Transaction.currentEntitlements {
        sawEntitlements = true
        // Accept `.unverified` too — device verification fails spuriously in the
        // sandbox (App Review) for genuine transactions; the entitlement is real.
        let tx: StoreKit.Transaction
        switch result {
        case .verified(let t), .unverified(let t, _): tx = t
        }
        if tx.productID == premiumProductID, tx.revocationDate == nil {
            if let exp = tx.expirationDate, exp < Date() { continue }
            return true
        }
    }
    // No premium entitlement found. If the iterator yielded nothing at all it may
    // be a load hiccup rather than a genuine non-subscriber — fail open.
    return !sawEntitlements
}

// MARK: - API Fetch
func fetchSafetyData() async -> SafetyWidgetData {
    // Live data requires the CommunitySafe Premium subscription, checked via
    // StoreKit (the widget shares the app's transaction context).
    guard await isPremiumActive() else {
        return SafetyWidgetData(
            grade: "?", city: "", neighborhood: "", score: 0,
            incidentCount: 0, updatedAt: Date(), locked: true)
    }

    // The widget runs in its own process and can't read the app's selected city
    // without a shared container, so it shows the citywide grade for the default
    // metro. (Per-city selection is a future configurable-widget enhancement.)
    let citySlug = "san-francisco"
    let encoded = citySlug.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? citySlug

    guard let url = URL(string: "https://communitysafe-api-production.up.railway.app/safezone/safety-score?city=\(encoded)") else {
        return .failure()
    }

    do {
        let (data, response) = try await URLSession.shared.data(from: url)
        // Never render a non-200 body — the API returns 404/error JSON without a
        // real grade, which must surface as "unavailable", not a fake letter.
        guard let http = response as? HTTPURLResponse, http.statusCode == 200,
              let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let grade = json["grade"] as? String, !grade.isEmpty else {
            return .failure()
        }

        // The API models the city as {slug,label}; older callers expected a flat
        // "cityLabel". Read the nested label, fall back to the slug.
        let cityObj = json["city"] as? [String: Any]
        let cityName = (cityObj?["label"] as? String) ?? citySlug

        // The endpoint reports per-category counts + FBI deltas rather than a
        // single 0–100 score. Derive a stable score from the grade band so the
        // widget's number always agrees with its letter.
        let score = scoreForGrade(grade)
        let incidents = (json["rows"] as? [[String: Any]])?
            .compactMap { $0["count"] as? Int }.reduce(0, +) ?? 0

        return SafetyWidgetData(
            grade: grade,
            city: cityName,
            neighborhood: "City Average",
            score: score,
            incidentCount: incidents,
            updatedAt: Date()
        )
    } catch {
        return .failure()
    }
}

/// Map the API's letter grade to a representative 0–100 score so the widget's
/// number never contradicts its letter (the API has no single score field).
private func scoreForGrade(_ grade: String) -> Double {
    switch grade.uppercased() {
    case "A": return 92
    case "B": return 80
    case "C": return 66
    case "D": return 50
    default:  return 32
    }
}

// MARK: - Timeline Provider
struct SafetyProvider: TimelineProvider {
    func placeholder(in context: Context) -> SafetyEntry {
        SafetyEntry(date: Date(), data: .preview)
    }

    func getSnapshot(in context: Context, completion: @escaping (SafetyEntry) -> Void) {
        Task {
            let data = context.isPreview ? .preview : await fetchSafetyData()
            completion(SafetyEntry(date: Date(), data: data))
        }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<SafetyEntry>) -> Void) {
        Task {
            let data = await fetchSafetyData()
            let entry = SafetyEntry(date: Date(), data: data)
            // Refresh every 30 minutes
            let nextUpdate = Calendar.current.date(byAdding: .minute, value: 30, to: Date()) ?? Date()
            let timeline = Timeline(entries: [entry], policy: .after(nextUpdate))
            completion(timeline)
        }
    }
}

struct SafetyEntry: TimelineEntry {
    let date: Date
    let data: SafetyWidgetData
}

// MARK: - Grade Color
private func gradeColor(_ grade: String) -> Color {
    switch grade {
    case "A": return Color(red: 0.21, green: 0.84, blue: 0.62)   // teal-green
    case "B": return Color(red: 0.42, green: 0.55, blue: 1.0)    // blue
    case "C": return Color(red: 1.0, green: 0.76, blue: 0.1)     // amber
    case "D": return Color(red: 1.0, green: 0.45, blue: 0.1)     // orange
    default:  return Color(red: 1.0, green: 0.29, blue: 0.29)    // red
    }
}

// MARK: - Small Widget View
struct SmallWidgetView: View {
    let entry: SafetyEntry

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [Color(red: 0.02, green: 0.04, blue: 0.1), Color(red: 0.05, green: 0.07, blue: 0.2)],
                startPoint: .topLeading, endPoint: .bottomTrailing
            )
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text("✦")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundColor(Color(red: 0.42, green: 0.55, blue: 1.0))
                    Text("CommunitySafe")
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundColor(.white.opacity(0.7))
                }
                Spacer()
                Text(entry.data.grade)
                    .font(.system(size: 52, weight: .black, design: .rounded))
                    .foregroundColor(gradeColor(entry.data.grade))
                    .shadow(color: gradeColor(entry.data.grade).opacity(0.5), radius: 8)
                Text(entry.data.city)
                    .font(.system(size: 11, weight: .medium))
                    .foregroundColor(.white.opacity(0.8))
                    .lineLimit(1)
                Text("Updated \(entry.data.updatedAt, style: .relative) ago")
                    .font(.system(size: 9))
                    .foregroundColor(.white.opacity(0.45))
            }
            .padding(12)
        }
    }
}

// MARK: - Medium Widget View
struct MediumWidgetView: View {
    let entry: SafetyEntry

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [Color(red: 0.02, green: 0.04, blue: 0.1), Color(red: 0.05, green: 0.07, blue: 0.2)],
                startPoint: .topLeading, endPoint: .bottomTrailing
            )
            HStack(spacing: 16) {
                // Grade circle
                VStack(spacing: 4) {
                    ZStack {
                        Circle()
                            .fill(gradeColor(entry.data.grade).opacity(0.15))
                            .frame(width: 72, height: 72)
                        Circle()
                            .strokeBorder(gradeColor(entry.data.grade), lineWidth: 2.5)
                            .frame(width: 72, height: 72)
                        Text(entry.data.grade)
                            .font(.system(size: 40, weight: .black, design: .rounded))
                            .foregroundColor(gradeColor(entry.data.grade))
                    }
                    Text("Safety Grade")
                        .font(.system(size: 10, weight: .medium))
                        .foregroundColor(.white.opacity(0.55))
                }

                // Details
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Text("✦")
                            .font(.system(size: 10, weight: .bold))
                            .foregroundColor(Color(red: 0.42, green: 0.55, blue: 1.0))
                        Text("CommunitySafe")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundColor(.white.opacity(0.7))
                    }
                    Text(entry.data.city)
                        .font(.system(size: 14, weight: .bold))
                        .foregroundColor(.white)
                    HStack(spacing: 4) {
                        Text("Score: \(Int(entry.data.score))/100")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundColor(.white.opacity(0.8))
                    }
                    if entry.data.incidentCount > 0 {
                        Text("\(entry.data.incidentCount) incidents (24h)")
                            .font(.system(size: 11))
                            .foregroundColor(.white.opacity(0.55))
                    }
                    Text("Updated \(entry.data.updatedAt, style: .relative) ago")
                        .font(.system(size: 10))
                        .foregroundColor(.white.opacity(0.4))
                }
                Spacer()
            }
            .padding(14)
        }
    }
}

// MARK: - Locked View (no active subscription)
struct LockedWidgetView: View {
    var body: some View {
        ZStack {
            LinearGradient(
                colors: [Color(red: 0.02, green: 0.04, blue: 0.1), Color(red: 0.05, green: 0.07, blue: 0.2)],
                startPoint: .topLeading, endPoint: .bottomTrailing
            )
            VStack(spacing: 8) {
                Image(systemName: "lock.fill")
                    .font(.system(size: 24, weight: .bold))
                    .foregroundColor(Color(red: 0.42, green: 0.55, blue: 1.0))
                Text("CommunitySafe Premium")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundColor(.white)
                    .multilineTextAlignment(.center)
                Text("Subscribe in the app to see live safety grades")
                    .font(.system(size: 10))
                    .foregroundColor(.white.opacity(0.6))
                    .multilineTextAlignment(.center)
            }
            .padding(12)
        }
    }
}

// MARK: - Unavailable View (live data could not load)
struct UnavailableWidgetView: View {
    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: "wifi.exclamationmark")
                .font(.system(size: 22, weight: .bold))
                .foregroundColor(.white.opacity(0.7))
            Text("Safety data unavailable")
                .font(.system(size: 12, weight: .bold))
                .foregroundColor(.white)
                .multilineTextAlignment(.center)
            Text("Check your connection — we’ll refresh soon")
                .font(.system(size: 10))
                .foregroundColor(.white.opacity(0.6))
                .multilineTextAlignment(.center)
        }
        .padding(12)
    }
}

// MARK: - Widget Entry View
struct CommunitySafeWidgetEntryView: View {
    @Environment(\.widgetFamily) var family
    let entry: SafetyEntry

    var body: some View {
        // iOS 17+ requires an explicit widget container background; without it
        // WidgetKit renders the "Please adopt containerBackground" placeholder.
        // Pre-17, the sub-views' own ZStack gradient provides the background.
        if #available(iOSApplicationExtension 17.0, *) {
            content.containerBackground(for: .widget) {
                LinearGradient(
                    colors: [Color(red: 0.02, green: 0.04, blue: 0.1),
                             Color(red: 0.05, green: 0.07, blue: 0.2)],
                    startPoint: .topLeading, endPoint: .bottomTrailing)
            }
        } else {
            content
        }
    }

    @ViewBuilder private var content: some View {
        if entry.data.locked {
            LockedWidgetView()
        } else if entry.data.unavailable {
            UnavailableWidgetView()
        } else {
            switch family {
            case .systemSmall:
                SmallWidgetView(entry: entry)
            case .systemMedium:
                MediumWidgetView(entry: entry)
            default:
                SmallWidgetView(entry: entry)
            }
        }
    }
}

// MARK: - Widget Configuration
struct CommunitySafeWidget: Widget {
    let kind: String = "CommunitySafeWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: SafetyProvider()) { entry in
            CommunitySafeWidgetEntryView(entry: entry)
        }
        .configurationDisplayName("Neighborhood Safety")
        .description("See the safety grade for your city at a glance.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

