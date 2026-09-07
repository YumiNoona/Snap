const RELEASE_API = "https://api.github.com/repos/YumiNoona/Snap/releases/latest";
const RELEASES_FALLBACK = "https://github.com/YumiNoona/Snap/releases/latest";

interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}

export async function GET() {
  try {
    const response = await fetch(RELEASE_API, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "Snap-Web" },
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`GitHub returned ${response.status}`);

    const release = await response.json() as { assets?: ReleaseAsset[] };
    const assets = release.assets ?? [];
    const installer = assets.find((asset) => /setup.*\.exe$/i.test(asset.name))
      ?? assets.find((asset) => /\.exe$/i.test(asset.name));

    return Response.redirect(installer?.browser_download_url ?? RELEASES_FALLBACK, 302);
  } catch {
    return Response.redirect(RELEASES_FALLBACK, 302);
  }
}
