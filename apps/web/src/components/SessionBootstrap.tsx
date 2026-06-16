"use client";
import { useEffect } from "react";
import { ensureAnonymousAuth } from "@/lib/api-client";
import { initNativeShell } from "@/lib/native";

/// Mounts once at the root. Silently issues a per-device anonymous session on
/// first visit so the user has full access to every feature (check-in timer,
/// live-share, alert preferences, etc.) with no login UI in the way. Also runs
/// one-time native-shell setup (status bar, splash hide, deep-link + hardware
/// back handling) when running inside the iOS/Android app.
export function SessionBootstrap() {
  useEffect(() => {
    void ensureAnonymousAuth();
    void initNativeShell();
  }, []);
  return null;
}
