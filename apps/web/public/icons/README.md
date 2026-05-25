# CommunitySafe — Icon System (v65)

## Concept
Guardian angel hovering above a modern city skyline. Glowing wings + halo
suggest protection without overly religious detail. Symbolic, elegant, and
universal.

## Color palette
| Token | Hex | Usage |
|---|---|---|
| `nightDeep` | `#0A1628` | Background base, manifest `background_color` |
| `nightMid` | `#122440` | Gradient top |
| `citySilh` | `#1A2640` | Skyscraper silhouettes |
| `windowGold` | `#FFD27F` | Window pinpricks, halo ring |
| `angelWhite` | `#FFFFFF` | Angel body, wings |
| `wingCyan` | `#88D7E8` | Wing-tip glow |
| `daySky` | `#E8F4FA` | Light-mode background |
| `dayCity` | `#5D6A78` | Light-mode silhouettes |

## Files
- `icon.svg` — source vector (512×512 viewbox)
- `icon-192.png` — manifest icon, Android Chrome
- `icon-512.png` — manifest icon, install banners
- `icon-1024.png` — App Store listing, hero header

## React components
- `@/components/AppIcon` — full-detail SVG (default `dark` theme)
- `@/components/AppIconSimple` — favicon-safe simplified (no windows)

## Deployment targets
| Surface | Source |
|---|---|
| Browser tab favicon | `apps/web/src/app/icon.tsx` (Edge runtime ImageResponse) |
| iOS home screen | `apps/web/src/app/apple-icon.tsx` + `Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png` |
| Android launcher | `apps/web/android/app/src/main/res/mipmap-*/ic_launcher*.png` (5 densities) |
| Android adaptive bg | `apps/web/android/app/src/main/res/values/ic_launcher_background.xml` |
| Web app install | `apps/web/public/manifest.json` |
| OG image | `apps/web/src/app/opengraph-image.tsx` (uses same palette) |

## Regenerating PNGs from the SVG
```bash
SVG=/Users/damiengantt-mcdade/TravelSafe/apps/web/public/icons/icon.svg
RES=/Users/damiengantt-mcdade/TravelSafe/apps/web/android/app/src/main/res

# Web
magick -background none -density 600 $SVG -resize 1024x1024 apps/web/public/icons/icon-1024.png
magick -background none -density 600 $SVG -resize 512x512  apps/web/public/icons/icon-512.png
magick -background none -density 600 $SVG -resize 192x192  apps/web/public/icons/icon-192.png

# Android
for D in mdpi:48 hdpi:72 xhdpi:96 xxhdpi:144 xxxhdpi:192; do
  DEN=$(echo $D | cut -d: -f1); S=$(echo $D | cut -d: -f2)
  magick -background none -density 600 $SVG -resize ${S}x${S} $RES/mipmap-$DEN/ic_launcher.png
  magick -background none -density 600 $SVG -resize ${S}x${S} $RES/mipmap-$DEN/ic_launcher_round.png
  magick -background none -density 600 $SVG -resize ${S}x${S} $RES/mipmap-$DEN/ic_launcher_foreground.png
done

# iOS (Xcode generates derivatives from 1024)
magick -background none -density 600 $SVG -resize 1024x1024 apps/web/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png
```

## Re-shipping after a redesign
1. Edit `icon.svg` (or update `ICON_SVG_DARK` in `@/components/AppIcon.tsx`)
2. Run the regenerate block above
3. Rebuild the Android AAB: `cd apps/web/android && ./gradlew bundleRelease`
4. Upload the AAB to Play Console
5. Push to git; Vercel + iOS Xcode pick up the new icon on next build
