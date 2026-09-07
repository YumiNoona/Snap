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

1. Import the `YumiNoona/Snap` repository in Vercel.
2. Edit **Root Directory** and select `web`.
3. Keep the detected framework as **Next.js** and deploy.

Vercel now reads this directory's `package.json` and `vercel.json` directly, so
the desktop Vite/Tauri project is never treated as the website. No environment
variables or custom install, build, or output commands are required.

The `/download` route queries the latest release from `YumiNoona/Snap` and redirects to the setup `.exe`. If GitHub's API is unavailable, it falls back to the releases page.
