// Generalized US state traffic / road-conditions adapter for the
// CommunitySafe "From official sources" card. Modeled on the California
// CHP adapter (chp.ts): one statewide feed per state → cache the parse
// (5-min TTL) → haversine-filter near the city centroid → return
// OfficialAlert[]. Switching cities within a state never re-fetches.
//
// Every supported state here exposes a free, no-key ArcGIS
// FeatureServer / MapServer layer that we query as GeoJSON. A single
// generic fetcher (`fetchArcgisTraffic`) handles the HTTP, caching,
// geometry → centroid extraction, radius filter, mapping, severe-first
// sort and cap. Each state contributes only a small `LayerConfig`
// describing its layer URL, query params and a `toAlert` mapper.
//
// California is special-cased: it delegates to the existing CHP KML
// adapter (getChpIncidents) and remaps its output to this module's
// traffic contract.
//
// Posture mirrors CHP: conservative, quiet-by-default, and degrades to
// [] on any error or timeout (8s) so one dead state feed can never
// blank the whole alerts card.

import type { OfficialAlert } from "./nws";
import { getChpIncidents } from "./chp";

const CACHE_TTL_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8_000;
const MAX_ALERTS = 12;
const DEFAULT_RADIUS_KM = 25;

const USER_AGENT =
  "CommunitySafe/0.1 (https://github.com/damienmcdade/TravelSafe)";

// ---------------------------------------------------------------------------
// Geometry + distance helpers
// ---------------------------------------------------------------------------

function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

type GeoJsonGeometry =
  | { type: "Point"; coordinates: [number, number] }
  | { type: "MultiPoint"; coordinates: [number, number][] }
  | { type: "LineString"; coordinates: [number, number][] }
  | { type: "MultiLineString"; coordinates: [number, number][][] }
  | { type: "Polygon"; coordinates: [number, number][][] }
  | { type: "MultiPolygon"; coordinates: [number, number][][][] }
  | null;

// Pull a single representative [lng, lat] from any GeoJSON geometry.
// Several feeds (notably PennDOT) return LineString segments rather than
// points; we use the first coordinate, which is close enough for a
// metro-radius filter. Returns null when nothing usable is present so
// no-geometry rows are dropped (mirroring CHP's coord guard).
function representativePoint(g: GeoJsonGeometry): { lat: number; lng: number } | null {
  if (!g) return null;
  let coord: unknown;
  switch (g.type) {
    case "Point":
      coord = g.coordinates;
      break;
    case "MultiPoint":
    case "LineString":
      coord = g.coordinates?.[0];
      break;
    case "MultiLineString":
    case "Polygon":
      coord = g.coordinates?.[0]?.[0];
      break;
    case "MultiPolygon":
      coord = g.coordinates?.[0]?.[0]?.[0];
      break;
    default:
      return null;
  }
  if (!Array.isArray(coord) || coord.length < 2) return null;
  const lng = Number(coord[0]);
  const lat = Number(coord[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

const SEVERITY_RANK: Record<OfficialAlert["severity"], number> = {
  Extreme: 0,
  Severe: 1,
  Moderate: 2,
  Minor: 3,
  Unknown: 4,
};

// Coerce a feed timestamp (epoch-ms number, ISO string, or US "MM/DD/YYYY
// hh:mm:ss AM" string) into an ISO string, falling back to "now" so an
// unparseable value never drops an otherwise-valid alert.
function toIso(raw: unknown): string {
  if (raw == null || raw === "") return new Date().toISOString();
  if (typeof raw === "number" && Number.isFinite(raw)) {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  if (typeof raw === "string") {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Generic ArcGIS layer fetcher + cache
// ---------------------------------------------------------------------------

type Props = Record<string, unknown>;

interface LayerConfig {
  // Layer endpoint, WITHOUT the trailing "/query".
  layerUrl: string;
  // ArcGIS where clause (defaults to "1=1").
  where?: string;
  // outFields value (defaults to "*"). WSDOT needs an explicit comma
  // list because its field names contain spaces and "*" errors there.
  outFields?: string;
  // Map a feature's properties + representative point to an OfficialAlert,
  // or null to drop the row (routine / non-safety-relevant).
  toAlert: (
    props: Props,
    lng: number,
    lat: number,
  ) => OfficialAlert | null;
}

interface CacheEntry {
  fetchedAt: number;
  features: ParsedFeature[];
}

interface ParsedFeature {
  alert: OfficialAlert;
  lat: number;
  lng: number;
}

// Cache keyed by layerUrl so each state's statewide parse is shared
// across every city in that state for the TTL window.
const cache = new Map<string, CacheEntry>();

async function loadLayer(cfg: LayerConfig, now: number): Promise<ParsedFeature[]> {
  const hit = cache.get(cfg.layerUrl);
  if (hit && now - hit.fetchedAt < CACHE_TTL_MS) return hit.features;

  const params = new URLSearchParams({
    where: cfg.where ?? "1=1",
    outFields: cfg.outFields ?? "*",
    returnGeometry: "true",
    outSR: "4326",
    f: "geojson",
  });
  const url = `${cfg.layerUrl}/query?${params.toString()}`;

  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/geo+json, application/json",
        "User-Agent": USER_AGENT,
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return hit?.features ?? [];
    const json = (await res.json()) as {
      features?: { properties?: Props; geometry?: GeoJsonGeometry }[];
    };
    const parsed: ParsedFeature[] = [];
    for (const f of json.features ?? []) {
      const point = representativePoint(f.geometry ?? null);
      if (!point) continue;
      const alert = cfg.toAlert(f.properties ?? {}, point.lng, point.lat);
      if (!alert) continue;
      parsed.push({ alert, lat: point.lat, lng: point.lng });
    }
    cache.set(cfg.layerUrl, { fetchedAt: now, features: parsed });
    return parsed;
  } catch {
    return hit?.features ?? [];
  }
}

// Fetch a statewide ArcGIS traffic layer, then filter to the metro
// radius, sort severe-first / nearest-first, and cap. Always resolves
// (never throws); returns [] on any failure.
async function fetchArcgisTraffic(
  cfg: LayerConfig,
  centroid: { lat: number; lng: number },
  radiusKm: number,
): Promise<OfficialAlert[]> {
  const features = await loadLayer(cfg, Date.now());
  return features
    .map((f) => ({ f, km: haversineKm({ lat: f.lat, lng: f.lng }, centroid) }))
    .filter(({ km }) => km <= radiusKm)
    .sort(
      (a, b) =>
        SEVERITY_RANK[a.f.alert.severity] - SEVERITY_RANK[b.f.alert.severity] ||
        a.km - b.km,
    )
    .slice(0, MAX_ALERTS)
    .map(({ f }) => f.alert);
}

// ---------------------------------------------------------------------------
// Mapping helpers shared across states
// ---------------------------------------------------------------------------

function str(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

function isTruthyFlag(v: unknown): boolean {
  const s = str(v).toLowerCase();
  return s === "true" || s === "t" || s === "y" || s === "yes" || s === "1";
}

// Build a concise "road: problem" headline, omitting empty pieces.
function roadHeadline(road: string, problem: string): string {
  const r = road.trim();
  const p = problem.trim();
  if (r && p) return `${r}: ${p}`;
  return r || p || "Traffic incident";
}

// Severity classification from free-text type/condition keywords.
function classifyByKeyword(text: string): OfficialAlert["severity"] {
  const t = text.toLowerCase();
  if (/fatal|fatality|hazmat|all lanes? closed|full closure|road closed/.test(t))
    return "Severe";
  if (/crash|collision|accident|closure|closed|disabled|fire|rollover/.test(t))
    return "Moderate";
  return "Minor";
}

// ---------------------------------------------------------------------------
// Per-state layer configs
// ---------------------------------------------------------------------------

const AGENCY = {
  CA: "California Highway Patrol",
  FL: "Florida DOT (FL511)",
  IL: "Illinois DOT",
  MD: "Maryland CHART",
  MI: "Michigan DOT (MiDrive)",
  MN: "Minnesota DOT (511)",
  MO: "Missouri DOT (MoDOT 511)",
  NC: "NCDOT (DriveNC)",
  PA: "PennDOT (511PA)",
  TX: "TxDOT (DriveTexas)",
} as const;

function mkAlert(
  state: string,
  agency: string,
  id: string,
  severity: OfficialAlert["severity"],
  headline: string,
  description: string,
  effective: string,
  url: string,
): OfficialAlert {
  return {
    id: `traffic:${state}:${id}`,
    source: agency,
    category: "traffic",
    severity,
    headline,
    description,
    effective,
    expires: null,
    url,
  };
}

// --- Florida (FL511) — layer 7 "Other Incidents" -----------------------------
// Verified fields: DESCRIPT, COUNTY, HIGHWAY, SEVERITY ("major"/...),
// TIMESTAMP ("MM/DD/YYYY hh:mm:ss AM"), plus NAME, DIRECTION, TYPE, ID.
const FL_CONFIG: LayerConfig = {
  layerUrl:
    "https://services.arcgis.com/3wFbqsFPLeKqOlIK/arcgis/rest/services/Road_Closures/FeatureServer/7",
  toAlert(props, lng, lat) {
    const desc = str(props.DESCRIPT);
    const road = str(props.HIGHWAY) || str(props.NAME);
    const sevRaw = str(props.SEVERITY).toLowerCase();
    let severity: OfficialAlert["severity"];
    if (sevRaw === "major" || /all lanes? closed/i.test(desc)) severity = "Severe";
    else if (sevRaw === "moderate" || sevRaw === "minor") severity = "Moderate";
    else severity = classifyByKeyword(desc);
    const id =
      str(props.ID) || str(props.OBJECTID) || `${lat.toFixed(4)},${lng.toFixed(4)}`;
    const county = str(props.COUNTY);
    return mkAlert(
      "FL",
      AGENCY.FL,
      id,
      severity,
      roadHeadline(road, county ? `Incident (${county})` : "Incident"),
      desc || "Florida DOT traffic incident.",
      toIso(props.TIMESTAMP),
      "https://fl511.com/",
    );
  },
};

// --- Illinois DOT ------------------------------------------------------------
// Verified fields: TRAFFIC_ITEM_TYPE_DESC ("CONSTRUCTION"/"ROAD_CLOSURE"/...),
// CRITICALITY_DESC ("minor"/"critical"), TRAFFIC_ITEM_DESCRIPTION /
// DESCRIPTION, ROAD_CLOSED, START_TIME (epoch ms), OBJECTID.
// Posture: drop routine minor construction; keep closures + critical rows.
const IL_CONFIG: LayerConfig = {
  layerUrl:
    "https://services2.arcgis.com/aIrBD8yn1TDTEXoz/arcgis/rest/services/Illinois_Roadway_Incidents/FeatureServer/0",
  toAlert(props, lng, lat) {
    const type = str(props.TRAFFIC_ITEM_TYPE_DESC);
    const crit = str(props.CRITICALITY_DESC).toLowerCase();
    const closed = isTruthyFlag(props.ROAD_CLOSED) || isTruthyFlag(props.FullClosure);
    const isConstruction = /construction/i.test(type);
    // Skip routine, minor, non-closing construction — not card material.
    if (isConstruction && !closed && crit === "minor") return null;
    let severity: OfficialAlert["severity"];
    // A roadwork closure is disruptive but planned (Moderate); reserve
    // Severe for unplanned crashes/closures and "critical" criticality on
    // non-construction events, so routine roadwork can't crowd out crashes.
    if (isConstruction) severity = closed ? "Moderate" : "Minor";
    else if (closed || crit === "critical") severity = "Severe";
    else if (/crash|accident|incident|closure/i.test(type)) severity = "Moderate";
    else severity = "Minor";
    const desc =
      str(props.TRAFFIC_ITEM_DESCRIPTION) ||
      str(props.DESCRIPTION) ||
      str(props.TRAFFIC_ITEM_DESCRIPTION_NO_EX);
    const prettyType = type ? type.replace(/_/g, " ").toLowerCase() : "incident";
    const id = str(props.OBJECTID) || `${lat.toFixed(4)},${lng.toFixed(4)}`;
    return mkAlert(
      "IL",
      AGENCY.IL,
      id,
      severity,
      roadHeadline(prettyType, desc || (closed ? "road closed" : "")),
      desc || `Illinois roadway ${prettyType}.`,
      toIso(props.START_TIME),
      "https://www.gettingaroundillinois.com/",
    );
  },
};

// --- Maryland CHART ----------------------------------------------------------
// Verified fields (richer than notes): Description, County, Route, RouteName,
// Direction, IncidentType, LanesClosed, TrafficAlert, Created/Updated (epoch
// ms), ID. ("Direction" present; "VehiclesInvolved" too.)
const MD_CONFIG: LayerConfig = {
  layerUrl:
    "https://chartimap1.sha.maryland.gov/arcgis/rest/services/CHART/Incidents/MapServer/0",
  toAlert(props, lng, lat) {
    const desc = str(props.Description);
    const route = str(props.Route) || str(props.RouteName);
    const type = str(props.IncidentType);
    const lanesClosed = Number(props.LanesClosed);
    const text = `${type} ${desc}`;
    let severity: OfficialAlert["severity"];
    if (/fatal|all lanes|road closed|full closure/i.test(text)) severity = "Severe";
    else if (
      isTruthyFlag(props.TrafficAlert) ||
      (Number.isFinite(lanesClosed) && lanesClosed > 0) ||
      /collision|crash|disabled|closure|fire/i.test(text)
    )
      severity = "Moderate";
    else severity = "Minor";
    const id = str(props.ID) || str(props.rowid) || `${lat.toFixed(4)},${lng.toFixed(4)}`;
    return mkAlert(
      "MD",
      AGENCY.MD,
      id,
      severity,
      roadHeadline(route, type || "Incident"),
      desc || "Maryland CHART traffic incident.",
      toIso(props.Updated ?? props.Created),
      "https://chart.maryland.gov/travinfov2/",
    );
  },
};

// --- Michigan DOT (MiDrive) --------------------------------------------------
// Verified fields: street, direction, reason ("Hazard"/...), description
// (often null), starttime (epoch ms), activeincid, url (often null),
// globalid/OBJECTID.
const MI_CONFIG: LayerConfig = {
  layerUrl:
    "https://services2.arcgis.com/67lKNkQ2TO1I3lhR/arcgis/rest/services/RoadClosures_public_3d3fcb4db4334aa88f746901f4e34f72/FeatureServer/0",
  toAlert(props, lng, lat) {
    const street = str(props.street);
    const reason = str(props.reason);
    const desc = str(props.description);
    const severity = classifyByKeyword(`${reason} ${desc}`);
    const id =
      str(props.globalid) || str(props.OBJECTID) || `${lat.toFixed(4)},${lng.toFixed(4)}`;
    const link = str(props.url) || "https://mdotjboss.state.mi.us/MiDrive/map";
    return mkAlert(
      "MI",
      AGENCY.MI,
      id,
      severity,
      roadHeadline(street, reason || "Road closure"),
      desc || (reason ? `${reason} reported on ${street || "the roadway"}.` : "Michigan DOT road closure."),
      toIso(props.starttime),
      link,
    );
  },
};

// --- Minnesota DOT (511) -----------------------------------------------------
// Verified fields: headline, phrase, cause, Route, STYLE ("roadwork"/...),
// linktxt (event URL), Priority, EditDate (epoch ms), ID, ExpireDate/Time.
const MN_CONFIG: LayerConfig = {
  layerUrl:
    "https://services.arcgis.com/8lRhdTsQyJpO52F1/arcgis/rest/services/CARS511_MN_Events_View/FeatureServer/0",
  toAlert(props, lng, lat) {
    const style = str(props.STYLE).toLowerCase();
    const headline = str(props.headline);
    const phrase = str(props.phrase);
    const route = str(props.Route);
    const cause = str(props.cause);
    // Drop routine roadwork; keep incidents/closures.
    if (style === "roadwork" && !/clos/i.test(`${headline} ${phrase}`)) return null;
    let severity: OfficialAlert["severity"];
    if (/clos|crash|incident/i.test(style) || /clos|crash/i.test(headline))
      severity = "Moderate";
    else severity = classifyByKeyword(`${style} ${headline}`);
    const id = str(props.ID) || str(props.OBJECTID) || `${lat.toFixed(4)},${lng.toFixed(4)}`;
    return mkAlert(
      "MN",
      AGENCY.MN,
      id,
      severity,
      headline || roadHeadline(route, phrase || "Traffic event"),
      [phrase, cause].filter(Boolean).join(" ").trim() || "Minnesota DOT traffic event.",
      toIso(props.EditDate),
      str(props.linktxt) || "https://511mn.org/",
    );
  },
};

// --- Missouri DOT (MoDOT 511) ------------------------------------------------
// Verified fields: STYLE ("roadwork"/...), HEADLINE, MESSAGE (HTML), OBJECTID,
// EditDate/CreationDate (epoch ms). No per-event link field.
const MO_CONFIG: LayerConfig = {
  layerUrl:
    "https://services.arcgis.com/8lRhdTsQyJpO52F1/arcgis/rest/services/511_MO_View/FeatureServer/0",
  toAlert(props, lng, lat) {
    const style = str(props.STYLE).toLowerCase();
    const headline = str(props.HEADLINE);
    // Strip HTML tags / entities from the message body.
    const message = str(props.MESSAGE)
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    // Drop routine roadwork unless it mentions a closure.
    if (style === "roadwork" && !/clos/i.test(`${headline} ${message}`)) return null;
    let severity: OfficialAlert["severity"];
    if (/clos|crash|incident/i.test(`${style} ${headline}`)) severity = "Moderate";
    else severity = classifyByKeyword(`${style} ${headline}`);
    const id = str(props.OBJECTID) || `${lat.toFixed(4)},${lng.toFixed(4)}`;
    return mkAlert(
      "MO",
      AGENCY.MO,
      id,
      severity,
      headline || "Traffic event",
      message || "Missouri DOT traffic event.",
      toIso(props.EditDate ?? props.CreationDate),
      "https://traveler.modot.org/map/",
    );
  },
};

// --- North Carolina (DriveNC) ------------------------------------------------
// Verified fields: Road, Reason (often null), Condition ("Partial Access"/...),
// EventType ("roadwork"/...), EventSubType, LanesAffected, IsFullClosure,
// DriveNCLink (event URL), StartDateTime (epoch ms), Id/OBJECTID.
const NC_CONFIG: LayerConfig = {
  layerUrl:
    "https://services.arcgis.com/NuWFvHYDMVmmxMeM/arcgis/rest/services/NCDOT_TIMSIncidentsByCondition/FeatureServer/0",
  toAlert(props, lng, lat) {
    const road = str(props.Road);
    const reason = str(props.Reason);
    const condition = str(props.Condition);
    const eventType = str(props.EventType);
    const subType = str(props.EventSubType);
    const lanes = str(props.LanesAffected);
    const fullClosure = isTruthyFlag(props.IsFullClosure);
    const isRoadwork = /roadwork|maintenance|construction/i.test(`${eventType} ${subType}`);
    // Drop routine roadwork that isn't a full closure.
    if (isRoadwork && !fullClosure) return null;
    let severity: OfficialAlert["severity"];
    if (/fatal/i.test(`${reason} ${subType}`)) severity = "Severe";
    else if (fullClosure && !isRoadwork) severity = "Severe";
    else if (fullClosure || /crash|incident|closure|disabled/i.test(`${eventType} ${subType}`))
      severity = "Moderate";
    else severity = "Minor";
    const problem = (reason || subType || eventType || condition || "Incident")
      .replace(/\s+/g, " ")
      .trim();
    const id = str(props.Id) || str(props.OBJECTID) || `${lat.toFixed(4)},${lng.toFixed(4)}`;
    const descParts = [condition, lanes].filter(Boolean);
    return mkAlert(
      "NC",
      AGENCY.NC,
      id,
      severity,
      roadHeadline(road, problem),
      descParts.join(" — ") || "North Carolina DOT traffic incident.",
      toIso(props.StartDateTime),
      str(props.DriveNCLink) || "https://drivenc.gov/",
    );
  },
};

// --- Pennsylvania (511PA) ----------------------------------------------------
// Verified fields (richer than notes): Description, Facility (road name),
// EventType ("damaged roadway"/...), LaneStatus ("closed"/...), CountyName,
// Direction, IsFatality/IsHazmat ("T"/"F"), DateTimeVerified /
// DateTimeNotified (epoch ms), EventID/OBJECTID. Geometry is LineString.
const PA_CONFIG: LayerConfig = {
  layerUrl:
    "https://services2.arcgis.com/xtuWQvb2YQnp0z3F/arcgis/rest/services/RCRS_GIS/FeatureServer/0",
  toAlert(props, lng, lat) {
    const desc = str(props.Description);
    const road = str(props.Facility) || str(props.RouteID);
    const eventType = str(props.EventType);
    const laneStatus = str(props.LaneStatus).toLowerCase();
    const fatality = isTruthyFlag(props.IsFatality);
    const hazmat = isTruthyFlag(props.IsHazmat);
    const isRoadwork = /roadwork|construction|maintenance|damaged roadway/i.test(eventType);
    let severity: OfficialAlert["severity"];
    if (fatality || hazmat) severity = "Severe";
    // An unplanned full lane closure (crash, disabled, hazard) is Severe;
    // a planned roadwork closure is disruptive-but-Moderate so routine
    // construction can't outrank crashes in the severe-first sort.
    else if (laneStatus === "closed" || /all lanes? closed|full closure/i.test(desc))
      severity = isRoadwork ? "Moderate" : "Severe";
    else if (/crash|collision|disabled|closure|restrict/i.test(`${eventType} ${laneStatus}`))
      severity = "Moderate";
    else severity = "Minor";
    const id = str(props.EventID) || str(props.OBJECTID) || `${lat.toFixed(4)},${lng.toFixed(4)}`;
    return mkAlert(
      "PA",
      AGENCY.PA,
      id,
      severity,
      roadHeadline(road, eventType || "Incident"),
      desc || "PennDOT traffic incident.",
      toIso(props.DateTimeNotified ?? props.DateTimeVerified),
      "https://www.511pa.com/",
    );
  },
};

// --- Texas (DriveTexas) ------------------------------------------------------
// Verified fields: COND_DSCR, RTE_NM, RDWAY_NM, CNSTRNT_TYPE_CD,
// TRVL_DRCT_CD, LMT_FROM_DSCR/LMT_TO_DSCR, COND_START_TS (epoch ms),
// TXDOT_COUNTY_NBR, OBJECTID. Layer is often EMPTY in clear weather — fine.
const TX_CONFIG: LayerConfig = {
  layerUrl:
    "https://services.arcgis.com/KTcxiTD9dsQw4r7Z/arcgis/rest/services/HCRS_Edit_AGO/FeatureServer/0",
  toAlert(props, lng, lat) {
    const cond = str(props.COND_DSCR);
    const road = str(props.RTE_NM) || str(props.RDWAY_NM);
    const type = str(props.CNSTRNT_TYPE_CD);
    const severity =
      isTruthyFlag(props.CNSTRNT_DETOUR_FLAG) || /clos/i.test(`${cond} ${type}`)
        ? "Moderate"
        : classifyByKeyword(`${cond} ${type}`);
    const id = str(props.OBJECTID) || str(props.GLOBALID) || `${lat.toFixed(4)},${lng.toFixed(4)}`;
    return mkAlert(
      "TX",
      AGENCY.TX,
      id,
      severity,
      roadHeadline(road, cond || type || "Road condition"),
      cond || "Texas DOT road condition / closure.",
      toIso(props.COND_START_TS),
      "https://drivetexas.org/",
    );
  },
};

// --- Washington (WSDOT) — INTENTIONALLY NOT WIRED ----------------------------
// The notes flagged that this layer's field names contain spaces and that
// outFields=* errors. On live testing the quirk is worse: the
// TrafficMgmtCenterEvents/FeatureServer/1 layer rejects (HTTP 400 "Unable
// to perform query operation") ANY outFields containing a spaced field
// name — including "*" and each individual spaced field
// ("Problem Description", "State Route ID", "Status Description", etc.).
// Only the space-free fields (ObjectID, SRMP, Latitude, Longitude) and the
// geometry are retrievable, which yields no headline/description text to
// build a meaningful traffic alert from. Rather than emit contentless
// rows, WA is left out of the registry and behaves like the unsupported
// states (agency → null, alerts → []). If WSDOT later exposes a
// queryable text field (or fixes the spaced-field rejection), add a
// LayerConfig here and a REGISTRY entry.

// ---------------------------------------------------------------------------
// State registry
// ---------------------------------------------------------------------------

interface StateEntry {
  agency: string;
  build: (
    centroid: { lat: number; lng: number },
    radiusKm: number,
  ) => Promise<OfficialAlert[]>;
}

// California delegates to the existing CHP KML adapter and remaps its
// output to this module's traffic contract (source = agency label,
// category = "traffic", id namespaced under this module).
async function buildCalifornia(
  centroid: { lat: number; lng: number },
  radiusKm: number,
): Promise<OfficialAlert[]> {
  const chp = await getChpIncidents("CA", centroid, radiusKm);
  return chp.slice(0, MAX_ALERTS).map((a) => ({
    ...a,
    id: a.id.startsWith("traffic:") ? a.id : `traffic:CA:${a.id}`,
    source: AGENCY.CA,
    category: "traffic",
  }));
}

function arcgisEntry(agency: string, cfg: LayerConfig): StateEntry {
  return {
    agency,
    build: (centroid, radiusKm) => fetchArcgisTraffic(cfg, centroid, radiusKm),
  };
}

const REGISTRY: Record<string, StateEntry> = {
  CA: { agency: AGENCY.CA, build: buildCalifornia },
  FL: arcgisEntry(AGENCY.FL, FL_CONFIG),
  IL: arcgisEntry(AGENCY.IL, IL_CONFIG),
  MD: arcgisEntry(AGENCY.MD, MD_CONFIG),
  MI: arcgisEntry(AGENCY.MI, MI_CONFIG),
  MN: arcgisEntry(AGENCY.MN, MN_CONFIG),
  MO: arcgisEntry(AGENCY.MO, MO_CONFIG),
  NC: arcgisEntry(AGENCY.NC, NC_CONFIG),
  PA: arcgisEntry(AGENCY.PA, PA_CONFIG),
  TX: arcgisEntry(AGENCY.TX, TX_CONFIG),
};

// States with no usable free keyless feed are intentionally absent from
// the registry (CO, DC, GA, IN, LA, MA, NV, NY, OH, VA, WI — plus WA, see
// note above — and any other not listed): trafficAgencyForState → null,
// getStateTraffic → [].

// ---------------------------------------------------------------------------
// Public contract
// ---------------------------------------------------------------------------

function normalizeState(state: string | null): string | null {
  if (!state) return null;
  const s = state.trim().toUpperCase();
  return s.length === 2 ? s : null;
}

/// Human-readable agency label for a state's traffic feed, or null when
/// the state has no supported keyless feed.
export function trafficAgencyForState(state: string | null): string | null {
  const code = normalizeState(state);
  if (!code) return null;
  return REGISTRY[code]?.agency ?? null;
}

/// Pull active traffic / road-condition alerts near the city centroid for
/// the given state. Returns [] for unsupported states or a missing
/// centroid, and degrades to [] on any upstream failure. Each alert has
/// category "traffic" and source set to the state's agency label.
export async function getStateTraffic(
  state: string | null,
  centroid: { lat: number; lng: number } | null,
  radiusKm: number = DEFAULT_RADIUS_KM,
): Promise<OfficialAlert[]> {
  const code = normalizeState(state);
  if (!code || !centroid) return [];
  const entry = REGISTRY[code];
  if (!entry) return [];
  try {
    return await entry.build(centroid, radiusKm);
  } catch {
    return [];
  }
}
