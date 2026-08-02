/*
  AREA CODES — add-artist Cloudflare Worker
  ------------------------------------------
  Handles four actions from the site's password-protected pages, sent as
  JSON POST bodies with an "action" field: "add" (default if omitted),
  "edit", "delete", and "bulk_add" (CSV/XLSX upload — many artists in one
  request). Every action re-checks the real password (a secret, never
  shipped to the browser) before touching anything, then reads and writes
  data.json (and, when relevant, stateOutlines.json) straight to your
  GitHub repo via the GitHub API. GitHub Pages then redeploys automatically,
  so changes go live for every visitor within about a minute.

  New cities get geocoded via OpenStreetMap's free Nominatim API (no key
  required) and placed on that state's map using its pre-computed bounding
  box. This is best-effort — if geocoding fails, the artist/edit still goes
  through, it just won't get a map pin.

  Tracks with a title but no spotifyId get auto-searched on Spotify (Client
  Credentials flow — no user login involved) and filled in if a match is
  found. Also best-effort: a failed or missing match just leaves that track
  without a play link.

  Setup: see worker/README.md in this same folder for the full walkthrough.

  Required secrets (set with `wrangler secret put NAME`):
    GITHUB_TOKEN          — fine-grained GitHub PAT, Contents: Read & Write,
                             scoped to ONLY this one repo
    ADD_PASSWORD          — the real, plain-text password (same one you
                             hashed into config.js's PASSWORD_HASH on the site)
    SPOTIFY_CLIENT_ID     — from a free Spotify Developer app
                             (developer.spotify.com/dashboard)
    SPOTIFY_CLIENT_SECRET — from the same Spotify Developer app

  Required vars (set in wrangler.toml):
    GITHUB_OWNER, GITHUB_REPO, GITHUB_BRANCH, DATA_PATH,
    STATE_OUTLINES_PATH, ALLOWED_ORIGIN
*/

function corsHeaders(origin, allowedOrigin) {
  const allow = allowedOrigin === "*" || origin === allowedOrigin ? origin || "*" : allowedOrigin;
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function slugify(str) {
  return String(str)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "entry";
}

function uniqueId(base, existingIds) {
  let id = base;
  let i = 2;
  while (existingIds.has(id)) {
    id = `${base}-${i}`;
    i++;
  }
  existingIds.add(id);
  return id;
}

function shortLabel(cityName) {
  return String(cityName).split(",")[0].trim();
}

function b64EncodeUtf8(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  bytes.forEach(b => { binary += String.fromCharCode(b); });
  return btoa(binary);
}

function b64DecodeUtf8(b64) {
  const binary = atob(b64.replace(/\n/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

async function githubRequest(env, path, options = {}) {
  const url = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
      "Accept": "application/vnd.github+json",
      "User-Agent": "area-codes-add-artist-worker",
      ...(options.headers || {}),
    },
  });
  return res;
}

async function getFile(env, path) {
  const res = await githubRequest(env, `contents/${path}?ref=${env.GITHUB_BRANCH}`);
  if (!res.ok) return null;
  const json = await res.json();
  return { sha: json.sha, data: JSON.parse(b64DecodeUtf8(json.content)) };
}

async function putFile(env, path, data, sha, message) {
  const content = JSON.stringify(data, null, 2) + "\n";
  return githubRequest(env, `contents/${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      content: b64EncodeUtf8(content),
      sha,
      branch: env.GITHUB_BRANCH,
    }),
  });
}

// Free, keyless geocoding via OpenStreetMap's Nominatim. Best-effort: on any
// failure this returns null and the caller just skips touching the map pin.
async function geocodeCity(cityName, stateAbbrev, env) {
  try {
    const q = encodeURIComponent(`${cityName}, ${stateAbbrev}, USA`);
    const url = `https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1&countrycodes=us`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": `area-codes-add-artist-worker (+https://github.com/${env.GITHUB_OWNER}/${env.GITHUB_REPO})`,
      },
    });
    if (!res.ok) return null;
    const results = await res.json();
    if (!results.length) return null;
    return { lat: parseFloat(results[0].lat), lon: parseFloat(results[0].lon) };
  } catch {
    return null;
  }
}

// Spotify Client Credentials flow (server-to-server, no user login). Token
// is cached at module scope so a warm isolate reuses it across requests
// instead of re-authenticating on every call.
let cachedSpotifyToken = null;
let spotifyTokenExpiresAt = 0;

async function getSpotifyToken(env) {
  if (cachedSpotifyToken && Date.now() < spotifyTokenExpiresAt) return cachedSpotifyToken;
  const basic = btoa(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`);
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Authorization": `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) return null;
  const json = await res.json();
  cachedSpotifyToken = json.access_token;
  spotifyTokenExpiresAt = Date.now() + (json.expires_in - 60) * 1000;
  return cachedSpotifyToken;
}

async function spotifySearchOnce(query, token) {
  const url = `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=1`;
  const res = await fetch(url, { headers: { "Authorization": `Bearer ${token}` } });
  if (!res.ok) return null;
  const json = await res.json();
  const track = json.tracks && json.tracks.items && json.tracks.items[0];
  return track ? track.id : null;
}

// Best-effort, like geocodeCity: any failure or no-match just returns null
// and the caller leaves that track without a play link. Single query only —
// a strict+fallback two-pass search used to double the Spotify subrequest
// count per track, which was enough on its own to blow past the free
// Workers plan's 50-subrequest-per-request limit on a full batch.
async function searchSpotifyTrack(title, artistName, token) {
  try {
    return await spotifySearchOnce(`track:"${title}" artist:"${artistName}"`, token);
  } catch {
    return null;
  }
}

// Fills in spotifyId for any track that has a title but none yet. Mutates
// and returns the same array. No-op (and no Spotify credentials required)
// if every track already has an id or there's nothing to look up.
async function fillMissingSpotifyIds(tracks, artistName, env) {
  const needsSearch = tracks.filter(t => !t.spotifyId);
  if (!needsSearch.length || !env.SPOTIFY_CLIENT_ID || !env.SPOTIFY_CLIENT_SECRET) return tracks;
  const token = await getSpotifyToken(env);
  if (!token) return tracks;
  for (const t of needsSearch) {
    const id = await searchSpotifyTrack(t.title, artistName, token);
    if (id) t.spotifyId = id;
  }
  return tracks;
}

function placeInBbox(lat, lon, bbox) {
  const x = ((lon - bbox.minLon) / (bbox.maxLon - bbox.minLon)) * 100;
  const y = ((bbox.maxLat - lat) / (bbox.maxLat - bbox.minLat)) * 100;
  return { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 };
}

function findCity(regions, regionId, cityId) {
  const region = regions.find(r => r.id === regionId);
  const city = region && region.cities.find(c => c.id === cityId);
  return region && city ? { region, city } : null;
}

function findCityByNameState(regions, stateAbbrev, cityNameLower) {
  for (const region of regions) {
    for (const city of region.cities) {
      if (city.state === stateAbbrev && city.name.toLowerCase() === cityNameLower) {
        return { region, city };
      }
    }
  }
  return null;
}

// Removes a city if it's got no artists left, and its region if that then
// has no cities left. Returns the removed city's id, or null.
function removeIfEmpty(regions, regionId, cityId) {
  const region = regions.find(r => r.id === regionId);
  if (!region) return null;
  const city = region.cities.find(c => c.id === cityId);
  if (!city || city.artists.length > 0) return null;
  region.cities = region.cities.filter(c => c.id !== cityId);
  if (region.cities.length === 0) {
    const idx = regions.findIndex(r => r.id === regionId);
    if (idx !== -1) regions.splice(idx, 1);
  }
  return cityId;
}

async function removePinIfPresent(env, stateAbbrev, cityId) {
  const outlinesFile = await getFile(env, env.STATE_OUTLINES_PATH);
  const stateEntry = outlinesFile && outlinesFile.data[stateAbbrev];
  if (!stateEntry || !stateEntry.cities) return;
  const before = stateEntry.cities.length;
  stateEntry.cities = stateEntry.cities.filter(c => c.id !== cityId);
  if (stateEntry.cities.length !== before) {
    await putFile(env, env.STATE_OUTLINES_PATH, outlinesFile.data, outlinesFile.sha, `Remove map pin for ${cityId}`);
  }
}

// Geocodes + adds a brand-new pin, or (if updateExistingId given) re-geocodes
// and repositions an existing pin in place. Best-effort; failures are silent.
async function placePin(env, stateAbbrev, cityId, cityNameClean, updateExisting) {
  const coords = await geocodeCity(cityNameClean, stateAbbrev, env);
  if (!coords) return false;
  const outlinesFile = await getFile(env, env.STATE_OUTLINES_PATH);
  const stateEntry = outlinesFile && outlinesFile.data[stateAbbrev];
  if (!stateEntry || !stateEntry.bbox) return false;
  const { x, y } = placeInBbox(coords.lat, coords.lon, stateEntry.bbox);
  stateEntry.cities = stateEntry.cities || [];
  if (updateExisting) {
    const existing = stateEntry.cities.find(c => c.id === cityId);
    if (existing) { existing.x = x; existing.y = y; existing.name = shortLabel(cityNameClean); }
    else stateEntry.cities.push({ id: cityId, name: shortLabel(cityNameClean), x, y });
  } else {
    stateEntry.cities.push({ id: cityId, name: shortLabel(cityNameClean), x, y });
  }
  const res = await putFile(env, env.STATE_OUTLINES_PATH, outlinesFile.data, outlinesFile.sha, `Update map pin: ${shortLabel(cityNameClean)}, ${stateAbbrev}`);
  return res.ok;
}

function cleanTracksFrom(tracks) {
  return Array.isArray(tracks)
    ? tracks
        .filter(t => t && typeof t.title === "string" && t.title.trim())
        .map(t => (t.spotifyId ? { title: t.title.trim(), spotifyId: String(t.spotifyId).trim() } : { title: t.title.trim() }))
    : [];
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Every existing artist name (any region/city/neighborhood), lowercased —
// used to skip exact-name duplicates on add/bulk_add.
function collectAllArtistNames(regions) {
  const names = new Set();
  regions.forEach(region => {
    region.cities.forEach(city => {
      (city.artists || []).forEach(a => names.add(a.name.trim().toLowerCase()));
      (city.neighborhoods || []).forEach(hood => {
        (hood.artists || []).forEach(a => names.add(a.name.trim().toLowerCase()));
      });
    });
  });
  return names;
}

// Finds an existing city (by name + state) to append to, or creates a new
// region+city for it. Mutates `regions` and `existingIds` in place. Returns
// the new city's id if one was created, or null if it merged into an
// existing city (used by callers to decide whether a map pin is needed).
function addArtistToRegions(regions, existingIds, stateAbbrev, cityNameClean, newArtist) {
  const match = findCityByNameState(regions, stateAbbrev, cityNameClean.toLowerCase());
  if (match) {
    match.city.artists = match.city.artists || [];
    match.city.artists.push(newArtist);
    return null;
  }
  const baseSlug = slugify(cityNameClean);
  const cityId = uniqueId(baseSlug, existingIds);
  const regionId = uniqueId(`${baseSlug}-region`, existingIds);
  regions.push({ id: regionId, name: cityNameClean, blurb: "", cities: [{ id: cityId, name: cityNameClean, state: stateAbbrev, artists: [newArtist] }] });
  return cityId;
}

async function handleAdd(env, body) {
  const { state, cityName, artistName, note, tracks } = body;
  if (!state || !cityName || !artistName || !note) {
    return { status: 400, error: "Missing required field" };
  }

  const dataFile = await getFile(env, env.DATA_PATH);
  if (!dataFile) return { status: 502, error: "Couldn't read data.json from GitHub" };
  const regions = dataFile.data;

  const existingIds = new Set();
  regions.forEach(r => { existingIds.add(r.id); r.cities.forEach(c => existingIds.add(c.id)); });

  const artistNameClean = String(artistName).trim();
  if (collectAllArtistNames(regions).has(artistNameClean.toLowerCase())) {
    return { status: 200, body: { ok: true, skipped: true } };
  }

  const stateAbbrev = String(state).trim().toUpperCase();
  const cityNameClean = String(cityName).trim();
  const cleanTracks = await fillMissingSpotifyIds(cleanTracksFrom(tracks), artistNameClean, env);
  const newArtist = { name: artistNameClean, note: String(note).trim(), tracks: cleanTracks };

  const newCityId = addArtistToRegions(regions, existingIds, stateAbbrev, cityNameClean, newArtist);

  const putRes = await putFile(env, env.DATA_PATH, regions, dataFile.sha, `Add artist: ${newArtist.name} (${cityNameClean})`);
  if (!putRes.ok) return { status: 502, error: `Couldn't commit to GitHub (${putRes.status}): ${await putRes.text()}` };

  let pinAdded = true;
  if (newCityId) pinAdded = await placePin(env, stateAbbrev, newCityId, cityNameClean, false);

  return { status: 200, body: { ok: true, pinAdded } };
}

// Bulk upload (CSV/XLSX parsed + grouped client-side into `entries`, one per
// artist). Capped so a single request stays safely within the free Workers
// plan's 50-subrequest limit — each brand-new city needs its own geocode
// call (spaced out to respect Nominatim's ~1-request-per-second usage
// policy) and each track without a spotifyId needs its own Spotify search.
// Worst case per entry: 1 geocode + 1 Spotify search per track, plus ~5
// shared calls (Spotify token, data.json get/put, stateOutlines get/put).
// The client additionally caps total tracks per batch (see BULK_BATCH_MAX_TRACKS
// in app.js) so one artist with many merged tracks can't blow this alone —
// this entries-count cap is the backstop, not the primary guard.
const BULK_MAX_ROWS = 12;

async function handleBulkAdd(env, body) {
  const entries = Array.isArray(body.entries) ? body.entries : [];
  if (!entries.length) return { status: 400, error: "No rows to add" };
  if (entries.length > BULK_MAX_ROWS) {
    return { status: 400, error: `Too many rows in one upload (max ${BULK_MAX_ROWS}) — split your file into smaller batches` };
  }

  const dataFile = await getFile(env, env.DATA_PATH);
  if (!dataFile) return { status: 502, error: "Couldn't read data.json from GitHub" };
  const regions = dataFile.data;

  const existingIds = new Set();
  regions.forEach(r => { existingIds.add(r.id); r.cities.forEach(c => existingIds.add(c.id)); });

  const existingNames = collectAllArtistNames(regions);

  const results = [];
  const newCityQueue = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const { state, cityName, artistName, note, tracks } = entry || {};
    if (!state || !cityName || !artistName || !note) {
      results.push({ row: i + 1, ok: false, artist: artistName || "(unnamed)", error: "Missing required field" });
      continue;
    }
    const artistNameClean = String(artistName).trim();
    const nameKey = artistNameClean.toLowerCase();
    if (existingNames.has(nameKey)) {
      results.push({ row: i + 1, ok: true, skipped: true, artist: artistNameClean });
      continue;
    }
    const stateAbbrev = String(state).trim().toUpperCase();
    const cityNameClean = String(cityName).trim();
    const cleanTracks = await fillMissingSpotifyIds(cleanTracksFrom(tracks), artistNameClean, env);
    const newArtist = { name: artistNameClean, note: String(note).trim(), tracks: cleanTracks };
    const newCityId = addArtistToRegions(regions, existingIds, stateAbbrev, cityNameClean, newArtist);
    if (newCityId) newCityQueue.push({ stateAbbrev, cityId: newCityId, cityNameClean });
    existingNames.add(nameKey);
    results.push({ row: i + 1, ok: true, artist: newArtist.name });
  }

  const addedCount = results.filter(r => r.ok && !r.skipped).length;
  const skippedCount = results.filter(r => r.skipped).length;
  if (addedCount === 0) {
    return { status: 200, body: { ok: true, results, pinsAdded: 0, addedCount: 0, skippedCount } };
  }

  const putRes = await putFile(env, env.DATA_PATH, regions, dataFile.sha, `Bulk add ${addedCount} artist(s)`);
  if (!putRes.ok) return { status: 502, error: `Couldn't commit to GitHub (${putRes.status}): ${await putRes.text()}` };

  // Geocode + place pins for any brand-new cities, one at a time with a
  // short pause between each, then commit stateOutlines.json once at the end.
  // Best-effort per city (a failed geocode just skips that pin, same as
  // single-add), but the final commit itself is checked — if it fails, no
  // pins actually landed even though individual geocodes may have
  // succeeded, so pinsAdded must reflect that rather than over-reporting.
  let pinsAdded = 0;
  let pinsCommitFailed = false;
  if (newCityQueue.length) {
    const outlinesFile = await getFile(env, env.STATE_OUTLINES_PATH);
    if (outlinesFile) {
      for (let i = 0; i < newCityQueue.length; i++) {
        const nc = newCityQueue[i];
        const coords = await geocodeCity(nc.cityNameClean, nc.stateAbbrev, env);
        const stateEntry = outlinesFile.data[nc.stateAbbrev];
        if (coords && stateEntry && stateEntry.bbox) {
          const { x, y } = placeInBbox(coords.lat, coords.lon, stateEntry.bbox);
          stateEntry.cities = stateEntry.cities || [];
          stateEntry.cities.push({ id: nc.cityId, name: shortLabel(nc.cityNameClean), x, y });
          pinsAdded++;
        }
        if (i < newCityQueue.length - 1) await sleep(1100);
      }
      if (pinsAdded > 0) {
        const pinPutRes = await putFile(env, env.STATE_OUTLINES_PATH, outlinesFile.data, outlinesFile.sha, `Bulk add ${pinsAdded} map pin(s)`);
        if (!pinPutRes.ok) {
          pinsCommitFailed = true;
          pinsAdded = 0;
        }
      }
    }
  }

  return { status: 200, body: { ok: true, results, pinsAdded, pinsCommitFailed, addedCount, skippedCount } };
}

async function handleEdit(env, body) {
  const { originalRegionId, originalCityId, originalArtistIndex, state, cityName, artistName, note, tracks } = body;
  if (!originalRegionId || !originalCityId || originalArtistIndex === undefined || !state || !cityName || !artistName || !note) {
    return { status: 400, error: "Missing required field" };
  }

  const dataFile = await getFile(env, env.DATA_PATH);
  if (!dataFile) return { status: 502, error: "Couldn't read data.json from GitHub" };
  const regions = dataFile.data;

  const found = findCity(regions, originalRegionId, originalCityId);
  if (!found || !found.city.artists[originalArtistIndex]) {
    return { status: 404, error: "That artist no longer exists (someone may have already edited or deleted it)" };
  }

  const stateAbbrev = String(state).trim().toUpperCase();
  const cityNameClean = String(cityName).trim();
  const artistNameClean = String(artistName).trim();
  const cleanTracks = await fillMissingSpotifyIds(cleanTracksFrom(tracks), artistNameClean, env);
  const editedArtist = { name: artistNameClean, note: String(note).trim(), tracks: cleanTracks };

  found.city.artists.splice(originalArtistIndex, 1);

  const sameCity = found.city.state === stateAbbrev && found.city.name.toLowerCase() === cityNameClean.toLowerCase();
  let pinAdded = true;

  if (sameCity) {
    found.city.artists.push(editedArtist);
  } else if (found.city.artists.length === 0) {
    // Only artist in that city, and the city/state changed — rename the
    // city in place (this is what fixes a typo like "Orlando" -> "Orlando, FL").
    found.city.name = cityNameClean;
    found.city.state = stateAbbrev;
    found.city.artists.push(editedArtist);
    pinAdded = await placePin(env, stateAbbrev, found.city.id, cityNameClean, true);
  } else {
    // Moving just this one artist to a different city that still has others left behind.
    const match = findCityByNameState(regions, stateAbbrev, cityNameClean.toLowerCase());
    if (match) {
      match.city.artists = match.city.artists || [];
      match.city.artists.push(editedArtist);
    } else {
      const existingIds = new Set();
      regions.forEach(r => { existingIds.add(r.id); r.cities.forEach(c => existingIds.add(c.id)); });
      const baseSlug = slugify(cityNameClean);
      const cityId = uniqueId(baseSlug, existingIds);
      const regionId = uniqueId(`${baseSlug}-region`, existingIds);
      regions.push({ id: regionId, name: cityNameClean, blurb: "", cities: [{ id: cityId, name: cityNameClean, state: stateAbbrev, artists: [editedArtist] }] });
      pinAdded = await placePin(env, stateAbbrev, cityId, cityNameClean, false);
    }
  }

  const putRes = await putFile(env, env.DATA_PATH, regions, dataFile.sha, `Edit artist: ${editedArtist.name}`);
  if (!putRes.ok) return { status: 502, error: `Couldn't commit to GitHub (${putRes.status}): ${await putRes.text()}` };

  return { status: 200, body: { ok: true, pinAdded } };
}

async function handleDelete(env, body) {
  const { regionId, cityId, artistIndex } = body;
  if (!regionId || !cityId || artistIndex === undefined) {
    return { status: 400, error: "Missing required field" };
  }

  const dataFile = await getFile(env, env.DATA_PATH);
  if (!dataFile) return { status: 502, error: "Couldn't read data.json from GitHub" };
  const regions = dataFile.data;

  const found = findCity(regions, regionId, cityId);
  if (!found || !found.city.artists[artistIndex]) {
    return { status: 404, error: "That artist no longer exists (may already be deleted)" };
  }
  const removedName = found.city.artists[artistIndex].name;
  const stateAbbrev = found.city.state;
  found.city.artists.splice(artistIndex, 1);
  const removedCityId = removeIfEmpty(regions, regionId, cityId);

  const putRes = await putFile(env, env.DATA_PATH, regions, dataFile.sha, `Delete artist: ${removedName}`);
  if (!putRes.ok) return { status: 502, error: `Couldn't commit to GitHub (${putRes.status}): ${await putRes.text()}` };

  if (removedCityId) await removePinIfPresent(env, stateAbbrev, removedCityId);

  return { status: 200, body: { ok: true } };
}

// Removes any artist (in any region/city/neighborhood) whose name exactly
// matches one in namesLower (a Set of lowercased, trimmed names). Cleans up
// cities and regions that end up empty, same as a normal delete, and
// collects their ids so the caller can also strip the matching map pins.
// Purely in-memory — no network calls — so this is cheap regardless of how
// many names are checked or removed.
function removeArtistsByName(regions, namesLower) {
  let removedCount = 0;
  const emptiedCities = [];
  for (let ri = regions.length - 1; ri >= 0; ri--) {
    const region = regions[ri];
    for (let ci = region.cities.length - 1; ci >= 0; ci--) {
      const city = region.cities[ci];
      const stripMatches = arr => (arr || []).filter(a => {
        const isMatch = namesLower.has(a.name.trim().toLowerCase());
        if (isMatch) removedCount++;
        return !isMatch;
      });
      city.artists = stripMatches(city.artists);
      (city.neighborhoods || []).forEach(hood => { hood.artists = stripMatches(hood.artists); });
      const cityEmpty = city.artists.length === 0 &&
        (!city.neighborhoods || city.neighborhoods.every(h => !h.artists || h.artists.length === 0));
      if (cityEmpty) {
        emptiedCities.push({ stateAbbrev: city.state, cityId: city.id });
        region.cities.splice(ci, 1);
      }
    }
    if (region.cities.length === 0) regions.splice(ri, 1);
  }
  return { removedCount, emptiedCities };
}

const REMOVE_CONFIRM_PHRASE = "DELETE THESE ARTISTS";

async function handleRemoveByName(env, body) {
  if (body.confirm !== REMOVE_CONFIRM_PHRASE) {
    return { status: 400, error: `Confirmation phrase didn't match — expected exactly "${REMOVE_CONFIRM_PHRASE}"` };
  }
  const names = Array.isArray(body.names) ? body.names : [];
  const namesLower = new Set(names.map(n => String(n).trim().toLowerCase()).filter(Boolean));
  if (!namesLower.size) return { status: 400, error: "No artist names provided" };

  const dataFile = await getFile(env, env.DATA_PATH);
  if (!dataFile) return { status: 502, error: "Couldn't read data.json from GitHub" };
  const regions = dataFile.data;

  const { removedCount, emptiedCities } = removeArtistsByName(regions, namesLower);
  if (removedCount === 0) {
    return { status: 200, body: { ok: true, removedCount: 0, pinsRemoved: 0 } };
  }

  const putRes = await putFile(env, env.DATA_PATH, regions, dataFile.sha, `Remove ${removedCount} artist(s) (name-list cleanup)`);
  if (!putRes.ok) return { status: 502, error: `Couldn't commit to GitHub (${putRes.status}): ${await putRes.text()}` };

  let pinsRemoved = 0;
  if (emptiedCities.length) {
    const outlinesFile = await getFile(env, env.STATE_OUTLINES_PATH);
    if (outlinesFile) {
      emptiedCities.forEach(({ stateAbbrev, cityId }) => {
        const stateEntry = outlinesFile.data[stateAbbrev];
        if (!stateEntry || !stateEntry.cities) return;
        const before = stateEntry.cities.length;
        stateEntry.cities = stateEntry.cities.filter(c => c.id !== cityId);
        if (stateEntry.cities.length !== before) pinsRemoved++;
      });
      if (pinsRemoved > 0) {
        await putFile(env, env.STATE_OUTLINES_PATH, outlinesFile.data, outlinesFile.sha, `Remove ${pinsRemoved} map pin(s) (name-list cleanup)`);
      }
    }
  }

  return { status: 200, body: { ok: true, removedCount, pinsRemoved } };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const headers = corsHeaders(origin, env.ALLOWED_ORIGIN || "*");

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers });

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response("Invalid JSON body", { status: 400, headers });
    }

    if (body.password !== env.ADD_PASSWORD) {
      return new Response("Incorrect password", { status: 401, headers });
    }

    try {
      let result;
      const action = body.action || "add";
      if (action === "add") result = await handleAdd(env, body);
      else if (action === "edit") result = await handleEdit(env, body);
      else if (action === "delete") result = await handleDelete(env, body);
      else if (action === "bulk_add") result = await handleBulkAdd(env, body);
      else if (action === "remove_by_name") result = await handleRemoveByName(env, body);
      else result = { status: 400, error: "Unknown action" };

      if (result.error) return new Response(result.error, { status: result.status, headers });
      return new Response(JSON.stringify(result.body), { status: 200, headers: { ...headers, "Content-Type": "application/json" } });
    } catch (err) {
      // Ensures a crash still comes back with CORS headers and a readable
      // message instead of a bare platform error page (which the browser
      // reports as an opaque CORS/"Failed to fetch" failure).
      return new Response(`Server error: ${err && err.message ? err.message : "unknown"}`, { status: 500, headers });
    }
  },
};
