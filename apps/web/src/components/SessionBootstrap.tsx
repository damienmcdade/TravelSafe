"use client";
import { useEffect } from "react";
import { ensureAnonymousAuth } from "@/lib/api-client";
import { initNativeShell, requestPushPermission, isNativeApp } from "@/lib/native";

/// Mounts once at the root. Silently issues a per-device anonymous session on
/// first visit so the user has full access to every feature (check-in timer,
/// live-share, alert preferences, etc.) with no login UI in the way. Also runs
/// one-time native-shell setup (status bar, splash hide, deep-link + hardware
/// back handling) when running inside the iOS/Android app.
export function SessionBootstrap() {
  useEffect(() => {
    void ensureAnonymousAuth();
    void initNativeShell().then(() => {
      // Request push notification permission on first launch (after 3-second delay
      // so the user has seen the app before the permission dialog appears)
      if (isNativeApp()) {
        const alreadyAsked = localStorage.getItem("cs_push_asked");
        if (!alreadyAsked) {
          setTimeout(() => {
            localStorage.setItem("cs_push_asked", "1");
            void requestPushPermission();
          }, 3000);
        }
      }
    });
  }, []);
  return null;
}
