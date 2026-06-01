// v99 — moved out of CityBackdrop.tsx (a "use client" module). The server
// /credits page imports PHOTOS to render attribution; importing it from a
// client module pulled the entire ~32 KB URL map into a client chunk on a
// static legal page. Living in this plain module, /credits consumes it at
// build time with zero client JS, and CityBackdrop still imports it for the
// backdrop rotation.
//
// Verified Wikimedia Commons photos of the actual cities (curl-checked
// HTTP 200 + image/jpeg, 1920x1080 thumbs). Keyed by city slug.

export const PHOTOS: Record<string, string[]> = {
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
  "colorado-springs": [
    // Colorado Springs skyline with the Rockies behind
    "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3e/Colorado_Springs_Skyline_%2854557268110%29.jpg/1920px-Colorado_Springs_Skyline_%2854557268110%29.jpg",
    // Downtown Colorado Springs street-level view (Shankbone)
    "https://upload.wikimedia.org/wikipedia/commons/thumb/4/44/Downtown_Colorado_Springs_3_by_David_Shankbone.jpg/1920px-Downtown_Colorado_Springs_3_by_David_Shankbone.jpg",
    // Downtown Colorado Springs from the east — Pikes Peak in the distance
    "https://upload.wikimedia.org/wikipedia/commons/thumb/6/63/Downtown_Colorado_Springs_from_the_east.jpg/1920px-Downtown_Colorado_Springs_from_the_east.jpg",
    // Downtown Colorado Springs aerial-style crop (Shankbone)
    "https://upload.wikimedia.org/wikipedia/commons/thumb/a/aa/Downtown_Colorado_Springs_by_David_Shankbone_cropped.jpg/1920px-Downtown_Colorado_Springs_by_David_Shankbone_cropped.jpg",
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
  "baltimore": [
    // Inner Harbor
    "https://upload.wikimedia.org/wikipedia/commons/3/35/Baltimore_Inner_Harbor.jpg",
    // Skyline of Baltimore
    "https://upload.wikimedia.org/wikipedia/commons/thumb/7/76/Skyline_of_Baltimore.jpg/1920px-Skyline_of_Baltimore.jpg",
    // Washington Monument, Mount Vernon
    "https://upload.wikimedia.org/wikipedia/commons/thumb/9/97/Washington_Monument_Baltimore.jpg/1920px-Washington_Monument_Baltimore.jpg",
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
  "milwaukee": [
    // Milwaukee Art Museum (Calatrava)
    "https://upload.wikimedia.org/wikipedia/commons/thumb/2/2a/Milwaukee_Art_Museum_-_Quadracci_Pavilion_-_aerial.jpg/1920px-Milwaukee_Art_Museum_-_Quadracci_Pavilion_-_aerial.jpg",
    // Milwaukee skyline at dusk
    "https://upload.wikimedia.org/wikipedia/commons/thumb/9/94/Milwaukee_skyline_2.jpg/1920px-Milwaukee_skyline_2.jpg",
    // Historic Third Ward
    "https://upload.wikimedia.org/wikipedia/commons/thumb/1/12/Historic_third_ward_at_dusk.jpg/1920px-Historic_third_ward_at_dusk.jpg",
  ],
  "las-vegas": [
    // Las Vegas aerial from above
    "https://upload.wikimedia.org/wikipedia/commons/thumb/d/da/Las_Vegas_from_above_%2840064746644%29.jpg/1920px-Las_Vegas_from_above_%2840064746644%29.jpg",
    // Las Vegas Strip
    "https://upload.wikimedia.org/wikipedia/commons/thumb/e/ee/Las_Vegas_Strip_09_2017_4897.jpg/1920px-Las_Vegas_Strip_09_2017_4897.jpg",
    // Las Vegas at night
    "https://upload.wikimedia.org/wikipedia/commons/thumb/8/87/Las_Vegas_at_Night.JPG/1920px-Las_Vegas_at_Night.JPG",
    // Symphony Park downtown
    "https://upload.wikimedia.org/wikipedia/commons/thumb/8/85/LasVegasSymphonyPark1.jpg/1920px-LasVegasSymphonyPark1.jpg",
  ],
  "boise": [
    // Boise downtown panoramic
    "https://upload.wikimedia.org/wikipedia/commons/thumb/c/cf/Boise_Downtown_Panoramic.jpg/1920px-Boise_Downtown_Panoramic.jpg",
    // Idaho State Capitol
    "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4f/Idaho_Capitol_Building.JPG/1920px-Idaho_Capitol_Building.JPG",
    // Boise River with downtown
    "https://upload.wikimedia.org/wikipedia/commons/thumb/6/62/Idaho_-_Boise_through_Boise_River_-_NARA_-_23939399_%28cropped%29.jpg/1920px-Idaho_-_Boise_through_Boise_River_-_NARA_-_23939399_%28cropped%29.jpg",
    // Hyde Park neighborhood
    "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3d/Hyde_Park_Boise.jpg/1920px-Hyde_Park_Boise.jpg",
  ],
  "buffalo": [
    // Buffalo skyline
    "https://upload.wikimedia.org/wikipedia/commons/thumb/1/14/Buffalo%2C_NY_skyline.jpg/1920px-Buffalo%2C_NY_skyline.jpg",
    // Buffalo City Hall
    "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d0/View_of_Buffalo_City_Hall_%28cropped%29.jpg/1920px-View_of_Buffalo_City_Hall_%28cropped%29.jpg",
    // Allentown neighborhood
    "https://upload.wikimedia.org/wikipedia/commons/thumb/9/90/AllentownBuffalo1.jpg/1920px-AllentownBuffalo1.jpg",
    // Shea's Buffalo Theater on Main Street
    "https://upload.wikimedia.org/wikipedia/commons/thumb/f/fe/Shea%27s_Buffalo_Theater%2C_Main_Street%2C_Buffalo%2C_NY.jpg/1920px-Shea%27s_Buffalo_Theater%2C_Main_Street%2C_Buffalo%2C_NY.jpg",
  ],
  "norfolk": [
    // Norfolk, Virginia skyline 2016 — Wikipedia infobox photo
    "https://upload.wikimedia.org/wikipedia/commons/thumb/b/bf/Norfolk%2C_Virginia_skyline_2016.jpg/1920px-Norfolk%2C_Virginia_skyline_2016.jpg",
    // Downtown Norfolk skyline looking toward Portsmouth across the Elizabeth River
    "https://upload.wikimedia.org/wikipedia/commons/thumb/2/26/Skyline_of_Downtown_Norfolk_Looking_Towards_Portsmouth.jpg/1920px-Skyline_of_Downtown_Norfolk_Looking_Towards_Portsmouth.jpg",
    // Downtown Norfolk skyline November 2021 — fresh tower additions
    "https://upload.wikimedia.org/wikipedia/commons/thumb/0/01/Downtown_Norfolk_VA_skyline_Nov_2021.jpg/1920px-Downtown_Norfolk_VA_skyline_Nov_2021.jpg",
    // Norfolk from Portsmouth across the Elizabeth River, 2020
    "https://upload.wikimedia.org/wikipedia/commons/thumb/8/89/Norfolk_VA_from_Portsmouth_2020.jpg/1920px-Norfolk_VA_from_Portsmouth_2020.jpg",
  ],
  "kansas-city": [
    // Downtown Kansas City
    "https://upload.wikimedia.org/wikipedia/commons/thumb/7/79/Kansas_City_-_Downtown_-_panoramio_%2815%29.jpg/1920px-Kansas_City_-_Downtown_-_panoramio_%2815%29.jpg",
    // Country Club Plaza
    "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f8/Country_Club_Plaza_2_Kansas_City_MO.jpg/1920px-Country_Club_Plaza_2_Kansas_City_MO.jpg",
    // Union Station
    "https://upload.wikimedia.org/wikipedia/commons/thumb/9/92/Kansas_City%2C_MO_Union_Station_%283557621442%29.jpg/1920px-Kansas_City%2C_MO_Union_Station_%283557621442%29.jpg",
    // J.C. Nichols Fountain
    "https://upload.wikimedia.org/wikipedia/commons/thumb/6/61/JC_Nichols_Fountain_by_Henri-L%C3%A9on_Gr%C3%A9ber_Kansas_City.jpg/1920px-JC_Nichols_Fountain_by_Henri-L%C3%A9on_Gr%C3%A9ber_Kansas_City.jpg",
  ],
  "saint-paul": [
    // Saint Paul skyline from West Side
    "https://upload.wikimedia.org/wikipedia/commons/thumb/5/59/Saint_Paul_skyline%2C_West_Side_%28cropped%29.jpg/1920px-Saint_Paul_skyline%2C_West_Side_%28cropped%29.jpg",
    // Cathedral of St Paul from Landmark Center
    "https://upload.wikimedia.org/wikipedia/commons/thumb/6/65/Cathedral_of_St._Paul_from_the_Landmark_Center.jpg/1920px-Cathedral_of_St._Paul_from_the_Landmark_Center.jpg",
    // Minnesota State Capitol
    "https://upload.wikimedia.org/wikipedia/commons/thumb/0/0b/Minnesota_State_Capitol_2017.jpg/1920px-Minnesota_State_Capitol_2017.jpg",
    // Saint Paul City Hall
    "https://upload.wikimedia.org/wikipedia/commons/thumb/3/36/Saint_Paul_City_Hall.jpg/1920px-Saint_Paul_City_Hall.jpg",
  ],
  "pittsburgh": [
    // Pittsburgh skyline at night
    "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b6/Pittsburgh_skyline_panorama_at_night.jpg/1920px-Pittsburgh_skyline_panorama_at_night.jpg",
    // Duquesne Incline
    "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d6/Ascending_the_Duquesne_Incline.jpg/1920px-Ascending_the_Duquesne_Incline.jpg",
    // Pittsburgh from North Hills
    "https://upload.wikimedia.org/wikipedia/commons/thumb/6/65/Pittsburgh_%28view_from_the_North_Hills%29.JPG/1920px-Pittsburgh_%28view_from_the_North_Hills%29.JPG",
    // Acrisure Stadium and downtown skyline
    "https://upload.wikimedia.org/wikipedia/commons/thumb/1/15/Pittsburgh_-_Acrisure_Stadium_and_Skyline_%2853910936115%29.jpg/1920px-Pittsburgh_-_Acrisure_Stadium_and_Skyline_%2853910936115%29.jpg",
  ],
  "fort-worth": [
    // Downtown Fort Worth
    "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f7/Downtown_Fort_Worth.jpg/1920px-Downtown_Fort_Worth.jpg",
    // Sundance Square
    "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c4/Sundance_Square.jpg/1920px-Sundance_Square.jpg",
    // Fort Worth Stockyards
    "https://upload.wikimedia.org/wikipedia/commons/thumb/6/65/Fort_Worth_Stockyards.jpg/1920px-Fort_Worth_Stockyards.jpg",
  ],
  // v99 — the 7 most-recently-added live cities had no backdrop entry, so
  // PHOTOS[slug] ?? [] returned empty and rendered NO photo (Denver, etc.).
  // All URLs below are Wikimedia Commons skyline/cityscape thumbs, curl-
  // verified HTTP 200 + image/jpeg via the Commons imageinfo API.
  "denver": [
    // Denver skyline with the Rocky Mountains behind
    "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3b/Denver%2C_Colorado_skyline_%28cropped%29.jpg/1920px-Denver%2C_Colorado_skyline_%28cropped%29.jpg",
    "https://upload.wikimedia.org/wikipedia/commons/thumb/3/31/Denver%2C_Colorado_skyline.jpg/1920px-Denver%2C_Colorado_skyline.jpg",
    "https://upload.wikimedia.org/wikipedia/commons/thumb/3/37/Denver%2C_Colorado_skyline_%28cropped_3x5%29.jpg/1920px-Denver%2C_Colorado_skyline_%28cropped_3x5%29.jpg",
    "https://upload.wikimedia.org/wikipedia/commons/d/d8/Denver_Colorado_Skyline.jpg",
  ],
  "sacramento": [
    // Sacramento downtown skyline (Tower Bridge / Capitol district)
    "https://upload.wikimedia.org/wikipedia/commons/thumb/4/40/Sacramento_Skyline_%28cropped%29.jpg/1920px-Sacramento_Skyline_%28cropped%29.jpg",
    "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5b/Sacramento%2C_California_skyline_in_2023.jpg/1920px-Sacramento%2C_California_skyline_in_2023.jpg",
    "https://upload.wikimedia.org/wikipedia/commons/thumb/b/ba/Sacramento%2C_California_skyline_2026.jpg/1920px-Sacramento%2C_California_skyline_2026.jpg",
    "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ad/Sacramento%2C_California_skyline.jpg/1920px-Sacramento%2C_California_skyline.jpg",
  ],
  "atlanta": [
    // Midtown Atlanta skyline over Piedmont Park's Lake Clara Meer
    "https://upload.wikimedia.org/wikipedia/commons/thumb/0/0d/Piedmont_Park%E2%80%99s_Lake_Clara_Meer_with_Midtown_Atlanta_skyline_%282024%29-104A8428.jpg/1920px-Piedmont_Park%E2%80%99s_Lake_Clara_Meer_with_Midtown_Atlanta_skyline_%282024%29-104A8428.jpg",
    "https://upload.wikimedia.org/wikipedia/commons/6/6b/Atlanta%2C_Georgia_Skyline.jpg",
    // Downtown Atlanta skyline from the Jackson Street Bridge
    "https://upload.wikimedia.org/wikipedia/commons/thumb/3/37/Atlanta_skyline_from_Jackson_Street_Bridge_2020.jpg/1920px-Atlanta_skyline_from_Jackson_Street_Bridge_2020.jpg",
    "https://upload.wikimedia.org/wikipedia/commons/6/68/Atlanta_Skyline_-_March_2019_%28cropped_2%29.jpg",
  ],
  "indianapolis": [
    // Downtown Indianapolis skyline (Chris Bowman)
    "https://upload.wikimedia.org/wikipedia/commons/thumb/e/ec/Indianapolis_skyline_-_2014_April_-_Chris_Bowman.jpg/1920px-Indianapolis_skyline_-_2014_April_-_Chris_Bowman.jpg",
    "https://upload.wikimedia.org/wikipedia/commons/9/91/Indianapolis_skyline_at_night_-_Sarah_Stierch.jpg",
    // Indianapolis skyline from White River State Park
    "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d0/White_River_State_Park_Indianapolis_Skyline_2020.jpg/1920px-White_River_State_Park_Indianapolis_Skyline_2020.jpg",
    "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4d/Skyline_at_the_Indianapolis_Zoo_-_June_2022_-_Sarah_Stierch.jpg/1920px-Skyline_at_the_Indianapolis_Zoo_-_June_2022_-_Sarah_Stierch.jpg",
  ],
  "raleigh": [
    // Downtown Raleigh skyline
    "https://upload.wikimedia.org/wikipedia/commons/thumb/9/99/Raleigh%2C_North_Carolina_skyline_--_27_September_2014_%28panoramio.com%29.jpg/1920px-Raleigh%2C_North_Carolina_skyline_--_27_September_2014_%28panoramio.com%29.jpg",
    "https://upload.wikimedia.org/wikipedia/commons/9/9c/Raleigh_skyline_along_S_Saunders_st.jpg",
    "https://upload.wikimedia.org/wikipedia/commons/6/64/Partial_view_of_Raleigh%2C_North_Carolina%27s_growing_skyline_--_19_May_2012.jpg",
    // Red Hat headquarters tower, downtown Raleigh
    "https://upload.wikimedia.org/wikipedia/commons/f/fc/Red_Hat_headquarters_at_Raleigh%2C_North_Carolina%2C_US_--_9_November_2013.jpg",
  ],
  "tucson": [
    // Tucson skyline against the desert mountains
    "https://upload.wikimedia.org/wikipedia/commons/thumb/f/fe/Tucson_skyline.JPG/1920px-Tucson_skyline.JPG",
    "https://upload.wikimedia.org/wikipedia/commons/thumb/b/be/Downtown_Tucson%2C_AZ_%28W._Pennington%29%2C_2007-04-02.jpg/1920px-Downtown_Tucson%2C_AZ_%28W._Pennington%29%2C_2007-04-02.jpg",
    "https://upload.wikimedia.org/wikipedia/commons/6/68/Tucson_asr.JPG",
    "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c6/Downtown_Tucson%2C_Arizona_5_-_panoramio.jpg/1920px-Downtown_Tucson%2C_Arizona_5_-_panoramio.jpg",
  ],
  "honolulu": [
    // Honolulu cityscape with Waikiki and Diamond Head
    "https://upload.wikimedia.org/wikipedia/commons/thumb/0/09/Panorama_of_Honolulu-Waikiki-Diamond_Head_%2816773142068%29.jpg/1920px-Panorama_of_Honolulu-Waikiki-Diamond_Head_%2816773142068%29.jpg",
    "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c7/Honolulu_-_panoramio.jpg/1920px-Honolulu_-_panoramio.jpg",
    "https://upload.wikimedia.org/wikipedia/commons/9/95/Waikiki_Diamond_Head_CC.jpg",
    "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d6/Waikiki_Beach.jpg/1920px-Waikiki_Beach.jpg",
  ],
  "long-beach": [
    // Downtown Long Beach skyline from the Queen Mary at dusk
    "https://upload.wikimedia.org/wikipedia/commons/thumb/7/7d/Downtown%2C_Long_Beach_from_Queen_Mary_%28Dusk%29.JPG/1920px-Downtown%2C_Long_Beach_from_Queen_Mary_%28Dusk%29.JPG.jpg",
    "https://upload.wikimedia.org/wikipedia/commons/thumb/f/ff/Queen_Mary_Long_Beach.JPG/1920px-Queen_Mary_Long_Beach.JPG.jpg",
    "https://upload.wikimedia.org/wikipedia/commons/thumb/f/ff/Long_Beach_CA_Photo_D_Ramey_Logan.jpg/1920px-Long_Beach_CA_Photo_D_Ramey_Logan.jpg",
    "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e8/Downtown_Long_Beach_California_Aerial.jpg/1920px-Downtown_Long_Beach_California_Aerial.jpg",
  ],
  "austin": [
    // Downtown Austin skyline, December 2023 (daytime)
    "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4a/Austin_Texas_skyline%2C_December_2023_-_Day.jpg/1920px-Austin_Texas_skyline%2C_December_2023_-_Day.jpg",
    // Austin skyline 2018 — downtown high-rise cluster
    "https://upload.wikimedia.org/wikipedia/commons/thumb/6/67/Austin%2C_Texas_Skyline_2018.jpg/1920px-Austin%2C_Texas_Skyline_2018.jpg",
    // Downtown skyline at dusk in 2016
    "https://upload.wikimedia.org/wikipedia/commons/thumb/6/62/Austin_Texas_skyline_at_dusk_in_2016.jpg/1920px-Austin_Texas_skyline_at_dusk_in_2016.jpg",
    // Skyline reflected over the Colorado River (Lady Bird Lake)
    "https://upload.wikimedia.org/wikipedia/commons/thumb/8/88/Colorado_River_and_Austin%2C_Texas_Skyline_%2846879015824%29.jpg/1920px-Colorado_River_and_Austin%2C_Texas_Skyline_%2846879015824%29.jpg",
  ],
  "phoenix": [
    // Phoenix skyline with the desert mountains behind
    "https://upload.wikimedia.org/wikipedia/commons/thumb/6/62/Phoenix_skyline_Arizona_USA.jpg/1920px-Phoenix_skyline_Arizona_USA.jpg",
    // Downtown Phoenix skyline high-rise cluster
    "https://upload.wikimedia.org/wikipedia/commons/thumb/c/cf/Downtown_Phoenix_Skyline_%286974043971%29.jpg/1920px-Downtown_Phoenix_Skyline_%286974043971%29.jpg",
    // Downtown Phoenix skyline lit at night
    "https://upload.wikimedia.org/wikipedia/commons/thumb/5/58/Downtown_Phoenix_Skyline_Lights.jpg/1920px-Downtown_Phoenix_Skyline_Lights.jpg",
    // Phoenix skyline from South Mountain at night
    "https://upload.wikimedia.org/wikipedia/commons/thumb/c/cc/Phoenix_Skyline_from_South_Mountain_at_Night.2010.jpg/1920px-Phoenix_Skyline_from_South_Mountain_at_Night.2010.jpg",
  ],
  "jacksonville": [
    // Jacksonville downtown skyline panorama over the St. Johns River
    "https://upload.wikimedia.org/wikipedia/commons/thumb/5/53/Jacksonville_Skyline_Panorama_2.jpg/1920px-Jacksonville_Skyline_Panorama_2.jpg",
    // Jacksonville skyline panorama (riverfront)
    "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ae/Jacksonville_Skyline_Panorama_3.jpg/1920px-Jacksonville_Skyline_Panorama_3.jpg",
    // Downtown Jacksonville, south view (2016)
    "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f3/Skyline_of_Jacksonville_FL%2C_South_view_20160706_1.jpg/1920px-Skyline_of_Jacksonville_FL%2C_South_view_20160706_1.jpg",
    // Jacksonville skyline at night (2025)
    "https://upload.wikimedia.org/wikipedia/commons/thumb/1/1f/Jacksonville_Florida_Night_Skyline_New_Year_2025.jpg/1920px-Jacksonville_Florida_Night_Skyline_New_Year_2025.jpg",
  ],
  "virginia-beach": [
    // Virginia Beach oceanfront — boardwalk and shoreline (2024)
    "https://upload.wikimedia.org/wikipedia/commons/thumb/4/44/Virginia_Beach_Oceanfront_2024-08-31.jpg/1920px-Virginia_Beach_Oceanfront_2024-08-31.jpg",
    // King Neptune statue — iconic Virginia Beach boardwalk landmark
    "https://upload.wikimedia.org/wikipedia/commons/thumb/3/30/King_Neptune%2C_Virginia_Beach.jpg/1920px-King_Neptune%2C_Virginia_Beach.jpg",
    // Virginia Beach oceanfront beach and resort strip
    "https://upload.wikimedia.org/wikipedia/commons/thumb/d/db/Beach_at_Virginia_Beach_Oceanfront_01.jpg/1920px-Beach_at_Virginia_Beach_Oceanfront_01.jpg",
    // Oceanfront looking south down the resort strip
    "https://upload.wikimedia.org/wikipedia/commons/thumb/9/92/Beach_at_Virginia_Beach_Oceanfront_-_Facing_South.jpg/1920px-Beach_at_Virginia_Beach_Oceanfront_-_Facing_South.jpg",
  ],
  "gainesville": [
    // Downtown Gainesville, Florida
    "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3b/Downtown_Gainesville%2C_FL.jpg/1920px-Downtown_Gainesville%2C_FL.jpg",
    // Downtown Gainesville street view
    "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Gainesville%2C_FL_Downtown.jpg/1920px-Gainesville%2C_FL_Downtown.jpg",
    // Century Tower — landmark carillon at the University of Florida
    "https://upload.wikimedia.org/wikipedia/commons/thumb/0/03/Century_Tower_%28University_of_Florida%29.jpg/1920px-Century_Tower_%28University_of_Florida%29.jpg",
    // Ben Hill Griffin Stadium ("The Swamp") — UF landmark
    "https://upload.wikimedia.org/wikipedia/commons/thumb/1/12/Ben_Hill_Griffin_Stadium_-_Florida_Gators.jpg/1920px-Ben_Hill_Griffin_Stadium_-_Florida_Gators.jpg",
  ],
  "tampa": [
    // Tampa skyline across Hillsborough Bay from Ballast Point Park (2024)
    "https://upload.wikimedia.org/wikipedia/commons/thumb/1/14/Tampa_Skyline_from_Ballast_Point_Park_April_2024.jpg/1920px-Tampa_Skyline_from_Ballast_Point_Park_April_2024.jpg",
    // Downtown Tampa skyline along the Hillsborough River
    "https://upload.wikimedia.org/wikipedia/commons/thumb/b/bf/Downtown_Tampa%2C_Florida.jpg/1920px-Downtown_Tampa%2C_Florida.jpg",
    // Tampa Riverwalk along the Hillsborough River downtown
    "https://upload.wikimedia.org/wikipedia/commons/thumb/4/49/Tampa_Riverwalk_02.jpg/1920px-Tampa_Riverwalk_02.jpg",
    // Historic TECO Line streetcar in Ybor City
    "https://upload.wikimedia.org/wikipedia/commons/thumb/2/2a/Streetcar_-_Ybor_City_-_Tampa%2C_Florida%2C_2012.jpg/1920px-Streetcar_-_Ybor_City_-_Tampa%2C_Florida%2C_2012.jpg",
  ],
};
