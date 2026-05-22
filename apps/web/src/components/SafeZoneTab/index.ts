/// SafeZoneTab — modular, drop-in widgets for the neighborhood-level safety
/// analytics view. Every component in this folder is stateless and consumes
/// typed props; all data fetching is centralized in `useSafeZoneData`.
///
/// Intended consumption:
///
///   const data = useSafeZoneData({ city, area });
///   <BlockScoreWidget score={data.blockScore} loading={data.loading} contextLabel={...} />
///   <ThreatFeed
///     threats={data.threats}
///     baseline={data.baseline}
///     windowDays={data.windowDays}
///     contextLabel={...}
///     source={...}
///     loading={data.loading}
///   />
///   <SafeZoneMap cityLabel={city.label} />
///
/// Drop-in goal: a partner app can render any of these by satisfying the
/// exported props — no hidden globals.
export { BlockScoreWidget, type BlockScoreWidgetProps } from "./BlockScoreWidget";
export { ThreatFeed, type ThreatFeedProps } from "./ThreatFeed";
export { SafeZoneMap, type SafeZoneMapProps } from "./SafeZoneMap";
export { BaselineTrendChart, type BaselineTrendChartProps } from "./BaselineTrendChart";
export { useSafeZoneData } from "./useSafeZoneData";
export type {
  BlockScore,
  BlockScoreBand,
  ThreatItem,
  BaselinePoint,
  SafeZoneSelection,
  SafeZoneDataState,
} from "./types";
