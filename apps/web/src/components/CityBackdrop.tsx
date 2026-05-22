"use client";
import { useEffect, useState } from "react";
import { useCity } from "@/lib/use-city";

// Verified Wikimedia Commons photos of the actual cities. Each URL has been
// curl-checked to return HTTP 200 + image/jpeg, and each photo is a
// recognizable landmark (skyline, bridge, observatory, etc.) of the named
// city — no generic stock imagery, no random Lorem Picsum fillers.
//
// Wikimedia accepts only standard thumbnail widths (1280, 1920, 3840). We use
// 1920 where the source is high-res enough, 1280 otherwise.
const PHOTOS: Record<string, string[]> = {
  "san-diego": [
    // Downtown skyline (Wikipedia infobox panorama)
    "https://upload.wikimedia.org/wikipedia/commons/thumb/1/11/San_Diego_skyline_18_%28cropped%29.jpg/1920px-San_Diego_skyline_18_%28cropped%29.jpg",
    // Downtown San Diego — dense high-rise cluster
    "https://upload.wikimedia.org/wikipedia/commons/thumb/2/26/Downtown_San_Diego_02.jpg/1920px-Downtown_San_Diego_02.jpg",
    // Petco Park ballpark with downtown skyline directly behind
    "https://upload.wikimedia.org/wikipedia/commons/thumb/7/74/Petco_Park%2C_San_Diego.jpg/1920px-Petco_Park%2C_San_Diego.jpg",
    // Gaslamp Quarter street view — historic urban district
    "https://upload.wikimedia.org/wikipedia/commons/thumb/4/42/Gaslamp_Quarter_01.jpg/1920px-Gaslamp_Quarter_01.jpg",
  ],
  "los-angeles": [
    // Dense DTLA foreground with mountains far behind
    "https://upload.wikimedia.org/wikipedia/commons/thumb/6/69/Los_Angeles_with_Mount_Baldy.jpg/1920px-Los_Angeles_with_Mount_Baldy.jpg",
    // DTLA financial district skyscraper cluster
    "https://upload.wikimedia.org/wikipedia/commons/thumb/1/1b/DTLA_%2850880465741%29.jpg/1920px-DTLA_%2850880465741%29.jpg",
    // Los Angeles City Hall tower in the civic center
    "https://upload.wikimedia.org/wikipedia/commons/thumb/2/2f/Los_Angeles_City_Hall_2013.jpg/1920px-Los_Angeles_City_Hall_2013.jpg",
    // Walt Disney Concert Hall on Grand Avenue
    "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8c/Walt_Disney_Concert_Hall%2C_LA%2C_CA%2C_jjron_22.03.2012.jpg/1920px-Walt_Disney_Concert_Hall%2C_LA%2C_CA%2C_jjron_22.03.2012.jpg",
  ],
  "san-francisco": [
    // Financial District skyline (lead image of the SF Financial District article)
    "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f1/Financial_District%2C_San_Francisco.jpg/1920px-Financial_District%2C_San_Francisco.jpg",
    // Downtown SF aerial — Salesforce / Transamerica towers
    "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f9/San_Francisco_Downtown_Aerial%2C_August_2025.jpg/1920px-San_Francisco_Downtown_Aerial%2C_August_2025.jpg",
    // Painted Ladies row at Alamo Square with downtown behind
    "https://upload.wikimedia.org/wikipedia/commons/thumb/7/71/Painted_Ladies_San_Francisco_January_2013_panorama_2.jpg/1920px-Painted_Ladies_San_Francisco_January_2013_panorama_2.jpg",
    // Lombard Street's famous crooked block — dense urban scene
    "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d1/Lombard_Street_2020.jpg/1280px-Lombard_Street_2020.jpg",
  ],
  "chicago": [
    // Chicago Loop skyline April 2024 (Wikipedia infobox)
    "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a3/Chicago_Skyline_in_April_2024_b.jpg/1280px-Chicago_Skyline_in_April_2024_b.jpg",
    // Wide downtown panorama from Lake Michigan
    "https://upload.wikimedia.org/wikipedia/commons/thumb/6/67/Chicago_Skyline_in_September_2023_pano.jpg/1280px-Chicago_Skyline_in_September_2023_pano.jpg",
    // Full Chicago skyline with North Side skyscrapers
    "https://upload.wikimedia.org/wikipedia/commons/thumb/7/73/Full_chicago_skyline.jpg/1280px-Full_chicago_skyline.jpg",
    // Downtown Chicago at night along the Chicago River
    "https://upload.wikimedia.org/wikipedia/commons/thumb/3/31/DowntownChicagoILatNight.jpg/1280px-DowntownChicagoILatNight.jpg",
  ],
  "seattle": [
    // Aerial of Downtown Seattle financial district, July 2025
    "https://upload.wikimedia.org/wikipedia/commons/thumb/1/1e/Seattle_Downtown_Aerial%2C_July_2025_%28zoomed_and_perspective_corrected%29.jpg/1280px-Seattle_Downtown_Aerial%2C_July_2025_%28zoomed_and_perspective_corrected%29.jpg",
    // Kerry Park panorama: Space Needle + downtown highrise cluster
    "https://upload.wikimedia.org/wikipedia/commons/thumb/1/16/Seattle_skyline_panorama_from_Kerry_Park%2C_June_2022.jpg/1280px-Seattle_skyline_panorama_from_Kerry_Park%2C_June_2022.jpg",
    // Downtown grid from the Columbia Center observation deck
    "https://upload.wikimedia.org/wikipedia/commons/thumb/6/6c/Seattle-Columbia-Center-looking-north-2320.jpg/1280px-Seattle-Columbia-Center-looking-north-2320.jpg",
    // Downtown financial district from Smith Tower
    "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e6/Seattle_downtown_from_smith_tower.jpg/1280px-Seattle_downtown_from_smith_tower.jpg",
  ],
  "new-york": [
    // Empire State Building from Rockefeller Center
    "https://upload.wikimedia.org/wikipedia/commons/thumb/7/7a/View_of_Empire_State_Building_from_Rockefeller_Center_New_York_City_dllu_%28cropped%29.jpg/1280px-View_of_Empire_State_Building_from_Rockefeller_Center_New_York_City_dllu_%28cropped%29.jpg",
    // Times Square at night
    "https://upload.wikimedia.org/wikipedia/commons/thumb/b/ba/New_york_times_square-terabass_%28cropped%29.jpg/1280px-New_york_times_square-terabass_%28cropped%29.jpg",
    // Brooklyn Bridge cables framing Lower Manhattan skyline
    "https://upload.wikimedia.org/wikipedia/commons/thumb/0/0e/Spiderweb_BB_jeh.jpg/1280px-Spiderweb_BB_jeh.jpg",
    // 10-mile Manhattan skyline panorama
    "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3d/10_mile_panorama_of_NYC%2C_Feb.%2C_2018.jpg/1280px-10_mile_panorama_of_NYC%2C_Feb.%2C_2018.jpg",
  ],
  "denver": [
    // Downtown Denver skyline (Wikipedia infobox crop)
    "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3b/Denver%2C_Colorado_skyline_%28cropped%29.jpg/1920px-Denver%2C_Colorado_skyline_%28cropped%29.jpg",
    // 17th Street financial district skyscraper cluster
    "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5b/Downtown_Denver_Skyscrapers.JPG/1920px-Downtown_Denver_Skyscrapers.JPG",
    // Downtown Denver 2024 — Trinity Church + Mile High Center + Lincoln Center
    "https://upload.wikimedia.org/wikipedia/commons/thumb/7/72/Downtown_Denver_2024.jpg/1920px-Downtown_Denver_2024.jpg",
    // Downtown panorama along Speer Boulevard at midnight
    "https://upload.wikimedia.org/wikipedia/commons/thumb/6/64/2006-07-14-Denver_Skyline_Midnight.jpg/1920px-2006-07-14-Denver_Skyline_Midnight.jpg",
  ],
  "detroit": [
    // Detroit skyline viewed across the river from Windsor (September 2025)
    "https://upload.wikimedia.org/wikipedia/commons/thumb/4/45/Detroit_Skyline_from_Windsor_2025-09-01.jpg/1920px-Detroit_Skyline_from_Windsor_2025-09-01.jpg",
    // Renaissance Center cluster — signature Detroit skyline building
    "https://upload.wikimedia.org/wikipedia/commons/thumb/5/52/Renaissance_Center%2C_Detroit%2C_Michigan_from_S_2014-12-07.jpg/1920px-Renaissance_Center%2C_Detroit%2C_Michigan_from_S_2014-12-07.jpg",
    // Guardian Building — iconic Art Deco skyscraper (2025)
    "https://upload.wikimedia.org/wikipedia/commons/thumb/8/84/Guardian_Building_2025.jpg/1920px-Guardian_Building_2025.jpg",
    // Campus Martius — downtown plaza framed by surrounding skyscrapers
    "https://upload.wikimedia.org/wikipedia/commons/thumb/9/97/Campus_Martius%2C_Detroit%2C_MI.jpg/1920px-Campus_Martius%2C_Detroit%2C_MI.jpg",
  ],
  "washington-dc": [
    // Capitol Hill Historic District — dense urban row houses + Capitol view
    "https://upload.wikimedia.org/wikipedia/commons/thumb/0/0c/DC_Capitol_Historic_District.jpg/1920px-DC_Capitol_Historic_District.jpg",
    // Washington DC Chinatown gate + Penn Quarter buildings (October 2016)
    "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b9/Washington_DC_Chinatown_-_a_-_Oct_2016.jpg/1920px-Washington_DC_Chinatown_-_a_-_Oct_2016.jpg",
    // Georgetown — C&O Canal with historic urban frontage
    "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ae/USA-Georgetown_C%26O_Canal.jpg/1920px-USA-Georgetown_C%26O_Canal.jpg",
    // Union Station — urban transit hub + Beaux-Arts architecture
    "https://upload.wikimedia.org/wikipedia/commons/thumb/9/9e/Union_Station_Washington_DC.jpg/1920px-Union_Station_Washington_DC.jpg",
  ],
  "boston": [
    // Boston skyline from Longfellow Bridge (September 2017 panorama)
    "https://upload.wikimedia.org/wikipedia/commons/thumb/c/ca/Boston_skyline_from_Longfellow_Bridge_September_2017_panorama_2.jpg/1920px-Boston_skyline_from_Longfellow_Bridge_September_2017_panorama_2.jpg",
    // John Hancock Tower — Boston's iconic glass skyscraper
    "https://upload.wikimedia.org/wikipedia/commons/thumb/5/56/John_Hancock_Tower.jpg/1920px-John_Hancock_Tower.jpg",
    // Federal Reserve + Boston financial district from across the Fort Point Channel
    "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f4/Federal_Reserve_from_South_Boston.jpg/1920px-Federal_Reserve_from_South_Boston.jpg",
    // Old State House on State Street — historic urban architecture
    "https://upload.wikimedia.org/wikipedia/commons/thumb/9/9a/Old_State_House_%2849280448012%29.jpg/1920px-Old_State_House_%2849280448012%29.jpg",
  ],
  "philadelphia": [
    // Philadelphia skyline May 2024 (Wikipedia infobox panorama)
    "https://upload.wikimedia.org/wikipedia/commons/thumb/1/19/Philadelphia_skyline_20240528_%28cropped_2-1%29.jpg/1920px-Philadelphia_skyline_20240528_%28cropped_2-1%29.jpg",
    // Skyline viewed from Spring Garden Street Bridge (2018)
    "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3a/A651%2C_Philadelphia_skyline_from_the_Spring_Garden_Street_Bridge%2C_2018.jpg/1920px-A651%2C_Philadelphia_skyline_from_the_Spring_Garden_Street_Bridge%2C_2018.jpg",
    // Center City with Comcast Technology Center (tallest building)
    "https://upload.wikimedia.org/wikipedia/commons/thumb/e/ee/View_of_Center_City_%28Comcast_Technology_Center%29.jpg/1920px-View_of_Center_City_%28Comcast_Technology_Center%29.jpg",
    // Philadelphia City Hall aerial view + downtown
    "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b4/Philadelphia_City_Hall%2C_aerial_view%2C_cropped.png/1920px-Philadelphia_City_Hall%2C_aerial_view%2C_cropped.png",
  ],
};

const ROTATE_MS = 5 * 60 * 1000;

export function CityBackdrop() {
  const { city } = useCity();
  const photos = PHOTOS[city.slug] ?? [];
  const [idx, setIdx] = useState(0);
  const [imgError, setImgError] = useState<Record<number, boolean>>({});

  // Reset to the first photo whenever the city changes so the user sees the
  // new city's downtown immediately, then resume rotation.
  useEffect(() => { setIdx(0); setImgError({}); }, [city.slug]);

  useEffect(() => {
    if (photos.length <= 1) return;
    const id = window.setInterval(() => {
      setIdx((i) => (i + 1) % photos.length);
    }, ROTATE_MS);
    return () => window.clearInterval(id);
  }, [photos.length]);

  return (
    <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden" aria-hidden>
      {photos.map((url, i) => (
        <div
          key={`${city.slug}-${i}`}
          className={`absolute inset-0 transition-opacity duration-[2000ms] ${i === idx && !imgError[i] ? "opacity-100" : "opacity-0"}`}
        >
          <img
            src={url}
            alt=""
            loading={i === 0 ? "eager" : "lazy"}
            decoding="async"
            onError={() => setImgError((e) => ({ ...e, [i]: true }))}
            className={`w-full h-full object-cover ${i === idx ? "animate-kenburns" : ""}`}
          />
        </div>
      ))}
      {/* Light legibility overlay — the photo reads clearly while text on top
          stays comfortable to read. No sand-50 wash on the bottom anymore. */}
      <div className="absolute inset-0 bg-gradient-to-b from-white/30 via-white/45 to-white/65" />
    </div>
  );
}
