# CommunitySafe — Icon System (v96)

## Concept
Guardian angel hovering above a modern city skyline, with moonlight, stars,
layered wings, and a brighter halo. The extra detail makes the refreshed icon
visibly different at install and launcher sizes.

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
| Browser tab favicon | `apps/web/src/app/icon.tsx` (Edge runtime ImageResponse) |
| iOS home screen | `apps/web/src/app/apple-icon.tsx` + `Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png` |
| Android launcher | `apps/web/android/app/src/main/res/mipmap-*/ic_launcher*.png` (5 densities) |
| Android adaptive bg | `apps/web/android/app/src/main/res/values/ic_launcher_background.xml` |
| Web app install | `apps/web/public/manifest.json` |
| Icon generator | `apps/web/scripts/generate-communitysafe-icons.mjs` |

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
