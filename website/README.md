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

## Deploy to Vercel

The Snap repository root contains `vercel.json`. It deliberately installs,
builds, and serves this directory only, and skips deployments for commits that
do not change `website/` or `vercel.json`.

1. Import the `YumiNoona/Snap` repository in Vercel.
2. Leave the project Root Directory at the repository root.
3. Deploy. The checked-in configuration selects Next.js and this website's
   `.next` output; no environment variables or dashboard command overrides are
   required.

The `/download` route queries the latest release from `YumiNoona/Snap` and redirects to the setup `.exe`. If GitHub's API is unavailable, it falls back to the releases page.
