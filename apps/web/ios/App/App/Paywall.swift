import Combine
import StoreKit
import SwiftUI
import UIKit
import WidgetKit

@MainActor
final class PremiumManager: ObservableObject {
    static let productID = "app.communitysafe.premium_monthly"

    // Mirrored into the shared App Group so the widget can gate its
    // content on the subscription too.
    @Published private(set) var isPremium = false {
        didSet { Self.syncWidgetEntitlement(isPremium) }
    }
    @Published private(set) var isLoading = true
    @Published var product: Product?
    // Non-nil only when the intro offer is a free trial AND this Apple Account
    // is still eligible for it — advertising a trial the user can't get is
    // itself a 3.1.2 violation.
    @Published private(set) var trialText: String?

    private var updateTask: Task<Void, Never>?

    init() {
        updateTask = Task { await self.observeTransactions() }
        Task { await self.refresh() }
    }

    deinit {
        updateTask?.cancel()
    }

    func refresh() async {
        isLoading = true
        defer { isLoading = false }

        if let p = try? await Product.products(for: [Self.productID]).first {
            product = p
            trialText = await Self.trialText(for: p)
        }

        await checkEntitlement()
    }

    func purchase() async throws {
        guard let product else { return }
        let result = try await product.purchase()
        switch result {
        case .success(let verification):
            // Apple has processed the payment at this point — always unlock.
            // `.unverified` occurs spuriously in the App Store sandbox (which
            // App Review uses) for real paid transactions; silently ignoring it
            // would take the customer's money and leave them on the paywall.
            await verification.unsafePayloadValue.finish()
            isPremium = true
        case .pending, .userCancelled:
            break
        @unknown default:
            break
        }
    }

    func restorePurchases() async {
        try? await AppStore.sync()
        await checkEntitlement()
    }

    private static func trialText(for product: Product) async -> String? {
        guard let sub = product.subscription,
              let offer = sub.introductoryOffer,
              offer.paymentMode == .freeTrial,
              await sub.isEligibleForIntroOffer else { return nil }
        let p = offer.period
        let unit: String
        switch p.unit {
        case .day: unit = "day"
        case .week: unit = "week"
        case .month: unit = "month"
        case .year: unit = "year"
        @unknown default: unit = "day"
        }
        return "\(p.value)-\(unit) free trial"
    }

    private func checkEntitlement() async {
        var ownActive = false
        var ownOriginalID: String?
        var ownExpires: Date?
        for await result in Transaction.currentEntitlements {
            // Accept unverified entitlements too — device verification fails
            // spuriously in the sandbox for genuine transactions (see purchase()).
            let tx = result.unsafePayloadValue
            if tx.productID == Self.productID {
                ownActive = tx.revocationDate == nil
                ownOriginalID = String(tx.originalID)
                ownExpires = tx.expirationDate
                break
            }
        }
        // Report our own subscription so the standalone widget app can honor it
        // (and stops when it lapses). Then, if we're not subscribed here, carry
        // over a subscription the family already has in the widget app so they
        // never pay twice for the same service. Both are best-effort/fail-soft.
        await CrossAppEntitlement.report(
            productID: Self.productID, source: "main",
            active: ownActive, originalID: ownOriginalID, expires: ownExpires)
        if ownActive {
            isPremium = true
            return
        }
        isPremium = await CrossAppEntitlement.siblingActive(excludingProductID: Self.productID)
    }

    private static func syncWidgetEntitlement(_ active: Bool) {
        let defaults = UserDefaults(suiteName: "group.app.communitysafe")
        if defaults?.bool(forKey: "premium_active") != active {
            defaults?.set(active, forKey: "premium_active")
            WidgetCenter.shared.reloadAllTimelines()
        }
    }

    private func observeTransactions() async {
        for await result in Transaction.updates {
            // Finish unverified transactions too — leaving them unfinished makes
            // StoreKit redeliver them forever.
            let tx = result.unsafePayloadValue
            if tx.productID == Self.productID {
                isPremium = tx.revocationDate == nil
            }
            await tx.finish()
        }
    }
}

/// Presents the paywall in its own window above the Capacitor WebView until
/// the CommunitySafe Premium entitlement is active.
@MainActor
final class PaywallGate {
    static let shared = PaywallGate()
    let premium = PremiumManager()
    private var window: UIWindow?
    private var cancellable: AnyCancellable?

    func activate() {
        // Show immediately: nothing is accessible until the entitlement check
        // resolves (matches the approved CommunitySafe Widget gate pattern).
        show()
        cancellable = premium.$isPremium
            .combineLatest(premium.$isLoading)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] isPremium, isLoading in
                guard let self else { return }
                if isPremium, !isLoading {
                    self.hide()
                } else {
                    self.show()
                }
            }
    }

    private func show() {
        guard window == nil else { return }
        let w = UIWindow(frame: UIScreen.main.bounds)
        w.windowLevel = .alert + 1
        w.rootViewController = UIHostingController(
            rootView: GateRootView().environmentObject(premium))
        w.makeKeyAndVisible()
        window = w
    }

    private func hide() {
        window?.isHidden = true
        window = nil
    }
}

private struct GateRootView: View {
    @EnvironmentObject private var premium: PremiumManager

    var body: some View {
        if premium.isLoading {
            ZStack {
                Color(.systemBackground).ignoresSafeArea()
                ProgressView()
            }
        } else {
            PaywallView()
        }
    }
}

struct PaywallView: View {
    @EnvironmentObject private var premium: PremiumManager
    @State private var isPurchasing = false
    @State private var errorMessage: String?

    // Guideline 3.1.2: the paywall must include functional links to the
    // Terms of Use (EULA) and Privacy Policy.
    private static let termsURL = URL(string: "https://www.communitysafe.app/terms")!
    private static let privacyURL = URL(string: "https://www.communitysafe.app/privacy")!

    let blue = Color(red: 0.10, green: 0.45, blue: 0.85)
    let green = Color(red: 0.3, green: 0.75, blue: 0.4)

    var displayPrice: String {
        premium.product?.displayPrice ?? "$20.00"
    }

    var body: some View {
        ZStack {
            Color(.systemBackground).ignoresSafeArea()

            ScrollView {
                VStack(spacing: 28) {
                    // Hero
                    VStack(spacing: 12) {
                        ZStack {
                            Circle()
                                .fill(blue.opacity(0.15))
                                .frame(width: 110, height: 110)
                            Image(systemName: "shield.checkerboard")
                                .font(.system(size: 54))
                                .foregroundStyle(blue)
                        }
                        Text("CommunitySafe Premium")
                            .font(.title)
                            .fontWeight(.black)
                        Text("Real-time neighborhood safety\nintelligence for 57 US cities.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                    }
                    .padding(.top, 48)

                    // Features
                    VStack(spacing: 14) {
                        FeatureRow(icon: "map.fill", color: green, title: "Neighborhood Safety Grades", detail: "A–F scores for 4,402 neighborhoods, live police data")
                        FeatureRow(icon: "sparkles", color: blue, title: "AI Area Briefs", detail: "Natural-language crime pattern analysis")
                        FeatureRow(icon: "clock.fill", color: .orange, title: "Time-of-Day Safety Map", detail: "Hour-by-hour crime distribution")
                        FeatureRow(icon: "figure.walk", color: .purple, title: "Route Safety Planner", detail: "Compare routes by crime exposure")
                        FeatureRow(icon: "location.fill.viewfinder", color: .red, title: "Live Location Sharing + SOS", detail: "Share with trusted contacts, one-tap SOS")
                        FeatureRow(icon: "bell.badge.fill", color: blue, title: "Crime Alerts + Widget", detail: "Push alerts and home screen safety grades")
                    }
                    .padding(.horizontal)

                    // Price block. Guideline 3.1.2(c): the billed amount must be
                    // the most clear and conspicuous pricing element — larger,
                    // bolder, and above any free-trial mention.
                    VStack(spacing: 6) {
                        HStack(alignment: .firstTextBaseline, spacing: 5) {
                            Text(displayPrice)
                                .font(.system(size: 46, weight: .black, design: .rounded))
                                .foregroundStyle(.primary)
                            Text("per month")
                                .font(.title3.weight(.semibold))
                                .foregroundStyle(.primary)
                        }
                        Text("Auto-renews monthly. Cancel anytime.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                        if let trialText = premium.trialText {
                            Text("Includes a \(trialText), then \(displayPrice)/month")
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                    }

                    // Error
                    if let errorMessage {
                        Text(errorMessage)
                            .font(.caption)
                            .foregroundStyle(.red)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal)
                    }

                    // CTA
                    VStack(spacing: 12) {
                        Button {
                            Task { await doPurchase() }
                        } label: {
                            Group {
                                if isPurchasing {
                                    ProgressView().tint(.white)
                                } else {
                                    // The CTA states the billed amount (3.1.2(c));
                                    // it must not lead with the free trial.
                                    Text("Subscribe for \(displayPrice)/month")
                                        .fontWeight(.black)
                                }
                            }
                            .frame(maxWidth: .infinity)
                            .frame(height: 54)
                            .background(blue)
                            .foregroundStyle(.white)
                            .clipShape(RoundedRectangle(cornerRadius: 16))
                        }
                        .disabled(isPurchasing)

                        Button("Restore Purchases") {
                            Task { await premium.restorePurchases() }
                        }
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    }
                    .padding(.horizontal)

                    // Apple-required auto-renewal disclosure (3.1.2).
                    Text("Payment of \(displayPrice) per month is charged to your Apple Account at confirmation of purchase\(premium.trialText != nil ? ", after the free trial ends" : ""). The subscription auto-renews at \(displayPrice)/month unless cancelled at least 24 hours before the end of the current period. Manage or cancel anytime in your Apple Account settings.")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 24)

                    HStack(spacing: 16) {
                        Link("Terms of Use", destination: Self.termsURL)
                        Text("·").foregroundStyle(.tertiary)
                        Link("Privacy Policy", destination: Self.privacyURL)
                    }
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.secondary)
                    .padding(.bottom, 40)
                }
            }
        }
    }

    private func doPurchase() async {
        isPurchasing = true
        errorMessage = nil
        do {
            try await premium.purchase()
        } catch {
            errorMessage = error.localizedDescription
        }
        isPurchasing = false
    }
}

private struct FeatureRow: View {
    let icon: String
    let color: Color
    let title: String
    let detail: String

    var body: some View {
        HStack(spacing: 16) {
            ZStack {
                RoundedRectangle(cornerRadius: 10)
                    .fill(color.opacity(0.12))
                    .frame(width: 44, height: 44)
                Image(systemName: icon)
                    .foregroundStyle(color)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.subheadline).fontWeight(.semibold)
                Text(detail).font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
        }
    }
}

/// Cross-app subscription carryover.
///
/// CommunitySafe and the standalone CommunitySafe Widget app are SEPARATE App
/// Store products, so StoreKit's per-app entitlements can't see each other. Each
/// app reports its active subscription to a shared backend keyed by the device's
/// `identifierForVendor` (identical across our same-team apps on one device), and
/// checks whether the sibling app holds an active subscription — so a subscriber
/// to one app is never charged twice for the same service in the other.
///
/// Same-device only (identifierForVendor is per-device); cross-device carryover
/// would require account login. Best-effort and fail-soft: any network failure
/// simply leaves the app on its own StoreKit result.
enum CrossAppEntitlement {
    private static let base = "https://communitysafe-api-production.up.railway.app"

    private static var deviceId: String? {
        UIDevice.current.identifierForVendor?.uuidString
    }

    /// Tell the backend about THIS app's subscription so the sibling app can
    /// honor it. A lapse is conveyed by `active == false` (expires the row now);
    /// a natural expiry needs no call — the reported `expires` date passes on its
    /// own. No-ops when there's no transaction to report (never subscribed).
    static func report(productID: String, source: String, active: Bool,
                       originalID: String?, expires: Date?) async {
        guard let deviceId, let originalID, let expires else { return }
        guard let url = URL(string: "\(base)/entitlement/report") else { return }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.timeoutInterval = 10
        let body: [String: Any] = [
            "deviceId": deviceId,
            "productId": productID,
            "originalTransactionId": originalID,
            "source": source,
            "expiresDate": Int(expires.timeIntervalSince1970 * 1000),
            "active": active,
        ]
        req.httpBody = try? JSONSerialization.data(withJSONObject: body)
        _ = try? await URLSession.shared.data(for: req)
    }

    /// Does the SIBLING app hold an active subscription on this device? Excludes
    /// our own product so we only ever count carryover, never our own sub.
    static func siblingActive(excludingProductID productID: String) async -> Bool {
        guard let deviceId,
              let encoded = productID.addingPercentEncoding(withAllowedCharacters: .csUrlQueryValueAllowed),
              let url = URL(string: "\(base)/entitlement/check?deviceId=\(deviceId)&exclude=\(encoded)")
        else { return false }
        var req = URLRequest(url: url)
        req.timeoutInterval = 10
        guard let (data, resp) = try? await URLSession.shared.data(for: req),
              (resp as? HTTPURLResponse)?.statusCode == 200,
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let premium = json["premium"] as? Bool
        else { return false }
        return premium
    }
}

private extension CharacterSet {
    /// Query-value-safe set (no "&"/"="/"+"), so a product id can't break the URL.
    static let csUrlQueryValueAllowed: CharacterSet = {
        var s = CharacterSet.urlQueryAllowed
        s.remove(charactersIn: "&=+")
        return s
    }()
}
