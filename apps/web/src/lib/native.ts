"use client";

/**
 * Capacitor native bridge.
 *
 * When the app runs inside the native iOS/Android shell, `window.Capacitor`
 * is injected and these helpers route to real native plugins (CoreLocation,
 * UIActivityViewController share sheet, Taptic Engine, native status bar /
 * splash, deep-link + hardware-back handling) installed via `npx cap sync`.
 *
 * On the web the same calls degrade gracefully to standard browser APIs
 * (navigator.geolocation / navigator.share / navigator.vibrate) or no-op,
 * so the identical React tree works in every environment. Plugins are
 * imported dynamically so they are never pulled into the path of a plain
 * web visitor who will never use them.
 */

type CapacitorGlobal = {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
};

function cap(): CapacitorGlobal | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as Window & { Capacitor?: CapacitorGlobal }).Capacitor;
}

/** True only inside the native iOS/Android shell. */
export function isNativeApp(): boolean {
  const c = cap();
  return !!(c && typeof c.isNativePlatform === "function" && c.isNativePlatform());
}

/** "ios" | "android" | "web". */
export function nativePlatform(): string {
  const c = cap();
  try {
    return (c && c.getPlatform && c.getPlatform()) || "web";
  } catch {
    return "web";
  }
}

// ---------------------------------------------------------------------------
// Geolocation (native CoreLocation on iOS via @capacitor/geolocation)
// ---------------------------------------------------------------------------

type GeoOpts = { enableHighAccuracy: boolean; timeout: number; maximumAge?: number };

function toWebPosition(p: {
  timestamp: number;
  coords: {
    latitude: number;
    longitude: number;
    accuracy: number;
    altitude?: number | null;
    altitudeAccuracy?: number | null;
    heading?: number | null;
    speed?: number | null;
  };
}): GeolocationPosition {
  // The Capacitor Position shape is coords-compatible with the web
  // GeolocationPosition for everything we read (lat/lng/accuracy).
  return p as unknown as GeolocationPosition;
}

export async function nativeGetCurrentPosition(opts: GeoOpts): Promise<GeolocationPosition> {
  const { Geolocation } = await import("@capacitor/geolocation");
  const pos = await Geolocation.getCurrentPosition({
    enableHighAccuracy: opts.enableHighAccuracy,
    timeout: opts.timeout,
    maximumAge: opts.maximumAge ?? 60_000,
  });
  return toWebPosition(pos);
}

/** Native position watch. Returns a cleanup function that clears the watch. */
export async function nativeWatchPosition(
  opts: GeoOpts,
  onPos: (pos: GeolocationPosition) => void,
  onErr?: (e: unknown) => void,
): Promise<() => void> {
  const { Geolocation } = await import("@capacitor/geolocation");
  const id = await Geolocation.watchPosition(
    { enableHighAccuracy: opts.enableHighAccuracy, timeout: opts.timeout },
    (pos, err) => {
      if (err) {
        onErr?.(err);
        return;
      }
      if (pos) onPos(toWebPosition(pos));
    },
  );
  return () => {
    void Geolocation.clearWatch({ id });
  };
}

// ---------------------------------------------------------------------------
// Share (native share sheet via @capacitor/share, with web/clipboard fallback)
// ---------------------------------------------------------------------------

export type ShareResult = "shared" | "copied" | "failed";

export async function shareOrCopy(opts: {
  title?: string;
  text?: string;
  url: string;
}): Promise<ShareResult> {
  if (isNativeApp()) {
    try {
      const { Share } = await import("@capacitor/share");
      await Share.share({
        title: opts.title,
        text: opts.text,
        url: opts.url,
        dialogTitle: opts.title,
      });
      return "shared";
    } catch {
      // user cancelled or share unavailable — fall through to copy
    }
  } else {
    try {
      if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
        await navigator.share({ title: opts.title, text: opts.text, url: opts.url });
        return "shared";
      }
    } catch {
      // cancelled — fall through to copy
    }
  }
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      await navigator.clipboard.writeText(opts.url);
      return "copied";
    }
  } catch {
    // ignore
  }
  return "failed";
}

// ---------------------------------------------------------------------------
// Haptics (Taptic Engine via @capacitor/haptics, with vibrate fallback)
// ---------------------------------------------------------------------------

export async function hapticImpact(style: "light" | "medium" | "heavy" = "medium"): Promise<void> {
  if (!isNativeApp()) {
    try {
      navigator.vibrate?.(style === "heavy" ? 50 : style === "light" ? 12 : 28);
    } catch {
      /* ignore */
    }
    return;
  }
  try {
    const { Haptics, ImpactStyle } = await import("@capacitor/haptics");
    const map = { light: ImpactStyle.Light, medium: ImpactStyle.Medium, heavy: ImpactStyle.Heavy };
    await Haptics.impact({ style: map[style] });
  } catch {
    /* ignore */
  }
}

export async function hapticNotify(type: "success" | "warning" | "error" = "success"): Promise<void> {
  if (!isNativeApp()) {
    try {
      navigator.vibrate?.([20, 40, 20]);
    } catch {
      /* ignore */
    }
    return;
  }
  try {
    const { Haptics, NotificationType } = await import("@capacitor/haptics");
    const map = {
      success: NotificationType.Success,
      warning: NotificationType.Warning,
      error: NotificationType.Error,
    };
    await Haptics.notification({ type: map[type] });
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Push Notifications (APNS on iOS via @capacitor/push-notifications)
// ---------------------------------------------------------------------------

export type PushPermission = "granted" | "denied" | "prompt";

export async function requestPushPermission(): Promise<PushPermission> {
  if (!isNativeApp()) return "prompt";
  try {
    const { PushNotifications } = await import("@capacitor/push-notifications");
    const status = await PushNotifications.checkPermissions();
    if (status.receive === "granted") return "granted";
    if (status.receive === "denied") return "denied";
    const result = await PushNotifications.requestPermissions();
    if (result.receive !== "granted") return "denied";
    await PushNotifications.register();
    return "granted";
  } catch {
    return "prompt";
  }
}

export async function initPushNotifications(onToken?: (token: string) => void): Promise<void> {
  if (!isNativeApp()) return;
  try {
    const { PushNotifications } = await import("@capacitor/push-notifications");
    await PushNotifications.addListener("registration", ({ value }) => {
      onToken?.(value);
      // Persist the token so the server can send targeted crime alerts
      try { localStorage.setItem("cs_push_token", value); } catch { /* ignore */ }
    });
    await PushNotifications.addListener("pushNotificationReceived", (notification) => {
      // Foreground notification — show custom in-app banner
      const event = new CustomEvent("cs:push", { detail: notification });
      window.dispatchEvent(event);
    });
    await PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
      // User tapped the notification — deep-link into the app
      const url: string | undefined = (action.notification.data as Record<string, string>)?.url;
      if (url) {
        try {
          const path = new URL(url).pathname;
          if (path && path !== "/") window.location.assign(path);
        } catch { /* ignore */ }
      }
    });
  } catch {
    /* push plugin unavailable */
  }
}

// Write preferred city to shared App Group so the WidgetKit extension can read it
export function syncPreferredCityToWidget(citySlug: string): void {
  if (!isNativeApp()) return;
  try {
    // Capacitor Preferences bridge for App Group data
    localStorage.setItem("cs_preferred_city", citySlug);
    // Custom message to native layer via custom URL scheme (AppDelegate reads this)
    const iframe = document.createElement("iframe");
    iframe.style.display = "none";
    iframe.src = `communitysafe://set-city?slug=${encodeURIComponent(citySlug)}`;
    document.body.appendChild(iframe);
    setTimeout(() => document.body.removeChild(iframe), 500);
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// One-time native shell init: status bar, splash, deep links, hardware back
// ---------------------------------------------------------------------------

let shellInitDone = false;

export async function initNativeShell(): Promise<void> {
  if (shellInitDone || !isNativeApp()) return;
  shellInitDone = true;

  // Dark app chrome (#0A1628) → light status-bar content.
  try {
    const { StatusBar, Style } = await import("@capacitor/status-bar");
    await StatusBar.setStyle({ style: Style.Dark });
  } catch {
    /* status bar plugin not present on this platform */
  }

  // Hide the native splash once the web layer has painted.
  try {
    const { SplashScreen } = await import("@capacitor/splash-screen");
    await SplashScreen.hide();
  } catch {
    /* ignore */
  }

  // Universal/deep links + hardware back button (Android) handled natively.
  try {
    const { App } = await import("@capacitor/app");
    App.addListener("appUrlOpen", (data: { url: string }) => {
      try {
        const url = new URL(data.url);
        const path = `${url.pathname}${url.search}${url.hash}`;
        if (path && path !== "/") window.location.assign(path);
      } catch {
        /* ignore malformed deep link */
      }
    });
    App.addListener("backButton", ({ canGoBack }: { canGoBack: boolean }) => {
      if (canGoBack) window.history.back();
      else void App.exitApp();
    });
  } catch {
    /* ignore */
  }

  // Initialise push notification listeners (registration completes asynchronously)
  await initPushNotifications();
}
