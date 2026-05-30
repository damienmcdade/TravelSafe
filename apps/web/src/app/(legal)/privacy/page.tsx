import type { Metadata } from "next";
import Link from "next/link";
import { LegalFooter } from "@/components/LegalFooter";

export const metadata: Metadata = {
  title: "Privacy",
  description:
    "CommunitySafe privacy practices — what's stored on your device, what's stored on our servers when you create a Safety account, what's transmitted to third parties, and how to control it.",
};

const LAST_UPDATED = "2026-05-30";

export default function PrivacyPage() {
  return (
    <main className="max-w-3xl mx-auto px-4 py-10 space-y-6">
      <header>
        <p className="text-xs uppercase tracking-[0.18em] text-bay-700 font-medium">Legal</p>
        <h1 className="mt-1 font-display text-3xl text-slate2-900">Privacy</h1>
        <p className="mt-2 text-xs text-slate2-500">Last updated: {LAST_UPDATED}</p>
        <p className="mt-2 text-sm text-slate2-700 leading-relaxed">
          CommunitySafe is operated by{" "}
          <a href="https://cyberwaveglobal.com" target="_blank" rel="noopener noreferrer" className="text-bay-700 hover:underline">CyberWave Technologies LLC</a>{" "}
          (cyberwaveglobal.com), a California limited liability company and the <strong>data controller</strong> for the purposes of the
          GDPR, the CCPA/CPRA, and equivalent laws. Privacy questions and data-subject requests:{" "}
          <a href="mailto:info@cyberwaveglobal.com?subject=CommunitySafe%20privacy%20request" className="text-bay-700 hover:underline">info@cyberwaveglobal.com</a>.
        </p>
      </header>

      <section className="surface p-6 space-y-3 text-sm text-slate2-700 leading-relaxed">
        <h2 className="font-display text-xl text-slate2-900">What CommunitySafe does NOT collect</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>No demographic data — race, ethnicity, religion, age, gender, sexual orientation are not stored, displayed, or analyzed anywhere in the app.</li>
          <li>No individual identification from public data — police-incident data is aggregated to neighborhood-level only; names, addresses below the block level, plates, and photos are never surfaced.</li>
          <li>No persistent background tracking. Geolocation is requested only when you tap &quot;Use my location&quot; OR when you arm a Check-In timer / Live Share link (both opt-in). The mobile shells (iOS / Android) declare permissions for background-location, contacts, and camera so that <em>if</em> you opt into Check-In, Live Share, Trusted Contact import, or photo attachment, the OS allows it — none of these run without an explicit user action.</li>
          <li>No data sales. The site shows Google AdSense ads to fund hosting; see the <strong>Advertising</strong> section below for what AdSense receives, what it doesn&apos;t, and how to opt out of personalised ads.</li>
          <li>Browsing the map / safety scores / community feed does NOT require an account. Account-required features are explicitly labeled (Personal Safety, CommunitySafe posts).</li>
        </ul>
      </section>

      <section className="surface p-6 space-y-3 text-sm text-slate2-700 leading-relaxed">
        <h2 className="font-display text-xl text-slate2-900">What is stored on your device</h2>
        <p>CommunitySafe uses your browser&apos;s <strong>localStorage</strong> to remember preferences and speed up subsequent loads. Items in localStorage are not transmitted to our servers except where noted (the anonymous session token is sent to authorize protected API calls).</p>
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
        <h2 className="font-display text-xl text-slate2-900">When you create a CommunitySafe account</h2>
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
        <p>We do not sell, license, or share user-account data with third parties for advertising or marketing. CommunitySafe accounts, contacts, check-in timers, and posts are never transmitted to ad networks. AdSense&apos;s collection is limited to what the browser sends directly to Google when an ad slot loads (described in the <strong>Advertising</strong> section below).</p>
      </section>

      <section className="surface p-6 space-y-3 text-sm text-slate2-700 leading-relaxed">
        <h2 className="font-display text-xl text-slate2-900">Advertising</h2>
        <p>CommunitySafe displays ads served by <strong>Google AdSense</strong> (publisher <code className="text-xs">ca-pub-8731629548430880</code>) to cover hosting costs. AdSense is a Google product; its data practices are governed by{" "}
          <a href="https://policies.google.com/technologies/ads" target="_blank" rel="noreferrer" className="text-bay-700 hover:underline">Google&apos;s ad-policy disclosures</a>.</p>
        <p>What CommunitySafe sends to AdSense:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Nothing from our backend. Account records, contacts, timers, posts, and the personal-safety surfaces are not transmitted to AdSense.</li>
        </ul>
        <p>What your browser sends to Google when an ad slot loads (we do not control these):</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>The URL of the page you&apos;re viewing (so the ad context can be matched).</li>
          <li>Your IP address, user-agent, language, and screen size.</li>
          <li>Google&apos;s own advertising / measurement cookies, if you&apos;ve previously consented under Google&apos;s consent prompt.</li>
        </ul>
        <p>How to opt out of personalised ads:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Use Google&apos;s{" "}
            <a href="https://adssettings.google.com/" target="_blank" rel="noreferrer" className="text-bay-700 hover:underline">Ads Settings</a>{" "}
            to turn off personalisation for your Google account.</li>
          <li>Use your browser&apos;s tracking-protection / cookie-blocking features. Ads will still show but won&apos;t be tailored to you.</li>
          <li>For EU/UK/Swiss users, Google&apos;s consent prompt will appear before personalisation begins.</li>
        </ul>
      </section>

      <section className="surface p-6 space-y-3 text-sm text-slate2-700 leading-relaxed">
        <h2 className="font-display text-xl text-slate2-900">Do Not Sell or Share My Personal Information (CCPA / CPRA)</h2>
        <p>California Civil Code §1798.135 requires every business that &quot;sells&quot; or &quot;shares&quot; personal information to surface a clear opt-out link. CommunitySafe does not sell or share personal information for cross-context behavioral advertising, monetary consideration, or any equivalent benefit. There is consequently no opt-out flow to surface — but for transparency we still affirm the position here:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>We have not sold or shared personal information in the preceding 12 months.</li>
          <li>We have no contractual relationship that would permit a third party to sell or share CommunitySafe-collected personal information on our behalf.</li>
          <li>If this changes in the future, this page will surface a working &quot;Do Not Sell or Share&quot; control before any such sale or share occurs.</li>
        </ul>
        <p>California residents can also exercise the right to limit the use of sensitive personal information; CommunitySafe does not process the categories California enumerates as sensitive (precise location is treated as personal — see Geolocation in the section above — and is only retained for the duration of an active Check-In or Live Share session you arm yourself).</p>
      </section>

      <section className="surface p-6 space-y-3 text-sm text-slate2-700 leading-relaxed">
        <h2 className="font-display text-xl text-slate2-900">AI Assistant</h2>
        <p>The optional AI Assistant runs your prompts through a third-party large language model (currently Google Gemini via Google AI Studio, or another configured provider). What this means:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>The text of your prompt — including any free text you type and the recent conversation turns — is transmitted to the AI provider over HTTPS and processed by their model.</li>
          <li>The assistant does NOT have access to your account data, your check-in timers, your contacts, or your location. It can call internal CommunitySafe tools that return aggregated city / neighborhood data (the same data the rest of the app shows).</li>
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
        <p>CommunitySafe surfaces police-incident data that the cities themselves publish through their official open-data portals (SDPD, LAPD, SFPD, Chicago CPD, NYPD, Phoenix PPD, and 24 others). We do not augment, predict, or editorialize that data. The FBI national-rate comparison comes from the FBI Crime Data Explorer 2025 release at <a href="https://cde.ucr.cjis.gov/LATEST/webapp/" target="_blank" rel="noreferrer" className="text-bay-700 hover:underline">cde.ucr.cjis.gov</a>.</p>
      </section>

      <section className="surface p-6 space-y-3 text-sm text-slate2-700 leading-relaxed">
        <h2 className="font-display text-xl text-slate2-900">GDPR / CCPA / your rights</h2>
        <p>If you have a CommunitySafe account, you have the right to:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>Access</strong> — request a copy of the personal data we hold about you.</li>
          <li><strong>Rectification</strong> — correct any inaccurate data.</li>
          <li><strong>Erasure</strong> — delete your account and the associated records listed under &quot;When you create a CommunitySafe account&quot; above. The fastest path is the <strong>Delete my account</strong> button in Personal Safety; it runs immediately and is irreversible. Replies left by other users on your deleted posts are removed along with the parent post, since the conversation is unintelligible without it.</li>
          <li><strong>Portability</strong> — request a machine-readable export.</li>
          <li><strong>Withdraw consent</strong> — disable Push, delete Trusted Contacts, or cancel pending Check-Ins from within the app at any time.</li>
        </ul>
        <p>Access, portability, and erasure are self-service from the Personal Safety page. For rectification or any other request, or if you can&apos;t access your account, use the contact path in <strong>Contact</strong> below — we&apos;ll respond within 30 days. Note that even without an explicit account, browsing CommunitySafe creates an anonymous device session (a server-side User row keyed by a random device token, with a synthetic <code className="text-xs">device-*@travelsafe.local</code> email). That anonymous session is also a valid target for export and erasure through the same Personal Safety controls.</p>
      </section>

      <section className="surface p-6 space-y-2 text-sm text-slate2-700 leading-relaxed">
        <h2 className="font-display text-xl text-slate2-900">Children</h2>
        <p>CommunitySafe is not directed to children under 13 and we do not knowingly collect personal information from children. If you believe a child has created an account, email us and we will remove it.</p>
      </section>

      <section className="surface p-6 space-y-2 text-sm text-slate2-700 leading-relaxed">
        <h2 className="font-display text-xl text-slate2-900">Security</h2>
        <p>Passwords are hashed with bcrypt before storage. Transport is HTTPS-only with HSTS preload. Sensitive endpoints are gated behind per-user session tokens, and operator endpoints (cron, diagnostics) are gated behind a separate shared secret.</p>
      </section>

      <section className="surface p-6 space-y-2 text-sm text-slate2-700 leading-relaxed">
        <h2 className="font-display text-xl text-slate2-900">Contact</h2>
        <p>The fastest paths are in-app: <strong>Personal Safety → Your account &amp; data</strong> for export / erasure, and the <strong>Report</strong> button on any post for content concerns. For anything else — corrections, questions about this policy, or DSAR requests you can&apos;t fulfill via the in-app controls — email <a href="mailto:info@cyberwaveglobal.com?subject=CommunitySafe%20privacy%20request" className="text-bay-700 hover:underline">info@cyberwaveglobal.com</a> with &quot;PRIVACY&quot; in the subject line, and we&apos;ll respond within 30 days. Bug reports and code-level questions can also be opened on the project&apos;s code repository at <a href="https://github.com/damienmcdade/TravelSafe/issues/new" target="_blank" rel="noreferrer" className="text-bay-700 hover:underline">github.com/damienmcdade/TravelSafe/issues</a>.</p>
      </section>

      <LegalFooter />
    </main>
  );
}
