// Per-state public sex-offender registry lookup. Each state runs its
// own registry; previously CommunitySafe surfaced California's
// Megan's Law site for every city regardless of state, which was
// wrong (a Chicago user clicking the link landed on a CA-only site).
//
// Coverage: every state where CommunitySafe currently has a supported
// city. URLs verified against the official state agency page (not
// nsopw.gov aggregator), since the state-run sites are the
// authoritative search interfaces.
//
// Fallback (no state match): the federal NSOPW aggregator at
// nsopw.gov, which searches every state registry simultaneously.
// Better than no link.

export interface StateRegistry {
  label: string;   // Short, recognizable name for the link button
  url: string;     // Public search URL
}

const STATE_REGISTRY: Record<string, StateRegistry> = {
  AZ: { label: "Arizona Public Sex Offender Website",                 url: "https://az.gov/app/dps/sexual-offender" },
  CA: { label: "Megan's Law (California)",                            url: "https://www.meganslaw.ca.gov/" },
  CO: { label: "Colorado Sex Offender Registry",                      url: "https://apps.colorado.gov/apps/dps/sor/index.jsf" },
  DC: { label: "DC Sex Offender Registry (CSOSA)",                    url: "https://csosa.gov/sex-offender-registry/" },
  GA: { label: "Georgia Sex Offender Registry (GBI)",                 url: "https://gbi.georgia.gov/services/sex-offender-search" },
  IL: { label: "Illinois Sex Offender Information (ISP)",             url: "https://isp.illinois.gov/Sor" },
  IN: { label: "Indiana Sex and Violent Offender Registry",           url: "https://www.icrimewatch.net/indiana.php" },
  KY: { label: "Kentucky State Police Sex Offender Registry",         url: "https://kspsor.state.ky.us/" },
  LA: { label: "Louisiana State Sex Offender Registry",               url: "https://www.lsp.org/socpr/" },
  MA: { label: "Massachusetts Sex Offender Registry Board",           url: "https://www.mass.gov/sex-offender-registry-board" },
  MI: { label: "Michigan Public Sex Offender Registry",               url: "https://mspsor.com/" },
  MO: { label: "Missouri Sex Offender Registry (MSHP)",               url: "https://www.mshp.dps.missouri.gov/MSHPWeb/PatrolDivisions/CRID/SOR/SORPage.html" },
  NC: { label: "North Carolina Sex Offender Registry",                url: "https://sexoffender.ncsbi.gov/" },
  NE: { label: "Nebraska State Patrol Sex Offender Registry",         url: "https://sor.nebraska.gov/" },
  NV: { label: "Nevada Sex Offender Registry",                        url: "https://www.nvsexoffenders.gov/" },
  NY: { label: "New York State Sex Offender Registry",                url: "https://www.criminaljustice.ny.gov/SomsSUBDirectory/search_index.jsp" },
  OH: { label: "Ohio Attorney General eSORN",                         url: "https://www.communitynotification.com/cap_main.php?office=55149" },
  OR: { label: "Oregon Sex Offender Inquiry System (OSP)",            url: "https://sexoffenders.oregon.gov/" },
  PA: { label: "Pennsylvania Megan's Law Website (PSP)",              url: "https://www.pameganslaw.state.pa.us/" },
  TN: { label: "Tennessee Sex Offender Registry (TBI)",               url: "https://www.tn.gov/tbi/general-information/redirect-tennessee-sex-offender-registry-search.html" },
  TX: { label: "Texas DPS Sex Offender Registry",                     url: "https://records.txdps.state.tx.us/SexOffender/" },
  VA: { label: "Virginia State Police Sex Offender Registry",         url: "https://sex-offender.vsp.virginia.gov/sor/" },
  WA: { label: "Washington State Sex Offender Search",                url: "https://www.icrimewatch.net/index.php?AgencyID=54574" },
  WI: { label: "Wisconsin Sex Offender Registry (DOC)",               url: "https://appsdoc.wi.gov/public" },
  MN: { label: "Minnesota DOC Sex Offender Registry",                 url: "https://coms.doc.state.mn.us/PublicRegistrant/" },
  ID: { label: "Idaho State Sex Offender Registry",                   url: "https://www.isp.idaho.gov/sor/" },
};

const FEDERAL_FALLBACK: StateRegistry = {
  label: "National Sex Offender Public Website (NSOPW)",
  url: "https://www.nsopw.gov/",
};

/// Returns the state-specific registry for the given two-letter state
/// abbreviation, or the federal NSOPW aggregator if the state isn't
/// in the table. NEVER returns null — there's always a reasonable
/// public link for the user to click.
export function registryForState(stateAbbr: string | undefined | null): StateRegistry {
  if (!stateAbbr) return FEDERAL_FALLBACK;
  return STATE_REGISTRY[stateAbbr.toUpperCase()] ?? FEDERAL_FALLBACK;
}
