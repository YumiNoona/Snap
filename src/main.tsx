import ReactDOM from "react-dom/client";
import App from "./App";

const rootEl = document.getElementById("root") as HTMLElement;

// Tag <body> with the window identity so App.css can scope opaque
// backgrounds to content windows. Read from the URL (`?window=editor`, set
// by the Rust side when each window is created — see src-tauri/src/lib.rs
// and tauri.conf.json), NOT from Tauri's getCurrentWindow()/IPC state.
//
// getCurrentWindow() reads window.__TAURI_INTERNALS__.metadata, which is
// injected by Tauri asynchronously and is NOT guaranteed to exist yet when
// this script's top-level code runs — especially on Windows (see
// https://github.com/tauri-apps/tauri/issues/12694 and #12990, both open
// upstream bugs about this exact race). Calling it this early can throw.
// The URL query param is available synchronously, immediately, with zero
// dependency on Tauri's IPC bridge being ready — it can never race.
const windowLabel = new URLSearchParams(window.location.search).get("window") ?? "main";
document.body.classList.add(`window-${windowLabel}`);


function showError(label: string, err: unknown) {
  const message = err instanceof Error ? `${err.message}\n\n${err.stack || ""}` : String(err);
  console.error(`[Snap] ${label}`, err);

  const banner = document.createElement("div");
  banner.style.cssText =
    "position:fixed;bottom:0;left:0;right:0;z-index:99999;background:#1a0000;color:#ef4444;" +
    "font-family:Consolas,monospace;font-size:11px;padding:10px 14px;max-height:30vh;overflow-y:auto;" +
    "border-top:2px solid #ef4444;white-space:pre-wrap;line-height:1.5";
  banner.textContent = `[${label}] ${message}`;
  document.body.appendChild(banner);

  if (!rootEl.textContent) {
    rootEl.style.cssText =
      "display:flex;align-items:center;justify-content:center;height:100vh;" +
      "color:#f2f4f8;background:#0b0d12;font-family:Consolas,monospace;font-size:13px;" +
      "padding:32px;white-space:pre-wrap;line-height:1.6";
    rootEl.textContent = `Snap failed to start.\n\n${message}`;
  }
}

window.addEventListener("error", (e) => showError("Uncaught Error", e.error || e.message));
window.addEventListener("unhandledrejection", (e) => showError("Unhandled Promise", e.reason));

try {
  ReactDOM.createRoot(rootEl).render(
    <App />,
  );
} catch (err) {
  showError("React Mount Failed", err);
}
