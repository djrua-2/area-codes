/*
  AREA CODES — config.js
  -----------------------
  Fill these two values in once you've deployed the Cloudflare Worker
  (see worker/README.md for the full step-by-step). Nothing else in the
  site needs to change.

  ADD_ARTIST_ENDPOINT
    The URL of your deployed Worker, e.g.
    "https://area-codes-add-artist.YOUR-SUBDOMAIN.workers.dev"

  PASSWORD_HASH
    NOT your password itself — a SHA-256 hash of it, so the real password
    never sits in plain text in this public file. To generate it:
      1. Open the live site in a browser.
      2. Open the browser console (F12, or Cmd+Option+J on Mac).
      3. Type: await sha256Hex("your-chosen-password")
      4. Paste the result below.
    Set the *same plain-text password* as the ADD_PASSWORD secret on the
    Worker (step in worker/README.md) — the hash below only gates the
    site's UI; the Worker independently checks the real password before
    writing anything.
*/

const AREA_CODES_CONFIG = {
  ADD_ARTIST_ENDPOINT: "https://area-codes-add-artist.area-codes.workers.dev",
  PASSWORD_HASH: "81610aced615fe754769e89ed3e4aba6adde4a2008f71a1c783a569dc8e6056a"
};
