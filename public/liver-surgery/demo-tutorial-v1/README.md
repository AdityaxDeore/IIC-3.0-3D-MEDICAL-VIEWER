# LiverSurgerySimWeb — Guided Demo Snapshot v1

This subfolder is a **frozen deployment** that ships the simulator together with
an **interactive tutorial**. It is aimed at first-time visitors who want to try
the system without reading documentation first: the tutorial menu opens
automatically on load and walks through the real UI.

It is a complete, self-contained copy — it does not depend on the files in the
parent directory and is unaffected by future updates to the live demo.

## Live URL

**https://meimeimei1223.github.io/LiverSurgerySimWeb/demo-tutorial-v1/**

Open in a WebGL2-capable desktop browser (Chrome, Firefox, Edge). The liver
model set is bundled, so no data files need to be supplied.

## What the tutorial covers

Five entries, chosen from a menu. Each lesson runs a **coach** (a ring that
points at the actual button you must press, advancing when you press it) next to
a **worked example** panel that steps through real screenshots of the same
operation.

| Lesson | Contents |
|---|---|
| Camera & Controls | Static help card — rotate / zoom / pan, Transform (T), shortcuts D X Q T B |
| Display & Organs | Organ visibility, liver alpha, display modes (Normal / Auto Seg / Preset Seg), Volume panel |
| Deform | Place handles → deform → undo handle → clear all |
| Cut | Free Cut: place cutter → size & thickness → CUT → undo |
| Select & Cut | Segment cut: display mode determines the selection unit, liver and portal territory selection, anatomical S1–S8 |

The most important idea taught by *Select & Cut* is that the **selection unit
follows the display mode**: `Preset Seg` selects anatomical S1–S8, `Auto Seg`
selects skeleton-derived portal territories, and switching modes clears the
current selection.

### Device support

- **Desktop** — coach guidance plus the worked-example panel (full experience).
- **Phone / tablet** — worked-example panel only; the coach targets desktop
  control-panel buttons that the mobile layout does not show.
- **VR / AR** — hidden while immersed, since 2D overlays are not visible there.

### URL parameters

| Parameter | Effect |
|---|---|
| *(none)* | Tutorial menu opens automatically once loading finishes |
| `?tut=0` | Suppress the automatic menu; the "🎓 Tutorial" pill still opens it |
| `?bench=1` | Benchmark mode; the tutorial is disabled entirely |

## What is preserved

| Component | Version |
|---|---|
| `index.html` | v317 (v316 + tutorial, English AR/VR strings) |
| `softbody.wasm` / `.data` / `.js` | identical to the v311 build (byte-for-byte) |
| `data/tut/*.jpg` | 39 screenshots used by the worked-example panel |
| `sw.js` | `CACHE_NAME = 'liver-sim-demo-tutorial-v1'` (own cache namespace) |

## Related snapshots

| Snapshot | Purpose |
|---|---|
| [`paper-benchmark-v1/`](../paper-benchmark-v1/) | Performance measurements reported in the paper |
| [`paper-volume-v1/`](../paper-volume-v1/) | Anatomical volume measurements reported in the paper |
| [live demo](../) | Continuously updated version (tutorial available from the "🎓 Tutorial" pill) |

---

Copyright (c) 2026 Meidai Kasai. All rights reserved. See [LICENSE](../LICENSE).
