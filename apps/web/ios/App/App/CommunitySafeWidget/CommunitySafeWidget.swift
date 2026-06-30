import WidgetKit
import SwiftUI

// MARK: - Data Model
struct SafetyWidgetData: Codable {
    let grade: String       // "A", "B", "C", "D", "F"
    let city: String
    let neighborhood: String
    let score: Double       // 0–100
    let incidentCount: Int
    let updatedAt: Date

    static let placeholder = SafetyWidgetData(
        grade: "A",
        city: "San Francisco",
        neighborhood: "Mission District",
        score: 78.5,
        incidentCount: 3,
        updatedAt: Date()
    )
}

// MARK: - API Fetch
func fetchSafetyData() async -> SafetyWidgetData {
    // Read preferred city slug from shared UserDefaults
    let defaults = UserDefaults(suiteName: "group.app.communitysafe") ?? UserDefaults.standard
    let citySlug = defaults.string(forKey: "preferred_city") ?? "san-francisco"

    guard let url = URL(string: "https://communitysafe-api-production.up.railway.app/api/safety/score?city=\(citySlug)") else {
        return .placeholder
    }

    do {
        let (data, _) = try await URLSession.shared.data(from: url)
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]

        let grade = json?["grade"] as? String ?? "?"
        let score = json?["score"] as? Double ?? 0
        let cityName = json?["cityLabel"] as? String ?? citySlug

        return SafetyWidgetData(
            grade: grade,
            city: cityName,
            neighborhood: "City Average",
            score: score,
            incidentCount: json?["recentIncidents"] as? Int ?? 0,
            updatedAt: Date()
        )
    } catch {
        return .placeholder
    }
}

// MARK: - Timeline Provider
struct SafetyProvider: TimelineProvider {
    func placeholder(in context: Context) -> SafetyEntry {
        SafetyEntry(date: Date(), data: .placeholder)
    }

    func getSnapshot(in context: Context, completion: @escaping (SafetyEntry) -> Void) {
        Task {
            let data = context.isPreview ? .placeholder : await fetchSafetyData()
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

// MARK: - Widget Entry View
struct CommunitySafeWidgetEntryView: View {
    @Environment(\.widgetFamily) var family
    let entry: SafetyEntry

    var body: some View {
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

