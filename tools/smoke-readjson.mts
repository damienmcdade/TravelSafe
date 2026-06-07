// v108 smoke test — proves the shared safe-JSON reader degrades non-JSON
// upstream responses gracefully instead of throwing a raw SyntaxError.
// Run: npx tsx tools/smoke-readjson.mts
import { readJson, UpstreamNonJsonError } from "../packages/crime-data/src/lib/http.ts";

function mockRes(body: string, status = 200, url = "https://upstream.example/query"): Response {
  // Minimal Response stand-in: only .text(), .status, .url are used by readJson.
  return {
    status,
    url,
    text: async () => body,
  } as unknown as Response;
}

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name} ${detail}`); }
}

async function expectThrowsNonJson(name: string, res: Response) {
  try {
    await readJson(res);
    check(name, false, "(expected throw, got value)");
  } catch (e) {
    const isOurs = e instanceof UpstreamNonJsonError;
    const transient = (e as { transient?: boolean })?.transient === true;
    check(name, isOurs && transient, `(got ${(e as Error)?.name}: ${(e as Error)?.message?.slice(0, 80)})`);
  }
}

(async () => {
  console.log("readJson smoke test\n");

  // 1) Valid JSON object (ArcGIS shape) parses through.
  const okObj = await readJson<{ features?: unknown[] }>(mockRes('{"features":[{"attributes":{"x":1}}]}'));
  check("valid JSON object parses", Array.isArray(okObj.features) && okObj.features.length === 1);

  // 2) Valid JSON array (Socrata/SANDAG shape) parses through.
  const okArr = await readJson<number[]>(mockRes("[1,2,3]"));
  check("valid JSON array parses", Array.isArray(okArr) && okArr.length === 3);

  // 3) The exact reported failure: an HTML/text error page starting with "An".
  await expectThrowsNonJson('reported case: "An error has occurred" page', mockRes("An error has occurred. Please try again later."));

  // 4) HTML error page (Cloudflare/nginx style) on a 200.
  await expectThrowsNonJson("HTML page on HTTP 200", mockRes("<!DOCTYPE html><html><body>502 Bad Gateway</body></html>", 200));

  // 5) HTML error page on a 503.
  await expectThrowsNonJson("HTML page on HTTP 503", mockRes("<html>Service Unavailable</html>", 503));

  // 6) Empty body.
  await expectThrowsNonJson("empty body", mockRes(""));

  // 7) Truncated/malformed JSON (starts like JSON but is invalid).
  await expectThrowsNonJson("truncated JSON", mockRes('{"features":[{"attributes":'));

  // 8) Plain text "null"/"true"/"false" literals still parse (valid JSON scalars).
  const okNull = await readJson(mockRes("null"));
  check("JSON null literal parses", okNull === null);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
