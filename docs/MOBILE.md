# Phone apps (iPhone, iPad and Android)

The `mobile/` folder is a native app around your RSlide site. It loads your live site, so every update you deploy reaches the app straight away, with no store review. On top of the website it adds:

- **Scan QR code** on the home screen, to join an event with the camera
- **Event links open in the app** (from email, chat or the camera), once app links are set up (below)
- A light **tap you can feel** when you vote, answer or react
- The phone's **share sheet** for the join link
- A friendly "you're offline" screen with a Try again button
- Its own icon and launch screen

People can still join from any browser with no app. The app is for those who prefer one, and to be findable in the stores.

## 1. Point it at your site

Edit `mobile/app.json`:

```json
{ "url": "https://your-rslide-site", "appId": "com.yourcompany.rslide", "appName": "RSlide" }
```

`appId` is permanent once you publish, so pick it carefully (reverse domain style).

## 2. Build

**Easiest: GitHub Actions.** Actions tab → **Mobile apps** → **Run workflow**, enter your site's address. You get:

- `app-debug.apk`: install it on an Android phone to try it (allow "install unknown apps")
- `app-release.aab`: the file Google Play wants
- An iPhone simulator build, to check it compiles

**On your computer:** `cd mobile && npm install && npm run sync`, then `npx cap open android` (Android Studio) or `npx cap open ios` (Xcode, Mac only).

## 3. Accounts you need

| Store | Cost | Sign up |
| --- | --- | --- |
| Google Play | US$25 once | play.google.com/console |
| Apple App Store | US$99 a year | developer.apple.com/programs |

Both review the app before it goes live (usually 1–3 days).

## 4. Google Play

1. Make an upload key once, on any computer with Java:
   `keytool -genkeypair -keystore release.jks -alias rslide -keyalg RSA -keysize 2048 -validity 10000`
   Keep the file and passwords safe. You need them for every update.
2. Add GitHub secrets (Settings → Secrets → Actions):
   `ANDROID_KEYSTORE_BASE64` (the output of `base64 -w0 release.jks`), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` (`rslide`), `ANDROID_KEY_PASSWORD`.
3. Run the workflow. Upload `app-release.aab` in Play Console → your app → Testing → Internal testing.
4. Optional, for automatic uploads: create a Google Play service account with release access, and add its JSON key as the `PLAY_SERVICE_ACCOUNT_JSON` secret. Each run then sends a draft to internal testing.

## 5. Apple App Store

1. In App Store Connect, add a new app with your `appId` as the bundle ID.
2. Create an API key: App Store Connect → Users and Access → Integrations → App Store Connect API → **+** (role: App Manager). Download the `.p8` file.
3. Add GitHub secrets: `APP_STORE_CONNECT_KEY_ID`, `APP_STORE_CONNECT_ISSUER_ID`, `APP_STORE_CONNECT_KEY_BASE64` (`base64 -i AuthKey_XXXX.p8`), `APPLE_TEAM_ID`.
4. Run the workflow with "Also build for iPhone and iPad" ticked. The build is signed automatically and uploaded to **TestFlight**. Try it there, then submit it for review.

> Apple sometimes rejects apps that are "just a website". The app's QR scanning, app links, haptics, share sheet and offline screen are there to help. In the review notes, mention that attendees scan a QR code at live events to join and vote, and give the reviewer a test event code.

## 6. App links (optional, recommended)

So that tapping `https://your-site/e/CODE` opens the app, set these on your Worker (in `wrangler.jsonc` vars or the dashboard), then redeploy:

| Setting | Where to find it |
| --- | --- |
| `ANDROID_PACKAGE` | your `appId` |
| `ANDROID_CERT_SHA256` | Play Console → your app → App integrity → App signing key certificate → SHA-256 (comma-separate several) |
| `APPLE_APP_IDS` | `TEAMID.your.app.id` (Team ID is in your Apple developer account) |

The site then serves `/.well-known/assetlinks.json` and `/.well-known/apple-app-site-association`. For iPhone, also tick **Associated Domains** on your App ID in the Apple developer site.

## 7. Store listing (copy you can use)

**Name:** RSlide: Live Q&A and Polls
**Subtitle (Apple, 30 characters):** Ask, vote and quiz live
**Short description (Google, 80 characters):** Join live Q&A, polls and quizzes with a code. No account needed.

**Description:**

> Take part in live events from your phone. Scan the QR code on the screen (or type the code) and you're in. No account, no sign-up.
>
> • Ask questions and upvote the best ones
> • Answer live polls: multiple choice, word clouds, ratings, rankings and more
> • Play quizzes and climb the leaderboard, on your own or in teams
> • Send reactions to the big screen
> • Works in English, French and Spanish
>
> Hosts: create events, run polls from your phone with the remote, and see results live.

**Category:** Education (or Business). **Content rating:** Everyone; questions come from other people at the event, and hosts can filter words and review questions before they appear.

**Privacy:** link your site's `/privacy` page. For the store privacy forms: the app collects what people type into events (questions, answers, and a name or email only if the host asks), linked to a random device ID, not used for tracking or ads.

**Screenshots:** take them from the app or a phone-size browser window: the home screen with Scan QR code, a live poll, the Q&A list, a quiz result, the leaderboard.
