# Snap Website

Official download and support website for [Snap](https://github.com/YumiNoona/Snap), a Windows screen recorder and editor.

## Features

- Responsive product landing page
- Download button that resolves the latest Windows installer from GitHub Releases
- Donation modal with UPI QR code and copyable UPI ID
- Open Graph and X social-preview metadata

## Local development

Requirements: Node.js 20.9 or newer.

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Production checks

```bash
npm run lint
npm run build
```

## Signal / Flow product film

The alternate 36-second film uses the app screenshots, bundled JetBrains Mono
fonts, and the supplied local `public/media/OST.mp3`. The full source track is
ignored by Git; only its normalized 16.6–52.6 second excerpt is embedded in the
video. The existing homepage promo remains independent.

From the repository root:

```bash
npm --prefix web run promo:flow -- --stills
npm --prefix web run promo:flow -- --preview
npm --prefix web run promo:flow
node web/scripts/verify-product-film.mjs --film=web/public/media/snap-flow-promo.mp4 --duration=36 --audio-start=16.6
```

The final MP4 is 1080p/60 fps with stereo AAC. Review frames and the 720p preview
are written to ignored `web/test-results/flow-film/`; the public MP4, poster,
and caption track are under `web/public/media/snap-flow-promo.*`.

## Deploy to Vercel

1. Import the `YumiNoona/Snap` repository in Vercel.
2. Edit **Root Directory** and select `web`.
3. Keep the detected framework as **Next.js** and deploy.

Vercel now reads this directory's `package.json` and `vercel.json` directly, so
the desktop Vite/Tauri project is never treated as the website. No environment
variables or custom install, build, or output commands are required.

The `/download` route queries the latest release from `YumiNoona/Snap` and redirects to the setup `.exe`. If GitHub's API is unavailable, it falls back to the releases page.
