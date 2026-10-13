// Writes your site's address and the app's name into the Android and iOS projects.
// Runs before every `npm run sync`, so changing app.json (or RSLIDE_URL) is all you need to do.
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const app = JSON.parse(readFileSync(`${root}app.json`, "utf8"));
const url = new URL(process.env.RSLIDE_URL || app.url);
const host = url.host;
const name = process.env.RSLIDE_APP_NAME || app.appName;
const appId = process.env.RSLIDE_APP_ID || app.appId;
if (!/^[a-zA-Z][\w]*(\.[a-zA-Z][\w]*)+$/.test(appId)) throw new Error(`appId "${appId}" should look like com.yourcompany.rslide`);
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const edit = (path, fn) => {
  const p = root + path;
  if (!existsSync(p)) return console.log(`skip ${path} (platform not added)`);
  const before = readFileSync(p, "utf8");
  const after = fn(before);
  if (after !== before) writeFileSync(p, after);
  console.log(`${after !== before ? "updated" : "ok     "} ${path}`);
};
const between = (s, start, end, inner) => {
  const re = new RegExp(`${start}[\\s\\S]*?${end}`);
  return re.test(s) ? s.replace(re, `${start}${inner}${end}`) : null;
};

// ---------- Android ----------
edit("android/app/src/main/AndroidManifest.xml", (s) => {
  const block = `
            <!-- rslide:links -->
            <intent-filter android:autoVerify="true">
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="https" android:host="${esc(host)}" android:pathPrefix="/e/" />
                <data android:scheme="https" android:host="${esc(host)}" android:pathPrefix="/join-team" />
            </intent-filter>
            <!-- /rslide:links -->`;
  const out = between(s, "\n            <!-- rslide:links -->", "<!-- /rslide:links -->", "") !== null
    ? s.replace(/\n            <!-- rslide:links -->[\s\S]*?<!-- \/rslide:links -->/, block)
    : s.replace(/(<category android:name="android.intent.category.LAUNCHER" \/>\s*<\/intent-filter>)/, `$1\n${block}`);
  // Android scans with Google's scanner, so the app itself never needs the camera permission.
  return out.replace(/\n\s*<uses-permission android:name="android.permission.CAMERA" \/>/, "");
});
edit("android/app/src/main/res/values/strings.xml", (s) =>
  s.replace(/<string name="app_name">[^<]*<\/string>/, `<string name="app_name">${esc(name)}</string>`).replace(/<string name="title_activity_main">[^<]*<\/string>/, `<string name="title_activity_main">${esc(name)}</string>`)
    .replace(/<string name="(package_name|custom_url_scheme)">[^<]*<\/string>/g, (_m, k) => `<string name="${k}">${appId}</string>`),
);

edit("android/app/build.gradle", (s) => s.replace(/applicationId "[^"]*"/, `applicationId "${appId}"`));

// ---------- iOS ----------
const plistSet = (s, key, xml) => {
  const re = new RegExp(`\\s*<key>${key}</key>\\s*(<string>[^<]*</string>|<array>[\\s\\S]*?</array>|<true/>|<false/>)`);
  const entry = `\n\t<key>${key}</key>\n\t${xml}`;
  return re.test(s) ? s.replace(re, entry) : s.replace(/<\/dict>\s*<\/plist>\s*$/, `${entry.slice(1)}\n</dict>\n</plist>\n`);
};
edit("ios/App/App/Info.plist", (s) => {
  s = plistSet(s, "CFBundleDisplayName", `<string>${esc(name)}</string>`);
  s = plistSet(s, "NSCameraUsageDescription", "<string>Scan an event's QR code to join it.</string>");
  return s.replace(/\s*<key>WKAppBoundDomains<\/key>\s*<array>[\s\S]*?<\/array>/, "");
});
// Opening event links in the app (universal links). Needs the Associated Domains capability on your App ID.
if (existsSync(`${root}ios/App/App`)) {
  writeFileSync(
    `${root}ios/App/App/App.entitlements`,
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>com.apple.developer.associated-domains</key>
\t<array>
\t\t<string>applinks:${esc(host)}</string>
\t</array>
</dict>
</plist>
`,
  );
  console.log("updated ios/App/App/App.entitlements");
}
edit("ios/App/App.xcodeproj/project.pbxproj", (s) => {
  if (!s.includes("CODE_SIGN_ENTITLEMENTS")) s = s.replace(/(\t+)INFOPLIST_FILE = App\/Info.plist;/g, "$1CODE_SIGN_ENTITLEMENTS = App/App.entitlements;\n$1INFOPLIST_FILE = App/Info.plist;");
  return s.replace(/PRODUCT_BUNDLE_IDENTIFIER = [^;]+;/g, `PRODUCT_BUNDLE_IDENTIFIER = ${appId};`);
});

console.log(`\nApp "${name}" → ${url.origin}`);
