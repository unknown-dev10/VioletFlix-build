# VioletFlix

VioletFlix is a **React Native** and **Expo** streaming discovery app for movies, TV series, and anime, with cross-platform support for **iOS**, **Android**, and **Web**.

---

## 🚀 Getting Started

### 1. Install Dependencies

```bash
npm install
# or
yarn install
```

2. Start the Project

Command Description
npm run dev Start Expo development server
npm run start Serve production web build from dist/
npm run android Launch Android emulator
npm run ios Launch iOS simulator
npm run web Start Expo web development server
npm run build Export production web build

3. Reset the Project

```bash
npm run reset-project
```

4. Lint the Code

```bash
npm run lint
```

---

📱 APK Download Protection

The production static server (npm run start) includes a lightweight guard for Android package files (.apk and .aab):

· ✅ Requests with missing or known scraper-style user agents are rejected before a package file is served.
· ✅ Package responses include:
  · X-Robots-Tag: noindex, nofollow, noarchive, nosnippet
  · Cache-Control: private, no-store
· 🔐 Optional: Set APP_PACKAGE_DOWNLOAD_TOKEN in production and require ?download_token=<token> or X-Download-Token header.

⚠️ Note: No server-side check can make a public APK impossible to copy once a real user downloads it. For sensitive builds, prefer:

· Private distribution channels
· Short-lived signed URLs
· Rate limiting at the CDN/WAF layer
· Android Play Integrity checks inside the app

---

📦 Main Dependencies

Library Version
React Native 0.79.4
React 19.0.0
Expo ~53.0.12
Expo Router ~5.1.0
Supabase ^2.50.0

Other Commonly Used Libraries:

· @expo/vector-icons
· react-native-paper
· react-native-calendars
· lottie-react-native
· react-native-webview
· (See full list in package.json)

---

🛠 Development Tools

Tool Version
TypeScript ~5.8.3
ESLint ^9.25.0
@babel/core ^7.25.2

---

🌐 Browser Extension: VioletFlix Shield

This repo includes a Manifest V3 browser extension in browser-extension/ for reducing ads, trackers, popups, and cosmetic ad containers while browsing streaming pages.

✨ Features

· Popup window with quick controls:
  · Turn protection on/off
  · Pause current site
  · Block ads, trackers, annoyances, popups
  · Enable cosmetic hiding
  · Stricter video-page cleanup
· ✅ EasyList-style network filtering via declarativeNetRequest dynamic rules
· ✅ Built-in list sources:
  · EasyList, EasyPrivacy
  · uBlock Badware, uBlock Privacy, uBlock Annoyances
  · Fanboy Annoyance/Social
  · Optional AdGuard Tracking Protection
· ✅ Automatic filter refreshes (daily by default) + manual Refresh lists button
· ✅ Advanced settings page:
  · Select lists
  · Change refresh interval
  · Tune rule budget
  · Add custom allow/block rules

🔧 Load It Locally

1. Open chrome://extensions, edge://extensions, or brave://extensions
2. Enable Developer mode
3. Choose Load unpacked and select the browser-extension/ folder
4. Pin VioletFlix Shield and use the popup to adjust blocking for the current site

✅ Validate Extension Files

```bash
npm run extension:validate
```

The validator checks:

· Manifest V3 wiring
· Required extension assets
· JavaScript syntax

---

⬇️ OmniSave Download Flow

Movie, TV, and anime direct downloads resolve through the local API proxy and OmniSave IDs:

Action Endpoint
Search movies /api/search/movie?q=avengers (returns subject_id)
Search TV/anime /api/search/tv?q=naruto (returns OmniSave subject_id, not MAL ID)
Download movie /api/download?subject_id=<subject_id>
Download TV/anime episode /api/download?subject_id=<subject_id>&season=1&episode=1

The frontend anime download button follows the TV/anime path by:

1. Searching OmniSave TV results first
2. Requesting episode MP4 URLs from /api/download

---

🤝 Contributing

1. Fork this repository
2. Create a new branch (git checkout -b feature/your-feature)
3. Commit your changes (git commit -am 'Add new feature')
4. Push to the branch (git push origin feature/your-feature)
5. Open a Pull Request

---

📄 License

This project is private ("private": true). For collaboration inquiries, please contact the author.

---

📸 Screenshots (Optional)

You can add project screenshots, API documentation, feature descriptions, or any other information as needed.

---

🧹 Additional Notes

· Make sure to set up your .env file with required environment variables (Supabase, TMDB, Firebase, etc.)
· For production builds, always run npm run build and test thoroughly
· Keep expo-env.d.ts in .gitignore as recommended by Expo

---

Enjoy building with VioletFlix! 🎬🔥

## Quick Start (VioletFlix)

### Ports
- **API Proxy + Panel**: `3050` (default)
- **Static frontend** (after `pnpm build`): `3000`
- **Panel token**: `violetkingdev10`

```bash
# API + Panel
PORT=3050 PANEL_TOKEN=violetkingdev10 node violetflix-api-proxy.js

# or
pnpm api
```

Panel: `http://YOUR_IP:3050/panel?token=violetkingdev10`

### Link Preview (Open Graph)
- Client-side SEO via `useSEO` on home, movie, TV pages.
- Dedicated preview page: `/public/link-preview.html`
- Default OG image is VioletFlix branded (purple).
- Movie/TV pages use poster as `og:image` so shared links show the real cover.

When you share a movie link, crawlers that execute JS (or after the SPA hydrates) get full VioletFlix metadata. For perfect bot support, host the domain and point shares at the root or use the link-preview page.

Made by @violetkingdev 😭✌️
