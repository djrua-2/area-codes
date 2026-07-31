/*
  AREA CODES — app.js
  -------------------
  Tiny hash-based router. Reads content from data.json (fetched once at
  startup — see loadData below), region layout from `STATE_GRID` (states.js)
  and `STATE_OUTLINES` (stateOutlines.js), and renders into #app. No build
  step, no framework. Dependencies: Spotify's iFrame API (playback) and,
  only on the /add page, a Cloudflare Worker (see worker/README.md) that
  actually persists new entries.

  Routes:
    #/                              home — the state grid map + chart + search
    #/state/:abbrev                 artists in a state, grouped by city
    #/city/:regionId/:cityId        a city's artists + clickable tracks
    #/neighborhood/:regionId/:cityId/:hoodId
    #/add                           password-gated form to add a new artist
*/

const app = document.getElementById("app");
let regions = [];
let dataLoaded = false;

async function loadData() {
  const res = await fetch("data.json", { cache: "no-store" });
  regions = await res.json();
  dataLoaded = true;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return String(str).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function findRegion(regionId) {
  return regions.find(r => r.id === regionId);
}

function findCity(region, cityId) {
  return region.cities.find(c => c.id === cityId);
}

// Build a lookup of stateAbbrev -> [{ region, city }] once per render.
function citiesByState() {
  const map = {};
  regions.forEach(region => {
    region.cities.forEach(city => {
      if (!city.state) return;
      (map[city.state] = map[city.state] || []).push({ region, city });
    });
  });
  return map;
}

// ---- clickable tracks -> persistent top player (Spotify iFrame API) ----
function renderTrackList(tracks, artistName) {
  return (tracks || []).map(t => {
    if (!t.spotifyId) {
      return `<li class="track-row"><span class="track-static">${escapeHtml(t.title)}</span></li>`;
    }
    return `
      <li class="track-row">
        <button class="track-toggle" data-spotify-id="${escapeAttr(t.spotifyId)}" data-title="${escapeAttr(t.title)}" data-artist="${escapeAttr(artistName)}">&#9656; ${escapeHtml(t.title)}</button>
      </li>
    `;
  }).join("");
}

let spotifyIframeAPI = null;
let spotifyController = null;
let pendingTrack = null;
let isPlaying = false;

window.onSpotifyIframeApiReady = function (IFrameAPI) {
  spotifyIframeAPI = IFrameAPI;
  if (pendingTrack) {
    const t = pendingTrack;
    pendingTrack = null;
    playTrack(t.spotifyId, t.title, t.artist);
  }
};

function playTrack(spotifyId, title, artist) {
  const bar = document.getElementById("player-bar");
  bar.hidden = false;
  document.getElementById("player-title").textContent = title;
  document.getElementById("player-artist").textContent = artist;

  if (!spotifyIframeAPI) {
    pendingTrack = { spotifyId, title, artist };
    return;
  }

  if (!spotifyController) {
    const mount = document.getElementById("spotify-mount");
    spotifyIframeAPI.createController(mount, { uri: `spotify:track:${spotifyId}`, width: "1", height: "1" }, controller => {
      spotifyController = controller;
      controller.addListener("ready", () => controller.play());
      controller.addListener("playback_update", e => {
        isPlaying = !!(e && e.data && !e.data.isPaused);
        updatePlayerButton();
      });
    });
    return;
  }

  spotifyController.loadUri(`spotify:track:${spotifyId}`);
  spotifyController.play();
}

function togglePlayback() {
  if (!spotifyController) return;
  spotifyController.togglePlay();
}

function updatePlayerButton() {
  const btn = document.getElementById("player-toggle");
  if (!btn) return;
  btn.innerHTML = isPlaying ? "&#10074;&#10074;" : "&#9658;";
}

document.addEventListener("click", e => {
  const btn = e.target.closest(".track-toggle");
  if (btn) playTrack(btn.dataset.spotifyId, btn.dataset.title, btn.dataset.artist);
});

// ---- randomize: jump to one random artist's city page ----
function randomizeArtist() {
  const picks = [];
  regions.forEach(region => {
    region.cities.forEach(city => {
      (city.artists || []).forEach(() => picks.push({ region, cityId: city.id, hoodId: null }));
      (city.neighborhoods || []).forEach(hood => {
        (hood.artists || []).forEach(() => picks.push({ region, cityId: city.id, hoodId: hood.id }));
      });
    });
  });
  if (!picks.length) return;
  const pick = picks[Math.floor(Math.random() * picks.length)];
  location.hash = pick.hoodId
    ? `#/neighborhood/${pick.region.id}/${pick.cityId}/${pick.hoodId}`
    : `#/city/${pick.region.id}/${pick.cityId}`;
}

// ---- organic (non-perfectly-straight) line drawing, oscilloscope-style ----
function seededRand(seed) {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function smoothPath(pts) {
  let d = `M ${pts[0].x.toFixed(3)} ${pts[0].y.toFixed(3)} `;
  for (let i = 1; i < pts.length - 1; i++) {
    const midX = (pts[i].x + pts[i + 1].x) / 2;
    const midY = (pts[i].y + pts[i + 1].y) / 2;
    d += `Q ${pts[i].x.toFixed(3)} ${pts[i].y.toFixed(3)} ${midX.toFixed(3)} ${midY.toFixed(3)} `;
  }
  const last = pts[pts.length - 1];
  d += `L ${last.x.toFixed(3)} ${last.y.toFixed(3)}`;
  return d;
}

// A slightly wobbly version of a straight line between two points — endpoints
// stay exact (so the grid mesh still lines up), the middle drifts a little.
function wobblyLine(x1, y1, x2, y2, seed, amplitude) {
  const vertical = Math.abs(x2 - x1) < 0.0001;
  const horizontal = Math.abs(y2 - y1) < 0.0001;
  const steps = 5;
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    let x = x1 + (x2 - x1) * t;
    let y = y1 + (y2 - y1) * t;
    if (i > 0 && i < steps) {
      const j = (seededRand(seed * 131.7 + i * 7.3) - 0.5) * amplitude;
      if (vertical) x += j;
      else if (horizontal) y += j;
      else { x += j; y += j; }
    }
    pts.push({ x, y });
  }
  return smoothPath(pts);
}

// ---- artist-count line chart, oscilloscope trace with organic jitter ----
function buildTracePath(values, w, h) {
  const n = values.length;
  const maxV = Math.max(...values, 1);
  const mx = 6, my = 5;
  const uw = w - mx * 2;
  const uh = h - my * 2;

  const basePoints = values.map((v, i) => ({
    x: mx + (n === 1 ? uw / 2 : i * (uw / (n - 1))),
    y: my + uh - (v / maxV) * uh
  }));

  const pts = [];
  for (let i = 0; i < basePoints.length; i++) {
    pts.push(basePoints[i]);
    if (i < basePoints.length - 1) {
      const a = basePoints[i], b = basePoints[i + 1];
      const steps = 5;
      for (let s = 1; s < steps; s++) {
        const t = s / steps;
        const jitter = (seededRand(i * 97 + s) - 0.5) * (uh * 0.08);
        pts.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t + jitter });
      }
    }
  }

  return { d: smoothPath(pts), basePoints };
}

function renderArtistChart() {
  const byState = citiesByState();
  const rows = Object.keys(byState).sort().map(abbrev => {
    const count = byState[abbrev].reduce((sum, { city }) => sum + (city.artists ? city.artists.length : 0), 0);
    const info = STATE_GRID.find(s => s.abbrev === abbrev);
    return { abbrev, name: info ? info.name : abbrev, count };
  });

  if (!rows.length) return "";

  const W = 100, H = 34;
  const { d, basePoints } = buildTracePath(rows.map(r => r.count), W, H);
  const gridLines = [0.25, 0.5, 0.75].map(f => `<line x1="0" y1="${(H * f).toFixed(2)}" x2="${W}" y2="${(H * f).toFixed(2)}" />`).join("");
  const dots = basePoints.map(p => `<circle cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="0.9" />`).join("");
  const labels = rows.map(r => `<span>${escapeHtml(r.abbrev)}</span>`).join("");

  return `
    <p class="section-heading">Artists Documented, By State</p>
    <div class="chart-wrap">
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="chart-svg">
        <g class="chart-grid">${gridLines}</g>
        <path class="chart-trace" d="${d}" />
        <g class="chart-dots">${dots}</g>
      </svg>
      <div class="chart-labels">${labels}</div>
    </div>
  `;
}

// ---- country map: hovering a state previews up to 5 artist names ----
const GRID_COLS = 12;
const GRID_ROWS = 8;
const HOVER_PREVIEW_MAX = 5;

function collectStateArtistNames(entries) {
  const names = [];
  entries.forEach(({ city }) => {
    (city.artists || []).forEach(a => names.push(a.name));
    (city.neighborhoods || []).forEach(h => (h.artists || []).forEach(a => names.push(a.name)));
  });
  return names;
}

function renderHoverBand(abbrev, entries) {
  const names = collectStateArtistNames(entries);
  const shown = names.slice(0, HOVER_PREVIEW_MAX);
  const extra = names.length - shown.length;
  const tipHtml = shown.map(escapeHtml).join("<br>") + (extra > 0 ? `<br>+ ${extra} more` : "");
  return `
    <a class="hover-band" href="#/state/${abbrev}">
      <span class="hover-tip">${tipHtml}</span>
    </a>
  `;
}

function renderHome() {
  const stateCities = citiesByState();

  const tiles = STATE_GRID.map(s => {
    const entries = stateCities[s.abbrev];
    if (!entries || !entries.length) {
      return `
        <a
          class="state-cell is-empty"
          style="grid-column:${s.col}; grid-row:${s.row};"
          href="#/state/${s.abbrev}"
          title="${escapeHtml(s.name)} — not yet documented"
        ><span class="state-label">${s.abbrev}</span></a>
      `;
    }

    return `
      <div class="state-cell is-documented" style="grid-column:${s.col}; grid-row:${s.row};" title="${escapeHtml(s.name)}">
        ${renderHoverBand(s.abbrev, entries)}
        <span class="state-label">${s.abbrev}</span>
      </div>
    `;
  }).join("");

  const vLines = [];
  for (let i = 0; i <= GRID_COLS; i++) vLines.push(`<line x1="${i}" y1="0" x2="${i}" y2="${GRID_ROWS}" />`);
  const hLines = [];
  for (let i = 0; i <= GRID_ROWS; i++) hLines.push(`<line x1="0" y1="${i}" x2="${GRID_COLS}" y2="${i}" />`);

  app.innerHTML = `
    <div class="toolbar">
      <input
        type="text"
        class="search-box retro-field"
        placeholder="Search artists (e.g. Gucci Mane, Detroit)"
        oninput="handleSearch(this.value)"
      >
      <button class="randomize-btn retro-btn" onclick="randomizeArtist()">&#8635; RANDOM</button>
    </div>
    <div id="search-results"></div>
    <div id="map-wrap" class="map-scroll">
      <div class="map-grid-container">
        <svg class="grid-lines" viewBox="0 0 ${GRID_COLS} ${GRID_ROWS}" preserveAspectRatio="none">
          ${vLines.join("")}
          ${hLines.join("")}
        </svg>
        <div id="state-grid" class="state-grid">${tiles}</div>
      </div>
    </div>
    <p class="map-key">
      <span class="key-swatch is-documented"></span> documented &nbsp;
      <span class="key-swatch is-empty"></span> not yet mapped &nbsp;
      <span class="map-key-note">hover a state to preview artists, click to open its city map</span>
    </p>
    <div id="map-empty-hide">
      ${renderArtistChart()}
    </div>
  `;
}

function handleSearch(query) {
  const mapWrap = document.getElementById("map-wrap");
  const chartWrap = document.getElementById("map-empty-hide");
  const resultsEl = document.getElementById("search-results");
  const q = query.trim().toLowerCase();

  if (!q) {
    resultsEl.innerHTML = "";
    mapWrap.style.display = "";
    if (chartWrap) chartWrap.style.display = "";
    return;
  }

  mapWrap.style.display = "none";
  if (chartWrap) chartWrap.style.display = "none";
  const hits = [];

  regions.forEach(region => {
    region.cities.forEach(city => {
      city.artists.forEach(artist => {
        if (artist.name.toLowerCase().includes(q)) {
          hits.push({ region, city, artist });
        }
      });
      (city.neighborhoods || []).forEach(hood => {
        (hood.artists || []).forEach(artist => {
          if (artist.name.toLowerCase().includes(q)) {
            hits.push({ region, city: hood, artist });
          }
        });
      });
    });
  });

  if (!hits.length) {
    resultsEl.innerHTML = `<div class="search-results"><p>No match for "${escapeHtml(query)}" — this is a small, hand-curated dataset. Try a state abbreviation instead, or add the artist yourself.</p></div>`;
    return;
  }

  resultsEl.innerHTML = `
    <div class="search-results">
      ${hits.map(h => `
        <a class="search-hit" href="#/state/${h.city.state || ""}">
          <strong>${escapeHtml(h.artist.name)}</strong> — ${escapeHtml(h.city.name)}
          <br><span>${escapeHtml(h.artist.note)}</span>
        </a>
      `).join("")}
    </div>
  `;
}

// State-level map: real outline (pre-computed in stateOutlines.js) with each
// documented city marked at its actual relative position and clickable.
function renderStateMap(abbrev, entries) {
  const geo = STATE_OUTLINES[abbrev];
  if (!geo) return "";

  const cityLookup = {};
  entries.forEach(({ region, city }) => { cityLookup[city.id] = { region, city }; });

  const points = geo.outline.map(p => p.join(",")).join(" ");
  const markers = geo.cities.map(c => {
    const match = cityLookup[c.id];
    if (!match) return "";
    // Start every label to the right of its pin; adjustStateMapLabels()
    // flips it to the left afterward if it would actually run off the map,
    // measured in real SVG units so it's correct at any screen size.
    return `
      <a class="city-marker" href="#/city/${match.region.id}/${match.city.id}">
        <circle cx="${c.x}" cy="${c.y}" r="2.2" />
        <text x="${(c.x + 3.2).toFixed(2)}" y="${(c.y + 1.2).toFixed(2)}" font-size="4.2" text-anchor="start">${escapeHtml(c.name)}</text>
      </a>
    `;
  }).join("");

  return `
    <div class="state-map-wrap">
      <svg class="state-map-svg" viewBox="-10 -10 120 120" preserveAspectRatio="xMidYMid meet">
        <polygon class="state-outline" points="${points}" />
        ${markers}
      </svg>
    </div>
  `;
}

// Runs after the state map is in the DOM. Uses getBBox() (real SVG-unit
// measurements, not screen pixels) so a label that overflows the map's
// right edge gets flipped to the left — correct at any screen size, since
// SVG scaling is uniform and this measures in the same coordinate space
// the viewBox uses.
function adjustStateMapLabels() {
  const svg = document.querySelector(".state-map-svg");
  if (!svg || !svg.viewBox || !svg.viewBox.baseVal) return;
  const vb = svg.viewBox.baseVal;
  const minX = vb.x, maxX = vb.x + vb.width;

  svg.querySelectorAll(".city-marker").forEach(marker => {
    const text = marker.querySelector("text");
    const circle = marker.querySelector("circle");
    if (!text || !circle) return;
    const cx = parseFloat(circle.getAttribute("cx"));
    let bbox;
    try { bbox = text.getBBox(); } catch { return; }

    if (bbox.x + bbox.width > maxX) {
      text.setAttribute("text-anchor", "end");
      text.setAttribute("x", (cx - 3.2).toFixed(2));
    } else if (bbox.x < minX) {
      text.setAttribute("text-anchor", "start");
      text.setAttribute("x", (cx + 3.2).toFixed(2));
    }
  });
}

function renderState(abbrev) {
  const stateInfo = STATE_GRID.find(s => s.abbrev === abbrev);
  const stateName = stateInfo ? stateInfo.name : abbrev;
  const entries = citiesByState()[abbrev] || [];

  if (!entries.length) {
    app.innerHTML = `
      <p class="crumbs"><a href="#/">Home</a> / ${escapeHtml(stateName)}</p>
      <h1 class="page-title">${escapeHtml(stateName)}</h1>
      <p class="page-subtitle">No cities documented yet for ${escapeHtml(stateName)}.</p>
      <p>This is a living, hand-curated project — check back later, or add it yourself in data.js.</p>
    `;
    return;
  }

  const sorted = entries.slice().sort((a, b) => a.city.name.localeCompare(b.city.name));

  const blocks = sorted.map(({ region, city }) => {
    const artists = (city.artists || []).map(a => `
      <li><a href="#/city/${region.id}/${city.id}">${escapeHtml(a.name)}</a></li>
    `).join("");
    return `
      <div class="city-block">
        <a class="city-heading" href="#/city/${region.id}/${city.id}">${escapeHtml(city.name)}</a>
        <ul class="rapper-names">${artists}</ul>
      </div>
    `;
  }).join("");

  app.innerHTML = `
    <p class="crumbs"><a href="#/">Home</a> / ${escapeHtml(stateName)}</p>
    <h1 class="page-title">${escapeHtml(stateName)}</h1>
    ${renderStateMap(abbrev, entries)}
    <div class="rapper-list">${blocks}</div>
  `;
  adjustStateMapLabels();
}

function renderArtistBlocks(artists) {
  return (artists || []).map(a => `
    <div class="artist-card">
      <h3>${escapeHtml(a.name)}</h3>
      <p>${escapeHtml(a.note)}</p>
      <ul class="track-list">${renderTrackList(a.tracks, a.name)}</ul>
    </div>
  `).join("");
}

function renderCity(regionId, cityId) {
  const region = findRegion(regionId);
  if (!region) return renderNotFound();
  const city = findCity(region, cityId);
  if (!city) return renderNotFound();

  const stateInfo = STATE_GRID.find(s => s.abbrev === city.state);
  const stateName = stateInfo ? stateInfo.name : city.state;

  const neighborhoods = (city.neighborhoods || []).map(n => `
    <a class="city-card" href="#/neighborhood/${region.id}/${city.id}/${n.id}">
      <h3>${escapeHtml(n.name)}</h3>
    </a>
  `).join("");

  app.innerHTML = `
    <p class="crumbs"><a href="#/">Home</a> / <a href="#/state/${city.state}">${escapeHtml(stateName)}</a> / ${escapeHtml(city.name)}</p>
    <h1 class="page-title">${escapeHtml(city.name)}</h1>

    ${neighborhoods ? `
      <p class="section-heading">Neighborhoods</p>
      <div class="city-list" style="margin-bottom:2rem;">${neighborhoods}</div>
    ` : ""}

    <div class="artist-list">${renderArtistBlocks(city.artists)}</div>
  `;
}

function renderNeighborhood(regionId, cityId, hoodId) {
  const region = findRegion(regionId);
  if (!region) return renderNotFound();
  const city = findCity(region, cityId);
  if (!city) return renderNotFound();
  const hood = (city.neighborhoods || []).find(n => n.id === hoodId);
  if (!hood) return renderNotFound();

  const stateInfo = STATE_GRID.find(s => s.abbrev === city.state);
  const stateName = stateInfo ? stateInfo.name : city.state;

  app.innerHTML = `
    <p class="crumbs"><a href="#/">Home</a> / <a href="#/state/${city.state}">${escapeHtml(stateName)}</a> / <a href="#/city/${region.id}/${city.id}">${escapeHtml(city.name)}</a> / ${escapeHtml(hood.name)}</p>
    <h1 class="page-title">${escapeHtml(hood.name)}</h1>

    <div class="artist-list">${renderArtistBlocks(hood.artists)}</div>
  `;
}

function renderNotFound() {
  app.innerHTML = `
    <p class="crumbs"><a href="#/">Home</a></p>
    <h1 class="page-title">404</h1>
    <p>That state, city, or neighborhood doesn't exist yet.</p>
  `;
}

// ---- add-artist: password gate (session-only convenience; the Worker is
// the real gatekeeper and re-checks the plain password on every submit) ----
async function sha256Hex(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function storedPassword() {
  return sessionStorage.getItem("areacodes_pw") || "";
}

function isConfigured() {
  return !!(AREA_CODES_CONFIG.ADD_ARTIST_ENDPOINT && AREA_CODES_CONFIG.PASSWORD_HASH);
}

async function handleUnlock() {
  const input = document.getElementById("gate-password");
  const errorEl = document.getElementById("gate-error");
  const hash = await sha256Hex(input.value);
  if (hash === AREA_CODES_CONFIG.PASSWORD_HASH) {
    sessionStorage.setItem("areacodes_pw", input.value);
    renderAddForm();
  } else {
    errorEl.textContent = "Incorrect password.";
  }
}

function renderAddGate() {
  app.innerHTML = `
    <h1 class="page-title">Add an Artist</h1>
    <div class="gate-wrap">
      <p class="page-subtitle">This page is password-protected. Enter it once per browser session.</p>
      <input type="password" class="retro-field" id="gate-password" placeholder="Password" onkeydown="if(event.key==='Enter')handleUnlock()">
      <button class="retro-btn" onclick="handleUnlock()">Unlock</button>
      <p id="gate-error" class="gate-error"></p>
    </div>
  `;
}

function renderNotConfigured() {
  app.innerHTML = `
    <h1 class="page-title">Add an Artist</h1>
    <p class="page-subtitle">This page isn't set up yet — config.js needs ADD_ARTIST_ENDPOINT and PASSWORD_HASH filled in. See worker/README.md.</p>
  `;
}

function trackRowHtml(i) {
  return `
    <div class="track-input-row" data-track-row="${i}">
      <input type="text" class="retro-field" placeholder="Song title" data-track-title>
      <input type="text" class="retro-field" placeholder="Spotify link or ID" data-track-spotify>
      <button type="button" class="retro-btn" onclick="this.closest('[data-track-row]').remove()">&times;</button>
    </div>
  `;
}

let trackRowCounter = 0;

function addTrackRow() {
  trackRowCounter++;
  document.getElementById("track-rows").insertAdjacentHTML("beforeend", trackRowHtml(trackRowCounter));
}

function renderAddForm() {
  trackRowCounter = 0;
  const stateOptions = STATE_GRID.slice().sort((a, b) => a.name.localeCompare(b.name))
    .map(s => `<option value="${s.abbrev}">${escapeHtml(s.name)}</option>`).join("");

  app.innerHTML = `
    <h1 class="page-title">Add an Artist</h1>
    <p class="page-subtitle">Goes live for everyone within about a minute of submitting.</p>
    <form class="add-form" onsubmit="handleAddSubmit(event)">
      <div>
        <label for="f-artist">Artist name</label>
        <input type="text" class="retro-field" id="f-artist" required>
      </div>
      <div>
        <label for="f-state">State</label>
        <select class="retro-field" id="f-state" required>${stateOptions}</select>
      </div>
      <div>
        <label for="f-city">City</label>
        <input type="text" class="retro-field" id="f-city" placeholder="e.g. Houston, TX" required>
      </div>
      <div>
        <label for="f-note">One-line note (style, why they represent this place)</label>
        <textarea class="retro-field" id="f-note" rows="2" required></textarea>
      </div>
      <div>
        <label>Songs</label>
        <p style="margin:0 0 0.5rem;"><a href="https://open.spotify.com/search" target="_blank" rel="noopener">Search Spotify ↗</a> for the song, then paste its link below.</p>
        <div id="track-rows"></div>
        <button type="button" class="add-track-btn retro-btn" onclick="addTrackRow()">+ Add a song</button>
      </div>
      <div class="form-actions">
        <button type="submit" class="retro-btn">Submit</button>
        <span id="form-status" class="form-status"></span>
      </div>
    </form>
    <pre id="snippet-box" class="snippet-box" style="display:none;"></pre>
  `;
  addTrackRow();
}

function extractSpotifyId(value) {
  const v = value.trim();
  const match = v.match(/track\/([A-Za-z0-9]+)/);
  if (match) return match[1];
  if (/^[A-Za-z0-9]{10,30}$/.test(v)) return v;
  return "";
}

async function handleAddSubmit(evt) {
  evt.preventDefault();
  const statusEl = document.getElementById("form-status");
  statusEl.className = "form-status";
  statusEl.textContent = "Submitting…";

  const tracks = Array.from(document.querySelectorAll("[data-track-row]")).map(row => {
    const title = row.querySelector("[data-track-title]").value.trim();
    const spotifyRaw = row.querySelector("[data-track-spotify]").value.trim();
    const spotifyId = spotifyRaw ? extractSpotifyId(spotifyRaw) : "";
    return title ? (spotifyId ? { title, spotifyId } : { title }) : null;
  }).filter(Boolean);

  const payload = {
    password: storedPassword(),
    state: document.getElementById("f-state").value,
    cityName: document.getElementById("f-city").value.trim(),
    artistName: document.getElementById("f-artist").value.trim(),
    note: document.getElementById("f-note").value.trim(),
    tracks
  };

  try {
    const res = await fetch(AREA_CODES_CONFIG.ADD_ARTIST_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error(await res.text());
    statusEl.textContent = "Added! It'll appear on the live site shortly.";
    document.querySelector(".add-form").reset();
    document.getElementById("track-rows").innerHTML = "";
    addTrackRow();
  } catch (err) {
    statusEl.className = "form-status is-error";
    statusEl.textContent = "Couldn't submit — " + err.message;
  }
}

function renderAdd() {
  if (!isConfigured()) return renderNotConfigured();
  if (storedPassword()) return renderAddForm();
  return renderAddGate();
}

function router() {
  if (!dataLoaded) return;
  const hash = location.hash.replace(/^#\/?/, "");
  const parts = hash.split("/").filter(Boolean);

  if (parts.length === 0) return renderHome();
  if (parts[0] === "add") return renderAdd();
  if (parts[0] === "state" && parts[1]) return renderState(parts[1]);
  if (parts[0] === "city" && parts[1] && parts[2]) return renderCity(parts[1], parts[2]);
  if (parts[0] === "neighborhood" && parts[1] && parts[2] && parts[3]) {
    return renderNeighborhood(parts[1], parts[2], parts[3]);
  }
  return renderNotFound();
}

window.addEventListener("hashchange", router);
window.addEventListener("DOMContentLoaded", () => { loadData().then(router); });
