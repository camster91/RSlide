// The app is a native shell around your RSlide site (set in app.json, or RSLIDE_URL when building).
// It adds what a browser can't: QR scanning to join, haptics, the share sheet, and opening event links in the app.
import type { CapacitorConfig } from "@capacitor/cli";
import { readFileSync } from "node:fs";

const app = JSON.parse(readFileSync(new URL("./app.json", import.meta.url), "utf8")) as { url: string; appId: string; appName: string };

const url = (process.env.RSLIDE_URL || app.url).replace(/\/$/, "");
const host = new URL(url).host;

const config: CapacitorConfig = {
  appId: process.env.RSLIDE_APP_ID || app.appId,
  appName: process.env.RSLIDE_APP_NAME || app.appName,
  // Shown only when the site can't be reached (no connection).
  webDir: "www",
  server: {
    url,
    errorPath: "offline.html",
    // Stay inside the app for your site; everything else opens in the browser.
    allowNavigation: [host],
  },
  ios: {
    // Keep content clear of the notch and home bar.
    contentInset: "automatic",
  },
  android: {
    allowMixedContent: false,
  },
  plugins: {
    SplashScreen: { launchShowDuration: 600, backgroundColor: "#3b3fd8", showSpinner: false },
    StatusBar: { overlaysWebView: false },
  },
};

export default config;
