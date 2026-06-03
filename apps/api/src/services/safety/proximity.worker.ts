import { prisma } from "../../lib/prisma.js";
import { sendToUser } from "../push/webpush.service.js";
import { crimeData } from "@travelsafe/crime-data/dispatcher";
import { cityFromLatLng } from "@travelsafe/crime-data/cities";
import type { Incident } from "@travelsafe/crime-data/types";

// Proximity safety alerts for Saved Places ("Alert Zones") — the Citizen-style
// daily-engagement feature. Every few minutes we check each alert-enabled saved
// place for NEW incidents within its radius and push the user a notification.
//
// Dedup / anti-spam:
//   • lastSeenIncidentAt is the newest incident we've already accounted for at a
//     place. On a place's FIRST check we set this to the current newest incident
//     WITHOUT pushing — so adding a place never blasts its existing backlog; we
//     only alert on genuinely-new activity afterwards.
//   • lastAlertAt + COOLDOWN_MS keep an active area from notifying repeatedly.

const TICK_MS = 5 * 60 * 1000;          // check every 5 minutes
const COOLDOWN_MS = 6 * 60 * 60 * 1000; // at most one push per place per 6h
const MAX_PLACES_PER_TICK = 500;
const NEAREST_AREA_BUFFER_KM = 4;       // pull incidents from areas whose centroid is within radius+buffer
const MAX_SEEN_IDS = 1000;              // bound seenIncidentIds per place (well above a place's typical in-radius feed window)

// Dedup + keep only the most-recent MAX_SEEN_IDS so the column can't grow
// without bound. Fresh IDs are appended, so the tail is the newest.
function boundIds(ids: string[]): string[] {
  return Array.from(new Set(ids)).slice(-MAX_SEEN_IDS);
}

let timer: NodeJS.Timeout | null = null;
let inFlight = false;

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/// Recent incidents within radiusM of a point, by sampling the nearest tracked
/// neighborhoods' cached incident lists and distance-filtering.
async function incidentsNearPoint(lat: number, lng: number, radiusM: number): Promise<Incident[]> {
  const city = cityFromLatLng({ lat, lng }) ?? null;
  if (!city) return [];
  const areas = await city.discover().catch(() => []);
  if (areas.length === 0) return [];
  const radiusKm = radiusM / 1000;
  const nearAreas = areas
    .map((a) => ({ a, km: haversineKm({ lat, lng }, a.centroid) }))
    .filter((x) => x.km <= radiusKm + NEAREST_AREA_BUFFER_KM)
    .sort((x, y) => x.km - y.km)
    .slice(0, 6)
    .map((x) => x.a);
  if (nearAreas.length === 0) return [];

  const lists = await Promise.all(
    nearAreas.map((a) => crimeData.getIncidents(a.slug, { limit: 500 }).catch(() => [] as Incident[])),
  );
  const seen = new Set<string>();
  const near: Incident[] = [];
  let anyHadCoords = false;
  for (const inc of lists.flat()) {
    if (inc.lat == null || inc.lng == null) continue;
    anyHadCoords = true;
    if (haversineKm({ lat, lng }, { lat: inc.lat, lng: inc.lng }) * 1000 > radiusM) continue;
    if (seen.has(inc.id)) continue;
    seen.add(inc.id);
    near.push(inc);
  }
  // fix(audit safezone-proximity-coordless-cities): coordless-feed cities
  // (Phoenix, Boise, Saint Paul, Virginia Beach, plus missing-coord rows in
  // Charlotte/Dallas) carry no per-incident lat/lng, so the distance filter
  // above drops everything and proximity alerts NEVER fire there. When the
  // sampled feed had no coordinates at all, fall back to area-level: use the
  // single nearest tracked area's incident list. Coarser than a radius, but the
  // best signal a coordless feed supports (the alternative is silent dead air).
  if (!anyHadCoords && near.length === 0) {
    const nearestAreaList = lists[0] ?? [];
    const out: Incident[] = [];
    for (const inc of nearestAreaList) {
      if (seen.has(inc.id)) continue;
      seen.add(inc.id);
      out.push(inc);
    }
    return out;
  }
  return near;
}

async function tick(): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  try {
    const places = await prisma.savedPlace.findMany({
      where: { alertsEnabled: true },
      select: { id: true, userId: true, label: true, lat: true, lng: true, radiusM: true, lastAlertAt: true, lastSeenIncidentAt: true, seenIncidentIds: true },
      take: MAX_PLACES_PER_TICK,
    });
    const now = Date.now();
    for (const p of places) {
      try {
        const incidents = await incidentsNearPoint(p.lat, p.lng, p.radiusM);
        if (incidents.length === 0) continue;
        const newestMs = Math.max(...incidents.map((i) => +new Date(i.occurredAt)).filter(Number.isFinite));

        // fix(audit safezone-proximity-occurredat-lag-miss): freshness is now
        // keyed on whether we've SEEN each incident ID, not whether its occurredAt
        // beats a high-water mark. Lagged feeds publish out of order (a record can
        // surface today dated weeks ago); the timestamp baseline stepped over
        // those, the ID set catches them.
        const seenSet = new Set(p.seenIncidentIds);

        // First observation of this place → seed the seen-set with the current
        // backlog and don't push (adding a place must not blast its history).
        if (p.seenIncidentIds.length === 0 && p.lastSeenIncidentAt == null) {
          await prisma.savedPlace.update({
            where: { id: p.id },
            data: {
              seenIncidentIds: boundIds(incidents.map((i) => i.id)),
              lastSeenIncidentAt: Number.isFinite(newestMs) ? new Date(newestMs) : null,
            },
          });
          continue;
        }

        const fresh = incidents.filter((i) => !seenSet.has(i.id));
        if (fresh.length === 0) continue;

        // fix(audit safezone-proximity-cooldown-suppression): hold WITHOUT marking
        // the fresh incidents as seen while cooling down, so they're re-evaluated
        // and alerted on the next eligible tick rather than stepped over forever.
        if (p.lastAlertAt && now - +new Date(p.lastAlertAt) < COOLDOWN_MS) continue;

        // Not in cooldown → we're about to act on these, so record them as seen
        // now (bounded) to prevent re-alerting on the same set next tick.
        await prisma.savedPlace.update({
          where: { id: p.id },
          data: {
            seenIncidentIds: boundIds([...p.seenIncidentIds, ...fresh.map((i) => i.id)]),
            lastSeenIncidentAt: Number.isFinite(newestMs) ? new Date(newestMs) : p.lastSeenIncidentAt,
          },
        });

        const top = fresh.sort((a, b) => +new Date(b.occurredAt) - +new Date(a.occurredAt))[0];
        const km = Math.round(p.radiusM / 100) / 10;
        const res = await sendToUser(p.userId, {
          title: `Safety alert near ${p.label}`,
          body: fresh.length === 1
            ? `New incident reported within ${km} km of ${p.label}: ${top.ibrOffenseDescription}.`
            : `${fresh.length} new incidents reported within ${km} km of ${p.label}. Most recent: ${top.ibrOffenseDescription}.`,
          tag: `place-${p.id}`,
          // `url` is read by the service worker's notificationclick handler to
          // focus/open the app when the user taps the alert.
          data: { placeId: p.id, kind: "proximity-alert", url: "/neighborhood" },
        }).catch(() => ({ sent: 0 }));

        if ((res?.sent ?? 0) > 0) {
          await prisma.savedPlace.update({ where: { id: p.id }, data: { lastAlertAt: new Date(now) } });
          console.log(`[proximity-worker] alerted user on ${p.label}: ${fresh.length} new incident(s)`);
        }
      } catch (err) {
        console.warn(`[proximity-worker] place ${p.id} failed:`, (err as Error).message);
      }
    }
  } catch (err) {
    console.error("[proximity-worker] tick failed:", err);
  } finally {
    inFlight = false;
  }
}

export function startProximityWorker(): void {
  if (timer) return;
  console.log("[proximity-worker] starting (saved-place alert zones, every 5m)");
  // Small startup delay so the adapter cache can warm first.
  setTimeout(() => { void tick(); }, 60_000);
  timer = setInterval(() => { void tick(); }, TICK_MS);
}
