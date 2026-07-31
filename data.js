/*
  AREA CODES — data schema reference (NOT loaded by the site)
  -------------------------------------------------------------
  The live site now reads its content from data.json, which is edited two
  ways:
    1. The password-protected "Add Artist" page on the site itself (adds
       go live automatically within about a minute).
    2. Hand-editing data.json directly — it's plain JSON with this exact
       shape, just without comments and with quoted keys. This file is kept
       around purely so the shape is documented somewhere with explanations.

  STRUCTURE
  regions            -> array of region objects
    region.cities     -> array of city objects
      city.neighborhoods (optional) -> array of neighborhood objects, same
                          shape as a city, for when you want to go more granular
                          than city-level (e.g. specific parts of Queens or LA)
      city.artists      -> array of artist objects

  City placement on the state-level map (stateOutlines.js) is precomputed
  separately from real geography — you don't need to touch that file unless
  you're adding a documented city to a state that doesn't have a map yet.

  HOW TO ADD A NEW ARTIST TO AN EXISTING CITY
    Find the city below, go to its "artists" array, and copy-paste this block
    inside the [ ] (don't forget a comma after the previous entry):

    {
      name: "Artist Name",
      note: "One or two sentences on their style and why they represent this place's sound.",
      tracks: [
        { title: "Song Name", spotifyId: "PASTE_ID_HERE" }
      ]
    }

  HOW TO GET spotifyId
    Open the song on open.spotify.com, copy the link — it looks like
    https://open.spotify.com/track/6xhblLundMJAiG9jF7nlxs — and use just the
    part after the last slash (6xhblLundMJAiG9jF7nlxs) as spotifyId. If you
    don't have one yet, you can omit the field and the title will just show
    as plain (non-clickable) text.

  HOW TO ADD A WHOLE NEW CITY
    Copy an entire { ... } city block, paste it into the region's "cities"
    array, and edit every field.

  HOW TO ADD A WHOLE NEW REGION
    Copy an entire { ... } region block below, paste it into the top-level
    "regions" array, and edit every field.

  NOTE ON THE STARTER DATA
  The entries below are a seed/starter set based on widely-documented hip-hop
  history — meant to demonstrate the pattern and get the site working. Verify,
  correct, and expand on all of it with your own knowledge. This is your
  special-interest project — treat everything here as a rough draft.
*/

const regions = [
  {
    id: "atlanta",
    name: "Atlanta & the Dirty South",
    blurb: "The trap's home base — where 808s got darker, hi-hats got faster, and the tempo of Southern rap changed permanently.",
    cities: [
      {
        id: "atlanta-city",
        name: "Atlanta, GA",
        state: "GA",
        artists: [
          {
            name: "Gucci Mane",
            note: "Early trap-era Atlanta voice; helped define the genre's lyrical and sonic template alongside producers like Zaytoven.",
            tracks: [
              { title: "Freaky Gurl", spotifyId: "25NDdQArkJni9i2zSUlYKj" },
              { title: "Lemonade", spotifyId: "6rUcS9i07F6okIe8wujs5J" }
            ]
          },
          {
            name: "Future",
            note: "Popularized the melodic, Auto-Tuned delivery over dark 808 production that came to define a huge swath of mainstream trap.",
            tracks: [
              { title: "Mask Off", spotifyId: "0VgkVdmE4gld66l8iyGjgx" },
              { title: "Codeine Crazy", spotifyId: "0ys7qDKabADPpq5pF9zIlY" }
            ]
          },
          {
            name: "Migos",
            note: "Known for triplet flow (three syllables per beat) that became one of the most widely imitated rhythmic patterns in all of rap nationally.",
            tracks: [
              { title: "Versace", spotifyId: "6xhblLundMJAiG9jF7nlxs" },
              { title: "Bad and Boujee", spotifyId: "0M9ydKzuF3oZTfYYPfaGX1" }
            ]
          }
        ]
      }
    ]
  },
  {
    id: "memphis",
    name: "Memphis",
    blurb: "Dark, horror-movie soul flipped into some of the eeriest, most influential low-end in rap — the direct ancestor of a lot of modern drill and trap.",
    cities: [
      {
        id: "memphis-city",
        name: "Memphis, TN",
        state: "TN",
        artists: [
          {
            name: "Three 6 Mafia",
            note: "The most influential group from the scene — DJ Paul and Juicy J's production defined the horrorcore-meets-rap aesthetic later cited by drill producers worldwide.",
            tracks: [
              { title: "Tear Da Club Up", spotifyId: "1rTiHyZrNVEx5Fi5nmUW6U" },
              { title: "Sippin On Some Syrup", spotifyId: "4YoMchssGvhj6MzALpKXlE" }
            ]
          },
          {
            name: "Playa Fly",
            note: "Known for extremely fast chopped flows layered over the same dark, minimal Memphis instrumentals.",
            tracks: [
              { title: "Nobody", spotifyId: "5iJSu0R2v63oyFlH5x8GjD" }
            ]
          }
        ]
      }
    ]
  },
  {
    id: "bay-area",
    name: "Bay Area (Oakland / Vallejo / SF)",
    blurb: "Funk-bass-driven, uptempo, and unapologetically regional — hyphy and mob music built a scene almost entirely on its own terms.",
    cities: [
      {
        id: "oakland",
        name: "Oakland, CA",
        state: "CA",
        artists: [
          {
            name: "Mac Dre",
            note: "Considered the godfather of hyphy — his catalog basically defines the era's uptempo, bass-heavy party sound.",
            tracks: [
              { title: "Feeling Myself", spotifyId: "0pVOdgCtwL4hPxqCD61JhH" },
              { title: "Thizzle Dance", spotifyId: "39LEBNE9C20OeUwrUB2Ubw" }
            ]
          },
          {
            name: "E-40",
            note: "Longest-running architect of the Bay's slang-driven, bass-forward sound; also a key bridge between mob music and hyphy eras.",
            tracks: [
              { title: "Tell Me When to Go", spotifyId: "7eJ5kRpMNPAk7ccCDKywjH" },
              { title: "Choices (Yup)", spotifyId: "2Zx41xpsAlZZxUVLm1ciar" }
            ]
          }
        ]
      }
    ]
  },
  {
    id: "nyc",
    name: "New York City",
    blurb: "The birthplace — boom bap's sample-chopping, jazz/soul-sourced sound, and lyricism-first ethos still shapes what 'classic' hip-hop production means.",
    cities: [
      {
        id: "queensbridge",
        name: "Queensbridge, Queens",
        state: "NY",
        artists: [
          {
            name: "Nas",
            note: "Illmatic is a foundational document of the sample-driven, jazz-inflected New York boom-bap sound of the early-to-mid 90s.",
            tracks: [
              { title: "N.Y. State of Mind", spotifyId: "0trHOzAhNpGCsGBEu7dOJo" },
              { title: "The World Is Yours", spotifyId: "6mshbQaQGTl1Srmm8YVukv" }
            ]
          },
          {
            name: "Mobb Deep",
            note: "Defined a darker, grittier strain of the same boom-bap tradition — sparse piano/string loops over hard drums.",
            tracks: [
              { title: "Shook Ones, Pt. II", spotifyId: "1yTzJW9NtdOqiOabqa9H8B" }
            ]
          }
        ]
      }
    ]
  },
  {
    id: "detroit",
    name: "Detroit",
    blurb: "Soul-sample chopping raised to an art form, plus its own rapid-fire, bounce-heavy street sound that's distinct from both coasts.",
    cities: [
      {
        id: "detroit-city",
        name: "Detroit, MI",
        state: "MI",
        artists: [
          {
            name: "J Dilla",
            note: "Producer whose sample-chopping and 'human' swung drum programming reshaped production far beyond Detroit — one of the most cited influences in hip-hop production generally.",
            tracks: [
              { title: "Workinonit", spotifyId: "33T6ABvdB3P2iYOWJnBjsQ" },
              { title: "Fall In Love (Slum Village)", spotifyId: "2KBo6O5rkNdtYT3wYjkEkq" }
            ]
          },
          {
            name: "Danny Brown",
            note: "Blends Detroit's sample-based tradition with abrasive, genre-crossing modern production and a distinctly Detroit cadence.",
            tracks: [
              { title: "Ain't It Funny", spotifyId: "7ItFoQDmQIh3MAPsxiP6Vt" }
            ]
          }
        ]
      }
    ]
  },
  {
    id: "florida",
    name: "Florida",
    blurb: "From Miami bass's booming low end to modern Florida trap's especially chaotic, high-energy variant — a state with several distinct scenes.",
    cities: [
      {
        id: "miami",
        name: "Miami, FL",
        state: "FL",
        artists: [
          {
            name: "Uncle Luke / 2 Live Crew",
            note: "Foundational to Miami bass — booming 808s and electro-influenced uptempo production built specifically for sound systems and dancing.",
            tracks: [
              { title: "Me So Horny", spotifyId: "3EgvmOhP3NQUHY7d6PDOUg" }
            ]
          }
        ]
      },
      {
        id: "broward-county",
        name: "Broward County / Ft. Lauderdale",
        state: "FL",
        artists: [
          {
            name: "Kodak Black",
            note: "Pompano Beach — melodic but street-rooted delivery over that denser, harder South Florida trap production.",
            tracks: [
              { title: "No Flockin'", spotifyId: "34oWbFBfGEElvgO0a5c9V4" }
            ]
          }
        ]
      }
    ]
  }
];
