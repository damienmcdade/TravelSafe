"use client";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { isSignedIn } from "@/lib/api-client";

/// Shows a sign-in prompt instead of the gated content for unauthenticated
/// visitors. Render this around any tab/section that needs a user identity
/// (posting, trusted contacts, check-in timer, live share, preferences).
export function SignInGate({ children, message }: { children: ReactNode; message?: string }) {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  useEffect(() => setSignedIn(isSignedIn()), []);
  if (signedIn === null) return null;
  if (signedIn) return <>{children}</>;
  return (
    <section className="surface p-6">
      <h2 className="font-display text-lg text-slate2-900">Sign in to continue</h2>
      <p className="mt-2 text-sm text-slate2-700">
        {message ?? "This feature requires an account so we can attach it to your profile and apply the moderation safeguards."}
      </p>
      <div className="mt-4 flex gap-3">
        <Link href="/login" className="px-4 py-2 bg-slate2-900 text-sand-50 rounded-xl">Sign in</Link>
        <Link href="/register" className="px-4 py-2 bg-white border border-sand-200 text-slate2-900 rounded-xl">Create account</Link>
      </div>
      <p className="mt-3 text-xs text-slate2-500">
        Browsing the awareness, community, and neighborhood tabs does not require an account.
      </p>
    </section>
  );
}
