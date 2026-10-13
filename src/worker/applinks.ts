// App links: lets event links open in the RSlide phone app (see docs/MOBILE.md). No Cloudflare imports, so it's easy to test.

export interface AppLinkEnv {
  /** Phone app: Android package name, e.g. "app.rslide.mobile". */
  ANDROID_PACKAGE?: string;
  /** SHA-256 fingerprints of the Android signing certificate(s), comma separated (Play Console → App integrity). */
  ANDROID_CERT_SHA256?: string;
  /** iOS app IDs, "TEAMID.bundle.id", comma separated. */
  APPLE_APP_IDS?: string;
}

const list = (v?: string) => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);

/** /.well-known files that let event links open in the phone app instead of the browser. */
export function wellKnown(path: string, env: AppLinkEnv): Response | null {
  const headers = { "content-type": "application/json", "cache-control": "public, max-age=3600" };
  if (path === "/.well-known/assetlinks.json" && env.ANDROID_PACKAGE && list(env.ANDROID_CERT_SHA256).length)
    return new Response(
      JSON.stringify([
        { relation: ["delegate_permission/common.handle_all_urls"], target: { namespace: "android_app", package_name: env.ANDROID_PACKAGE, sha256_cert_fingerprints: list(env.ANDROID_CERT_SHA256) } },
      ]),
      { headers },
    );
  if (path === "/.well-known/apple-app-site-association" && list(env.APPLE_APP_IDS).length)
    return new Response(
      JSON.stringify({ applinks: { details: [{ appIDs: list(env.APPLE_APP_IDS), components: [{ "/": "/e/*" }, { "/": "/join-team*" }] }] } }),
      { headers },
    );
  return null;
}
