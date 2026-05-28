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

// Plane / fixed-wing — proper top-down aircraft silhouette (nose at 12 o'clock)
const planeImg = new Image(48, 48);
planeImg.src =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 32 32">` +
    // halo
    `<circle cx="16" cy="16" r="14" fill="rgba(167,139,250,0.15)" stroke="#a78bfa" stroke-width="1"/>` +
    // fuselage — slender body nose(top) to tail(bottom)
    `<ellipse cx="16" cy="16" rx="2" ry="11" fill="#a78bfa"/>` +
    // main wings — swept slightly back from mid-body
    `<path d="M15,13 L2,21 L6,22.5 L15,18 L17,18 L26,22.5 L30,21 L17,13 Z" fill="#a78bfa"/>` +
    // horizontal tail stabilizers
    `<path d="M14.5,23 L10,27 L12.5,26.5 L15.5,25 L16.5,25 L19.5,26.5 L22,27 L17.5,23 Z" fill="#a78bfa" opacity="0.9"/>` +
    `</svg>`
  );

// Quadcopter icon — X-frame, front motors brighter, rear motors dimmed
const quadImg = new Image(48, 48);
quadImg.src =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">` +
    // arms
    `<line x1="24" y1="24" x2="10" y2="10" stroke="#a78bfa" stroke-width="3" stroke-linecap="round"/>` +
    `<line x1="24" y1="24" x2="38" y2="10" stroke="#a78bfa" stroke-width="3" stroke-linecap="round"/>` +
    `<line x1="24" y1="24" x2="10" y2="38" stroke="#a78bfa" stroke-width="3" stroke-linecap="round"/>` +
    `<line x1="24" y1="24" x2="38" y2="38" stroke="#a78bfa" stroke-width="3" stroke-linecap="round"/>` +
    // front motors (top-left, top-right) — full brightness
    `<circle cx="10" cy="10" r="7" fill="#a78bfa" stroke="#050709" stroke-width="1.5"/>` +
    `<circle cx="38" cy="10" r="7" fill="#a78bfa" stroke="#050709" stroke-width="1.5"/>` +
    // rear motors — dimmed so heading direction is obvious
    `<circle cx="10" cy="38" r="7" fill="rgba(167,139,250,0.35)" stroke="#050709" stroke-width="1.5"/>` +
    `<circle cx="38" cy="38" r="7" fill="rgba(167,139,250,0.35)" stroke="#050709" stroke-width="1.5"/>` +
    // body + forward indicator line
    `<rect x="19" y="19" width="10" height="10" rx="2" fill="rgba(5,7,9,0.85)" stroke="#a78bfa" stroke-width="1.5"/>` +
    `<line x1="24" y1="19" x2="24" y2="13" stroke="#a78bfa" stroke-width="2" stroke-linecap="round"/>` +
    `</svg>`
  );

// Home marker icon — shown as house when drone is armed, plain circle otherwise
const homeImg = new Image(40, 40);
homeImg.src =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 32 32">` +
    `<circle cx="16" cy="16" r="14" fill="rgba(59,130,246,0.25)" stroke="#3b82f6" stroke-width="1.5"/>` +
    // roof
    `<polygon points="16,7 5,17 27,17" fill="#3b82f6" stroke="rgba(0,0,0,0.25)" stroke-width="0.5" stroke-linejoin="round"/>` +
    // walls
    `<rect x="7" y="17" width="18" height="9" rx="0.5" fill="#3b82f6" stroke="rgba(0,0,0,0.25)" stroke-width="0.5"/>` +
    // door
    `<rect x="13" y="19.5" width="6" height="6.5" rx="1" fill="rgba(5,7,9,0.65)"/>` +
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
    style: new Style({ stroke: new Stroke({ color: "#a78bfa", width: 2.5, lineDash: [6, 4] }) }),
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
      <!-- Map / Satellite toggle -->
      <button
        class="map-btn w-9 h-9 text-[10px] font-bold font-mono tracking-widest"
        :title="settings.map.style === 'satellite' ? 'Switch to street map' : 'Switch to satellite'"
        @click="toggleLayer"
      >
        {{ settings.map.style === "satellite" ? "MAP" : "SAT" }}
      </button>
      <!-- Go to my location -->
      <button
        class="map-btn w-9 h-9 text-base relative"
        :class="{ 'opacity-50': locating, 'border-red-500': locateError }"
        :title="locateError || 'Go to my browser location'"
        @click="gotoMyLocation"
      >
        <svg v-if="!locating" class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="3"/>
          <path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>
          <circle cx="12" cy="12" r="8" stroke-dasharray="2 3"/>
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
      <!-- Trail toggle -->
      <button
        class="map-btn w-9 h-9 text-[10px] font-bold font-mono tracking-widest"
        :class="settings.map.showTrail ? '!border-hud-accent !text-hud-accent' : ''"
        title="Toggle flight trail"
        @click="toggleTrail"
      >
        TRL
      </button>
    </div>

    <!-- Set-home confirmation -->
    <div
      v-if="showHomeConfirm"
      class="absolute inset-0 z-20 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      @click.self="showHomeConfirm = false"
    >
      <div class="panel p-4 max-w-xs mx-4 text-hud-text">
        <p class="text-sm leading-snug">
          Update drone home location to your current location?
        </p>
        <p class="text-[11px] text-hud-mute mt-1">
          Uses the browser's geolocation. The home marker on the map will move to that point.
        </p>
        <p v-if="homeError" class="text-[11px] text-hud-danger mt-2">{{ homeError }}</p>
        <div class="flex gap-2 justify-end mt-3">
          <button
            class="btn px-3 py-1 text-xs"
            :disabled="homeBusy"
            @click="showHomeConfirm = false"
          >
            No
          </button>
          <button
            class="btn px-3 py-1 text-xs bg-hud-ok/15 border-hud-ok/40 text-hud-ok hover:bg-hud-ok/25"
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
