# XR Shell

A native Electron proof of concept for a panoramic workspace that is wider than the physical XREAL display. The physical display acts as a viewport into a 2–5× virtual canvas. XREAL One Pro head rotation pans the canvas; right-button dragging and arrow keys provide a hardware-free simulator.

Open macOS windows can be brought into the workspace as live, interactive surfaces. Choose a window in the top toolbar and select **Add app**. macOS requests Screen Recording permission the first time. The mirror receives futuristic spatial chrome, depth, scan lines, color treatment and glow without modifying the original application bundle.

## Run

```bash
cd /Users/ido/Documents/xr-shell
npm install
npm start
```

Set the XREAL to an **extended display**, not mirroring. Select it in the top-right display picker and choose **Open on display**.

To control captured apps, choose **Grant Accessibility access**. The app opens **System Settings → Privacy & Security → Accessibility**; enable `input-bridge`, then return to Horizon. Horizon detects the permission automatically. Click a captured surface to select it; mouse clicks, dragging, scrolling, typing, common shortcuts and navigation keys are forwarded to the original app.

If `input-bridge` is not listed, use the **+** button in Accessibility settings, press **Command-Shift-G**, and enter `/Users/ido/Documents/xr-shell/.build/input-bridge`. If an older disabled entry exists after rebuilding, remove it with **−**, add the current helper again, and enable its switch.

To arrange the spatial workspace, drag a captured window by its holographic title bar. Drag its illuminated lower-right corner to resize it, or use the **−** and **+** buttons for coarse sizing. Manual offsets and sizes remain attached to the window when other windows are added or removed.

Choose **AX** on a captured window, then use the original app normally for five minutes. XR Shell snapshots the visible macOS Accessibility hierarchy, inventories roles, actions, attributes and parameterized attributes, highlights semantic controls over the live surface, records native AXObserver notifications, and learns structural/focus/value/state patterns by comparing snapshots. It summarizes event frequencies without persisting dynamic control values, then gives the privacy-trimmed profile to a schema-constrained Codex agent. The generated XR palette and role effects are validated, saved in `integration-profiles/<bundle-id>.json`, and applied live. If Codex is unavailable, the deterministic local theme compiler remains the fallback.

The central command deck starts real Codex CLI sessions in a read-only sandbox. Sessions appear in the right-hand rail and can be selected and continued. Capturable application windows refresh every two seconds without clearing the current selection. Learned profiles compile to app-specific XR palettes and role effects; Terminal and TextEdit themes are included from the current recordings.

Captured windows expose a three-way **THEME → FX → PASS** visual control and a **FRONT** control. Theme uses the learned app profile, FX uses the generic holographic shell treatment, and Pass shows a near-original view. Apps without a learned theme cycle between FX and Pass. The window selector refreshes from active macOS windows every two seconds and can be refreshed manually. Width and height controls independently size the panoramic canvas. Codex sessions can be created, resumed, and removed from the session rail; removing a running session stops its local process.
The explicit **RELEASE** control stops mirroring and removes a captured window from XR Shell without closing the original macOS app.

When profile learning finishes, XR Shell opens an intensity preview from **Light** to **Extreme** and remembers the choice for that theme. The top-bar **Profiles** library can inspect the complete local profile or its recording-derived AX summary, clear recording data while preserving the theme, or delete the entire profile.

For live tracking, connect the One Pro directly over USB-C, enable Ethernet in its developer menu, use flat Follow display mode, click **Connect XREAL**, hold still while calibration completes, and press **Recenter** while facing forward.

## Implemented

- 1.5–3.5× panoramic virtual canvas with a live minimap; 2.25× is the calmer default.
- XREAL display discovery and fullscreen placement.
- Live capture of up to three existing macOS application windows.
- Native pointer, drag, scroll, text, shortcut and navigation-key forwarding to captured windows.
- Direct spatial repositioning and constrained resizing for every captured surface.
- Per-application Accessibility inventory and locally generated integration profiles.
- Live role-aware holographic overlays and learned UI event capabilities.
- Explicit macOS Accessibility permission boundary; input is disabled until the user grants access.
- Futuristic glass frames, spatial depth, glow and display treatment around captured apps.
- First imported window opens directly ahead and automatically recenters the head pose.
- Responsive one-, two- and three-window layouts keep captured surfaces within a comfortable head-turn range.
- Holographic shell with angular corners, animated scan, telemetry and an `FX` clarity toggle.
- One Pro USB-Ethernet discovery on TCP port `52998`.
- Fragment-safe 134-byte IMU frame parsing.
- Stationary gyro calibration, accelerometer gravity feedback, quaternion integration and recentering.
- Frame-rate-independent head-view damping and safe edge clamping.
- Mouse and keyboard simulation without glasses.
- Sandboxed renderer with a narrow preload boundary.

## Limits

- Rotation-only 3DoF; yaw can drift and may need recentering.
- No stereoscopic compositor or positional tracking.
- The virtual workspace is a panoramic application surface, not additional macOS display pixels.
- Input forwarding is experimental. Protected/DRM surfaces, secure text fields and apps with custom event handling may reject synthetic input.
- Rebuilding or moving the unsigned `input-bridge` binary can cause macOS to request Accessibility permission again.
