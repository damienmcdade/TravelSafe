# CommunitySafe — Icon System (v108 — "Sheltering Wing")

## Concept
A single luminous guardian-angel **wing arcing protectively over a minimal
downtown-Manhattan skyline** at dusk — Empire State Building (with antenna spire)
center, a terraced Art-Deco crown to the left, a warm gilded street glow below.
The wing is the focal element (it survives at 48px); the skyline is a supporting
silhouette baseline. Secular by design (no halo/face), claiming the safety
category's unclaimed "wing" white space — competitors are all flat blue shields,
location pins, and house glyphs. The art is built **parametrically** (feather fan
along a leading-edge arc) in the generator, so the feathering is tunable. A
hyper-realistic photographic master can be swapped in via the same `png()`
fan-out by replacing the `svg` source with a 1024×1024 PNG.

## Color palette
| Token | Hex | Usage |
|---|---|---|
| `nightDeep` | `#0A1628` | Background base, manifest `background_color` |
| `skyTop` | `#050B1C` | Night-sky top |
| `skyMid` | `#0A1A38` | Night-sky middle |
| `skyHorizon` | `#1A2D55` | Horizon gradient |
| `cityMid` | `#0F1A33` | Skyscraper silhouettes |
| `windowGold` | `#FFD27F` | Window pinpricks, halo ring |
| `angelWhite` | `#FBF7E6` | Angel body, wings |
| `wingCyan` | `#88D7E8` | Wing-tip glow |

## Files
- `icon.svg` — source vector (512×512 viewbox)
- `icon-192.png` — manifest icon, Android Chrome
- `icon-512.png` — manifest icon, install banners
- `icon-1024.png` — App Store listing, hero header

## Deployment targets
| Surface | Source |
|---|---|
| Browser tab favicon | `apps/web/src/app/favicon.ico` (App-Router auto-served at `/favicon.ico`) + `icons` metadata in `apps/web/src/app/layout.tsx` → `/icons/icon-192.png`,`/icon-512.png` |
| iOS home screen | `apps/web/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png` (1024², Xcode auto-scales) |
| Android launcher | `apps/web/android/app/src/main/res/mipmap-*/ic_launcher*.png` (5 densities) |
| Android adaptive bg | `apps/web/android/app/src/main/res/values/ic_launcher_background.xml` |
| Web app install | `apps/web/public/manifest.json` |
| Icon generator | `apps/web/scripts/generate-communitysafe-icons.mjs` (emits all of the above incl. `favicon.ico`) |

## Regenerating PNGs from the SVG
```bash
npm run icons:generate --workspace=@travelsafe/web
```

## Re-shipping after a redesign
1. Update `apps/web/scripts/generate-communitysafe-icons.mjs`
2. Run `npm run icons:generate --workspace=@travelsafe/web`
3. Rebuild the Android AAB: `cd apps/web/android && ./gradlew bundleRelease`
4. Upload the AAB to Play Console
5. Push to git; Vercel + iOS Xcode pick up the new icon on next build
