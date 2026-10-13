// /api/apps/…: ready-to-install packages for other apps, filled in with this site's address.
//   GET /api/apps/powerpoint.xml   PowerPoint add-in manifest (live polls on a slide)
//   GET /api/apps/teams.zip        Microsoft Teams app (tab, meeting side panel and meeting stage)
// Hosts download these once and upload them (see docs/INTEGRATIONS.md).
import { zipSync, strToU8 } from "fflate";
import type { Env } from "./room";
import { json } from "./http";
import { sha256 } from "./identity";

/** A stable GUID for this site, so re-downloading gives the same app (updates instead of duplicates). */
export async function siteGuid(origin: string, kind: string) {
  const h = await sha256(`rslide-app:${kind}:${origin}`);
  // Shape it like a version-4 UUID.
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const xmlEsc = (s: string) => s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function powerpointManifest(origin: string, id: string, name: string) {
  const n = xmlEsc(name);
  const o = xmlEsc(origin);
  return `<?xml version="1.0" encoding="UTF-8"?>
<OfficeApp xmlns="http://schemas.microsoft.com/office/appforoffice/1.1"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:ov="http://schemas.microsoft.com/office/taskpaneappversionoverrides"
  xsi:type="ContentApp">
  <Id>${id}</Id>
  <Version>1.0.0.0</Version>
  <ProviderName>${n}</ProviderName>
  <DefaultLocale>en-US</DefaultLocale>
  <DisplayName DefaultValue="${n} live poll" />
  <Description DefaultValue="Show live poll results, Q&amp;A or the join code on a slide. Start a poll when its slide comes up." />
  <IconUrl DefaultValue="${o}/icons/icon-32.png" />
  <HighResolutionIconUrl DefaultValue="${o}/icons/icon-64.png" />
  <SupportUrl DefaultValue="${o}/help" />
  <AppDomains>
    <AppDomain>${o}</AppDomain>
  </AppDomains>
  <Hosts>
    <Host Name="Presentation" />
  </Hosts>
  <DefaultSettings>
    <SourceLocation DefaultValue="${o}/apps/powerpoint.html" />
    <RequestedWidth>960</RequestedWidth>
    <RequestedHeight>540</RequestedHeight>
  </DefaultSettings>
  <Permissions>ReadWriteDocument</Permissions>
  <AllowSnapshot>true</AllowSnapshot>
</OfficeApp>
`;
}

export function teamsManifest(origin: string, id: string, name: string) {
  const host = new URL(origin).host;
  return {
    $schema: "https://developer.microsoft.com/en-us/json-schemas/teams/v1.17/MicrosoftTeams.schema.json",
    manifestVersion: "1.17",
    version: "1.0.0",
    id,
    developer: {
      name,
      websiteUrl: `${origin}/`,
      privacyUrl: `${origin}/privacy`,
      termsOfUseUrl: `${origin}/terms`,
    },
    name: { short: name.slice(0, 30), full: `${name} live Q&A and polls`.slice(0, 100) },
    description: {
      short: "Live Q&A and polls in your meetings and channels.".slice(0, 80),
      full: "Ask questions, vote and answer polls without leaving Teams. Add it to a meeting to get a side panel for everyone, and share live results to the meeting stage.",
    },
    icons: { color: "color.png", outline: "outline.png" },
    accentColor: "#3B3FD8",
    configurableTabs: [
      {
        configurationUrl: `${origin}/apps/teams.html?setup=1`,
        canUpdateConfiguration: true,
        scopes: ["team", "groupChat"],
        context: ["channelTab", "privateChatTab", "meetingChatTab", "meetingDetailsTab", "meetingSidePanel", "meetingStage"],
      },
    ],
    validDomains: [host],
  };
}

export async function appRoutes(req: Request, env: Env, url: URL, parts: string[]): Promise<Response> {
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);
  const name = (env.APP_NAME || "RSlide").slice(0, 30);
  const origin = url.origin;
  if (parts[2] === "powerpoint.xml") {
    return new Response(powerpointManifest(origin, await siteGuid(origin, "powerpoint"), name), {
      headers: { "content-type": "application/xml; charset=utf-8", "content-disposition": `attachment; filename="${name.replace(/[^\w-]/g, "")}-powerpoint.xml"`, "cache-control": "no-store" },
    });
  }
  if (parts[2] === "teams.zip") {
    const icon = async (path: string) => new Uint8Array(await (await env.ASSETS.fetch(new URL(path, origin))).arrayBuffer());
    const zip = zipSync({
      "manifest.json": strToU8(JSON.stringify(teamsManifest(origin, await siteGuid(origin, "teams"), name), null, 2)),
      "color.png": await icon("/icons/teams-color.png"),
      "outline.png": await icon("/icons/teams-outline.png"),
    });
    return new Response(zip, {
      headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="${name.replace(/[^\w-]/g, "")}-teams.zip"`, "cache-control": "no-store" },
    });
  }
  return json({ error: "Not found" }, 404);
}
