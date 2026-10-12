# Windows capture and game compatibility

Full Screen now uses GPU-resident DXGI Desktop Duplication, resolving both the
adapter and the output index from the selected monitor handle. Windows and
custom regions keep Windows Graphics Capture. GPU encoding is still required;
software encoding remains explicit opt-in. Existing segmented recovery handles
capture-process exits during display changes.

The previous full-screen path only used the compositor capture API and the
launcher selected the first enumerated monitor without a visible choice. Both
could explain a desktop-only game recording. The original Apex recording and
its diagnostics were not supplied, so this is not proof of the exact cause.

With multiple monitors, select the game display in the Full Screen card before
recording. This is a fixed display selection, not automatic window-following.
No game injection, anti-cheat bypass, or security-setting changes are used.

Native-size capture skips the GPU scaling filter entirely. On this PC, live
Desktop Duplication + NVENC succeeded on the RTX 3060, but FFmpeg's D3D11 scaler
failed texture allocation. When a requested downscale fails, the app suggests
Manual recording / Native resolution rather than silently ignoring the size
limit, downloading frames to the CPU, or falling back to compositor-only capture.
Drivers, protected content and exclusive-fullscreen behavior still need a short
real Apex test. This change cannot recover game frames absent from old recordings.

Live diagnosis on 2026-10-12: the running Apex window was visible, not minimized,
foreground, and 1920×1080, but `GetWindowDisplayAffinity` returned `0x11`
(`WDA_EXCLUDEFROMCAPTURE`). The user confirmed Borderless Windowed mode.
Window capture received no frames even with working GPU encoders. Snap now
checks capture protection before launching the recording process, reports the
actual restriction, and does not clear another application's affinity, inject
into the game, or silently switch a window recording to desktop capture.
This query does not identify the program that applied the flag or prove that
it offers a user-facing switch. Snap cannot clear another process's window
affinity through the supported Windows API. A GPU upgrade or encoder change
does not remove this exclusion.
See [Microsoft's capture affinity reference](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowdisplayaffinity).

## Window picker and editor

The picker uses one-shot window snapshots with bounded time/memory, no live
preview polling, and immediate card selection. Protected/unavailable previews
have neutral placeholders. Search, counts and confirmation footer are removed.
Editor drawers use consistent 16px outer padding; zoom inspection headers
show only the name. Top-bar command search and its shortcut are removed. Frame
actions and project health remain accessible in the project menu, while finishing
tools use an icon entry point and concise icon-labelled tabs. The Color & Film
panel starts with Film looks and tone adjustments, then grade scope, comparison,
adjustment layers and enable controls, followed by LUTs and RGB curves.

Editor changes: balanced drawers and motion labels, hidden scrollbars with scrolling
retained, removed camera-source badges and redundant video/audio bar labels,
and a source-aware filmstrip using the existing cached thumbnail atlas. Track
headers and accessible clip labels remain intact. Atlas sampling follows trims
and uses the entire visible source interval instead of repeating a strip from
an arbitrary offset.

References checked 2026-10-11:
- [Microsoft Desktop Duplication](https://learn.microsoft.com/en-us/windows/win32/direct3ddxgi/desktop-dup-api)
- [FFmpeg GPU capture filters](https://ffmpeg.org/ffmpeg-filters.html#ddagrab)

Before release: run a short Apex recording on the selected display, inspect
movement while in-game (not just after Alt+Tab), test a resolution change, and
check multi-monitor selection. Automated tests and native desktop GPU encoding
do not substitute for that game-specific test.
