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

## Extended feature tour

The 60-second `snap-features-promo.mp4` preserves the Signal / Flow design and
uses the OST excerpt from 16.6–76.6 seconds. It covers all ten persistent editor
tabs, with extra demonstrations of zoom, motion blur, camera curves, custom
cursors, backgrounds, 3D poses, color, audio, captions, and timeline keyframes.
It is a separate film; the homepage promo and original 36-second film are unchanged.

The panel images in `public/screenshots/tour/` are captures of the real React
components with deterministic demo state, not fabricated UI. The accompanying
motion graphics illustrate the features; they are not a live recording or a
claim that caption generation completed during the capture. The capture fixture
does not run native recording, transcription, or other desktop operations.

```bash
# Optional: recapture panels from the desktop project's actual components.
npm --prefix web run promo:capture-panels
npm --prefix web run promo:features -- --stills
npm --prefix web run promo:features
node web/scripts/verify-product-film.mjs --film=web/public/media/snap-features-promo.mp4 --duration=60 --audio-start=16.6
```

Panel capture needs Playwright and Edge. Set `SNAP_PLAYWRIGHT_MODULE` to an
installed Playwright entry point if it is not available in the bundled runtime.
Rendering needs FFmpeg on PATH and the local, Git-ignored `public/media/OST.mp3`.
Generated QA frames are in ignored `test-results/feature-film/`. Text added by
the film uses JetBrains Mono; real UI captures retain the application's font.
The 3D demo uses inverse projection with bilinear sampling to avoid mesh seams.

## Deploy to Vercel

1. Import the `YumiNoona/Snap` repository in Vercel.
2. Edit **Root Directory** and select `web`.
3. Keep the detected framework as **Next.js** and deploy.

Vercel now reads this directory's `package.json` and `vercel.json` directly, so
the desktop Vite/Tauri project is never treated as the website. No environment
variables or custom install, build, or output commands are required.

The `/download` route queries the latest release from `YumiNoona/Snap` and redirects to the setup `.exe`. If GitHub's API is unavailable, it falls back to the releases page.
