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

From the `/add` page, click "Bulk upload a CSV or XLSX". One row per song, up to 2000 songs per file — download the template button on that page for the exact column names. Multiple rows for the same artist (same artist_name/city/state) get grouped into one artist entry automatically. No Spotify column needed — the Worker searches for each song.

Behind the scenes the site submits automatically in batches of up to 12 artists (and up to 20 total songs, whichever limit hits first) per Worker request — each brand-new city still gets geocoded and pinned, same as a single add. Those caps keep every request safely under the free Cloudflare plan's 50-subrequest limit even when a batch mixes new-city geocoding with several Spotify searches. A large file just means more batches, submitted one after another with a progress readout; there's nothing you need to do differently for a big upload versus a small one, it just takes longer.

Any artist whose name **exactly matches** one already on the site (anywhere, any city) gets silently skipped rather than added as a duplicate — this applies to both the single-artist form and bulk upload.

## Undoing a bad upload

There's a hidden page at `#/add/remove-batch` (not linked anywhere in the site's navigation — go there directly) for undoing a bulk upload gone wrong. Load a list of artist names — the same CSV you bulk-uploaded works as-is, since it just reads the `artist_name` column, or a plain `.txt` file with one name per line — then type the exact confirmation phrase shown on the page to enable the button. It removes every artist site-wide whose name exactly matches one in that list, across every city, and cleans up any city/map pin that ends up empty as a result. This is permanent from the site's perspective (no in-site undo), though since every write is a git commit to your repo, you could still revert via GitHub's commit history if you truly needed to.

## A note on security

The password gate on the site itself is just a convenience — it's checked in the browser, so it's not meant to stop a determined person who reads the page's source. The part that actually matters is the Worker: every submission is re-checked against the real password (`ADD_PASSWORD`) on the server before anything gets written, and the GitHub token that can actually modify your repo never leaves the Worker. Treat the password the same as you would a shared Wi-Fi password — good enough to keep casual visitors out, not bank-grade security.
