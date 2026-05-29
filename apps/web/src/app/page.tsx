import Link from "next/link";
import { ThemeToggle } from "@/components/ThemeToggle";

export default function WelcomePage() {
  return (
    <main className="min-h-screen">
      {/* Floating top-right utility bar — theme toggle lives here so
          first-time visitors can flip themes without diving into
          settings. Absolute-positioned so it doesn't push the hero
          down on small viewports. */}
      <div className="absolute top-4 right-4 sm:top-6 sm:right-6 z-10">
        <ThemeToggle align="right" size="sm" />
      </div>

      {/* Hero — glass card so the city backdrop shows through. */}
      <section className="relative">
        <div className="relative max-w-5xl mx-auto px-6 py-24 sm:py-32">
          <div className="max-w-2xl rounded-2xl bg-slate2-900/55 backdrop-blur-md p-6 sm:p-8 shadow-card-lift border border-white/10">
            <p className="text-bay-200 text-sm tracking-wide uppercase animate-fade-in">Area-level safety · San Diego · Los Angeles · San Francisco</p>
            <h1 className="mt-2 font-display text-5xl sm:text-6xl text-white animate-rise-in">
              <span className="bg-gradient-to-r from-white to-coral-200 bg-clip-text text-transparent">Community</span>Safe
            </h1>
            <p className="mt-4 text-sand-100 text-lg animate-rise-in">
              Calm, neighborhood-level safety context for major California cities. The application draws on official police data and moderated community reports, without surveillance, profiling, or alarmism.
            </p>
            <div className="mt-8 flex flex-wrap gap-3 animate-rise-in">
              <Link href="/now" className="btn-coral text-base px-6 py-3">Explore CommunitySafe →</Link>
              <Link href="/map" className="btn-secondary text-base px-6 py-3 !bg-white/10 !border-white/30 !text-white hover:!bg-white/20">
                Open the Crime Map
              </Link>
            </div>
            <p className="mt-6 text-xs text-sand-100/80">
              No account is needed. Browsing and posting on CommunitySafe are both anonymous. A check-in timer and trusted-contact features require an existing account.
            </p>
          </div>
        </div>
      </section>

      {/* Pillars */}
      <section className="max-w-5xl mx-auto px-6 py-16">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Pillar
            tone="bay"
            label="Awareness"
            title="Neighborhood-level data, not rumors"
            body="Incident reports from each city's police department, aggregated to the neighborhood level. Sparkline trends and plain-language context for the area you select."
          />
          <Pillar
            tone="sage"
            label="Community"
            title="Behaviors and places, never people"
            body="Moderated posts use a structured what/where/when composer. The pre-screening service blocks street addresses, individual names, and posts that lead with appearance."
          />
          <Pillar
            tone="coral"
            label="Personal"
            title="Check-ins on your terms"
            body="A server-side check-in timer and revocable live-share links for your trusted contacts. The application does not dial 911 for you; the emergency button opens your phone's native dialer."
          />
        </div>
      </section>

      {/* Not list */}
      <section className="max-w-5xl mx-auto px-6 pb-16">
        <div className="surface p-8">
          <h2 className="font-display text-2xl text-slate2-900">What this application does not do</h2>
          <ul className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-slate2-700">
            <Bullet>It does not surveil, track, or geolocate individuals.</Bullet>
            <Bullet>It does not contact emergency services on your behalf. In an emergency, call 911 directly.</Bullet>
            <Bullet>It does not collect demographic data (no age, gender, ethnicity, religion).</Bullet>
            <Bullet>Community posts are reviewed and are never presented as official police data.</Bullet>
          </ul>
        </div>
      </section>

      {/* Founder + contact */}
      <section className="max-w-5xl mx-auto px-6 pb-24">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <article className="surface p-6">
            <span className="inline-block text-[11px] uppercase tracking-wider px-2 py-0.5 rounded-full text-bay-700 bg-bay-200">
              Founder
            </span>
            <h2 className="mt-3 font-display text-2xl text-slate2-900">Built by a U.S. Army Veteran</h2>
            <p className="mt-3 text-sm text-slate2-700 leading-relaxed">
              CommunitySafe is founded by a U.S. Army Veteran. The product was
              built around what actually keeps people safe in a neighborhood:
              honest open data, calm community input, and personal-safety tools
              that respect the user&apos;s autonomy. No surveillance, no
              profiling, no alarmism — the same standards we&apos;d hold any
              tool we relied on ourselves.
            </p>
          </article>

          <article className="surface p-6">
            <span className="inline-block text-[11px] uppercase tracking-wider px-2 py-0.5 rounded-full text-coral-700 bg-coral-200">
              Contact
            </span>
            <h2 className="mt-3 font-display text-2xl text-slate2-900">Questions, press, partnerships</h2>
            <p className="mt-3 text-sm text-slate2-700 leading-relaxed">
              For any inquiry — feedback, press, data-source corrections,
              privacy-rights requests, partnerships — email us. We read
              every message and reply within two business days.
            </p>
            <a
              href="mailto:info@cyberwaveglobal.com?subject=CommunitySafe%20inquiry"
              className="btn-coral text-base px-5 py-2.5 mt-4 inline-flex items-center"
            >
              info@cyberwaveglobal.com →
            </a>
            <p className="mt-3 text-xs text-slate2-500">
              For privacy-rights requests under GDPR, CCPA/CPRA or equivalent
              laws, use the same email. We respond within 30 days per the{" "}
              <Link href="/privacy" className="text-bay-700 hover:underline">privacy policy</Link>.
            </p>
          </article>
        </div>
      </section>
    </main>
  );
}

function Pillar({ tone, label, title, body }: { tone: "bay" | "sage" | "coral"; label: string; title: string; body: string }) {
  const accent = tone === "bay" ? "text-bay-700 bg-bay-200" : tone === "sage" ? "text-sage-700 bg-sage-200" : "text-coral-700 bg-coral-200";
  return (
    <article className="surface p-6 animate-rise-in">
      <span className={`inline-block text-[11px] uppercase tracking-wider px-2 py-0.5 rounded-full ${accent}`}>{label}</span>
      <h3 className="mt-3 font-display text-lg text-slate2-900">{title}</h3>
      <p className="mt-2 text-sm text-slate2-700">{body}</p>
    </article>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <span className="mt-1.5 inline-block w-1.5 h-1.5 rounded-full bg-coral-500 shrink-0" />
      <span>{children}</span>
    </li>
  );
}
