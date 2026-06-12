<script setup>
import { onMounted, onBeforeUnmount, watch, ref } from "vue";
import Map from "ol/Map.js";
import View from "ol/View.js";
import TileLayer from "ol/layer/Tile.js";
import VectorLayer from "ol/layer/Vector.js";
import VectorSource from "ol/source/Vector.js";
import OSM from "ol/source/OSM.js";
import XYZ from "ol/source/XYZ.js";
import Feature from "ol/Feature.js";
import Point from "ol/geom/Point.js";
import LineString from "ol/geom/LineString.js";
import { fromLonLat } from "ol/proj.js";
import { Style, Stroke, Circle as CircleStyle, Fill, Icon } from "ol/style.js";
import { useTelemetryStore } from "../stores/telemetry.js";
import { useSettingsStore } from "../stores/settings.js";

const telemetry = useTelemetryStore();
const settings = useSettingsStore();
const mapEl = ref(null);
let map, view, tileLayer, droneFeat, homeFeat, trailFeat, trailSrc, droneSrc, homeSrc;

// Pre-built drone icons — loaded once so OL can read naturalWidth/Height synchronously.

// Plane / fixed-wing — classic airliner silhouette (nose at 12 o'clock),
// gradient body + dark outline so it stays readable on any map imagery
const planeImg = new Image(48, 48);
planeImg.src =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 32 32">` +
    `<defs><linearGradient id="pg" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="#a89df0"/><stop offset="1" stop-color="#6f5fd9"/>` +
    `</linearGradient></defs>` +
    // halo
    `<circle cx="16" cy="16" r="14.5" fill="rgba(139,127,232,0.16)" stroke="rgba(139,127,232,0.55)" stroke-width="1"/>` +
    // airframe — rounded nose, swept main wings, tapered tail with stabilizers
    `<path d="M16 3.2 c0.9 0 1.55 1.1 1.75 2.9 l0.35 5.6 9.3 5.4 c0.35 0.2 0.55 0.55 0.55 0.95 v1.7 c0 0.25 -0.25 0.4 -0.5 0.33 l-9.5 -2.9 -0.45 6.1 2.9 2.15 c0.2 0.15 0.3 0.38 0.3 0.62 v1.25 c0 0.28 -0.28 0.46 -0.55 0.38 l-5.15 -1.6 -5.15 1.6 c-0.27 0.08 -0.55 -0.1 -0.55 -0.38 v-1.25 c0 -0.24 0.1 -0.47 0.3 -0.62 l2.9 -2.15 -0.45 -6.1 -9.5 2.9 c-0.25 0.07 -0.5 -0.08 -0.5 -0.33 v-1.7 c0 -0.4 0.2 -0.75 0.55 -0.95 l9.3 -5.4 0.35 -5.6 c0.2 -1.8 0.85 -2.9 1.75 -2.9 z"` +
    ` fill="url(#pg)" stroke="rgba(8,10,14,0.55)" stroke-width="0.7" stroke-linejoin="round"/>` +
    // cockpit hint
    `<ellipse cx="16" cy="6.6" rx="0.9" ry="1.5" fill="rgba(11,14,17,0.5)"/>` +
    `</svg>`
  );

// Quadcopter icon — X-frame with prop rings, front props bright + rear dimmed,
// forward chevron on the body so heading reads at a glance
const quadImg = new Image(48, 48);
quadImg.src =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">` +
    // halo
    `<circle cx="24" cy="24" r="22" fill="rgba(139,127,232,0.14)" stroke="rgba(139,127,232,0.5)" stroke-width="1"/>` +
    // arms
    `<line x1="24" y1="24" x2="12" y2="12" stroke="rgba(8,10,14,0.55)" stroke-width="4.5" stroke-linecap="round"/>` +
    `<line x1="24" y1="24" x2="36" y2="12" stroke="rgba(8,10,14,0.55)" stroke-width="4.5" stroke-linecap="round"/>` +
    `<line x1="24" y1="24" x2="12" y2="36" stroke="rgba(8,10,14,0.55)" stroke-width="4.5" stroke-linecap="round"/>` +
    `<line x1="24" y1="24" x2="36" y2="36" stroke="rgba(8,10,14,0.55)" stroke-width="4.5" stroke-linecap="round"/>` +
    `<line x1="24" y1="24" x2="12" y2="12" stroke="#8b7fe8" stroke-width="3" stroke-linecap="round"/>` +
    `<line x1="24" y1="24" x2="36" y2="12" stroke="#8b7fe8" stroke-width="3" stroke-linecap="round"/>` +
    `<line x1="24" y1="24" x2="12" y2="36" stroke="rgba(139,127,232,0.55)" stroke-width="3" stroke-linecap="round"/>` +
    `<line x1="24" y1="24" x2="36" y2="36" stroke="rgba(139,127,232,0.55)" stroke-width="3" stroke-linecap="round"/>` +
    // front prop rings — full brightness, hub dot in the middle
    `<circle cx="12" cy="12" r="7" fill="rgba(139,127,232,0.25)" stroke="#8b7fe8" stroke-width="2.2"/>` +
    `<circle cx="36" cy="12" r="7" fill="rgba(139,127,232,0.25)" stroke="#8b7fe8" stroke-width="2.2"/>` +
    `<circle cx="12" cy="12" r="2" fill="#8b7fe8"/>` +
    `<circle cx="36" cy="12" r="2" fill="#8b7fe8"/>` +
    // rear prop rings — dimmed so heading direction is obvious
    `<circle cx="12" cy="36" r="7" fill="rgba(139,127,232,0.12)" stroke="rgba(139,127,232,0.45)" stroke-width="2.2"/>` +
    `<circle cx="36" cy="36" r="7" fill="rgba(139,127,232,0.12)" stroke="rgba(139,127,232,0.45)" stroke-width="2.2"/>` +
    `<circle cx="12" cy="36" r="2" fill="rgba(139,127,232,0.45)"/>` +
    `<circle cx="36" cy="36" r="2" fill="rgba(139,127,232,0.45)"/>` +
    // body + forward chevron
    `<rect x="18.5" y="18.5" width="11" height="11" rx="3" fill="rgba(11,14,17,0.9)" stroke="#8b7fe8" stroke-width="1.6"/>` +
    `<path d="M20.5 23.5 L24 19.5 L27.5 23.5" fill="none" stroke="#e8eaed" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>` +
    `</svg>`
  );

// Home marker icon — shown as house when drone is armed, plain circle otherwise
const homeImg = new Image(40, 40);
homeImg.src =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 32 32">` +
    `<defs><linearGradient id="hg" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="#60a5fa"/><stop offset="1" stop-color="#2e6fd6"/>` +
    `</linearGradient></defs>` +
    // halo
    `<circle cx="16" cy="16" r="14.5" fill="rgba(59,130,246,0.18)" stroke="rgba(59,130,246,0.6)" stroke-width="1"/>` +
    // chimney
    `<rect x="20.6" y="8.6" width="2.4" height="5" rx="0.6" fill="url(#hg)" stroke="rgba(8,10,14,0.45)" stroke-width="0.6"/>` +
    // overhanging roof
    `<path d="M16 6.4 L27.4 15.6 c0.3 0.25 0.35 0.7 0.1 1 -0.25 0.3 -0.7 0.35 -1 0.1 L16 9.4 5.5 16.7 c-0.3 0.25 -0.75 0.2 -1 -0.1 -0.25 -0.3 -0.2 -0.75 0.1 -1 Z"` +
    ` fill="url(#hg)" stroke="rgba(8,10,14,0.45)" stroke-width="0.7" stroke-linejoin="round"/>` +
    // walls
    `<path d="M8.2 15.8 L16 10.4 23.8 15.8 V24.6 c0 0.8 -0.65 1.4 -1.4 1.4 H9.6 c-0.75 0 -1.4 -0.6 -1.4 -1.4 Z"` +
    ` fill="url(#hg)" stroke="rgba(8,10,14,0.45)" stroke-width="0.7" stroke-linejoin="round"/>` +
    // door
    `<rect x="13.7" y="19.2" width="4.6" height="6.8" rx="1.1" fill="rgba(11,14,17,0.7)"/>` +
    // door knob
    `<circle cx="17.2" cy="22.8" r="0.55" fill="rgba(232,234,237,0.8)"/>` +
    // window
    `<rect x="10" y="17.6" width="2.6" height="2.6" rx="0.5" fill="rgba(11,14,17,0.55)"/>` +
    `</svg>`
  );

function makeHomeStyle() {
  if (telemetry.armed && telemetry.homeLat != null) {
    return new Style({ image: new Icon({ img: homeImg, size: [40, 40], scale: 1.0 }) });
  }
  return new Style({
    image: new CircleStyle({
      radius: 7,
      fill: new Fill({ color: "#3b82f6" }),
      stroke: new Stroke({ color: "#071218", width: 3 }),
    }),
  });
}

function makeDroneStyle(hdg) {
  const img = settings.map.droneIcon === "quad" ? quadImg : planeImg;
  return new Style({
    image: new Icon({
      img,
      size: [48, 48],
      rotation: ((hdg ?? 0) * Math.PI) / 180,
      rotateWithView: false,
      scale: 1.1,
    }),
  });
}

function makeOsmSource() { return new OSM(); }
function makeSatSource() {
  return new XYZ({
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attributions: "Imagery © Esri",
  });
}

onMounted(() => {
  trailSrc = new VectorSource();
  droneSrc  = new VectorSource();
  homeSrc   = new VectorSource();

  const trailLayer = new VectorLayer({
    source: trailSrc,
    style: new Style({ stroke: new Stroke({ color: "#8b7fe8", width: 2.5, lineDash: [6, 4] }) }),
  });
  const homeLayer = new VectorLayer({ source: homeSrc });
  const droneLayer = new VectorLayer({ source: droneSrc });

  tileLayer = new TileLayer({
    source: settings.map.style === "satellite" ? makeSatSource() : makeOsmSource(),
  });

  map = new Map({
    target: mapEl.value,
    layers: [tileLayer, trailLayer, homeLayer, droneLayer],
    view: new View({ center: fromLonLat([0, 20]), zoom: 3 }),
    controls: [],
  });
  view = map.getView();
  // Force correct size after the DOM has fully laid out
  setTimeout(() => map.updateSize(), 0);

  // Initial home + map centre from browser geolocation.
  // Silent on denial/unavailability — the user can still operate normally.
  // The drone's own GPS overrides this once it arms (handled by autoSetHome).
  loadHomeFromBrowserLocation();
});

async function loadHomeFromBrowserLocation() {
  try {
    const { latitude: lat, longitude: lon } = await getLocation();
    if (telemetry.homeLat == null && telemetry.lat == null) {
      telemetry.homeLat = lat;
      telemetry.homeLon = lon;
    }
    view?.animate({ center: fromLonLat([lon, lat]), zoom: 16, duration: 600 });
  } catch (err) {
    console.warn("[MapView] Auto-zoom to browser location failed:", err.message);
  }
}

watch(
  () => [telemetry.lon, telemetry.lat, telemetry.heading],
  ([lon, lat, hdg]) => {
    if (lon == null || lat == null) return;
    const coord = fromLonLat([lon, lat]);
    if (!droneFeat) {
      droneFeat = new Feature({ geometry: new Point(coord) });
      droneSrc.addFeature(droneFeat);
    } else {
      droneFeat.getGeometry().setCoordinates(coord);
    }
    droneFeat.setStyle(makeDroneStyle(hdg));
    if (settings.map.centerOnDrone) {
      view.animate({ center: coord, duration: 200 });
      if (view.getZoom() < 14) view.setZoom(17);
    }
  }
);

watch(
  () => telemetry.trail.length,
  () => {
    if (!settings.map.showTrail) { trailSrc.clear(); trailFeat = null; return; }
    const coords = telemetry.trail.map((c) => fromLonLat(c));
    if (coords.length < 2) return;
    if (!trailFeat) {
      trailFeat = new Feature({ geometry: new LineString(coords) });
      trailSrc.addFeature(trailFeat);
    } else {
      trailFeat.getGeometry().setCoordinates(coords);
    }
  }
);

watch(
  () => [telemetry.homeLon, telemetry.homeLat],
  ([lon, lat]) => {
    if (lon == null || lat == null) return;
    const c = fromLonLat([lon, lat]);
    if (!homeFeat) {
      homeFeat = new Feature({ geometry: new Point(c) });
      homeFeat.setStyle(makeHomeStyle());
      homeSrc.addFeature(homeFeat);
    } else {
      homeFeat.getGeometry().setCoordinates(c);
      homeFeat.setStyle(makeHomeStyle());
    }
  }
);

watch(
  () => telemetry.armed,
  () => { if (homeFeat) homeFeat.setStyle(makeHomeStyle()); }
);

// Swap tile source when settings change
watch(
  () => settings.map.style,
  (s) => { if (tileLayer) tileLayer.setSource(s === "satellite" ? makeSatSource() : makeOsmSource()); }
);

// Swap drone icon when settings change
watch(
  () => settings.map.droneIcon,
  () => { if (droneFeat) droneFeat.setStyle(makeDroneStyle(telemetry.heading)); }
);

onBeforeUnmount(() => { if (map) map.setTarget(null); });

function zoomIn()  { view?.animate({ zoom: (view.getZoom() ?? 3) + 1, duration: 200 }); }
function zoomOut() { view?.animate({ zoom: (view.getZoom() ?? 3) - 1, duration: 200 }); }
function toggleLayer() {
  settings.map.style = settings.map.style === "satellite" ? "osm" : "satellite";
  settings.save();
}
function toggleTrail() {
  settings.map.showTrail = !settings.map.showTrail;
  settings.save();
  if (!settings.map.showTrail) { trailSrc?.clear(); trailFeat = null; }
}

const locating = ref(false);
const locateError = ref(null);
const inElectron = typeof window !== "undefined" && !!window.electronAPI?.isElectron;

// Electron's Chromium has no Google API key so navigator.geolocation never
// resolves. Fetch via main-process IPC (Node https, no CORS) instead.
async function ipGeolocation() {
  if (inElectron && window.electronAPI?.getIpLocation) {
    return window.electronAPI.getIpLocation();
  }
  // Browser fallback — fetch directly (CORS allowed by ipapi.co)
  const res = await fetch("https://ipapi.co/json/");
  if (!res.ok) throw new Error("IP geolocation failed");
  const { latitude, longitude } = await res.json();
  if (!latitude || !longitude) throw new Error("No coordinates in IP response");
  return { latitude, longitude };
}

function browserGeolocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error("Geolocation unavailable")); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      (err) => reject(new Error(err.message || "Location unavailable")),
      { enableHighAccuracy: false, timeout: 5000, maximumAge: 60000 }
    );
  });
}

// Single entry point used by both startup and the locate button.
// Always tries navigator.geolocation first (accurate, WiFi/GPS-based).
// Falls back to IP lookup only if the OS location service is unavailable.
async function getLocation() {
  try { return await browserGeolocation(); } catch { return ipGeolocation(); }
}

async function gotoMyLocation() {
  if (locating.value) return;
  locating.value = true;
  locateError.value = null;
  try {
    const { latitude, longitude } = await getLocation();
    view?.animate({ center: fromLonLat([longitude, latitude]), zoom: 14, duration: 400 });
  } catch (err) {
    locateError.value = err.message || "Location unavailable";
    setTimeout(() => { locateError.value = null; }, 3000);
  } finally {
    locating.value = false;
  }
}

// Manual home override: prompt → fetch geolocation → write to telemetry store.
const showHomeConfirm = ref(false);
const homeBusy = ref(false);
const homeError = ref(null);

function askSetHome() {
  homeError.value = null;
  showHomeConfirm.value = true;
}

async function setHomeToMyLocation() {
  homeBusy.value = true;
  homeError.value = null;
  try {
    const { latitude: lat, longitude: lon } = await getLocation();
    telemetry.homeLat = lat;
    telemetry.homeLon = lon;
    view?.animate({ center: fromLonLat([lon, lat]), zoom: 16, duration: 400 });
    showHomeConfirm.value = false;
  } catch (err) {
    homeError.value = err.message || "Couldn't read your location";
  } finally {
    homeBusy.value = false;
  }
}
</script>

<template>
  <div class="absolute inset-0 bg-[#0a0f17]">
    <div ref="mapEl" class="absolute inset-0" />

    <!-- Map overlay controls — bottom-right, inset enough to clear the InfoCards panel -->
    <div class="absolute bottom-3 right-3 md:right-[248px] flex flex-col-reverse gap-1.5 z-10 pointer-events-auto">
      <!-- Zoom in -->
      <button class="map-btn w-9 h-9 text-lg font-bold leading-none" title="Zoom in" @click="zoomIn">+</button>
      <!-- Zoom out -->
      <button class="map-btn w-9 h-9 text-lg font-bold leading-none" title="Zoom out" @click="zoomOut">−</button>
      <!-- Map / Satellite toggle — layers icon; satellite view = active (brand) -->
      <button
        class="map-btn w-9 h-9"
        :class="settings.map.style === 'satellite' ? '!border-brand/50 !text-brand' : ''"
        :title="settings.map.style === 'satellite' ? 'Switch to street map' : 'Switch to satellite'"
        @click="toggleLayer"
      >
        <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="12 2 22 8.5 12 15 2 8.5"/>
          <polyline points="2 14 12 20.5 22 14"/>
        </svg>
      </button>
      <!-- Go to my location -->
      <button
        class="map-btn w-9 h-9 relative"
        :class="{ 'opacity-50': locating, '!border-status-critical': locateError }"
        :title="locateError || 'Go to my browser location'"
        @click="gotoMyLocation"
      >
        <svg v-if="!locating" class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="7"/>
          <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/>
          <path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>
        </svg>
        <svg v-else class="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
          <path d="M12 2a10 10 0 0 1 10 10" stroke-linecap="round"/>
        </svg>
      </button>
      <!-- Set home -->
      <button class="map-btn w-9 h-9" title="Set drone home to my location" @click="askSetHome">
        <svg viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 11l9-8 9 8" />
          <path d="M5 10v10h5v-6h4v6h5V10" />
        </svg>
      </button>
      <!-- Trail toggle — dashed route icon -->
      <button
        class="map-btn w-9 h-9"
        :class="settings.map.showTrail ? '!border-brand/50 !text-brand' : ''"
        title="Toggle flight trail"
        @click="toggleTrail"
      >
        <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="5" cy="19" r="2"/>
          <circle cx="19" cy="5" r="2"/>
          <path d="M6.5 17.5C9 15 9.5 13.5 9 11.5S9.5 7.5 12 7s5 .5 5.5-.5" stroke-dasharray="3 2.5"/>
        </svg>
      </button>
    </div>

    <!-- Set-home confirmation -->
    <div
      v-if="showHomeConfirm"
      class="absolute inset-0 z-20 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      @click.self="showHomeConfirm = false"
    >
      <div class="panel p-4 max-w-xs mx-4 text-data">
        <p class="text-sm leading-snug">
          Update drone home location to your current location?
        </p>
        <p class="text-[11px] text-label mt-1">
          Uses the browser's geolocation. The home marker on the map will move to that point.
        </p>
        <p v-if="homeError" class="text-[11px] text-status-critical mt-2">{{ homeError }}</p>
        <div class="flex gap-2 justify-end mt-3">
          <button
            class="btn px-3 py-1 text-xs"
            :disabled="homeBusy"
            @click="showHomeConfirm = false"
          >
            No
          </button>
          <button
            class="btn px-3 py-1 text-xs !bg-status-good/15 !border-status-good/40 !text-status-good hover:!bg-status-good/25"
            :disabled="homeBusy"
            @click="setHomeToMyLocation"
          >
            {{ homeBusy ? "Locating…" : "Yes" }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
