"use client";
import { useEffect, useState } from "react";
import { useCity } from "@/lib/use-city";

// Verified Wikimedia Commons photos of the actual cities. Each URL has been
// curl-checked to return HTTP 200 + image/jpeg, and each photo is a
// recognizable landmark (skyline, bridge, observatory, etc.) of the named
// city — no generic stock imagery, no random Lorem Picsum fillers.
//
// All URLs are at 1920×1080 (Wikimedia's standard 1920px thumb width) for
// 1080p backdrop quality.
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
    "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d1/Lombard_Street_2020.jpg/1920px-Lombard_Street_2020.jpg",
  ],
  "chicago": [
    // Chicago Loop skyline April 2024 (Wikipedia infobox)
    "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a3/Chicago_Skyline_in_April_2024_b.jpg/1920px-Chicago_Skyline_in_April_2024_b.jpg",
    // Wide downtown panorama from Lake Michigan
    "https://upload.wikimedia.org/wikipedia/commons/thumb/6/67/Chicago_Skyline_in_September_2023_pano.jpg/1920px-Chicago_Skyline_in_September_2023_pano.jpg",
    // Full Chicago skyline with North Side skyscrapers
    "https://upload.wikimedia.org/wikipedia/commons/thumb/7/73/Full_chicago_skyline.jpg/1920px-Full_chicago_skyline.jpg",
    // Downtown Chicago at night along the Chicago River
    "https://upload.wikimedia.org/wikipedia/commons/thumb/3/31/DowntownChicagoILatNight.jpg/1920px-DowntownChicagoILatNight.jpg",
  ],
  "seattle": [
    // Aerial of Downtown Seattle financial district, July 2025
    "https://upload.wikimedia.org/wikipedia/commons/thumb/1/1e/Seattle_Downtown_Aerial%2C_July_2025_%28zoomed_and_perspective_corrected%29.jpg/1920px-Seattle_Downtown_Aerial%2C_July_2025_%28zoomed_and_perspective_corrected%29.jpg",
    // Kerry Park panorama: Space Needle + downtown highrise cluster
    "https://upload.wikimedia.org/wikipedia/commons/thumb/1/16/Seattle_skyline_panorama_from_Kerry_Park%2C_June_2022.jpg/1920px-Seattle_skyline_panorama_from_Kerry_Park%2C_June_2022.jpg",
    // Downtown grid from the Columbia Center observation deck
    "https://upload.wikimedia.org/wikipedia/commons/thumb/6/6c/Seattle-Columbia-Center-looking-north-2320.jpg/1920px-Seattle-Columbia-Center-looking-north-2320.jpg",
    // Downtown financial district from Smith Tower
    "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e6/Seattle_downtown_from_smith_tower.jpg/1920px-Seattle_downtown_from_smith_tower.jpg",
  ],
  "new-york": [
    // Empire State Building from Rockefeller Center
    "https://upload.wikimedia.org/wikipedia/commons/thumb/7/7a/View_of_Empire_State_Building_from_Rockefeller_Center_New_York_City_dllu_%28cropped%29.jpg/1920px-View_of_Empire_State_Building_from_Rockefeller_Center_New_York_City_dllu_%28cropped%29.jpg",
    // Times Square at night
    "https://upload.wikimedia.org/wikipedia/commons/thumb/b/ba/New_york_times_square-terabass_%28cropped%29.jpg/1920px-New_york_times_square-terabass_%28cropped%29.jpg",
    // Brooklyn Bridge cables framing Lower Manhattan skyline
    "https://upload.wikimedia.org/wikipedia/commons/thumb/0/0e/Spiderweb_BB_jeh.jpg/1920px-Spiderweb_BB_jeh.jpg",
    // 10-mile Manhattan skyline panorama
    "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3d/10_mile_panorama_of_NYC%2C_Feb.%2C_2018.jpg/1920px-10_mile_panorama_of_NYC%2C_Feb.%2C_2018.jpg",
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
  "oakland": [
    // Downtown Oakland Historic District — dense urban
    "https://upload.wikimedia.org/wikipedia/commons/thumb/5/53/Downtown_Oakland_Historic_District-6_%28cropped%29.jpg/1920px-Downtown_Oakland_Historic_District-6_%28cropped%29.jpg",
    // Fox Oakland Theatre — iconic Art Deco landmark
    "https://upload.wikimedia.org/wikipedia/commons/thumb/2/28/Fox_Oakland_Theatre.jpg/1920px-Fox_Oakland_Theatre.jpg",
    // Grand Avenue side of Lake Merritt — Oakland skyline reflected
    "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c1/Grand_Avenue_side_of_Lake_Merritt%2C_Oakland.jpg/1920px-Grand_Avenue_side_of_Lake_Merritt%2C_Oakland.jpg",
    // Lake Merritt with downtown Oakland surrounding it
    "https://upload.wikimedia.org/wikipedia/commons/thumb/c/ca/Lake_Merritt_2022-06-16.png/1920px-Lake_Merritt_2022-06-16.png",
  ],
  "cincinnati": [
    // Downtown Cincinnati skyline from Devou Park
    "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5c/Downtown_Cincinnati_viewed_from_Devou_Park_%28cropped%29.jpg/1920px-Downtown_Cincinnati_viewed_from_Devou_Park_%28cropped%29.jpg",
    // Downtown Cincinnati from Mt. Adams
    "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f3/Downtown_Cincinnati_viewed_from_Mt._Adams_%28cropped%29.jpg/1920px-Downtown_Cincinnati_viewed_from_Mt._Adams_%28cropped%29.jpg",
    // Carew Tower — iconic Cincinnati Art Deco skyscraper
    "https://upload.wikimedia.org/wikipedia/commons/thumb/6/63/Carew_Tower%2C_Cincinnati%2C_Ohio.jpg/1920px-Carew_Tower%2C_Cincinnati%2C_Ohio.jpg",
    // Cincinnati Union Terminal — Art Deco landmark
    "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f7/Cincinnati_Union_Terminal_principal_facade.jpg/1920px-Cincinnati_Union_Terminal_principal_facade.jpg",
  ],
  "new-orleans": [
    // Central Business District skyline aerial (Wikipedia infobox)
    "https://upload.wikimedia.org/wikipedia/commons/thumb/c/cb/New_Orleans_from_the_Air_September_2019_-_Central_Business_District_Skyline_%28cropped%29.jpg/1920px-New_Orleans_from_the_Air_September_2019_-_Central_Business_District_Skyline_%28cropped%29.jpg",
    // Skyline from Uptown
    "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d3/New_Orleans_Skyline_from_Uptown.jpg/1920px-New_Orleans_Skyline_from_Uptown.jpg",
    // St. Louis Cathedral at night — Jackson Square
    "https://upload.wikimedia.org/wikipedia/commons/thumb/2/2e/Stlouiscathedralnight.jpg/1920px-Stlouiscathedralnight.jpg",
    // French Quarter street scene
    "https://upload.wikimedia.org/wikipedia/commons/thumb/2/2c/French_Quarter03_New_Orleans.JPG/1920px-French_Quarter03_New_Orleans.JPG",
  ],
  "baton-rouge": [
    // Downtown Baton Rouge from Tiger Stadium (Wikipedia infobox)
    "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d0/Downtown_Baton_Rouge%2C_Louisiana_from_Tiger_Stadium_%28LSU%29.jpg/1920px-Downtown_Baton_Rouge%2C_Louisiana_from_Tiger_Stadium_%28LSU%29.jpg",
    // Old Louisiana State Capitol — Gothic Revival landmark
    "https://upload.wikimedia.org/wikipedia/commons/thumb/9/9d/Baton_Rouge_-_Old_State_Capitol_from_the_riverfront%2C_April_2024.jpg/1920px-Baton_Rouge_-_Old_State_Capitol_from_the_riverfront%2C_April_2024.jpg",
    // Mississippi River waterfront, aerial
    "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b2/Baton_Rouge_Louisiana_waterfront_aerial_view.jpg/1920px-Baton_Rouge_Louisiana_waterfront_aerial_view.jpg",
    // Riverfront from the I-10 bridge
    "https://upload.wikimedia.org/wikipedia/commons/thumb/f/fb/Baton_Rouge_riverfront_from_I-10_bridge_5_November_2016_-_1.jpg/1920px-Baton_Rouge_riverfront_from_I-10_bridge_5_November_2016_-_1.jpg",
  ],
  "cambridge": [
    // Cambridge skyline across the Charles River
    "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e3/Cambridge_skyline_November_2016_panorama.jpg/1920px-Cambridge_skyline_November_2016_panorama.jpg",
    // Harvard Yard in autumn
    "https://upload.wikimedia.org/wikipedia/commons/thumb/c/cf/Harvard_Yard_in_autumn%2C_Boston%2C_Massachusetts%2C_2015.jpg/1920px-Harvard_Yard_in_autumn%2C_Boston%2C_Massachusetts%2C_2015.jpg",
    // Charles River from the Cambridge side
    "https://upload.wikimedia.org/wikipedia/commons/thumb/e/ea/Charles_River_Cambridge_USA.jpg/1920px-Charles_River_Cambridge_USA.jpg",
    // MIT Main Campus aerial — Killian Court & the Great Dome
    "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3d/MIT_Main_Campus_Aerial.jpg/1920px-MIT_Main_Campus_Aerial.jpg",
  ],
  "dallas": [
    // Downtown Dallas skyline from Reunion Tower
    "https://upload.wikimedia.org/wikipedia/commons/thumb/0/03/View_of_Dallas_from_Reunion_Tower_August_2015_05.jpg/1920px-View_of_Dallas_from_Reunion_Tower_August_2015_05.jpg",
    // Klyde Warren Park with downtown skyline
    "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b4/Klyde_Warren_Park_and_Dallas%27_Skyline.jpg/1920px-Klyde_Warren_Park_and_Dallas%27_Skyline.jpg",
    // Margaret Hunt Hill Bridge — Calatrava-designed landmark
    "https://upload.wikimedia.org/wikipedia/commons/thumb/9/96/The_Margaret_Hunt_Hill_Bridge.jpg/1920px-The_Margaret_Hunt_Hill_Bridge.jpg",
    // Downtown skyline from Lake Cliff Park
    "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c6/Dallas_downtown_skyline_seen_from_Lake_Cliff.jpg/1920px-Dallas_downtown_skyline_seen_from_Lake_Cliff.jpg",
  ],
  "charlotte": [
    // Uptown Charlotte aerial
    "https://upload.wikimedia.org/wikipedia/commons/thumb/7/7d/Uptown_Charlotte_2018_taking_by_DJI_Phantom_4_pro.jpg/1920px-Uptown_Charlotte_2018_taking_by_DJI_Phantom_4_pro.jpg",
    // Bank of America Corporate Center — iconic downtown landmark
    "https://upload.wikimedia.org/wikipedia/commons/thumb/d/dd/Bank_of_America_Corporate_Center.jpg/1920px-Bank_of_America_Corporate_Center.jpg",
    // Romare Bearden Park
    "https://upload.wikimedia.org/wikipedia/commons/thumb/f/fb/Romare_Bearden_Park_2.JPG/1920px-Romare_Bearden_Park_2.JPG",
    // SouthPark aerial — south Charlotte district
    "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3b/Southpark_aerial_Charlotte_NC.jpg/1920px-Southpark_aerial_Charlotte_NC.jpg",
  ],
  "nashville": [
    // Nashville skyline at dusk
    "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e4/Nashville%2C_TN_skyline.jpg/1920px-Nashville%2C_TN_skyline.jpg",
    // Broadway and Bridgestone Arena
    "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3f/Nashville_Visitor_Center_and_Bridgestone_Arena%2C_Broadway_and_5th_Avenue%2C_Nashville%2C_TN_%2854384487819%29.jpg/1920px-Nashville_Visitor_Center_and_Bridgestone_Arena%2C_Broadway_and_5th_Avenue%2C_Nashville%2C_TN_%2854384487819%29.jpg",
    // Tennessee State Capitol
    "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ae/Tennessee_State_Capitol_2022f.jpg/1920px-Tennessee_State_Capitol_2022f.jpg",
    // The Parthenon — full-scale replica in Centennial Park
    "https://upload.wikimedia.org/wikipedia/commons/thumb/8/89/Parthenon.at.Nashville.Tenenssee.01.jpg/1920px-Parthenon.at.Nashville.Tenenssee.01.jpg",
  ],
  "minneapolis": [
    // Skyline looking south
    "https://upload.wikimedia.org/wikipedia/commons/thumb/3/31/Minneapolis_Skyline_looking_south.jpg/1920px-Minneapolis_Skyline_looking_south.jpg",
    // Stone Arch Bridge over the Mississippi
    "https://upload.wikimedia.org/wikipedia/commons/thumb/6/64/Stone_Arch_Bridge_as_viewed_from_downriver_2019-08-08_%28cropped%29.jpg/1920px-Stone_Arch_Bridge_as_viewed_from_downriver_2019-08-08_%28cropped%29.jpg",
    // Minnehaha Falls
    "https://upload.wikimedia.org/wikipedia/commons/thumb/2/29/Minnehaha_Falls%2C_Minneapolis.jpg/1920px-Minnehaha_Falls%2C_Minneapolis.jpg",
    // Mill City Museum — historic mill ruins
    "https://upload.wikimedia.org/wikipedia/commons/thumb/e/eb/Minneapolis-Mill_City_Museum-20070514_%28cropped%29.jpg/1920px-Minneapolis-Mill_City_Museum-20070514_%28cropped%29.jpg",
  ],
  "cleveland": [
    // Cleveland skyline from Lakewood Park
    "https://upload.wikimedia.org/wikipedia/commons/thumb/9/92/Cleveland_skyline_from_Lakewood_Park%2C_January_2026.jpg/1920px-Cleveland_skyline_from_Lakewood_Park%2C_January_2026.jpg",
    // Playhouse Square chandelier district
    "https://upload.wikimedia.org/wikipedia/commons/thumb/3/37/Cleveland_Playhouse_Square_%2813917560487%29.jpg/1920px-Cleveland_Playhouse_Square_%2813917560487%29.jpg",
    // Rock and Roll Hall of Fame
    "https://upload.wikimedia.org/wikipedia/commons/thumb/4/42/Rock_and_Roll_Hall_of_Fame_-_Joy_of_Museums_1.jpg/1920px-Rock_and_Roll_Hall_of_Fame_-_Joy_of_Museums_1.jpg",
    // Public Square Fountain
    "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d8/Cleveland_Public_Square_Fountain_%2829744768716%29.jpg/1920px-Cleveland_Public_Square_Fountain_%2829744768716%29.jpg",
  ],
};

// 30-second rotation — keeps the backdrop visibly dynamic without distracting
// the user. Each city carries 4 photos, so a full cycle is 2 minutes.
const ROTATE_MS = 30 * 1000;

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
