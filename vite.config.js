import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { VitePWA } from "vite-plugin-pwa";
import { execSync } from "child_process";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const isGitHubPages = process.env.GITHUB_PAGES === "true";

// Use the nearest git tag as the version. Falls back to package.json so dev
// builds without a tag still show something sensible.
function appVersion() {
  try {
    const tag = execSync("git describe --tags --abbrev=0", { encoding: "utf8", stdio: ["pipe","pipe","pipe"] }).trim();
    return tag.startsWith("v") ? tag.slice(1) : tag;
  } catch {
    return require("./package.json").version;
  }
}
const APP_VERSION = appVersion();

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
  // GitHub Pages needs an absolute base (/flighttrace/) for correct PWA scope.
  // Electron needs "./" because it loads via file://.
  base: isGitHubPages ? "/flighttrace/" : "./",
  plugins: [
    vue(),
    basicSsl(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: false,
      includeAssets: ["icon.svg"],
      manifest: {
        name: "FlightTrace",
        short_name: "FlightTrace",
        description:
          "Drone telemetry viewer with CRSF, MAVLink, and LTM support over USB, BLE, and WiFi",
        theme_color: "#050709",
        background_color: "#050709",
        display: "standalone",
        orientation: "any",
        start_url: isGitHubPages ? "/flighttrace/" : ".",
        scope: isGitHubPages ? "/flighttrace/" : ".",
        icons: [
          { src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
          { src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,ico,png,woff,woff2}"],
        navigateFallback: "index.html",
        // Map tiles + Google Fonts cached for offline use
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.hostname === "tile.openstreetmap.org",
            handler: "CacheFirst",
            options: {
              cacheName: "osm-tiles",
              expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: ({ url }) => url.hostname === "server.arcgisonline.com",
            handler: "CacheFirst",
            options: {
              cacheName: "esri-tiles",
              expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts",
              expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    port: 5173,
    host: true,
    https: true,
    proxy: {
      "/ws-bridge": {
        target: "ws://localhost:14555",
        ws: true,
        rewrite: (path) => path.replace(/^\/ws-bridge/, ""),
      },
    },
  },
});
