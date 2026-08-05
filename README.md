# Setting up the "Add an Artist" backend

This lets anyone with the password add an artist through the site itself, and have it go live for every visitor within about a minute. It needs three things you set up once: a GitHub repo for the site, a free Cloudflare account running one small Worker, and two config values pasted into the site.

If you haven't put this project on GitHub yet, do that first (steps in the earlier deployment guide — create a repo, upload all the files including this `worker` folder, enable GitHub Pages). Everything below assumes the site is already live on GitHub Pages.

## 1. Create a GitHub token the Worker can use to commit

This token lets the Worker push updates to `data.json` in your repo — nothing else.

1. Go to [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new) (this is the "fine-grained" token page).
2. Under **Repository access**, choose **Only select repositories** and pick your Area Codes repo.
3. Under **Permissions → Repository permissions**, find **Contents** and set it to **Read and write**. Leave everything else as "No access."
4. Click **Generate token**, then copy it somewhere safe — GitHub only shows it once.

## 2. Create a Spotify Developer app (for song auto-search)

This lets the Worker search Spotify for a song by title/artist and fill in the link automatically, so you don't have to paste one by hand. No user login involved — it's a server-to-server credential, free at any usage level relevant here.

1. Go to [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) and log in with any Spotify account (free tier is fine).
2. Click **Create app**. Fill in any app name/description. For **Redirect URI**, put anything valid (e.g. `https://example.com`) — it's required by the form but unused by this integration. Check the box agreeing to the terms, then **Save**.
3. On the app's page, click **Settings** and copy the **Client ID** and **Client Secret** (click "View client secret" to reveal it).

## 3. Deploy the Worker on Cloudflare (free)

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com) and sign up for a free account if you don't have one.
2. Install the Cloudflare CLI tool (`wrangler`) — open Terminal and run:
   ```bash
   npm install -g wrangler
   ```
   (If that fails, you likely need Node.js installed first — [nodejs.org](https://nodejs.org), the "LTS" version, then try the command again.)
3. Log in:
   ```bash
   wrangler login
   ```
   This opens a browser tab to authorize — approve it.
4. In Terminal, go into this project's `worker` folder:
   ```bash
   cd "path/to/To Be Titled Web Project/worker"
   ```
5. Open `wrangler.toml` in a text editor and fill in:
   - `GITHUB_OWNER` — your GitHub username
   - `GITHUB_REPO` — the repo name you created for this site
   - `ALLOWED_ORIGIN` — your live site's URL (e.g. `https://yourusername.github.io`)
6. Set your four secrets (Terminal will prompt you to paste each value — paste and press Enter):
   ```bash
   wrangler secret put GITHUB_TOKEN
   ```
   (paste the token from step 1)
   ```bash
   wrangler secret put ADD_PASSWORD
   ```
   (type the actual password you want people to use — pick something you haven't used elsewhere)
   ```bash
   wrangler secret put SPOTIFY_CLIENT_ID
   ```
   (paste the Client ID from step 2)
   ```bash
   wrangler secret put SPOTIFY_CLIENT_SECRET
   ```
   (paste the Client Secret from step 2)
7. Deploy it:
   ```bash
   wrangler deploy
   ```
   When it finishes, it prints a URL like `https://area-codes-add-artist.yoursubdomain.workers.dev` — copy that.

## 4. Point the site at the Worker

1. Open `config.js` in the project root.
2. Set `ADD_ARTIST_ENDPOINT` to the URL from step 2.7.
3. Get the password hash: open your live site, open the browser console (F12, or Cmd+Option+J on Mac), and type:
   ```js
   await sha256Hex("the-same-password-you-set-as-ADD_PASSWORD")
   ```
   Copy the long string it prints and set it as `PASSWORD_HASH` in `config.js`.
4. Commit and push `config.js` (via the GitHub web editor, same as any other content edit) so the live site picks it up.

## Trying it out

Visit `yoursite.com/#/add`, enter the password, fill out the form, and submit. Within a minute you should see a new commit appear in your GitHub repo, and the entry show up on the live site after it redeploys.

## Bulk upload (CSV/XLSX)

From the `/add` page, click "Bulk upload a CSV or XLSX". One row per song, up to 2000 songs per file — download the template button on that page for the exact column names: `artist_name, song_title, spotify URI or URL, state, city, note` (this is the same header set/order used by the Bulk Spotify Links and Remove a Batch tools below, so one CSV format works everywhere). Only `artist_name` and `song_title` are always required:

- **Artist already on the site** — `state`/`city`/`note` aren't needed at all for these rows. The exact song title gets linked (or added as a new track, if that title isn't there yet) for that artist. The Spotify column is still optional either way — leave it blank and the Worker searches for that song; fill it in and the search is skipped.
- **Artist not on the site yet** — treated as a new artist, and needs `state`/`city`/`note` (repeat the same values on every row for that artist so they group into one entry, same as before). If **every** row for a given new artist is missing any of `state`/`city`/`note`, that whole artist is silently skipped and not uploaded — the preview screen lists which ones before you submit.

Behind the scenes the site submits automatically in batches — up to 12 new-artist entries (and up to 20 total songs, whichever limit hits first) per request for the new-artist path, and up to 30 rows per request for the existing-artist path (no geocoding involved there, so it can move faster). Each brand-new city still gets geocoded and pinned, same as a single add. Those caps keep every request safely under the free Cloudflare plan's 50-subrequest limit even when a batch mixes new-city geocoding with several Spotify searches. A large file just means more batches, submitted one after another with a progress readout; there's nothing you need to do differently for a big upload versus a small one, it just takes longer.

Any **new** artist whose name **exactly matches** one already on the site (anywhere, any city) gets silently skipped rather than added as a duplicate — this applies to both the single-artist form and bulk upload.

## Bulk-importing birth years

From the `/add` page, "Import Birth Years" goes to `#/add/birth-years` — sets a `birthYear` field on existing artists, shown on the site as a small pill under their name, color-coded by decade (every artist born in the same decade gets the same color). Columns: `artist_name, birth_year`. Only updates artists already on the site (matched by exact name) — it never creates or renames anyone, and a blank `birth_year` on a row just skips that row quietly. Pairs with Export Artist List: export the current roster, add a `birth_year` column yourself, reupload here. No external calls per row, so batches can be large (up to 300 rows per Worker request).

## Bulk-uploading producer credits

From the `/add` page, "Bulk Add Producer Credits" (under a "Producers" group) goes to
`#/add/producers` — for attaching producer credits to specific songs. Columns:
`artist_name, song_title, producer_name, producer_city, producer_state` — all five are
required on every row. Each row is matched to an artist already on the site
(exact name) and one of their existing tracks (exact title, case-insensitive) — rows
that don't match either are reported as errors and skipped, nothing is ever created
from this tool (no new artists or songs). For a matched row, the Worker geocodes
**both** the producer's city and the artist's own city (via the same free Nominatim
lookup used for map pins — there's no stored lat/lon for artist cities today, so both
sides need a fresh geocode) and computes the straight-line distance between them in
miles, then attaches `{ name, city, state, lat, lon, distanceMiles }` to that song's
`producers` array. Re-uploading a row for a producer already credited on that song
updates their info in place rather than duplicating it, so corrections are safe to
re-run. Because of the extra geocoding cost (up to two lookups per row, vs. one for a
new artist), batches are capped smaller than regular bulk upload — 10 rows per Worker
request — so a full-size file takes a few batches longer to finish.

Producers show up two places on the live site: a "Produced by" dropdown under each
artist whose songs have credits, and as a normal search hit — typing a producer's name
in the search bar lists every song they're credited on, formatted "Song Title – Artist
Name", linking straight to that artist's entry.

## Bulk-uploading manual Spotify links

From the `/add` page, "Bulk upload Spotify links" goes to `#/add/spotify-links` — for when you already have exact Spotify URLs in hand and don't want to rely on auto-search. Columns: `artist_name, song_title, spotify URI or URL, state, city, note`. Each row is checked against artists already on the site: if the artist exists, that exact song (matched by exact title) gets the given link attached, and if no song by that title exists yet for them it's added as a brand-new track instead — either way, no Spotify search involved since you're providing the link directly. `state`/`city`/`note` can be left blank for these rows. If the artist doesn't exist yet, the row is treated as a new artist and needs `state`/`city`/`note` filled in, same as regular Bulk Upload — full entry in data.json plus a geocoded map pin; multiple rows for the same new artist merge into one entry the same way. The Spotify column accepts a full `open.spotify.com` link, a `spotify:track:` URI, or a bare track ID.

## Undoing a bad upload

There's a hidden page at `#/add/remove-batch` (not linked anywhere in the site's navigation — go there directly) for undoing a bulk upload gone wrong. Load a list of artist names — the same CSV you bulk-uploaded works as-is, since it just reads the `artist_name` column, or a plain `.txt` file with one name per line — then type the exact confirmation phrase shown on the page to enable the button. It removes every artist site-wide whose name exactly matches one in that list, across every city, and cleans up any city/map pin that ends up empty as a result. This is permanent from the site's perspective (no in-site undo), though since every write is a git commit to your repo, you could still revert via GitHub's commit history if you truly needed to.

## Retroactively filling in missing Spotify links

There's another hidden page at `#/add/relink-spotify` for tracks that ended up without a Spotify link (the search didn't find a confident match at the time, or the artist was added before Spotify search existed). It scans every track currently on the site, shows how many are missing a link, and re-runs the search for just those when you click the button. Safe to run repeatedly — anything that already has a link is always left alone, and it submits in batches (35 tracks per Worker request) the same way bulk upload does.

## Editing the site's look (colors, line thickness) without touching code

There's a visible link on the `/add` page to `#/add/theme` — a password-gated page for changing site-wide colors and outline thickness. Edits preview instantly right there on the page as you adjust them, and clicking Save writes the changes to `theme.json` (same GitHub-commit mechanism as everything else), so they go live for every visitor within about a minute. A "Custom CSS" box at the bottom covers anything not in the curated color/thickness fields — it's applied site-wide after all other styling. Avoid `url()`/`@import` in there; the Worker strips `@import` outright since pulling in an external stylesheet on every page load would violate the site's no-unnecessary-network-requests rule, but a background-image `url()` would slip through and should just be avoided by hand.

## Grouping states into colored regions

From the `/add` page, "Manage Regions" goes to `#/add/regions` — group states into named regions (e.g. "South", "Midwest"), each with two independent colors: a "Tile" color (the state's background on the home map and legend) and a "Title text" color (used when the region's name shows as a heading, e.g. in search results — doesn't have to match the tile color). Typing a region's name in the search bar (e.g. "South") shows a cropped copy of the home map with just that region's states (still at their real relative positions, so borders touch correctly) plus an alphabetical list of them, in the right-hand column of the search results (artists/cities are on the left). A state can only belong to one region — checking it in a new region on this page automatically unchecks it from whichever region it was in before. Saving writes the whole region list to `mapRegions.json` (same GitHub-commit mechanism as everything else, live within about a minute) — it's always a full replace, not an incremental edit, so the page always sends its complete current draft.

The country map's gridline color is also independently editable, on `#/add/theme` ("Country map gridline color") — the lines render on top of each state's tile color so they stay visible as borders regardless of what color the tiles are.

## A note on security

The password gate on the site itself is just a convenience — it's checked in the browser, so it's not meant to stop a determined person who reads the page's source. The part that actually matters is the Worker: every submission is re-checked against the real password (`ADD_PASSWORD`) on the server before anything gets written, and the GitHub token that can actually modify your repo never leaves the Worker. Treat the password the same as you would a shared Wi-Fi password — good enough to keep casual visitors out, not bank-grade security.
