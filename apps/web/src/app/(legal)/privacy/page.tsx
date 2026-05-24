import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy",
  description:
    "TravelSafe privacy practices — what's stored on your device, what's stored on our servers when you create a Safety account, what's transmitted to third parties, and how to control it.",
};

const LAST_UPDATED = "2026-05-23";

export default function PrivacyPage() {
  return (
    <main className="max-w-3xl mx-auto px-4 py-10 space-y-6">
      <header>
        <p className="text-xs uppercase tracking-[0.18em] text-bay-700 font-medium">Legal</p>
        <h1 className="mt-1 font-display text-3xl text-slate2-900">Privacy</h1>
        <p className="mt-2 text-xs text-slate2-500">Last updated: {LAST_UPDATED}</p>
      </header>

      <section className="surface p-6 space-y-3 text-sm text-slate2-700 leading-relaxed">
        <h2 className="font-display text-xl text-slate2-900">What TravelSafe does NOT collect</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>No demographic data — race, ethnicity, religion, age, gender, sexual orientation are not stored, displayed, or analyzed anywhere in the app.</li>
          <li>No individual identification from public data — police-incident data is aggregated to neighborhood-level only; names, addresses below the block level, plates, and photos are never surfaced.</li>
          <li>No location tracking. Geolocation is requested only when you tap &quot;Use my location&quot;, used once for the lookup, and not stored.</li>
          <li>No third-party advertising, no profiling cookies, no data sales.</li>
          <li>Browsing the map / safety scores / community feed does NOT require an account. Account-required features are explicitly labeled (Personal Safety, CommunitySafe posts).</li>
        </ul>
      </section>

      <section className="surface p-6 space-y-3 text-sm text-slate2-700 leading-relaxed">
        <h2 className="font-display text-xl text-slate2-900">What is stored on your device</h2>
        <p>TravelSafe uses your browser&apos;s <strong>localStorage</strong> to remember preferences and speed up subsequent loads. Items in localStorage are not transmitted to our servers except where noted (the anonymous session token is sent to authorize protected API calls).</p>
        <ul className="list-disc pl-5 space-y-1">
          <li><code className="text-xs">travelsafe.token</code> — anonymous session JWT, minted per-device on first visit. Sent to the server with protected requests so anonymous-session state (e.g., your Community moderation history) can be remembered without an account.</li>
          <li><code className="text-xs">travelsafe.city.v1</code> — currently-selected city.</li>
          <li><code className="text-xs">travelsafe.area.v1</code> — currently-picked neighborhood, per city.</li>
          <li><code className="text-xs">travelsafe.saved-areas.v1</code> — your saved neighborhoods (up to 5).</li>
          <li><code className="text-xs">travelsafe.swr.v1.*</code> — cached API responses for snappy navigation (15-min TTL).</li>
          <li><code className="text-xs">travelsafe.safety.disclaimer.ack</code> — flag that you&apos;ve dismissed the Personal Safety disclaimer.</li>
          <li><code className="text-xs">travelsafe.assistant.*</code> — your AI Assistant conversation history. Kept locally so you can review past answers; the prompts themselves are transmitted to our AI provider — see <strong>AI Assistant</strong> below.</li>
        </ul>
        <p>To clear everything: open your browser settings and delete site data for this domain, or open DevTools → Application → Local Storage → clear.</p>
      </section>

      <section className="surface p-6 space-y-3 text-sm text-slate2-700 leading-relaxed">
        <h2 className="font-display text-xl text-slate2-900">When you create a TravelSafe account</h2>
        <p>The Personal Safety and CommunitySafe features require an account. When you register we store, in our database:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Your email address and a one-way <strong>hashed</strong> password (bcrypt — the plaintext is never written to disk and never transmitted to anyone). Optional display name.</li>
          <li>For each Trusted Contact you add: their email and/or phone number, the relationship label you chose, and your confirmation that you have their permission to contact them.</li>
          <li>For each Check-In timer you arm: the scheduled expiry, your optional note, and the last latitude/longitude you shared to that timer.</li>
          <li>For each Live Share link you generate: the cancel token, the recipient channel (email/SMS), and the expiry.</li>
          <li>For each Web Push subscription you opt into: the browser-issued endpoint URL and the two public crypto keys (used to encrypt notifications). Push subscriptions never carry personal content.</li>
          <li>Your CommunitySafe post bodies, comments, and reports — and an append-only edit log if you revise a post.</li>
          <li>Moderation records: post flags, suspensions, and any blocks/mutes you set.</li>
        </ul>
        <p>You can export or delete your account directly from inside the app: go to <strong>Personal Safety → Your account &amp; data</strong>. Export downloads a single JSON file with every record we hold about you. Delete is irreversible — it wipes your account, posts, comments, check-in timers, trusted contacts, push subscriptions, and live-share links in one transaction. If you can&apos;t access your account, use the contact path in <strong>Contact</strong> below and we&apos;ll process the request within 30 days. Local browser data is not part of the server-side account and can be cleared at any time from your browser settings.</p>
      </section>

      <section className="surface p-6 space-y-3 text-sm text-slate2-700 leading-relaxed">
        <h2 className="font-display text-xl text-slate2-900">What we receive when you use the app (without an account)</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>Standard server logs from our hosting provider (IP address, user-agent, request path, timestamp). Retained per the provider&apos;s default retention.</li>
          <li>Anonymous rate-limiting state: a short-lived in-memory counter keyed by IP+endpoint to throttle abuse. Not persisted.</li>
        </ul>
        <p>We do not sell, license, or share user data with third parties for advertising or marketing.</p>
      </section>

      <section className="surface p-6 space-y-3 text-sm text-slate2-700 leading-relaxed">
        <h2 className="font-display text-xl text-slate2-900">AI Assistant</h2>
        <p>The optional AI Assistant runs your prompts through a third-party large language model (currently Google Gemini via Google AI Studio, or another configured provider). What this means:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>The text of your prompt — including any free text you type and the recent conversation turns — is transmitted to the AI provider over HTTPS and processed by their model.</li>
          <li>The assistant does NOT have access to your account data, your check-in timers, your contacts, or your location. It can call internal TravelSafe tools that return aggregated city / neighborhood data (the same data the rest of the app shows).</li>
          <li>Outputs are generated by a probabilistic model and can be inaccurate. Verify any numeric claim against the source URL the assistant cites.</li>
          <li>We rate-limit the assistant to 10 requests per minute per IP to manage cost.</li>
          <li>The provider&apos;s own data-retention policy applies to prompts in transit and at rest on their side. Review your chosen provider&apos;s privacy terms.</li>
        </ul>
        <p>If you prefer not to use AI, simply don&apos;t open the Assistant tab — nothing else in the app sends data to the AI provider.</p>
      </section>

      <section className="surface p-6 space-y-3 text-sm text-slate2-700 leading-relaxed">
        <h2 className="font-display text-xl text-slate2-900">Third-party services your browser contacts</h2>
        <p>When you use certain parts of the app, your browser makes requests directly to:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>Wikimedia Commons</strong> (<code className="text-xs">upload.wikimedia.org</code>) — source images for the city backdrops. Routed through our image optimizer in most cases so your IP isn&apos;t exposed.</li>
          <li><strong>CartoDB</strong> (<code className="text-xs">basemaps.cartocdn.com</code>) — basemap tiles for the crime map and safe-route view. Your IP is exposed to CartoDB for each tile request.</li>
          <li><strong>Google AI Studio / Gemini</strong> — only when you use the AI Assistant (above). Prompts are sent server-side; your IP is not directly exposed to the provider, but the contents of your prompt are.</li>
        </ul>
        <p>Map routing (OpenStreetMap&apos;s OSRM) and all police open-data feeds are called from our server, not from your browser, so those services don&apos;t see your IP.</p>
      </section>

      <section className="surface p-6 space-y-3 text-sm text-slate2-700 leading-relaxed">
        <h2 className="font-display text-xl text-slate2-900">Public data sources we display</h2>
        <p>TravelSafe surfaces police-incident data that the cities themselves publish through their official open-data portals (SDPD, LAPD, SFPD, Chicago CPD, NYPD, Phoenix PPD, and 24 others). We do not augment, predict, or editorialize that data. The FBI national-rate comparison comes from the FBI Crime Data Explorer 2025 release at <a href="https://cde.ucr.cjis.gov/LATEST/webapp/" target="_blank" rel="noreferrer" className="text-bay-700 hover:underline">cde.ucr.cjis.gov</a>.</p>
      </section>

      <section className="surface p-6 space-y-3 text-sm text-slate2-700 leading-relaxed">
        <h2 className="font-display text-xl text-slate2-900">GDPR / CCPA / your rights</h2>
        <p>If you have a TravelSafe account, you have the right to:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>Access</strong> — request a copy of the personal data we hold about you.</li>
          <li><strong>Rectification</strong> — correct any inaccurate data.</li>
          <li><strong>Erasure</strong> — delete your account and the associated records listed under &quot;When you create a TravelSafe account&quot; above. The fastest path is the <strong>Delete my account</strong> button in Personal Safety; it runs immediately and is irreversible. Replies left by other users on your deleted posts are removed along with the parent post, since the conversation is unintelligible without it.</li>
          <li><strong>Portability</strong> — request a machine-readable export.</li>
          <li><strong>Withdraw consent</strong> — disable Push, delete Trusted Contacts, or cancel pending Check-Ins from within the app at any time.</li>
        </ul>
        <p>Access, portability, and erasure are self-service from the Personal Safety page. For rectification or any other request, or if you can&apos;t access your account, use the contact path in <strong>Contact</strong> below — we&apos;ll respond within 30 days. Note that even without an explicit account, browsing TravelSafe creates an anonymous device session (a server-side User row keyed by a random device token, with a synthetic <code className="text-xs">device-*@travelsafe.local</code> email). That anonymous session is also a valid target for export and erasure through the same Personal Safety controls.</p>
      </section>

      <section className="surface p-6 space-y-2 text-sm text-slate2-700 leading-relaxed">
        <h2 className="font-display text-xl text-slate2-900">Children</h2>
        <p>TravelSafe is not directed to children under 13 and we do not knowingly collect personal information from children. If you believe a child has created an account, email us and we will remove it.</p>
      </section>

      <section className="surface p-6 space-y-2 text-sm text-slate2-700 leading-relaxed">
        <h2 className="font-display text-xl text-slate2-900">Security</h2>
        <p>Passwords are hashed with bcrypt before storage. Transport is HTTPS-only with HSTS preload. Sensitive endpoints are gated behind per-user session tokens, and operator endpoints (cron, diagnostics) are gated behind a separate shared secret.</p>
      </section>

      <section className="surface p-6 space-y-2 text-sm text-slate2-700 leading-relaxed">
        <h2 className="font-display text-xl text-slate2-900">Contact</h2>
        <p>The fastest paths are in-app: <strong>Personal Safety → Your account &amp; data</strong> for export / erasure, and the <strong>Report</strong> button on any post for content concerns. For anything else — corrections, questions about this policy, or DSAR requests you can&apos;t fulfill via the in-app controls — open a privacy issue on the project&apos;s code repository at <a href="https://github.com/damienmcdade/TravelSafe/issues/new" target="_blank" rel="noreferrer" className="text-bay-700 hover:underline">github.com/damienmcdade/TravelSafe/issues</a>. Mark it &quot;PRIVACY&quot; in the title and we&apos;ll respond within 30 days.</p>
      </section>

      <p className="text-xs text-slate2-500">
        See also: <Link href="/terms" className="text-bay-700 hover:underline">Terms of use</Link>, <Link href="/methodology" className="text-bay-700 hover:underline">Methodology</Link>.
      </p>
    </main>
  );
}
