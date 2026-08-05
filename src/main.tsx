import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

const rootEl = document.getElementById("root") as HTMLElement;

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
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
} catch (err) {
  showError("React Mount Failed", err);
}
