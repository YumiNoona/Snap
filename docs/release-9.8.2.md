# Snap 9.8.2

- Fixes the blank preview and "Failed to load log" error when opening uploaded videos. Cursor-event data is optional: missing or unreadable telemetry no longer blocks preview, manual editing or export. Pending telemetry also no longer delays the first video frame.
- Restores legacy pretty-printed JSON-array input logs, including UTF-8 BOM files. Current JSONL logs and complete records before a truncated final record remain readable. Unrelated adjacent video metadata is not treated as input events.
- Validates cursor-event records before rendering. Unavailable telemetry appears as a non-blocking status and in project health. Original sidecars are preserved.

Use the 9.8.2 Full, Recorder and Editor executables together so Recorder's companion-editor handoff uses the matching version. The standalone Editor still opens directly in its empty editing workspace.

Build all three with `npm run build:editions`. Output: `release-artifacts/v9.8.2`.
