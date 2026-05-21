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
        <Link href="/login" className="btn-primary">Sign in</Link>
        <Link href="/register" className="btn-secondary">Create account</Link>
      </div>
      <p className="mt-3 text-xs text-slate2-500">
        Browsing the awareness, community, and neighborhood tabs does not require an account.
      </p>
    </section>
  );
}
