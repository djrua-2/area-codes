/*
  AREA CODES — app.js
  -------------------
  Tiny hash-based router. Reads content from data.json and state/city
  geography from stateOutlines.json (both fetched once at startup — see
  loadData below), plus the country-map layout from `STATE_GRID` (states.js).
  Renders into #app. No build step, no framework. Dependencies: Spotify's
  iFrame API (playback) and, only on the /add page, a Cloudflare Worker
  (see worker/README.md) that persists new entries AND geocodes+places new
  city pins automatically.

  Routes:
    #/                              home — the state grid map + chart + search
    #/state/:abbrev                 artists in a state, grouped by city
    #/city/:regionId/:cityId        a city's artists + clickable tracks
    #/neighborhood/:regionId/:cityId/:hoodId
    #/add                           password-gated form to add a new artist
*/

const app = document.getElementById("app");
let regions = [];
let STATE_OUTLINES = {};
let dataLoaded = false;

// Site-wide look overrides (colors, line thickness, arbitrary custom CSS),
// edited from the password-gated #/add/theme page and persisted to
// theme.json the same way data.json is — so a change made there is live for
// every visitor on their next page load, no code/file edits required. Best
// effort: a missing/failed fetch (e.g. theme.json doesn't exist yet) just
// leaves the site on its built-in style.css defaults.
let THEME = { vars: {}, customCss: "", labels: {} };

async function loadData() {
  const [regionsRes, outlinesRes, themeRes] = await Promise.all([
    fetch("data.json", { cache: "no-store" }),
    fetch("stateOutlines.json", { cache: "no-store" }),
    fetch("theme.json", { cache: "no-store" }).catch(() => null)
  ]);
  regions = await regionsRes.json();
  STATE_OUTLINES = await outlinesRes.json();
  if (themeRes && themeRes.ok) {
    try { THEME = await themeRes.json(); } catch { /* keep defaults */ }
  }
  applyThemeObject(THEME);
  dataLoaded = true;
}

function setCustomCssStyleTag(css) {
  let styleEl = document.getElementById("theme-custom-css");
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = "theme-custom-css";
    document.head.appendChild(styleEl);
  }
  // textContent (not innerHTML) so nothing in here can break out of the
  // <style> tag, regardless of what's typed into the custom-CSS textarea.
  styleEl.textContent = css || "";
}

// Maps an editable text label's key to the single DOM element it controls.
// Only one entry today (the footer CTA button) — deliberately a plain
// lookup rather than a generic templating system, since adding a second
// editable label later just means one more entry here plus one more row
// in THEMEABLE_LABELS.
const LABEL_TARGET_SELECTORS = {
  addArtistBtn: ".retro-badge-link",
};

function applyThemeLabel(key, value) {
  const selector = LABEL_TARGET_SELECTORS[key];
  const el = selector && document.querySelector(selector);
  if (el) el.textContent = value;
}

function applyThemeObject(themeObj) {
  const root = document.documentElement.style;
  // Clear every known themeable var first — otherwise a key absent from
  // themeObj.vars (e.g. after Discard, when the saved theme is empty/
  // partial) would silently keep whatever was last live-previewed instead
  // of actually reverting, since setProperty only ever adds/overwrites and
  // never removes on its own.
  ALL_THEMEABLE_VARS.forEach(t => root.removeProperty(t.key));
  Object.entries((themeObj && themeObj.vars) || {}).forEach(([key, value]) => {
    if (key.startsWith("--") && typeof value === "string") root.setProperty(key, value);
  });
  setCustomCssStyleTag(themeObj && themeObj.customCss);
  const labels = (themeObj && themeObj.labels) || {};
  THEMEABLE_LABELS.forEach(l => applyThemeLabel(l.key, labels[l.key] || l.default));
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

// ---- clickable tracks -> persistent top player ----
// Uses Spotify's iFrame Controller API so clicking a song can actually
// autoplay, but keeps the player VISIBLE (not the old hidden/1px version).
// A hidden iframe is exactly the pattern mobile Safari's autoplay
// heuristics distrust; a visible one with Spotify's own native play/pause
// button as the fallback means even if a strict browser blocks the
// programmatic play() call, you land on a working player you can tap
// rather than a silent failure. No custom play/pause state to track here
// on purpose — Spotify's own UI is always the source of truth.
function renderTrackList(tracks) {
  return (tracks || []).map(t => {
    if (!t.spotifyId) {
      return `<li class="track-row"><span class="track-static">${escapeHtml(t.title)}</span></li>`;
    }
    return `
      <li class="track-row">
        <button class="track-toggle" data-spotify-id="${escapeAttr(t.spotifyId)}">&#9656; ${escapeHtml(t.title)}</button>
      </li>
    `;
  }).join("");
}

let spotifyIframeAPI = null;
let spotifyController = null;
let pendingSpotifyId = null;

window.onSpotifyIframeApiReady = function (IFrameAPI) {
  spotifyIframeAPI = IFrameAPI;
  if (pendingSpotifyId) {
    const id = pendingSpotifyId;
    pendingSpotifyId = null;
    playTrack(id);
  }
};

function playTrack(spotifyId) {
  const bar = document.getElementById("player-bar");
  bar.hidden = false;

  if (!spotifyIframeAPI) {
    pendingSpotifyId = spotifyId;
    return;
  }

  if (!spotifyController) {
    const mount = document.getElementById("player-mount");
    spotifyIframeAPI.createController(mount, { uri: `spotify:track:${spotifyId}`, width: "100%", height: "80" }, controller => {
      spotifyController = controller;
      controller.addListener("ready", () => controller.play());
    });
    return;
  }

  spotifyController.loadUri(`spotify:track:${spotifyId}`);
  spotifyController.play();
}

document.addEventListener("click", e => {
  const btn = e.target.closest(".track-toggle");
  if (btn) { playTrack(btn.dataset.spotifyId); return; }

  const del = e.target.closest(".delete-artist-link");
  if (del) {
    e.preventDefault();
    deleteArtist(del.dataset.regionId, del.dataset.cityId, parseInt(del.dataset.artistIndex, 10), del.dataset.artistName);
  }
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

// ---- delete an existing artist (password-gated, same session as /add) ----
// Mirrors the Worker's own cleanup (removeIfEmpty) so the local `regions`
// array stays in sync with the server after a delete without needing a
// refetch — without this, a second delete on the same page computes its
// artistIndex against a stale (unshifted) local array and eventually 404s.
function removeArtistLocally(regionId, cityId, artistIndex) {
  const region = regions.find(r => r.id === regionId);
  const city = region && region.cities.find(c => c.id === cityId);
  if (!city) return;
  city.artists.splice(artistIndex, 1);
  const cityEmpty = city.artists.length === 0 &&
    (!city.neighborhoods || city.neighborhoods.every(h => !h.artists || h.artists.length === 0));
  if (cityEmpty) {
    region.cities = region.cities.filter(c => c.id !== cityId);
    if (region.cities.length === 0) regions = regions.filter(r => r.id !== regionId);
  }
}

async function deleteArtist(regionId, cityId, artistIndex, artistName) {
  if (!confirm(`Delete "${artistName}"? This can't be undone.`)) return;
  try {
    const res = await fetch(AREA_CODES_CONFIG.ADD_ARTIST_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", password: storedPassword(), regionId, cityId, artistIndex })
    });
    if (!res.ok) throw new Error(await res.text());
    removeArtistLocally(regionId, cityId, artistIndex);
    router();
  } catch (err) {
    alert("Couldn't delete — " + err.message);
  }
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
  `;
}

function handleSearch(query) {
  const mapWrap = document.getElementById("map-wrap");
  const resultsEl = document.getElementById("search-results");
  const q = query.trim().toLowerCase();

  if (!q) {
    resultsEl.innerHTML = "";
    mapWrap.style.display = "";
    return;
  }

  mapWrap.style.display = "none";
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
// The outline/pin coordinates in stateOutlines.json are normalized
// independently per axis (0-100 for both the longitude spread and the
// latitude spread), which silently forces every state into a square
// footprint regardless of its real shape — e.g. Tennessee (wide/short) and
// New Jersey (narrow/tall) both come out looking square. This computes a
// corrective per-axis scale from the state's actual bbox (accounting for
// longitude compression at latitude via cos(lat)) so the true width:height
// ratio is restored at render time, without needing to touch the
// pre-computed JSON. Only ever shrinks the smaller axis, never stretches
// past the original footprint, so the shape still fits the same map area.
function computeAspectScale(bbox) {
  const lonRange = bbox.maxLon - bbox.minLon;
  const latRange = bbox.maxLat - bbox.minLat;
  const avgLatRad = ((bbox.minLat + bbox.maxLat) / 2) * Math.PI / 180;
  const trueWidth = lonRange * Math.cos(avgLatRad);
  const trueHeight = latRange;
  const ratio = trueWidth / trueHeight;
  return ratio >= 1 ? { scaleX: 1, scaleY: 1 / ratio } : { scaleX: ratio, scaleY: 1 };
}

// A small pixel-art push-pin: a shaded red head (crispEdges gives it visibly
// stepped, jagged circle edges instead of smooth anti-aliasing) plus a
// metal needle, defined once and reused via <use> for every city.
const PUSHPIN_SYMBOL = `
  <symbol id="pushpin-icon" viewBox="0 0 10 12" shape-rendering="crispEdges">
    <ellipse cx="5" cy="10.6" rx="2" ry="0.8" fill="#000000" opacity="0.25" />
    <rect x="4.5" y="6" width="1" height="4" fill="#aaaaaa" />
    <rect x="4.5" y="6" width="0.5" height="4" fill="#dddddd" />
    <circle cx="5" cy="4" r="4" fill="#b30000" />
    <path d="M2 5.8 A4 4 0 0 0 8.6 6.2 A4 4 0 0 1 2 5.8 Z" fill="#7a0000" />
    <circle cx="3.4" cy="2.4" r="1.3" fill="#ff6666" />
    <circle cx="2.8" cy="1.7" r="0.55" fill="#ffbaba" />
  </symbol>
`;

function renderStateMap(abbrev, entries) {
  const geo = STATE_OUTLINES[abbrev];
  if (!geo) return "";

  const cityLookup = {};
  entries.forEach(({ region, city }) => { cityLookup[city.id] = { region, city }; });

  const rawXs = geo.outline.map(p => p[0]);
  const rawYs = geo.outline.map(p => p[1]);
  const centerX = (Math.min(...rawXs) + Math.max(...rawXs)) / 2;
  const centerY = (Math.min(...rawYs) + Math.max(...rawYs)) / 2;
  const { scaleX, scaleY } = computeAspectScale(geo.bbox);
  const fix = (x, y) => [centerX + (x - centerX) * scaleX, centerY + (y - centerY) * scaleY];

  const points = geo.outline.map(p => fix(p[0], p[1]).map(n => n.toFixed(2)).join(",")).join(" ");
  const markers = geo.cities.map(c => {
    const match = cityLookup[c.id];
    if (!match) return "";
    const [cx, cy] = fix(c.x, c.y);
    // Start every label to the right of its pin; adjustStateMapLabels()
    // flips it to the left afterward if it would actually run off the map,
    // measured in real SVG units so it's correct at any screen size. The
    // pin's own needle tip (not its head) marks the exact location, so the
    // <use> box is offset up-and-left of (cx, cy) rather than centered on
    // it; a transparent hit-circle keeps the tap target from shrinking
    // along with the now-smaller visible pin.
    return `
      <a class="city-marker" href="#/city/${match.region.id}/${match.city.id}" data-cx="${cx.toFixed(2)}">
        <circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="2.4" class="city-marker-hitarea" />
        <g class="marker-visual" data-cx="${cx.toFixed(2)}" data-cy="${cy.toFixed(2)}">
          <use href="#pushpin-icon" x="${(cx - 1.5).toFixed(2)}" y="${(cy - 3).toFixed(2)}" width="3" height="3.6" />
          <text x="${(cx + 3.2).toFixed(2)}" y="${(cy + 1.2).toFixed(2)}" font-size="4.2" text-anchor="start">${escapeHtml(c.name)}</text>
        </g>
      </a>
    `;
  }).join("");

  return `
    <div class="state-map-wrap">
      <p class="map-zoom-controls">
        <button type="button" class="retro-btn" onclick="zoomMapBy(0.6)" aria-label="Zoom in">+</button>
        <button type="button" class="retro-btn" onclick="zoomMapBy(-0.6)" aria-label="Zoom out">&minus;</button>
        <button type="button" class="retro-btn" onclick="resetMapZoom()">Reset</button>
        <span class="page-subtitle map-zoom-hint">Double-click to zoom in, click and drag to pan — useful when city labels overlap.</span>
      </p>
      <div class="state-map-viewport">
        <svg class="state-map-svg" viewBox="-10 -10 120 120" preserveAspectRatio="xMidYMid meet">
          <defs>${PUSHPIN_SYMBOL}</defs>
          <polygon class="state-outline" points="${points}" />
          ${markers}
        </svg>
      </div>
    </div>
  `;
}

// ---- state map zoom/pan: plain CSS transform + pointer events, no library.
// Lets dense states (many city pins close together) become readable by
// zooming in rather than fighting label overlap with tinier and tinier text.
let mapZoomState = { scale: 1, x: 0, y: 0 };
let mapDrag = null;

function applyMapZoom() {
  const svg = document.querySelector(".state-map-svg");
  if (!svg) return;
  const { scale, x, y } = mapZoomState;
  svg.style.transform = `scale(${scale}) translate(${x}px, ${y}px)`;
  // Counter-scale each pin+label back down by the inverse of the map's
  // zoom, pivoted on its own point via an explicit SVG transform (not CSS
  // transform-origin, whose unit/reference-box handling for SVG children
  // is inconsistent across browsers). Positions still spread apart with
  // the zoom — only the rendered size of the pin/text stays fixed — which
  // is what actually relieves label overlap instead of just magnifying it.
  const invScale = 1 / scale;
  svg.querySelectorAll(".marker-visual").forEach(g => {
    const mx = g.dataset.cx, my = g.dataset.cy;
    g.setAttribute("transform", `translate(${mx} ${my}) scale(${invScale}) translate(${-mx} ${-my})`);
  });
}

function resetMapZoom() {
  mapZoomState = { scale: 1, x: 0, y: 0 };
  applyMapZoom();
}

function zoomMapBy(delta) {
  const next = Math.min(4, Math.max(1, mapZoomState.scale + delta));
  if (next === mapZoomState.scale) return;
  mapZoomState.scale = next;
  if (next === 1) { mapZoomState.x = 0; mapZoomState.y = 0; }
  applyMapZoom();
}

// Zooms in a step centered on a specific screen point (a double-click)
// rather than the map's fixed center, so whatever the user double-clicked
// on stays under the cursor instead of the view jumping. Measures the
// rendered box before and after the scale change via getBoundingClientRect
// (real layout, not transform-matrix algebra) and corrects the pan by
// however far that drifted — simpler to get right than deriving the exact
// composition of the scale()/translate() transform by hand.
function zoomAtPoint(clientX, clientY, delta) {
  const svg = document.querySelector(".state-map-svg");
  if (!svg) return;
  const beforeRect = svg.getBoundingClientRect();
  const fracX = (clientX - beforeRect.left) / beforeRect.width;
  const fracY = (clientY - beforeRect.top) / beforeRect.height;

  const next = Math.min(4, Math.max(1, mapZoomState.scale + delta));
  if (next === mapZoomState.scale) return;
  mapZoomState.scale = next;
  applyMapZoom();

  const afterRect = svg.getBoundingClientRect();
  const afterX = afterRect.left + fracX * afterRect.width;
  const afterY = afterRect.top + fracY * afterRect.height;
  mapZoomState.x += (clientX - afterX) / next;
  mapZoomState.y += (clientY - afterY) / next;
  applyMapZoom();
}

// Zoom: double-click only (zoomed toward the click point). Pan: click and
// hold, then drag. Deliberately no wheel/scroll listener — that used to
// hijack two-finger trackpad scrolling and mobile scroll gestures the
// moment the pointer crossed the map, which is exactly the "scrolling
// feels weird" complaint this replaces.
function initMapPanZoom() {
  const viewport = document.querySelector(".state-map-viewport");
  if (!viewport) return;
  mapZoomState = { scale: 1, x: 0, y: 0 };
  applyMapZoom();

  viewport.addEventListener("dblclick", e => {
    e.preventDefault();
    zoomAtPoint(e.clientX, e.clientY, 0.8);
  });

  viewport.addEventListener("pointerdown", e => {
    if (mapZoomState.scale <= 1) return;
    mapDrag = { startX: e.clientX, startY: e.clientY, origX: mapZoomState.x, origY: mapZoomState.y };
    viewport.classList.add("is-panning");
  });
  window.addEventListener("pointermove", e => {
    if (!mapDrag) return;
    mapZoomState.x = mapDrag.origX + (e.clientX - mapDrag.startX) / mapZoomState.scale;
    mapZoomState.y = mapDrag.origY + (e.clientY - mapDrag.startY) / mapZoomState.scale;
    applyMapZoom();
  });
  window.addEventListener("pointerup", () => {
    mapDrag = null;
    viewport.classList.remove("is-panning");
  });
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
    if (!text) return;
    const cx = parseFloat(marker.dataset.cx);
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
  initMapPanZoom();
}

const NEW_TAG_WINDOW_MS = 48 * 60 * 60 * 1000;

function isRecentlyAdded(addedAt) {
  if (!addedAt) return false;
  const t = new Date(addedAt).getTime();
  return !isNaN(t) && Date.now() - t < NEW_TAG_WINDOW_MS;
}

function renderArtistBlocks(artists, regionId, cityId) {
  const canManage = regionId && cityId && isConfigured() && storedPassword();
  return (artists || []).map((a, i) => `
    <div class="artist-card">
      <h3>${escapeHtml(a.name)}${isRecentlyAdded(a.addedAt) ? '<span class="new-tag">New</span>' : ""}</h3>
      ${canManage ? `
        <p class="manage-controls">
          <a href="#/edit/${regionId}/${cityId}/${i}">Edit</a> &nbsp;
          <a href="#" class="delete-artist-link" data-region-id="${escapeAttr(regionId)}" data-city-id="${escapeAttr(cityId)}" data-artist-index="${i}" data-artist-name="${escapeAttr(a.name)}">Delete</a>
        </p>
      ` : ""}
      <p>${escapeHtml(a.note)}</p>
      <ul class="track-list">${renderTrackList(a.tracks)}</ul>
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

    <div class="artist-list">${renderArtistBlocks(city.artists, region.id, city.id)}</div>
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
    router();
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

function trackRowHtml(i, title, spotifyId) {
  return `
    <div class="track-input-row" data-track-row="${i}">
      <input type="text" class="retro-field" placeholder="Song title" data-track-title value="${escapeAttr(title || "")}">
      <input type="text" class="retro-field" placeholder="Spotify link or ID (leave blank to auto-search)" data-track-spotify value="${escapeAttr(spotifyId || "")}">
      <button type="button" class="retro-btn" onclick="this.closest('[data-track-row]').remove()">&times;</button>
    </div>
  `;
}

let trackRowCounter = 0;

function addTrackRow(title, spotifyId) {
  trackRowCounter++;
  document.getElementById("track-rows").insertAdjacentHTML("beforeend", trackRowHtml(trackRowCounter, title, spotifyId));
}

function renderAddForm() {
  trackRowCounter = 0;
  const stateOptions = STATE_GRID.slice().sort((a, b) => a.name.localeCompare(b.name))
    .map(s => `<option value="${s.abbrev}">${escapeHtml(s.name)}</option>`).join("");

  app.innerHTML = `
    <h1 class="page-title">Add an Artist</h1>
    <p class="page-subtitle">Goes live for everyone within about a minute of submitting. Adding several at once? <a href="#/add/bulk">Bulk upload a CSV or XLSX ↗</a></p>
    <p class="page-subtitle">Want to change colors or line thickness across the site? <a href="#/add/theme">Theme Editor ↗</a></p>
    <p class="page-subtitle">Other tools: <a href="#/add/spotify-links">Bulk upload Spotify links</a> · <a href="#/add/relink-spotify">Relink missing Spotify links</a> · <a href="#/add/remove-batch">Remove a batch of artists</a></p>
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
        <p style="margin:0 0 0.5rem;">Leave the Spotify field blank to auto-search by title, or <a href="https://open.spotify.com/search" target="_blank" rel="noopener">search Spotify ↗</a> yourself and paste a link.</p>
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

function renderEditForm(regionId, cityId, artistIndex) {
  const region = findRegion(regionId);
  const city = region && findCity(region, cityId);
  const artist = city && city.artists[artistIndex];
  if (!artist) {
    app.innerHTML = `
      <h1 class="page-title">Edit Artist</h1>
      <p class="page-subtitle">Couldn't find that artist — it may have already been edited or deleted.</p>
      <p><a href="#/">Back home</a></p>
    `;
    return;
  }

  trackRowCounter = 0;
  const stateOptions = STATE_GRID.slice().sort((a, b) => a.name.localeCompare(b.name))
    .map(s => `<option value="${s.abbrev}" ${s.abbrev === city.state ? "selected" : ""}>${escapeHtml(s.name)}</option>`).join("");

  app.innerHTML = `
    <h1 class="page-title">Edit Artist</h1>
    <p class="page-subtitle">Changes go live for everyone within about a minute of submitting.</p>
    <form class="add-form" onsubmit="handleEditSubmit(event, '${escapeAttr(regionId)}', '${escapeAttr(cityId)}', ${artistIndex})">
      <div>
        <label for="f-artist">Artist name</label>
        <input type="text" class="retro-field" id="f-artist" value="${escapeAttr(artist.name)}" required>
      </div>
      <div>
        <label for="f-state">State</label>
        <select class="retro-field" id="f-state" required>${stateOptions}</select>
      </div>
      <div>
        <label for="f-city">City</label>
        <input type="text" class="retro-field" id="f-city" value="${escapeAttr(city.name)}" required>
      </div>
      <div>
        <label for="f-note">One-line note (style, why they represent this place)</label>
        <textarea class="retro-field" id="f-note" rows="2" required>${escapeHtml(artist.note)}</textarea>
      </div>
      <div>
        <label>Songs</label>
        <p style="margin:0 0 0.5rem;">Leave the Spotify field blank to auto-search by title, or <a href="https://open.spotify.com/search" target="_blank" rel="noopener">search Spotify ↗</a> yourself and paste a link.</p>
        <div id="track-rows"></div>
        <button type="button" class="add-track-btn retro-btn" onclick="addTrackRow()">+ Add a song</button>
      </div>
      <div class="form-actions">
        <button type="submit" class="retro-btn">Save changes</button>
        <span id="form-status" class="form-status"></span>
      </div>
    </form>
  `;

  if (artist.tracks && artist.tracks.length) {
    artist.tracks.forEach(t => addTrackRow(t.title, t.spotifyId || ""));
  } else {
    addTrackRow();
  }
}

async function handleEditSubmit(evt, originalRegionId, originalCityId, originalArtistIndex) {
  evt.preventDefault();
  const statusEl = document.getElementById("form-status");
  statusEl.className = "form-status";
  statusEl.textContent = "Saving…";

  const tracks = Array.from(document.querySelectorAll("[data-track-row]")).map(buildTrackFromRow).filter(Boolean);

  const payload = {
    action: "edit",
    password: storedPassword(),
    originalRegionId, originalCityId, originalArtistIndex,
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
    statusEl.textContent = "Saved! Changes will appear on the live site shortly.";
  } catch (err) {
    statusEl.className = "form-status is-error";
    statusEl.textContent = "Couldn't save — " + err.message;
  }
}

function renderEdit(regionId, cityId, artistIndex) {
  if (!isConfigured()) return renderNotConfigured();
  if (!storedPassword()) return renderAddGate();
  renderEditForm(regionId, cityId, parseInt(artistIndex, 10));
}

function extractSpotifyId(value) {
  const v = value.trim();
  const match = v.match(/track\/([A-Za-z0-9]+)/);
  if (match) return match[1];
  if (/^[A-Za-z0-9]{10,30}$/.test(v)) return v;
  return "";
}

// Builds a track object from a track-input-row, or null if no title was
// entered. Spotify link is optional — an empty field means the Worker will
// auto-search for it on save.
function buildTrackFromRow(row) {
  const title = row.querySelector("[data-track-title]").value.trim();
  if (!title) return null;
  const spotifyRaw = row.querySelector("[data-track-spotify]").value.trim();
  const spotifyId = spotifyRaw ? extractSpotifyId(spotifyRaw) : "";
  const track = { title };
  if (spotifyId) track.spotifyId = spotifyId;
  return track;
}

// ---- bulk upload: CSV (no dependency) or XLSX (lazy-loaded parser) ----
// One CSV row = one song. Rows sharing the same artist_name + city + state
// get grouped into a single artist entry with multiple tracks (see
// groupRowsIntoEntries below). Spotify links aren't part of the template —
// the Worker auto-searches for each track that doesn't already have one.
const BULK_MAX_ROWS = 2000; // total song-rows allowed in one file — a sanity ceiling, not a technical limit (batching below has no real cap); headroom above the user's actual 1,682-row library export
// Worst case per entry costs 1 geocode + 1 Spotify search per track; both
// caps below keep a batch's worst case (all-new cities, no cached Spotify
// matches) safely under the free Workers plan's 50-subrequest limit — the
// track cap matters because a few artists in a real library end up with
// many merged songs (e.g. one artist with 10+ tracks) and entry count alone
// wouldn't catch that.
const BULK_BATCH_SIZE = 12; // artist-entries per Worker request
const BULK_BATCH_MAX_TRACKS = 20; // total tracks per Worker request
const BULK_TEMPLATE_HEADERS = ["artist_name", "state", "city", "note", "song_title"];

function downloadBulkTemplate() {
  const csv = BULK_TEMPLATE_HEADERS.join(",") + "\n" +
    'Example Artist,GA,"Savannah, GA",One-line note about their style,Example Song One\n' +
    'Example Artist,GA,"Savannah, GA",One-line note about their style,Example Song Two\n';
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "area-codes-songs-template.csv";
  a.click();
  URL.revokeObjectURL(url);
}

// Minimal RFC4180-ish CSV parser: handles quoted fields, embedded commas,
// escaped quotes (""), and CRLF/LF line endings. Returns array of row
// objects keyed by the header row.
function parseCSV(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      rows.push(row); row = [];
    } else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const nonEmpty = rows.filter(r => r.some(cell => cell.trim() !== ""));
  if (!nonEmpty.length) return [];
  const headers = nonEmpty[0].map(h => h.trim());
  return nonEmpty.slice(1).map(r => {
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = (r[idx] || "").trim(); });
    return obj;
  });
}

let xlsxLoadPromise = null;
function loadXLSXLibrary() {
  if (window.XLSX) return Promise.resolve();
  if (xlsxLoadPromise) return xlsxLoadPromise;
  xlsxLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.sheetjs.com/xlsx-0.20.2/package/dist/xlsx.full.min.js";
    script.onload = resolve;
    script.onerror = () => reject(new Error("Couldn't load the XLSX parser — check your connection, or export as CSV instead."));
    document.head.appendChild(script);
  });
  return xlsxLoadPromise;
}

function getField(row, ...keys) {
  const rowKeys = Object.keys(row);
  for (const key of keys) {
    const foundKey = rowKeys.find(k => k.trim().toLowerCase() === key);
    if (foundKey && String(row[foundKey]).trim()) return String(row[foundKey]).trim();
  }
  return "";
}

function normalizeSongRow(row) {
  return {
    artistName: getField(row, "artist_name", "artist"),
    state: getField(row, "state").toUpperCase(),
    cityName: getField(row, "city", "city_name"),
    note: getField(row, "note"),
    songTitle: getField(row, "song_title", "title", "track_title"),
  };
}

// Merges song-rows sharing the same artist + city + state into one entry
// per artist, each with a tracks array — the shape handleBulkAdd expects.
function groupRowsIntoEntries(rows) {
  const order = [];
  const byKey = new Map();
  rows.forEach(r => {
    const key = `${r.artistName.toLowerCase()}|${r.cityName.toLowerCase()}|${r.state}`;
    let entry = byKey.get(key);
    if (!entry) {
      entry = { artistName: r.artistName, state: r.state, cityName: r.cityName, note: r.note, tracks: [] };
      byKey.set(key, entry);
      order.push(entry);
    }
    entry.tracks.push({ title: r.songTitle });
  });
  return order;
}

let bulkParsedEntries = [];

async function handleBulkFile(evt) {
  const file = evt.target.files[0];
  const statusEl = document.getElementById("bulk-status");
  const previewEl = document.getElementById("bulk-preview");
  const submitBtn = document.getElementById("bulk-submit-btn");
  if (!file) return;

  statusEl.className = "form-status";
  statusEl.textContent = "Reading file…";
  previewEl.innerHTML = "";
  submitBtn.disabled = true;
  bulkParsedEntries = [];

  try {
    let rawRows;
    if (/\.xlsx$/i.test(file.name)) {
      await loadXLSXLibrary();
      const buf = await file.arrayBuffer();
      const wb = window.XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      rawRows = window.XLSX.utils.sheet_to_json(sheet, { defval: "" });
    } else {
      const text = await file.text();
      rawRows = parseCSV(text);
    }

    if (!rawRows.length) throw new Error("No rows found in that file.");
    if (rawRows.length > BULK_MAX_ROWS) {
      throw new Error(`That file has ${rawRows.length} rows — max is ${BULK_MAX_ROWS} per upload. Split it into smaller files.`);
    }

    const normalized = rawRows.map((row, i) => ({ ...normalizeSongRow(row), rowNum: i + 2 }));
    const validRows = [], invalidRows = [];
    normalized.forEach(r => {
      const problems = [];
      if (!r.artistName) problems.push("missing artist name");
      if (!r.state) problems.push("missing state");
      if (!r.cityName) problems.push("missing city");
      if (!r.note) problems.push("missing note");
      if (!r.songTitle) problems.push("missing song title");
      if (problems.length) invalidRows.push({ ...r, problems });
      else validRows.push(r);
    });

    const entries = groupRowsIntoEntries(validRows);
    bulkParsedEntries = entries;
    const totalSongs = entries.reduce((n, e) => n + e.tracks.length, 0);

    const entryRowsHtml = entries.map((e, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${escapeHtml(e.artistName)}</td>
        <td>${escapeHtml(e.cityName)}, ${escapeHtml(e.state)}</td>
        <td>${e.tracks.length}</td>
        <td>Ready</td>
      </tr>
    `).join("");

    const invalidRowsHtml = invalidRows.map(r => `
      <tr class="bulk-row-error">
        <td>row ${r.rowNum}</td>
        <td>${escapeHtml(r.artistName || "—")}</td>
        <td>${escapeHtml(r.songTitle || "—")}</td>
        <td>${escapeHtml(r.problems.join(", "))}</td>
      </tr>
    `).join("");

    previewEl.innerHTML = `
      <table class="bulk-table">
        <thead><tr><th>#</th><th>Artist</th><th>City</th><th>Songs</th><th>Status</th></tr></thead>
        <tbody>${entryRowsHtml || `<tr><td colspan="5">No valid rows.</td></tr>`}</tbody>
      </table>
      ${invalidRows.length ? `
        <p class="page-subtitle" style="margin-top:1rem;">${invalidRows.length} row(s) skipped — fix and re-upload if you want them included:</p>
        <table class="bulk-table">
          <thead><tr><th>Row</th><th>Artist</th><th>Song</th><th>Problem</th></tr></thead>
          <tbody>${invalidRowsHtml}</tbody>
        </table>
      ` : ""}
    `;
    statusEl.textContent = `${entries.length} artist(s), ${totalSongs} song(s) ready to submit` + (invalidRows.length ? `, ${invalidRows.length} row(s) skipped.` : ".");
    submitBtn.disabled = entries.length === 0;
  } catch (err) {
    statusEl.className = "form-status is-error";
    statusEl.textContent = "Couldn't read that file — " + err.message;
  }
}

// Groups entries into batches respecting both BULK_BATCH_SIZE (entry count)
// and BULK_BATCH_MAX_TRACKS (total tracks) — whichever limit a batch would
// hit first ends it. A single artist with more tracks than the track cap
// still gets its own (larger) batch rather than being split mid-artist.
function buildBulkBatches(entries) {
  const batches = [];
  let current = [];
  let currentTracks = 0;
  for (const entry of entries) {
    const entryTracks = entry.tracks.length;
    const wouldOverflow = current.length > 0 &&
      (current.length >= BULK_BATCH_SIZE || currentTracks + entryTracks > BULK_BATCH_MAX_TRACKS);
    if (wouldOverflow) {
      batches.push(current);
      current = [];
      currentTracks = 0;
    }
    current.push(entry);
    currentTracks += entryTracks;
  }
  if (current.length) batches.push(current);
  return batches;
}

// Submits grouped artist entries in sequential batches of BULK_BATCH_SIZE —
// never in parallel, so each batch's read-modify-write of data.json always
// sees the previous batch's committed state. On a batch failure, whatever
// already landed stays live; the rest can be re-uploaded as a smaller file.
async function submitBulk() {
  const statusEl = document.getElementById("bulk-status");
  const submitBtn = document.getElementById("bulk-submit-btn");
  const entries = bulkParsedEntries;
  if (!entries.length) return;

  submitBtn.disabled = true;
  const batches = buildBulkBatches(entries);
  let doneArtists = 0, addedCount = 0, skippedCount = 0, pinsAdded = 0, pinCommitFailures = 0;
  const failures = [];

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    statusEl.className = "form-status";
    statusEl.textContent = `Batch ${i + 1} of ${batches.length} — ${doneArtists} of ${entries.length} artists submitted so far…`;

    try {
      const res = await fetch(AREA_CODES_CONFIG.ADD_ARTIST_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "bulk_add", password: storedPassword(), entries: batch })
      });
      if (!res.ok) throw new Error(await res.text());
      const result = await res.json();
      addedCount += result.addedCount || 0;
      skippedCount += result.skippedCount || 0;
      pinsAdded += result.pinsAdded || 0;
      if (result.pinsCommitFailed) pinCommitFailures++;
      result.results.filter(r => !r.ok).forEach(r => failures.push(r));
      doneArtists += batch.length;
    } catch (err) {
      statusEl.className = "form-status is-error";
      statusEl.textContent = `Stopped at batch ${i + 1} of ${batches.length} — ${addedCount} of ${entries.length} artist(s) were added before this failed (${err.message}). Those are already live; re-upload the rest as a new file.`;
      submitBtn.disabled = false;
      return;
    }
  }

  let msg = `Added ${addedCount} of ${entries.length} artist(s), ${pinsAdded} new map pin(s) placed.`;
  if (skippedCount) msg += ` ${skippedCount} skipped (already existed).`;
  if (pinCommitFailures) msg += ` ${pinCommitFailures} batch(es) had geocoded pins that failed to save — those cities are live but pin-less; re-run the upload later to retry them.`;
  if (failures.length) msg += ` ${failures.length} failed: ` + failures.slice(0, 5).map(f => `${f.artist} (${f.error})`).join("; ") + (failures.length > 5 ? "…" : "");
  statusEl.className = "form-status";
  statusEl.textContent = msg + " Live on the site shortly.";
}

function renderBulkForm() {
  bulkParsedEntries = [];
  app.innerHTML = `
    <p class="crumbs"><a href="#/add">Add an Artist</a> / Bulk Upload</p>
    <h1 class="page-title">Bulk Upload Artists</h1>
    <p class="page-subtitle">Upload a CSV or XLSX file — up to ${BULK_MAX_ROWS} songs at a time, one row per song. Repeat the same artist_name/state/city/note on every row for that artist's songs and they'll be grouped into a single artist entry automatically.</p>
    <p><button type="button" class="retro-btn" onclick="downloadBulkTemplate()">Download CSV template</button></p>
    <p class="page-subtitle">Columns: <code>artist_name, state, city, note, song_title</code> (state is the 2-letter abbreviation). No Spotify column needed — the site searches Spotify automatically for each song.</p>
    <p><input type="file" class="retro-field" accept=".csv,.xlsx" onchange="handleBulkFile(event)"></p>
    <div id="bulk-preview"></div>
    <p class="form-actions">
      <button type="button" id="bulk-submit-btn" class="retro-btn" disabled onclick="submitBulk()">Submit All</button>
      <span id="bulk-status" class="form-status"></span>
    </p>
    <p class="page-subtitle">Large files submit automatically in batches of up to ${BULK_BATCH_SIZE} artists — a full-size upload can take a while (each new city needs a geocode lookup, each song a Spotify search). Keep this tab open until it finishes.</p>
  `;
}

// ---- hidden admin page: bulk-upload manual Spotify links ----
// Not linked from anywhere in the site's normal navigation — reachable only
// by going directly to #/add/spotify-links (also linked from the Add
// Artist hub's "Other tools" line). Each row supplies an exact artist name,
// exact song title, and a Spotify URL/URI/bare ID. If the artist is
// already on the site, that exact song gets the link attached — no
// Spotify search involved, since the link is given directly. If the
// artist isn't on the site yet, the row is treated as a new artist and
// needs state/city/note too, same as the regular Bulk Upload page. A file
// can freely mix both kinds of rows; which bucket each row falls into is
// decided against the artist names already loaded on this page.
const SPOTIFY_LINK_MAX_ROWS = 3000;
// linkRows cost nothing but in-memory string matching (no geocode, no
// Spotify search), so this batch can be far larger than the other bulk
// actions' — it's still one GitHub commit per batch either way.
const SPOTIFY_LINK_BATCH_SIZE = 200;
const SPOTIFY_LINK_TEMPLATE_HEADERS = ["artist_name", "song_title", "spotify_url", "state", "city", "note"];

function downloadSpotifyLinkTemplate() {
  const csv = SPOTIFY_LINK_TEMPLATE_HEADERS.join(",") + "\n" +
    "Example Artist,Example Song,https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC,,,\n" +
    'New Artist Example,New Song,https://open.spotify.com/track/0VjIjW4GlUZAMYd2vXMi3b,GA,"Savannah, GA",One-line note about their style\n';
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "area-codes-spotify-links-template.csv";
  a.click();
  URL.revokeObjectURL(url);
}

function normalizeSpotifyLinkRow(row) {
  return {
    artistName: getField(row, "artist_name", "artist"),
    songTitle: getField(row, "song_title", "title", "track_title"),
    spotifyUrl: getField(row, "spotify_url", "spotify", "spotify_link", "url"),
    state: getField(row, "state").toUpperCase(),
    cityName: getField(row, "city", "city_name"),
    note: getField(row, "note"),
  };
}

// Accepts a full open.spotify.com URL (with or without query string), a
// spotify:track: URI, or a bare 22-character track ID.
function extractSpotifyId(input) {
  if (!input) return "";
  const s = String(input).trim();
  let m = s.match(/open\.spotify\.com\/track\/([A-Za-z0-9]{22})/);
  if (m) return m[1];
  m = s.match(/spotify:track:([A-Za-z0-9]{22})/);
  if (m) return m[1];
  if (/^[A-Za-z0-9]{22}$/.test(s)) return s;
  return "";
}

function existingArtistNameSet() {
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

// Mirrors the Worker's findArtistByName, against whatever's already loaded
// on this page — lets the upload preview catch "no such song for this
// artist" immediately instead of only failing at submit time.
function findLoadedArtistByName(nameLower) {
  for (const region of regions) {
    for (const city of region.cities) {
      for (const artist of city.artists || []) {
        if (artist.name.trim().toLowerCase() === nameLower) return artist;
      }
      for (const hood of city.neighborhoods || []) {
        for (const artist of hood.artists || []) {
          if (artist.name.trim().toLowerCase() === nameLower) return artist;
        }
      }
    }
  }
  return null;
}

// Splits normalized rows into: linkRows (artist already exists — just
// attach spotifyId to a matching existing track), newArtistEntries (artist
// doesn't exist yet — grouped by artist+city+state into one entry with
// multiple tracks, same shape handleBulkAdd/bulk_add uses), and
// problemRows (couldn't tell what to do with it). Checked against
// whatever's already loaded on this page — the Worker re-checks against
// live data before actually writing anything, same as bulk_add.
function classifySpotifyLinkRows(rows) {
  const existingNames = existingArtistNameSet();
  const linkRows = [];
  const newArtistOrder = [];
  const newArtistByKey = new Map();
  const problemRows = [];

  rows.forEach(r => {
    if (!r.artistName || !r.songTitle) {
      problemRows.push({ ...r, problem: "missing artist name or song title" });
      return;
    }
    const spotifyId = extractSpotifyId(r.spotifyUrl);
    if (!spotifyId) {
      problemRows.push({ ...r, problem: "couldn't find a Spotify track ID in that URL" });
      return;
    }
    const nameKey = r.artistName.toLowerCase();
    if (existingNames.has(nameKey)) {
      const artist = findLoadedArtistByName(nameKey);
      const titleLower = r.songTitle.trim().toLowerCase();
      const hasTrack = artist && (artist.tracks || []).some(t => t.title.trim().toLowerCase() === titleLower);
      if (!hasTrack) {
        problemRows.push({ ...r, problem: `No song titled "${r.songTitle}" found for "${r.artistName}" (this tool only links songs that already exist)` });
        return;
      }
      linkRows.push({ artistName: r.artistName, songTitle: r.songTitle, spotifyId, rowNum: r.rowNum });
      return;
    }
    if (!r.state || !r.cityName || !r.note) {
      problemRows.push({ ...r, problem: `"${r.artistName}" isn't on the site yet — new artists need state, city, and note filled in` });
      return;
    }
    const key = `${nameKey}|${r.cityName.toLowerCase()}|${r.state}`;
    let entry = newArtistByKey.get(key);
    if (!entry) {
      entry = { artistName: r.artistName, state: r.state, cityName: r.cityName, note: r.note, tracks: [] };
      newArtistByKey.set(key, entry);
      newArtistOrder.push(entry);
    }
    entry.tracks.push({ title: r.songTitle, spotifyId });
  });

  return { linkRows, newArtistEntries: newArtistOrder, problemRows };
}

let spotifyLinkParsed = { linkRows: [], newArtistEntries: [] };

async function handleSpotifyLinkFile(evt) {
  const file = evt.target.files[0];
  const statusEl = document.getElementById("spotify-link-status");
  const previewEl = document.getElementById("spotify-link-preview");
  const submitBtn = document.getElementById("spotify-link-submit-btn");
  if (!file) return;

  statusEl.className = "form-status";
  statusEl.textContent = "Reading file…";
  previewEl.innerHTML = "";
  submitBtn.disabled = true;
  spotifyLinkParsed = { linkRows: [], newArtistEntries: [] };

  try {
    let rawRows;
    if (/\.xlsx$/i.test(file.name)) {
      await loadXLSXLibrary();
      const buf = await file.arrayBuffer();
      const wb = window.XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      rawRows = window.XLSX.utils.sheet_to_json(sheet, { defval: "" });
    } else {
      const text = await file.text();
      rawRows = parseCSV(text);
    }

    if (!rawRows.length) throw new Error("No rows found in that file.");
    if (rawRows.length > SPOTIFY_LINK_MAX_ROWS) {
      throw new Error(`That file has ${rawRows.length} rows — max is ${SPOTIFY_LINK_MAX_ROWS} per upload. Split it into smaller files.`);
    }

    const normalized = rawRows.map((row, i) => ({ ...normalizeSpotifyLinkRow(row), rowNum: i + 2 }));
    const { linkRows, newArtistEntries, problemRows } = classifySpotifyLinkRows(normalized);
    spotifyLinkParsed = { linkRows, newArtistEntries };
    const newArtistSongs = newArtistEntries.reduce((n, e) => n + e.tracks.length, 0);

    const linkRowsHtml = linkRows.map((r, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${escapeHtml(r.artistName)}</td>
        <td>${escapeHtml(r.songTitle)}</td>
        <td>Link to existing artist</td>
      </tr>
    `).join("");

    const newArtistRowsHtml = newArtistEntries.map((e, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${escapeHtml(e.artistName)}</td>
        <td>${escapeHtml(e.cityName)}, ${escapeHtml(e.state)}</td>
        <td>${e.tracks.length}</td>
        <td>New artist</td>
      </tr>
    `).join("");

    const problemRowsHtml = problemRows.map(r => `
      <tr class="bulk-row-error">
        <td>row ${r.rowNum}</td>
        <td>${escapeHtml(r.artistName || "—")}</td>
        <td>${escapeHtml(r.songTitle || "—")}</td>
        <td>${escapeHtml(r.problem)}</td>
      </tr>
    `).join("");

    previewEl.innerHTML = `
      ${linkRows.length ? `
        <p class="section-heading">Link to existing artists (${linkRows.length})</p>
        <table class="bulk-table">
          <thead><tr><th>#</th><th>Artist</th><th>Song</th><th>Action</th></tr></thead>
          <tbody>${linkRowsHtml}</tbody>
        </table>
      ` : ""}
      ${newArtistEntries.length ? `
        <p class="section-heading">New artists to add (${newArtistEntries.length})</p>
        <table class="bulk-table">
          <thead><tr><th>#</th><th>Artist</th><th>City</th><th>Songs</th><th>Action</th></tr></thead>
          <tbody>${newArtistRowsHtml}</tbody>
        </table>
      ` : ""}
      ${problemRows.length ? `
        <p class="page-subtitle" style="margin-top:1rem;">${problemRows.length} row(s) skipped — fix and re-upload if you want them included:</p>
        <table class="bulk-table">
          <thead><tr><th>Row</th><th>Artist</th><th>Song</th><th>Problem</th></tr></thead>
          <tbody>${problemRowsHtml}</tbody>
        </table>
      ` : ""}
    `;

    statusEl.textContent = `${linkRows.length} song(s) to link, ${newArtistEntries.length} new artist(s) (${newArtistSongs} song(s) total)` +
      (problemRows.length ? `, ${problemRows.length} row(s) skipped.` : ".");
    submitBtn.disabled = linkRows.length === 0 && newArtistEntries.length === 0;
  } catch (err) {
    statusEl.className = "form-status is-error";
    statusEl.textContent = "Couldn't read that file — " + err.message;
  }
}

function buildLinkRowBatches(linkRows) {
  const batches = [];
  for (let i = 0; i < linkRows.length; i += SPOTIFY_LINK_BATCH_SIZE) batches.push(linkRows.slice(i, i + SPOTIFY_LINK_BATCH_SIZE));
  return batches;
}

// Submits in two phases — all linkRows batches (cheap, no external calls
// per row), then all newArtistEntries batches (same geocode-per-new-city
// cost/pacing as regular Bulk Upload, via the same buildBulkBatches used
// there). Sequential, never parallel, so each batch's read-modify-write of
// data.json always sees the previous batch's committed state.
async function submitSpotifyLinkUpload() {
  const statusEl = document.getElementById("spotify-link-status");
  const submitBtn = document.getElementById("spotify-link-submit-btn");
  const { linkRows, newArtistEntries } = spotifyLinkParsed;
  if (!linkRows.length && !newArtistEntries.length) return;

  submitBtn.disabled = true;
  const linkBatches = buildLinkRowBatches(linkRows);
  const artistBatches = buildBulkBatches(newArtistEntries);
  const totalBatches = linkBatches.length + artistBatches.length;

  let linkedTotal = 0, addedTotal = 0, skippedTotal = 0, pinsTotal = 0;
  const failures = [];
  let batchNum = 0;

  try {
    for (const batch of linkBatches) {
      batchNum++;
      statusEl.className = "form-status";
      statusEl.textContent = `Batch ${batchNum} of ${totalBatches} — linking Spotify tracks…`;
      const res = await fetch(AREA_CODES_CONFIG.ADD_ARTIST_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "bulk_spotify_links", password: storedPassword(), linkRows: batch, newArtistEntries: [] })
      });
      if (!res.ok) throw new Error(await res.text());
      const result = await res.json();
      linkedTotal += result.linkedCount || 0;
      (result.linkResults || []).filter(r => !r.ok).forEach(r => failures.push(r));
    }

    for (const batch of artistBatches) {
      batchNum++;
      statusEl.className = "form-status";
      statusEl.textContent = `Batch ${batchNum} of ${totalBatches} — adding new artists…`;
      const res = await fetch(AREA_CODES_CONFIG.ADD_ARTIST_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "bulk_spotify_links", password: storedPassword(), linkRows: [], newArtistEntries: batch })
      });
      if (!res.ok) throw new Error(await res.text());
      const result = await res.json();
      addedTotal += result.addedCount || 0;
      skippedTotal += result.skippedCount || 0;
      pinsTotal += result.pinsAdded || 0;
      (result.newArtistResults || []).filter(r => !r.ok).forEach(r => failures.push(r));
    }
  } catch (err) {
    statusEl.className = "form-status is-error";
    statusEl.textContent = `Stopped at batch ${batchNum} of ${totalBatches} — ${linkedTotal} link(s) and ${addedTotal} new artist(s) saved before this failed (${err.message}). Those are already live; re-upload the rest as a new file.`;
    submitBtn.disabled = false;
    return;
  }

  let msg = `Linked ${linkedTotal} Spotify track(s), added ${addedTotal} new artist(s) (${pinsTotal} new map pin(s)).`;
  if (skippedTotal) msg += ` ${skippedTotal} skipped (already existed).`;
  if (failures.length) msg += ` ${failures.length} row(s) failed: ` + failures.slice(0, 5).map(f => `${f.artist} (${f.error})`).join("; ") + (failures.length > 5 ? "…" : "");
  statusEl.className = "form-status";
  statusEl.textContent = msg + " Live on the site shortly.";
}

function renderSpotifyLinkForm() {
  spotifyLinkParsed = { linkRows: [], newArtistEntries: [] };
  app.innerHTML = `
    <p class="crumbs"><a href="#/add">Add an Artist</a> / Spotify Links Upload</p>
    <h1 class="page-title">Bulk Upload Spotify Links</h1>
    <p class="page-subtitle">Upload a CSV or XLSX with exact artist names, exact song titles, and Spotify URLs. Rows for artists already on the site just get that song linked (no Spotify search — you're providing the exact link). Rows for artists not yet on the site create them, same as Bulk Upload.</p>
    <p><button type="button" class="retro-btn" onclick="downloadSpotifyLinkTemplate()">Download CSV template</button></p>
    <p class="page-subtitle">Columns: <code>artist_name, song_title, spotify_url, state, city, note</code> — state/city/note only required for artists not already on the site. A Spotify URL, URI, or bare track ID all work. Note: this only links songs that already exist for an existing artist — it can't add a new song to an artist who's already on the site.</p>
    <p><input type="file" class="retro-field" accept=".csv,.xlsx" onchange="handleSpotifyLinkFile(event)"></p>
    <div id="spotify-link-preview"></div>
    <p class="form-actions">
      <button type="button" id="spotify-link-submit-btn" class="retro-btn" disabled onclick="submitSpotifyLinkUpload()">Submit All</button>
      <span id="spotify-link-status" class="form-status"></span>
    </p>
  `;
}

function renderSpotifyLinkUpload() {
  if (!isConfigured()) return renderNotConfigured();
  if (!storedPassword()) return renderAddGate();
  renderSpotifyLinkForm();
}

// ---- hidden admin page: remove a batch of artists by exact name ----
// Not linked from anywhere in the site's normal navigation — reachable only
// by going directly to #/add/remove-batch. Built for undoing a bad bulk
// upload: load a list of artist names (the same CSV you uploaded works,
// since it just reads the artist_name column) and it removes any artist
// site-wide whose name matches exactly, cleaning up empty cities/pins after.
const REMOVE_BATCH_CONFIRM_PHRASE = "DELETE THESE ARTISTS";
let removeBatchNames = [];

async function handleRemoveBatchFile(evt) {
  const file = evt.target.files[0];
  const statusEl = document.getElementById("remove-batch-status");
  const submitBtn = document.getElementById("remove-batch-submit-btn");
  removeBatchNames = [];
  submitBtn.disabled = true;
  if (!file) return;

  try {
    const text = await file.text();
    let names;
    if (/\.csv$/i.test(file.name)) {
      const rows = parseCSV(text);
      names = rows.map(r => getField(r, "artist_name", "artist")).filter(Boolean);
    } else {
      names = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    }
    const unique = Array.from(new Set(names.map(n => n.trim()).filter(Boolean)));
    removeBatchNames = unique;
    statusEl.className = "form-status";
    statusEl.textContent = `${unique.length} unique artist name(s) loaded from file.`;
    checkRemoveBatchReady();
  } catch (err) {
    statusEl.className = "form-status is-error";
    statusEl.textContent = "Couldn't read that file — " + err.message;
  }
}

function checkRemoveBatchReady() {
  const submitBtn = document.getElementById("remove-batch-submit-btn");
  const confirmInput = document.getElementById("remove-batch-confirm");
  submitBtn.disabled = !(removeBatchNames.length > 0 && confirmInput.value === REMOVE_BATCH_CONFIRM_PHRASE);
}

async function submitRemoveBatch() {
  const statusEl = document.getElementById("remove-batch-status");
  const submitBtn = document.getElementById("remove-batch-submit-btn");
  const confirmInput = document.getElementById("remove-batch-confirm");
  if (!removeBatchNames.length || confirmInput.value !== REMOVE_BATCH_CONFIRM_PHRASE) return;

  submitBtn.disabled = true;
  statusEl.className = "form-status";
  statusEl.textContent = `Removing ${removeBatchNames.length} artist name(s)…`;

  try {
    const res = await fetch(AREA_CODES_CONFIG.ADD_ARTIST_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "remove_by_name", password: storedPassword(), names: removeBatchNames, confirm: confirmInput.value })
    });
    if (!res.ok) throw new Error(await res.text());
    const result = await res.json();
    statusEl.textContent = `Removed ${result.removedCount} artist(s), cleaned up ${result.pinsRemoved} map pin(s). Live on the site shortly.`;
    removeBatchNames = [];
    confirmInput.value = "";
  } catch (err) {
    statusEl.className = "form-status is-error";
    statusEl.textContent = "Couldn't remove — " + err.message;
  }
  submitBtn.disabled = true;
}

function renderRemoveBatchForm() {
  removeBatchNames = [];
  app.innerHTML = `
    <p class="crumbs"><a href="#/add">Add an Artist</a> / Remove a Batch</p>
    <h1 class="page-title">Remove Artists by Name</h1>
    <p class="page-subtitle"><strong>This permanently removes every artist site-wide whose name exactly matches one in the file you load — across every city, not just one.</strong> There's no in-site undo (though every change is a git commit on GitHub, so it can be reverted there if needed).</p>
    <p><label>Load a name list — a .csv with an <code>artist_name</code> column (the same file you bulk-uploaded works), or a .txt file with one name per line:</label></p>
    <p><input type="file" class="retro-field" accept=".csv,.txt" onchange="handleRemoveBatchFile(event)"></p>
    <p><label for="remove-batch-confirm">Type <code>${REMOVE_BATCH_CONFIRM_PHRASE}</code> to enable the button:</label></p>
    <p><input type="text" class="retro-field" id="remove-batch-confirm" oninput="checkRemoveBatchReady()"></p>
    <p class="form-actions">
      <button type="button" id="remove-batch-submit-btn" class="retro-btn" disabled onclick="submitRemoveBatch()">Remove These Artists</button>
      <span id="remove-batch-status" class="form-status"></span>
    </p>
  `;
}

function renderRemoveBatch() {
  if (!isConfigured()) return renderNotConfigured();
  if (!storedPassword()) return renderAddGate();
  renderRemoveBatchForm();
}

// ---- hidden admin page: retroactively fill in missing Spotify links ----
// Not linked from anywhere in the site's normal navigation — reachable only
// by going directly to #/add/relink-spotify. Scans the already-loaded data
// for tracks with a title but no spotifyId, then asks the Worker to
// re-attempt a Spotify search for each one, in batches sized to stay under
// the free Workers plan's subrequest limit.
const RELINK_BATCH_SIZE = 35;

function findTracksMissingSpotify() {
  const items = [];
  regions.forEach(region => {
    region.cities.forEach(city => {
      (city.artists || []).forEach(artist => {
        (artist.tracks || []).forEach(track => {
          if (!track.spotifyId) items.push({ artistName: artist.name, trackTitle: track.title });
        });
      });
      (city.neighborhoods || []).forEach(hood => {
        (hood.artists || []).forEach(artist => {
          (artist.tracks || []).forEach(track => {
            if (!track.spotifyId) items.push({ artistName: artist.name, trackTitle: track.title });
          });
        });
      });
    });
  });
  return items;
}

async function submitRelinkSpotify() {
  const statusEl = document.getElementById("relink-status");
  const btn = document.getElementById("relink-submit-btn");
  const items = findTracksMissingSpotify();
  if (!items.length) return;

  btn.disabled = true;
  const batches = [];
  for (let i = 0; i < items.length; i += RELINK_BATCH_SIZE) batches.push(items.slice(i, i + RELINK_BATCH_SIZE));

  let relinkedTotal = 0, attemptedTotal = 0, errorTotal = 0, firstDiagnostic = null;

  for (let i = 0; i < batches.length; i++) {
    statusEl.className = "form-status";
    statusEl.textContent = `Batch ${i + 1} of ${batches.length} — ${attemptedTotal} of ${items.length} tracks attempted so far…`;
    try {
      const res = await fetch(AREA_CODES_CONFIG.ADD_ARTIST_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "relink_spotify", password: storedPassword(), items: batches[i] })
      });
      if (!res.ok) throw new Error(await res.text());
      const result = await res.json();
      relinkedTotal += result.relinkedCount || 0;
      attemptedTotal += result.attemptedCount || 0;
      errorTotal += result.errorCount || 0;
      if (!firstDiagnostic && result.diagnostic) firstDiagnostic = result.diagnostic;
    } catch (err) {
      statusEl.className = "form-status is-error";
      statusEl.textContent = `Stopped at batch ${i + 1} of ${batches.length} — ${relinkedTotal} track(s) relinked before this failed (${err.message}). Those are already saved; reload this page and run it again to pick up where it left off.`;
      btn.disabled = false;
      return;
    }
  }

  // A track can land in "no match" for two very different reasons: the
  // search genuinely ran and found nothing, or every search request itself
  // failed (bad/expired token, rate limit) and got miscounted as "no match"
  // — which is exactly what made a real outage look like an innocuous 0%
  // hit rate before. Surface the distinction instead of hiding it.
  if (errorTotal > 0) {
    statusEl.className = "form-status is-error";
    statusEl.textContent = `Done — relinked ${relinkedTotal} of ${items.length} track(s). ${errorTotal} search(es) failed outright rather than finding no match (not a real "no match" — these will be retried if you run this again). First error: ${firstDiagnostic}`;
  } else {
    statusEl.className = "form-status";
    statusEl.textContent = `Done — relinked ${relinkedTotal} of ${items.length} track(s) (${items.length - relinkedTotal} had no confident Spotify match). Live on the site shortly. Reload this page to see the current remaining count.`;
  }
}

function renderRelinkSpotifyForm() {
  const missing = findTracksMissingSpotify();
  app.innerHTML = `
    <p class="crumbs"><a href="#/add">Add an Artist</a> / Relink Spotify</p>
    <h1 class="page-title">Relink Missing Spotify Links</h1>
    <p class="page-subtitle">Scans every track currently on the site for ones without a Spotify link, then re-runs the search for just those. Safe to run repeatedly — tracks that already have a link are always skipped.</p>
    <p class="page-subtitle"><strong>${missing.length} track(s) currently missing a Spotify link.</strong></p>
    <p class="form-actions">
      <button type="button" id="relink-submit-btn" class="retro-btn" ${missing.length ? "" : "disabled"} onclick="submitRelinkSpotify()">Relink All</button>
      <span id="relink-status" class="form-status"></span>
    </p>
  `;
}

function renderRelinkSpotify() {
  if (!isConfigured()) return renderNotConfigured();
  if (!storedPassword()) return renderAddGate();
  renderRelinkSpotifyForm();
}

function renderBulk() {
  if (!isConfigured()) return renderNotConfigured();
  if (!storedPassword()) return renderAddGate();
  renderBulkForm();
}

async function handleAddSubmit(evt) {
  evt.preventDefault();
  const statusEl = document.getElementById("form-status");
  statusEl.className = "form-status";
  statusEl.textContent = "Submitting…";

  const tracks = Array.from(document.querySelectorAll("[data-track-row]")).map(buildTrackFromRow).filter(Boolean);

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
    const result = await res.json().catch(() => ({}));
    if (result.skipped) {
      statusEl.textContent = `Skipped — an artist named "${payload.artistName}" already exists on the site.`;
      return;
    }
    statusEl.textContent = result.pinAdded === false
      ? "Added! It'll appear on the live site shortly (couldn't auto-place a map pin for this city, but the artist listing works fine)."
      : "Added! It'll appear on the live site shortly.";
    document.querySelector(".add-form").reset();
    document.getElementById("track-rows").innerHTML = "";
    addTrackRow();
  } catch (err) {
    statusEl.className = "form-status is-error";
    statusEl.textContent = "Couldn't submit — " + err.message;
  }
}

// ---- theme editor: password-gated, edits site-wide look without touching
// any code/file. Linked from the Add Artist hub (unlike the rarer/riskier
// hidden tools above) since this is meant to be reached for quick day-to-
// day tweaks. Curated color/thickness fields cover the common cases; the
// custom-CSS textarea is the escape hatch for anything not in that list.
const THEMEABLE_VARS = [
  { key: "--bg", label: "Page background", type: "color", default: "#c0c0c0" },
  { key: "--ink", label: "Link / accent color", type: "color", default: "#0000ee" },
  { key: "--ink-faded", label: "Body text color", type: "color", default: "#333333" },
  { key: "--line-color", label: "Outline / border color", type: "color", default: "#000000" },
  { key: "--line-width", label: "Outline / border thickness", type: "px", default: "1px" },
];
const THEMEABLE_VARS_MAP = [
  // Also drives .key-swatch.is-empty (the small square in the country-map
  // key) — same variable, one picker controls both.
  { key: "--state-empty-color", label: "Undiscovered state color (name + map key)", type: "color", default: "#606060" },
  { key: "--map-bg", label: "State map background", type: "color", default: "#c0c0c0" },
  { key: "--map-fill", label: "State shape fill color", type: "color", default: "#c0c0c0" },
];
const THEMEABLE_VARS_ADVANCED = [
  { key: "--ink-faint", label: "Muted accent", type: "color", default: "#c7c7c7" },
  { key: "--bevel-face", label: "Button face", type: "color", default: "#e9e9e9" },
  { key: "--bevel-hi", label: "Button highlight edge", type: "color", default: "#ffffff" },
  { key: "--bevel-sh", label: "Button shadow edge", type: "color", default: "#848484" },
];
const ALL_THEMEABLE_VARS = THEMEABLE_VARS.concat(THEMEABLE_VARS_MAP, THEMEABLE_VARS_ADVANCED);

// Editable plain-text labels (as opposed to CSS vars above) — see
// LABEL_TARGET_SELECTORS for what DOM element each key controls.
const THEMEABLE_LABELS = [
  { key: "addArtistBtn", label: "Footer button text", default: "Login" },
];

function defaultThemeVars() {
  const out = {};
  ALL_THEMEABLE_VARS.forEach(t => { out[t.key] = t.default; });
  return out;
}

function defaultThemeLabels() {
  const out = {};
  THEMEABLE_LABELS.forEach(l => { out[l.key] = l.default; });
  return out;
}

function previewThemeVar(key, type, value) {
  document.documentElement.style.setProperty(key, type === "px" ? `${value}px` : value);
}

function previewCustomCss(css) {
  setCustomCssStyleTag(css);
}

function previewThemeLabel(key, value) {
  applyThemeLabel(key, value);
}

function themeLabelFieldHtml(l, labels) {
  const raw = (labels && labels[l.key] !== undefined && labels[l.key] !== "") ? labels[l.key] : l.default;
  return `
    <div class="theme-field">
      <label for="theme-label-${l.key}">${escapeHtml(l.label)}</label>
      <input type="text" class="retro-field" id="theme-label-${l.key}" data-theme-label-key="${l.key}"
        value="${escapeAttr(raw)}" oninput="previewThemeLabel('${l.key}', this.value)">
    </div>
  `;
}

function themeFieldHtml(t, vars) {
  const raw = (vars && vars[t.key] !== undefined && vars[t.key] !== "") ? vars[t.key] : t.default;
  if (t.type === "color") {
    return `
      <div class="theme-field">
        <label for="theme-${t.key}">${escapeHtml(t.label)}</label>
        <input type="color" id="theme-${t.key}" data-theme-key="${t.key}" data-theme-type="color"
          value="${escapeAttr(raw)}" oninput="previewThemeVar('${t.key}','color',this.value)">
      </div>
    `;
  }
  const numeric = String(raw).replace(/px$/, "");
  return `
    <div class="theme-field">
      <label for="theme-${t.key}">${escapeHtml(t.label)} (px)</label>
      <input type="number" min="0" max="20" step="1" class="retro-field" id="theme-${t.key}" data-theme-key="${t.key}" data-theme-type="px"
        value="${escapeAttr(numeric)}" oninput="previewThemeVar('${t.key}','px',this.value)">
    </div>
  `;
}

function renderThemeForm(previewSource) {
  const source = previewSource || THEME;
  const vars = source.vars || {};
  const customCss = source.customCss || "";
  const labels = source.labels || {};
  applyThemeObject(source);

  const fields = THEMEABLE_VARS.map(t => themeFieldHtml(t, vars)).join("");
  const mapFields = THEMEABLE_VARS_MAP.map(t => themeFieldHtml(t, vars)).join("");
  const labelFields = THEMEABLE_LABELS.map(l => themeLabelFieldHtml(l, labels)).join("");
  const advancedFields = THEMEABLE_VARS_ADVANCED.map(t => themeFieldHtml(t, vars)).join("");

  app.innerHTML = `
    <p class="crumbs"><a href="#/add">Add an Artist</a> / Theme Editor</p>
    <h1 class="page-title">Theme Editor</h1>
    <p class="page-subtitle">Changes preview instantly right here as you edit. Click Save to publish site-wide — live for every visitor within about a minute, no file edits needed.</p>
    <div class="theme-form">${fields}</div>
    <h2 class="section-heading">State Map</h2>
    <div class="theme-form">${mapFields}</div>
    <h2 class="section-heading">Site Text</h2>
    <div class="theme-form">${labelFields}</div>
    <details class="theme-advanced">
      <summary>Advanced colors</summary>
      <div class="theme-form">${advancedFields}</div>
    </details>
    <details class="theme-advanced">
      <summary>Custom CSS (anything not covered above)</summary>
      <p class="page-subtitle">Applied site-wide, after everything else. Avoid <code>url()</code>/<code>@import</code> — external resources slow the site down for every visitor (site policy: no unnecessary network requests on the public pages).</p>
      <textarea class="retro-field theme-css-input" id="theme-custom-css-input" rows="8" placeholder=".artist-card { padding: 1.2rem; }" oninput="previewCustomCss(this.value)">${escapeHtml(customCss)}</textarea>
    </details>
    <p class="form-actions">
      <button type="button" class="retro-btn" onclick="submitThemeUpdate()">Save</button>
      <button type="button" class="retro-btn" onclick="discardThemeChanges()">Discard changes</button>
      <button type="button" class="retro-btn" onclick="resetThemeFormToDefaults()">Reset to defaults</button>
      <span id="theme-status" class="form-status"></span>
    </p>
  `;
}

function collectThemeFormVars() {
  const vars = {};
  document.querySelectorAll("[data-theme-key]").forEach(el => {
    const key = el.dataset.themeKey;
    vars[key] = el.dataset.themeType === "px" ? `${el.value}px` : el.value;
  });
  return vars;
}

function collectThemeFormLabels() {
  const labels = {};
  document.querySelectorAll("[data-theme-label-key]").forEach(el => {
    labels[el.dataset.themeLabelKey] = el.value;
  });
  return labels;
}

async function submitThemeUpdate() {
  const statusEl = document.getElementById("theme-status");
  statusEl.className = "form-status";
  statusEl.textContent = "Saving…";
  const vars = collectThemeFormVars();
  const customCss = document.getElementById("theme-custom-css-input").value;
  const labels = collectThemeFormLabels();
  try {
    const res = await fetch(AREA_CODES_CONFIG.ADD_ARTIST_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "update_theme", password: storedPassword(), vars, customCss, labels })
    });
    if (!res.ok) throw new Error(await res.text());
    THEME = { vars, customCss, labels };
    statusEl.textContent = "Saved — live for everyone within about a minute.";
  } catch (err) {
    statusEl.className = "form-status is-error";
    statusEl.textContent = "Couldn't save — " + err.message;
  }
}

function discardThemeChanges() {
  renderThemeForm(THEME);
}

function resetThemeFormToDefaults() {
  renderThemeForm({ vars: defaultThemeVars(), customCss: "", labels: defaultThemeLabels() });
}

function renderTheme() {
  if (!isConfigured()) return renderNotConfigured();
  if (!storedPassword()) return renderAddGate();
  renderThemeForm();
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
  if (parts[0] === "add" && parts[1] === "bulk") return renderBulk();
  if (parts[0] === "add" && parts[1] === "remove-batch") return renderRemoveBatch();
  if (parts[0] === "add" && parts[1] === "relink-spotify") return renderRelinkSpotify();
  if (parts[0] === "add" && parts[1] === "spotify-links") return renderSpotifyLinkUpload();
  if (parts[0] === "add" && parts[1] === "theme") return renderTheme();
  if (parts[0] === "add") return renderAdd();
  if (parts[0] === "edit" && parts[1] && parts[2] && parts[3]) return renderEdit(parts[1], parts[2], parts[3]);
  if (parts[0] === "state" && parts[1]) return renderState(parts[1]);
  if (parts[0] === "city" && parts[1] && parts[2]) return renderCity(parts[1], parts[2]);
  if (parts[0] === "neighborhood" && parts[1] && parts[2] && parts[3]) {
    return renderNeighborhood(parts[1], parts[2], parts[3]);
  }
  return renderNotFound();
}

// ---- retro header/footer extras: hit counter + badges. Purely decorative,
// no network requests — the counter is a real per-browser localStorage
// tally (not faked), everything else is static markup. Both run once at
// page load, independent of loadData() since neither needs the artist data.
function renderHeaderHitCounter() {
  const el = document.getElementById("header-hitcounter");
  if (!el) return;

  let count = parseInt(localStorage.getItem("areaCodesHitCount") || "0", 10);
  if (isNaN(count)) count = 0;
  count += 1;
  localStorage.setItem("areaCodesHitCount", String(count));
  const digits = String(count).padStart(6, "0");

  el.innerHTML = `
    <span class="hit-counter-label">You are visitor</span>
    <span class="hit-counter">${escapeHtml(digits)}</span>
  `;
}

function renderFooterBadges() {
  const el = document.getElementById("footer-extras");
  if (!el) return;

  el.innerHTML = `
    <div class="retro-badges">
      <a href="#/add" class="retro-badge-link">Login</a>
      <span class="retro-badge retro-badge-seal">100% human-curated</span>
    </div>
  `;
}

window.addEventListener("hashchange", router);
window.addEventListener("DOMContentLoaded", () => {
  renderHeaderHitCounter();
  renderFooterBadges();
  loadData().then(router);
});
