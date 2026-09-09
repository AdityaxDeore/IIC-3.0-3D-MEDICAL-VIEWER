/* benchmark.js — LiverSurgerySimWeb performance measurement
 * Version: 1.0.9
 * Loaded via ?bench URL parameter only.
 * No external dependencies. No network. No persistence.
 * Phase 1 (MVP): platform, load times, FPS (idle/rotation), 4-cut logging,
 *                report UI.
 * Phase 2 (1.0.7): XR session lifecycle + per-second vrFps sampling.
 *
 * Changelog:
 *  1.0.9 — Android AR handle-grab detection.
 *          v1.0.8 added sb.isGrabbing() check, but that method is the
 *          DESKTOP-MOUSE variant (paired with startGrab/endGrab). Android AR
 *          and Quest3 use the VR-suffixed variant: sb.isGrabbingVR() (paired
 *          with startGrabVR/endGrabVR). The two are bound separately in
 *          WasmBindings.cpp (isGrabbing + isGrabbingVR). On Android AR,
 *          vrGrabs.right.active is also never synced to isGrabbingVR() (only
 *          Quest3 controller/hand-tracking handlers do that sync), so the only
 *          reliable signal is calling sb.isGrabbingVR() directly. Both the
 *          XR-rAF classifier (XRSessionProbe._sampleOnce) and the window-rAF
 *          classifier (FPSSampler._classifyState) now check isGrabbingVR()
 *          alongside the existing checks.
 *  1.0.8 — Touch-aware XR bucket classifier.
 *          v1.0.7 only checked vrGrabs.left/.right (Quest3 hand-tracking).
 *          On Android AR (dom-overlay touch), those flags never flip → all
 *          activity collapsed into 'idle'. Now also checks sb.isGrabbing()
 *          for any-platform handle grab, and FPSSampler._lastPointerMoveAt
 *          for touch/mouse drag (= rotation). grabCount.right also counts
 *          touch-grab transitions.
 *  1.0.7 — Phase 2: XRSessionProbe implemented.
 *          Polls xrSession at 500ms cadence to detect session start/end.
 *          During session, samples global `vrFps` (updated by renderXR at 1Hz
 *          in index.html) into idle / rotation (left grab) / deform (right grab)
 *          / postCut buckets. Records mode ('vr'/'ar'), environmentBlendMode,
 *          duration, grab transition count. Renders 'XR Sessions' MD section.
 *  1.0.6 — Track input route as 'inputMethod' field per objDropEvent
 *          ('folder-drop' | 'folder-pick' | 'zip-drop'). Listens for
 *          'obj-input-detected' CustomEvent (dispatched by index.html v280).
 *          Synthesizes a drop record on the folder-pick path (no native drop event).
 *  1.0.5 — Track ZIP unzip duration (Quest3 supports ZIP drop, not folder drop).
 *          Adds 'unzipDurationMs' field per objDropEvent + Tet-only column in MD.
 *          Listens for 'objzip-unzipped' CustomEvent dispatched by index.html v279.
 *  1.0.4 — Tet-gen FPS bucket isolation, dual preset capture, full reset semantics.
 */
(function() {
    'use strict';

    // Defense in depth: re-check URL param
    if (!new URLSearchParams(location.search).has('bench')) return;

    const BENCH_VERSION = '1.0.9';
    const BENCH_BOOT_AT = performance.now();

    // ============================================================
    // Cross-script lexical accessors
    //   index.html declares globals as `let gl, sb = null;` (line 710),
    //   `let xrSession`, `let vrFps`, `let vrGrabs`. `let` at top-level
    //   does NOT bind to window, but IS accessible by name across
    //   script blocks in the same realm. So we look them up by name,
    //   guarded by typeof to be safe in case names get renamed.
    // ============================================================
    function $sb()        { try { return (typeof sb        !== 'undefined') ? sb        : null; } catch { return null; } }
    function $gl()        { try { return (typeof gl        !== 'undefined') ? gl        : null; } catch { return null; } }
    function $xrSession() { try { return (typeof xrSession !== 'undefined') ? xrSession : null; } catch { return null; } }
    function $vrGrabs()   { try { return (typeof vrGrabs   !== 'undefined') ? vrGrabs   : null; } catch { return null; } }
    function $xrMode()    { try { return (typeof xrMode    !== 'undefined') ? xrMode    : null; } catch { return null; } }
    function $vrFps()     { try { return (typeof vrFps     !== 'undefined') ? vrFps     : null; } catch { return null; } }

    // ============================================================
    // Utility helpers
    // ============================================================
    function safeNum(x) { return Number.isFinite(x) ? x : null; }

    function statsOf(samples) {
        if (!samples || samples.length === 0) {
            return { count: 0, mean: null, median: null, std: null,
                     p01: null, p05: null, min: null, max: null };
        }
        const sorted = [...samples].sort((a, b) => a - b);
        const n = sorted.length;
        const sum = sorted.reduce((s, v) => s + v, 0);
        const mean = sum / n;
        const median = n % 2 === 0
            ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2
            : sorted[(n - 1) / 2];
        const variance = sorted.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
        const std = Math.sqrt(variance);
        const pickPct = (p) => sorted[Math.max(0, Math.min(n - 1, Math.floor(n * p)))];
        return {
            count: n,
            mean: +mean.toFixed(2),
            median: +median.toFixed(2),
            std: +std.toFixed(2),
            p01: +pickPct(0.01).toFixed(2),
            p05: +pickPct(0.05).toFixed(2),
            min: +sorted[0].toFixed(2),
            max: +sorted[n - 1].toFixed(2),
        };
    }

    function nowIso() { return new Date().toISOString(); }

    function copyToClipboard(text) {
        if (navigator.clipboard?.writeText) {
            return navigator.clipboard.writeText(text).then(() => true).catch(() => fallbackCopy(text));
        }
        return Promise.resolve(fallbackCopy(text));
    }
    function fallbackCopy(text) {
        try {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.left = '-9999px';
            document.body.appendChild(ta);
            ta.select();
            const ok = document.execCommand('copy');
            document.body.removeChild(ta);
            return ok;
        } catch (e) {
            console.warn('[Bench] clipboard fallback failed:', e);
            return false;
        }
    }

    // ============================================================
    // PlatformProbe
    // ============================================================
    const PlatformProbe = {
        data: {
            userAgent: navigator.userAgent,
            platformHint: 'unknown',
            os: 'unknown',
            browser: { name: 'unknown', version: 'unknown' },
            hardwareConcurrency: navigator.hardwareConcurrency ?? null,
            deviceMemoryGB: navigator.deviceMemory ?? null,
            screenW: screen.width,
            screenH: screen.height,
            devicePixelRatio: window.devicePixelRatio,
            webgl: { vendor: null, renderer: null, version: null, maxTextureSize: null },
            webxr: { supported: !!navigator.xr, vrSupported: null, arSupported: null },
            wasm: { simd: null, threads: null },
            connection: navigator.connection?.effectiveType ?? null,
            language: navigator.language,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
        async init() {
            const ua = navigator.userAgent;
            // Platform hint
            if (/OculusBrowser|Quest/i.test(ua)) this.data.platformHint = 'xr-vr';
            else if (/Mobi|Android/i.test(ua) && !/Tablet|iPad/i.test(ua)) this.data.platformHint = 'mobile';
            else if (/iPhone|iPod/i.test(ua)) this.data.platformHint = 'mobile';
            else this.data.platformHint = 'desktop';

            // OS
            if (/Windows NT/i.test(ua)) this.data.os = 'Windows';
            else if (/Android/i.test(ua)) this.data.os = 'Android';
            else if (/iPhone|iPad|iPod/i.test(ua)) this.data.os = 'iOS';
            else if (/Mac OS X/i.test(ua)) this.data.os = 'macOS';
            else if (/Linux/i.test(ua)) this.data.os = 'Linux';

            // Browser
            const browserMatch = ua.match(/(Edg|Chrome|Firefox|Safari|OculusBrowser)\/([\d.]+)/);
            if (browserMatch) {
                this.data.browser.name = browserMatch[1];
                this.data.browser.version = browserMatch[2];
            }
            // Safari hides Chrome from UA but contains both Safari/Chrome — already handled above by order.

            // WebXR support
            if (navigator.xr) {
                try { this.data.webxr.vrSupported = await navigator.xr.isSessionSupported('immersive-vr'); }
                catch { this.data.webxr.vrSupported = false; }
                try { this.data.webxr.arSupported = await navigator.xr.isSessionSupported('immersive-ar'); }
                catch { this.data.webxr.arSupported = false; }
            }

            // WASM features
            this.data.wasm.simd = (typeof WebAssembly !== 'undefined' &&
                WebAssembly.validate(new Uint8Array([0,97,115,109,1,0,0,0,1,5,1,96,0,1,123,3,2,1,0,10,10,1,8,0,65,0,253,15,253,98,11])));
            this.data.wasm.threads = (typeof SharedArrayBuffer !== 'undefined');

            // WebGL info — defer until gl exists (it's `let`, not on window)
            this._pollGL();
        },
        _pollGL(attempts = 0) {
            const gl = $gl();
            if (!gl) {
                if (attempts < 50) setTimeout(() => this._pollGL(attempts + 1), 100);
                return;
            }
            try {
                const dbg = gl.getExtension('WEBGL_debug_renderer_info');
                if (dbg) {
                    this.data.webgl.vendor = gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL);
                    this.data.webgl.renderer = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL);
                } else {
                    this.data.webgl.vendor = gl.getParameter(gl.VENDOR);
                    this.data.webgl.renderer = gl.getParameter(gl.RENDERER);
                }
                this.data.webgl.version = gl.getParameter(gl.VERSION);
                this.data.webgl.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
            } catch (e) {
                console.warn('[Bench] WebGL probe failed:', e);
            }
        },
    };

    // ============================================================
    // LoadTimeTracker
    // ============================================================
    const LoadTimeTracker = {
        initialLoad: {
            navStart: 0,
            domContentLoaded: null,
            benchLoaded: BENCH_BOOT_AT,
            wasmReady: null,
            sbCreated: null,
            firstInteractable: null,
        },
        objDropEvents: [],   // {dropAt, tetCompleteAt, simReadyAt, durationMs, presetAtDrop, simTetsAfter, visTetsAfter, unzipDurationMs, inputMethod}
        _currentDrop: null,  // pending drop in progress
        _origConsoleLog: null,
        _renderFramesAfterSb: 0,
        // v1.0.5: ZIP unzip duration captured asynchronously from 'objzip-unzipped' event
        _pendingUnzipMs: null,

        init() {
            // navStart from PerformanceNavigationTiming if available
            const nav = performance.getEntriesByType('navigation')[0];
            this.initialLoad.navStart = nav ? 0 : 0;  // by definition relative

            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', () => {
                    this.initialLoad.domContentLoaded = performance.now();
                });
            } else {
                this.initialLoad.domContentLoaded = performance.now();
            }

            // Wrap Module.onRuntimeInitialized — the existing handler is already set
            // We poll for window.Module and wrap once.
            this._pollWasmReady();

            // Wrap console.log to detect "[TET] Simulation restarted."
            this._origConsoleLog = console.log.bind(console);
            const self = this;
            console.log = function(...args) {
                if (typeof args[0] === 'string' && args[0].includes('[TET] Simulation restarted')) {
                    self._onTetComplete();
                }
                return self._origConsoleLog.apply(console, args);
            };

            // Drop event listener (capture phase, do not interfere)
            document.addEventListener('drop', (e) => {
                this._onDrop(e);
            }, true);

            // v1.0.5: ZIP unzip event from index.html — fired after drop, before tet化
            document.addEventListener('objzip-unzipped', (e) => {
                const ms = e.detail?.durationMs;
                if (typeof ms !== 'number') return;
                if (this._currentDrop) {
                    // Add to existing (multi-zip case: accumulate)
                    this._currentDrop.unzipDurationMs =
                        (this._currentDrop.unzipDurationMs ?? 0) + ms;
                } else {
                    // No drop in flight (shouldn't happen, but stash for safety)
                    this._pendingUnzipMs = (this._pendingUnzipMs ?? 0) + ms;
                }
            });

            // v1.0.6: input method classification from index.html (handleFiles entry).
            //   - drop path: native drop fired first → fill inputMethod on existing _currentDrop
            //   - pick path: no native drop event → synthesize a drop record
            document.addEventListener('obj-input-detected', (e) => {
                const d = e.detail || {};
                if (this._currentDrop) {
                    this._currentDrop.inputMethod = d.method ?? 'unknown';
                } else {
                    this._startDrop({
                        dropAt: typeof d.ts === 'number' ? d.ts : performance.now(),
                        inputMethod: d.method ?? 'unknown',
                    });
                }
            });

            // Poll sb for first creation (sb is `let`, not on window)
            this._pollSb();
        },

        _pollWasmReady(attempts = 0) {
            // We can't easily detect when onRuntimeInitialized fires without wrapping.
            // Instead, poll for window._wasmRuntimeReady (set by index.html).
            if (window._wasmRuntimeReady) {
                if (this.initialLoad.wasmReady === null) {
                    this.initialLoad.wasmReady = performance.now();
                }
                return;
            }
            if (attempts < 200) setTimeout(() => this._pollWasmReady(attempts + 1), 50);
        },

        _pollSb(attempts = 0) {
            if ($sb() && this.initialLoad.sbCreated === null) {
                this.initialLoad.sbCreated = performance.now();
                this._countRenderFramesAfterSb();
                return;
            }
            // sb not yet — keep polling
            if (attempts < 600) setTimeout(() => this._pollSb(attempts + 1), 100);
        },

        _countRenderFramesAfterSb() {
            // Count 10 rAF after sb creation as "first interactable".
            const tick = () => {
                this._renderFramesAfterSb++;
                if (this._renderFramesAfterSb >= 10) {
                    this.initialLoad.firstInteractable = performance.now();
                    return;
                }
                requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
        },

        // v1.0.6: factored out of _onDrop so the folder-pick path
        //         (no native drop event) can synthesize a drop record too.
        _startDrop({ dropAt, inputMethod }) {
            const ts = window.TetPreset?.getCurrentValues?.();
            this._currentDrop = {
                dropAt,
                tetCompleteAt: null,
                simReadyAt: null,
                durationMs: null,
                presetAtDrop: ts?.preset ?? 'unknown',
                gridValuesAtDrop: ts?.values ?? null,
                // v1.0.4: filled at TET complete (= what was actually used for tet化)
                presetAtTetGen: null,
                gridValuesAtTetGen: null,
                simTetsAfter: null,
                visTetsAfter: null,
                // v1.0.5: ZIP unzip cost (null for non-ZIP drops; isolated from tet化 wall-clock)
                unzipDurationMs: this._pendingUnzipMs,
                // v1.0.6: 'folder-drop' | 'folder-pick' | 'zip-drop' | null
                //         (null = native drop fired but obj-input-detected hasn't classified yet,
                //          or the drop is non-OBJ noise that won't reach handleFiles)
                inputMethod: inputMethod ?? null,
            };
            this._pendingUnzipMs = null;
            // v1.0.4: mark tet 化 window for FPS bucket isolation
            FPSSampler.beginTetGen();
        },

        _onDrop(e) {
            // Native drag-drop event. inputMethod is filled in later by 'obj-input-detected'
            // (which fires from handleFiles, after extension classification).
            this._startDrop({ dropAt: performance.now(), inputMethod: null });
        },

        _onTetComplete() {
            if (!this._currentDrop) {
                // No drop tracked (could be initial load or programmatic) — still end tetGen
                FPSSampler.endTetGen();
                return;
            }
            this._currentDrop.tetCompleteAt = performance.now();
            this._currentDrop.durationMs = this._currentDrop.tetCompleteAt - this._currentDrop.dropAt;

            // v1.0.4: capture preset state AT TET COMPLETE (= what was actually used)
            try {
                const ts2 = window.TetPreset?.getCurrentValues?.();
                if (ts2) {
                    this._currentDrop.presetAtTetGen = ts2.preset;
                    this._currentDrop.gridValuesAtTetGen = ts2.values;
                }
            } catch {}

            // Wait a few rAF for new sb, then snapshot tet counts
            const drop = this._currentDrop;
            this._currentDrop = null;
            const start = performance.now();
            const tick = () => {
                const sb = $sb();
                if (sb) {
                    drop.simReadyAt = performance.now();
                    try {
                        drop.simTetsAfter = sb.getNumLowResTets?.() ?? null;
                        drop.visTetsAfter = sb.getNumHighResTets?.() ?? null;
                    } catch {}
                    LoadTimeTracker.objDropEvents.push(drop);
                    // v1.0.4: end tetGen window (with one extra rAF to swallow final stabilization frame)
                    requestAnimationFrame(() => FPSSampler.endTetGen());
                    return;
                }
                if (performance.now() - start > 5000) {
                    LoadTimeTracker.objDropEvents.push(drop);  // record anyway
                    FPSSampler.endTetGen();
                    return;
                }
                requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
        },

        // v1.0.4: Reset Samples 拡張用
        reset() {
            this.objDropEvents = [];
            this._currentDrop = null;
            // initialLoad は保持 (起動時のデータは消さない)
        },
    };

    // ============================================================
    // FPSSampler — independent rAF loop, 4-bucket classification
    // ============================================================
    const FPSSampler = {
        buckets: {
            idle:     { samples: [] },
            rotation: { samples: [] },
            deform:   { samples: [] },
            postCut:  { samples: [] },
            tetGen:   { samples: [] },     // v1.0.4: tet 化中 jank を分離
        },
        frameTimes: [],            // ring buffer
        _maxFrameTimes: 3000,
        currentBucket: 'idle',
        _lastFrameTime: null,
        _lastFpsAt: null,
        _frameCountInWindow: 0,
        _started: false,
        _lastPointerMoveAt: 0,
        _lastCutAt: 0,
        _inTetGen: false,         // v1.0.4: drop event ~ TET complete の窓で true

        start() {
            if (this._started) return;
            this._started = true;

            // Track pointer movement for "rotation" detection
            window.addEventListener('pointermove', () => {
                this._lastPointerMoveAt = performance.now();
            }, { passive: true, capture: true });

            // Begin loop
            this._lastFrameTime = performance.now();
            this._lastFpsAt = this._lastFrameTime;
            requestAnimationFrame((t) => this._tick(t));
        },

        notifyCut() {
            this._lastCutAt = performance.now();
        },

        // v1.0.4: tet 化中マーカー (LoadTimeTracker から呼ばれる)
        beginTetGen() { this._inTetGen = true; },
        endTetGen()   {
            // 終了直後に sample 境界をリセット (in-progress count を tetGen に閉じ込める)
            this._inTetGen = false;
            this._lastFpsAt = performance.now();
            this._frameCountInWindow = 0;
        },

        _tick(t) {
            const now = t || performance.now();
            const dt = now - this._lastFrameTime;
            this._lastFrameTime = now;
            this._frameCountInWindow++;

            if (Number.isFinite(dt) && dt > 0) {
                this.frameTimes.push(dt);
                if (this.frameTimes.length > this._maxFrameTimes) this.frameTimes.shift();
            }

            // Classify state
            this.currentBucket = this._classifyState(now);

            // Per-second FPS sample
            if (now - this._lastFpsAt >= 1000) {
                const fps = this._frameCountInWindow / ((now - this._lastFpsAt) / 1000);
                const bucket = this.buckets[this.currentBucket];
                if (bucket) bucket.samples.push(+fps.toFixed(2));
                this._lastFpsAt = now;
                this._frameCountInWindow = 0;
            }

            requestAnimationFrame((t2) => this._tick(t2));
        },

        _classifyState(now) {
            // v1.0.4: tetGen を最優先 (drop ~ TET complete 中の jank を idle/rotation に汚染させない)
            if (this._inTetGen) return 'tetGen';
            // Priority order:
            // 1. XR session + active vrGrabs (Quest3 controller/hand-tracking) → deform
            // 2. sb.isGrabbing() OR sb.isGrabbingVR() → deform
            //    v1.0.9: added isGrabbingVR() — Android AR / Quest3 hand-tracking
            //    use startGrabVR/isGrabbingVR pair; vrGrabs may not be synced
            //    on Android AR (no controller handler), so isGrabbingVR() is the
            //    only reliable signal there.
            // 3. recent cut (<500ms) → postCut
            // 4. recent pointermove (<500ms) → rotation
            // 5. else → idle
            try {
                if ($xrSession()) {
                    const grabs = $vrGrabs();
                    if (grabs && (grabs.left?.active || grabs.right?.active)) return 'deform';
                }
                const sbRef = $sb();
                if (sbRef?.isGrabbing?.())   return 'deform';
                if (sbRef?.isGrabbingVR?.()) return 'deform';
                if (now - this._lastCutAt < 500) return 'postCut';
                if (now - this._lastPointerMoveAt < 500) {
                    // exclude pointermove during cut placement (cutMode + pointer down)
                    // simple heuristic: if cutMode true, pointermove may be cutter rotation,
                    // still count as rotation since 1-finger drag rotates either cutter or scene
                    return 'rotation';
                }
            } catch {}
            return 'idle';
        },

        reset() {
            for (const b of Object.values(this.buckets)) b.samples = [];
            this.frameTimes = [];
            this._frameCountInWindow = 0;
            this._lastFpsAt = performance.now();
        },

        report() {
            const out = { buckets: {}, overall: null };
            const allSamples = [];
            for (const [name, b] of Object.entries(this.buckets)) {
                out.buckets[name] = { ...statsOf(b.samples), samples: b.samples.slice() };
                allSamples.push(...b.samples);
            }
            out.overall = statsOf(allSamples);
            return out;
        },
    };

    // ============================================================
    // InteractionLogger — wrap 4 cut methods on sb
    // ============================================================
    const InteractionLogger = {
        cuts: [],                    // all cut records
        _lastWrappedSb: null,
        _pendingFragment: null,      // stage-A buffer for segment-fragment

        init() {
            // Poll sb and re-wrap when sb identity changes (after OBJ drop -> new sb)
            this._poll();
        },

        _poll() {
            const sb = $sb();
            if (sb && sb !== this._lastWrappedSb) {
                this._wrap(sb);
                this._lastWrappedSb = sb;
            }
            setTimeout(() => this._poll(), 200);
        },

        _wrap(sb) {
            const self = this;
            const origCut  = sb.executeCut?.bind(sb);
            const origCh   = sb.executeChildCut?.bind(sb);
            const origSeg  = sb.executeSegmentCut?.bind(sb);
            const origComp = sb.completePendingCut?.bind(sb);
            if (!origCut || !origCh || !origSeg || !origComp) {
                console.warn('[Bench] sb missing one of the cut methods, skip wrap');
                return;
            }

            sb.executeCut = function() {
                const t0 = performance.now();
                const before = self._safeTets(sb);
                const count = origCut();
                const t1 = performance.now();
                const after = self._safeTets(sb);
                self._record('liver-free', { t0, t1, count, before, after });
                FPSSampler.notifyCut();
                return count;
            };

            sb.executeChildCut = function(ci) {
                const t0 = performance.now();
                const before = self._safeTets(sb);
                const count = origCh(ci);
                const t1 = performance.now();
                const after = self._safeTets(sb);
                self._record('child-free', { t0, t1, count, before, after, childIndex: ci });
                FPSSampler.notifyCut();
                return count;
            };

            sb.executeSegmentCut = function(mode) {
                const t0 = performance.now();
                const before = self._safeTets(sb);
                const count = origSeg(mode);
                const t1 = performance.now();
                const after = self._safeTets(sb);

                if (count === -1) {
                    // Fragment selection pending — store stage A for later pairing
                    self._pendingFragment = {
                        stageA: { t0, t1, computeMs: +(t1 - t0).toFixed(2) },
                        simTetsBefore: before,
                        pendingAt: t1,
                        bucketAtCut: FPSSampler.currentBucket,
                    };
                } else {
                    self._record('segment', { t0, t1, count, before, after });
                }
                FPSSampler.notifyCut();
                return count;
            };

            sb.completePendingCut = function(rank) {
                const t0 = performance.now();
                const before = self._safeTets(sb);
                const count = origComp(rank);
                const t1 = performance.now();
                const after = self._safeTets(sb);

                if (self._pendingFragment) {
                    const rec = self._pendingFragment;
                    self._pendingFragment = null;
                    const record = {
                        target: 'segment-fragment',
                        stageA: rec.stageA,
                        fragmentPendingMs: +(t0 - rec.pendingAt).toFixed(2),
                        stageB: { t0, t1, t3: null, computeMs: +(t1 - t0).toFixed(2), displayMs: null },
                        tetsCut: count,
                        simTetsBefore: rec.simTetsBefore,
                        simTetsAfter: after,
                        bucketAtCut: rec.bucketAtCut,
                        fragmentRank: rank,
                    };
                    self.cuts.push(record);
                    requestAnimationFrame(() => {
                        record.stageB.t3 = performance.now();
                        record.stageB.displayMs = +(record.stageB.t3 - record.stageB.t0).toFixed(2);
                    });
                } else {
                    // Orphan completePending (e.g., after cancel) — record as best-effort
                    self._record('segment-fragment-orphan', { t0, t1, count, before, after, fragmentRank: rank });
                }
                FPSSampler.notifyCut();
                return count;
            };

            console.log('[Bench] sb cut methods wrapped');
        },

        _safeTets(sb) {
            try { return sb.getNumLowResTets?.() ?? null; } catch { return null; }
        },

        _record(target, { t0, t1, count, before, after, childIndex, fragmentRank }) {
            const record = {
                target,
                t0, t1, t3: null,
                computeMs: +(t1 - t0).toFixed(2),
                displayMs: null,
                tetsCut: count,
                simTetsBefore: before,
                simTetsAfter: after,
                bucketAtCut: FPSSampler.currentBucket,
                childIndex: childIndex ?? null,
                fragmentRank: fragmentRank ?? null,
            };
            this.cuts.push(record);
            requestAnimationFrame(() => {
                record.t3 = performance.now();
                record.displayMs = +(record.t3 - record.t0).toFixed(2);
            });
        },

        reset() {
            this.cuts = [];
            this._pendingFragment = null;
        },

        report() {
            const cuts = this.cuts.slice();
            const byTarget = {};
            for (const c of cuts) {
                const k = c.target;
                if (!byTarget[k]) byTarget[k] = { count: 0, computeMs: [], displayMs: [] };
                byTarget[k].count++;
                if (c.target === 'segment-fragment') {
                    byTarget[k].computeMs.push(c.stageA.computeMs + (c.stageB.computeMs ?? 0));
                    if (c.stageB.displayMs != null) byTarget[k].displayMs.push(c.stageB.displayMs);
                } else {
                    if (c.computeMs != null) byTarget[k].computeMs.push(c.computeMs);
                    if (c.displayMs != null) byTarget[k].displayMs.push(c.displayMs);
                }
            }
            const summary = { byTarget: {} };
            for (const [k, v] of Object.entries(byTarget)) {
                summary.byTarget[k] = {
                    count: v.count,
                    computeMs: statsOf(v.computeMs),
                    displayMs: statsOf(v.displayMs),
                };
            }
            return { cuts, summary };
        },
    };

    // ============================================================
    // XRSessionProbe — Phase 2 implementation
    //   - Polls xrSession (let, accessed via $xrSession()) at 500ms.
    //   - On session start: records mode + environmentBlendMode + startAt.
    //     Starts 1Hz sampling of global vrFps (computed by renderXR loop in
    //     index.html). First 1500ms skipped so vrFps is fresh.
    //   - Bucket classification per sample:
    //       deform   = right hand grab active (mesh manipulation)
    //       rotation = left hand grab active  (model translate/rotate)
    //       postCut  = within 1000ms after a cut (uses FPSSampler._lastCutAt)
    //       idle     = none of the above
    //   - On session end: finalize stats, push to sessions[].
    // ============================================================
    const XRSessionProbe = {
        sessions: [],          // completed sessions
        activeSession: null,   // current in-flight session (internal form)
        _pollTimer: null,
        _sampleTimer: null,

        init() {
            this._poll();
        },

        _poll() {
            try {
                const xs = $xrSession();
                if (xs && !this.activeSession)        this._onSessionStart(xs);
                else if (!xs && this.activeSession)   this._onSessionEnd();
            } catch (e) { console.warn('[Bench] XR poll error:', e); }
            this._pollTimer = setTimeout(() => this._poll(), 500);
        },

        _onSessionStart(xs) {
            const startAt = performance.now();
            const mode = $xrMode() || 'unknown';   // 'vr' | 'ar' | 'unknown'
            let blendMode = null;
            try { blendMode = xs.environmentBlendMode || null; } catch {}

            this.activeSession = {
                mode,
                blendMode,                          // 'opaque' (VR) / 'alpha-blend' / 'additive' (AR)
                startAt,
                startIso: nowIso(),
                _samplingStartAt: startAt + 1500,   // wait for renderXR to populate vrFps
                endAt: null,
                durationMs: null,
                buckets: {
                    idle:     { samples: [] },
                    rotation: { samples: [] },   // left grab
                    deform:   { samples: [] },   // right grab
                    postCut:  { samples: [] },
                },
                grabCount: { left: 0, right: 0 },
                _grabPrev: { left: false, right: false },
                fpsRaw: [],                       // [{tMs, fps, bucket}] raw 1Hz trace for forensics
            };

            // Backup notification path (in case polling misses the transition)
            try { xs.addEventListener('end', () => this._onSessionEnd()); } catch {}

            this._startSampling();
            console.log('[Bench] XR session started:', mode, 'blend:', blendMode);
        },

        _startSampling() {
            clearTimeout(this._sampleTimer);
            const tick = () => {
                if (!this.activeSession) return;
                try { this._sampleOnce(); }
                catch (e) { console.warn('[Bench] XR sample error:', e); }
                this._sampleTimer = setTimeout(tick, 1000);
            };
            this._sampleTimer = setTimeout(tick, 1000);
        },

        _sampleOnce() {
            const s = this.activeSession;
            if (!s) return;
            const now = performance.now();
            if (now < s._samplingStartAt) return;       // vrFps not yet fresh

            const fpsRaw = $vrFps();
            const fps = (fpsRaw != null && Number.isFinite(+fpsRaw) && +fpsRaw > 0) ? +fpsRaw : null;
            if (fps == null) return;

            // ---- input signals ----
            // Quest3 hand-tracking (controller / hand-tracking sets vrGrabs flags)
            const grabs = $vrGrabs();
            const rightActive = !!(grabs && grabs.right && grabs.right.active);
            const leftActive  = !!(grabs && grabs.left  && grabs.left.active);
            // Cross-platform handle grab.
            // - sb.isGrabbing()   = desktop mouse variant (startGrab/endGrab pair).
            // - sb.isGrabbingVR() = VR variant (startGrabVR/endGrabVR pair) — used
            //   by BOTH Quest3 hand-tracking AND Android AR dom-overlay touch.
            // On Android AR, vrGrabs.right.active is never set (only Quest3
            // controller handlers sync vrGrabs to isGrabbingVR), so checking
            // isGrabbingVR() directly is the only reliable signal there.
            const sbRef = $sb();
            let sbGrabbing = false, sbGrabbingVR = false;
            try { sbGrabbing   = !!(sbRef?.isGrabbing?.());   } catch {}
            try { sbGrabbingVR = !!(sbRef?.isGrabbingVR?.()); } catch {}
            // Touch/mouse pointermove within last 500ms (= dragging = rotation, when
            // not also grabbing a handle). pointermove fires for touch on dom-overlay
            // AR canvas as well, so this works on Android AR.
            const recentMove = (now - FPSSampler._lastPointerMoveAt) < 500;
            const recentCut  = (now - FPSSampler._lastCutAt)         < 1000;

            // ---- bucket classification ----
            // Priority: deform (any grab) > rotation > postCut > idle.
            // Deform comes first because if a handle is grabbed AND the user is
            // dragging it, the underlying cost is dominated by mesh deformation,
            // not by view rotation.
            const anyGrab = rightActive || sbGrabbing || sbGrabbingVR;
            let bucket;
            if (anyGrab)         bucket = 'deform';
            else if (leftActive) bucket = 'rotation';
            else if (recentMove) bucket = 'rotation';
            else if (recentCut)  bucket = 'postCut';
            else                 bucket = 'idle';

            s.buckets[bucket].samples.push(+fps.toFixed(2));
            s.fpsRaw.push({ tMs: +(now - s.startAt).toFixed(0), fps: +fps.toFixed(2), bucket });

            // ---- grab transition counting ----
            // grabCount.right covers Quest3 right-hand + desktop mouse grab +
            // Android AR / Quest3 hand-tracking touch-grab (anyGrab from above).
            const prev = s._grabPrev;
            if (leftActive && !prev.left)   s.grabCount.left++;
            if (anyGrab    && !prev.right)  s.grabCount.right++;
            prev.left  = leftActive;
            prev.right = anyGrab;
        },

        _onSessionEnd() {
            if (!this.activeSession) return;
            const s = this.activeSession;
            s.endAt = performance.now();
            s.durationMs = +(s.endAt - s.startAt).toFixed(0);

            const fps = {};
            const all = [];
            for (const [name, b] of Object.entries(s.buckets)) {
                fps[name] = { ...statsOf(b.samples), samples: b.samples.slice() };
                for (const v of b.samples) all.push(v);
            }
            fps.overall = statsOf(all);
            s.fps = fps;

            // strip internal mutable state before publishing
            delete s._grabPrev;
            delete s._samplingStartAt;
            delete s.buckets;

            this.sessions.push(s);
            this.activeSession = null;
            clearTimeout(this._sampleTimer);
            this._sampleTimer = null;
            console.log('[Bench] XR session ended.', s.mode, 'duration:', s.durationMs, 'ms',
                'samples:', { idle: fps.idle.count, rot: fps.rotation.count,
                              def: fps.deform.count, cut: fps.postCut.count });
        },

        report() {
            // Snapshot active session (without finalizing) for live preview
            let active = null;
            if (this.activeSession) {
                const s = this.activeSession;
                const buckets = {};
                const all = [];
                for (const [name, b] of Object.entries(s.buckets)) {
                    buckets[name] = statsOf(b.samples);
                    for (const v of b.samples) all.push(v);
                }
                active = {
                    mode: s.mode,
                    blendMode: s.blendMode,
                    startIso: s.startIso,
                    elapsedMs: +(performance.now() - s.startAt).toFixed(0),
                    grabCount: { ...s.grabCount },
                    fpsLive: { buckets, overall: statsOf(all) },
                };
            }
            return { sessions: this.sessions.slice(), activeSession: active };
        },

        reset() {
            // Wipe completed sessions; keep any in-progress session intact so
            // the user can't accidentally lose an active recording.
            this.sessions = [];
        },
    };

    // ============================================================
    // MemorySampler — Phase 3 stub
    // ============================================================
    const MemorySampler = {
        jsHeap: { samples: [], peakUsed: 0 },
        wasmHeap: { samples: [], peakSize: 0 },
        init() {
            // TODO Phase 3: 2-second polling of performance.memory and
            // Module.HEAPU8.length, push samples, track peaks.
        },
        report() {
            return {
                jsHeap: { peakUsed: this.jsHeap.peakUsed, samples: this.jsHeap.samples.slice() },
                wasmHeap: { peakSize: this.wasmHeap.peakSize, samples: this.wasmHeap.samples.slice() },
            };
        },
        reset() {
            this.jsHeap = { samples: [], peakUsed: 0 };
            this.wasmHeap = { samples: [], peakSize: 0 };
        },
    };

    // ============================================================
    // ReportRenderer
    // ============================================================
    const ReportRenderer = {
        build() {
            const sb = $sb();
            // v1.0.1: distinguish baked-default model from OBJ-dropped model.
            // v1.0.4: For OBJ-drop case, use the LAST drop's presetAtTetGen as the source of truth
            //         (= preset actually used to generate the live tets). Slider state is just
            //         the current state which may have been changed AFTER tet化.
            const drops = LoadTimeTracker.objDropEvents;
            const usingPrebaked = drops.length === 0;
            const lastDrop = drops.length > 0 ? drops[drops.length - 1] : null;
            let sliderState = null;
            try {
                const ts = window.TetPreset?.getCurrentValues?.();
                if (ts) sliderState = { preset: ts.preset, values: ts.values };
            } catch {}

            let modelPreset, modelGrid;
            if (usingPrebaked) {
                modelPreset = 'pre-baked-default';
                modelGrid = null;
            } else if (lastDrop?.presetAtTetGen) {
                // The actual preset used at last tet化
                modelPreset = lastDrop.presetAtTetGen;
                modelGrid = lastDrop.gridValuesAtTetGen ?? sliderState?.values ?? null;
            } else {
                // Fallback: live slider state (may not match generated tets)
                modelPreset = sliderState?.preset ?? 'unknown';
                modelGrid = sliderState?.values ?? null;
            }

            let model = {
                preset: modelPreset,
                gridValues: modelGrid,
                sliderState,    // current slider state (may differ if user moved sliders after tet化)
                source: usingPrebaked ? 'pre-baked' : 'obj-drop',
                simTets: null,
                visualTets: null,
                surfaceTris: null,
                lowResParticles: null,
                children: null,
                skeletonAnalyzed: null,
                sampledAt: nowIso(),
            };
            if (sb) {
                try {
                    model.simTets       = sb.getNumLowResTets?.() ?? null;
                    model.visualTets    = sb.getNumHighResTets?.() ?? null;
                    model.surfaceTris   = sb.getNumHighResSurfaceTriIdsAfterCut?.() != null
                                          ? Math.floor(sb.getNumHighResSurfaceTriIdsAfterCut() / 3) : null;
                    model.lowResParticles = sb.getNumLowResParticles?.() ?? null;
                    model.children      = sb.getNumChildren?.() ?? null;
                    model.skeletonAnalyzed = sb.isSkeletonAnalyzed?.() ?? null;
                } catch {}
            }

            return {
                bench: {
                    version: BENCH_VERSION,
                    reportGeneratedAt: nowIso(),
                    runDurationMs: +(performance.now() - BENCH_BOOT_AT).toFixed(0),
                },
                platform: PlatformProbe.data,
                loadTime: {
                    initial: { ...LoadTimeTracker.initialLoad },
                    objDrops: LoadTimeTracker.objDropEvents.slice(),
                },
                model,
                fps: FPSSampler.report(),
                interaction: InteractionLogger.report(),
                xr: XRSessionProbe.report(),
                memory: MemorySampler.report(),
            };
        },

        toJSON(report) {
            return JSON.stringify(report, null, 2);
        },

        toMarkdown(report) {
            const p = report.platform;
            const m = report.model;
            const lt = report.loadTime;
            const fps = report.fps;
            const iter = report.interaction;

            const fmt = (v, suffix = '') => v == null ? '—' : v + suffix;
            const fmtMs = (v) => v == null ? '—' : (v.toFixed ? v.toFixed(0) : v) + ' ms';
            const fmtBucket = (b) =>
                `| ${b.count} | ${fmt(b.mean)} | ${fmt(b.median)} | ${fmt(b.std)} | ${fmt(b.p01)} | ${fmt(b.p05)} | ${fmt(b.min)} | ${fmt(b.max)} |`;

            const lines = [];
            lines.push('## LiverSurgerySimWeb Benchmark Report');
            lines.push('');
            lines.push(`**Generated**: ${report.bench.reportGeneratedAt}`);
            const dur = report.bench.runDurationMs / 1000;
            lines.push(`**Run duration**: ${(dur / 60 | 0)}:${(dur % 60).toFixed(0).padStart(2, '0')}`);
            lines.push(`**Bench version**: ${report.bench.version}`);
            lines.push('');

            lines.push('### Platform');
            lines.push('| Field | Value |');
            lines.push('|---|---|');
            lines.push(`| UserAgent | ${p.browser.name} ${p.browser.version} / ${p.os} |`);
            lines.push(`| Platform hint | ${p.platformHint} |`);
            lines.push(`| GPU | ${p.webgl.renderer ?? '—'} |`);
            lines.push(`| GPU vendor | ${p.webgl.vendor ?? '—'} |`);
            lines.push(`| WebGL version | ${p.webgl.version ?? '—'} |`);
            lines.push(`| CPU threads | ${fmt(p.hardwareConcurrency)} |`);
            lines.push(`| Device memory | ${fmt(p.deviceMemoryGB, ' GB')} |`);
            lines.push(`| Screen | ${p.screenW}x${p.screenH} @ DPR ${p.devicePixelRatio} |`);
            lines.push(`| WebXR | VR: ${p.webxr.vrSupported ? '✓' : '✗'} / AR: ${p.webxr.arSupported ? '✓' : '✗'} |`);
            lines.push(`| WASM SIMD | ${p.wasm.simd ? '✓' : '✗'} |`);
            lines.push(`| WASM threads | ${p.wasm.threads ? '✓' : '✗'} |`);
            lines.push(`| Connection | ${fmt(p.connection)} |`);
            lines.push(`| Language | ${p.language} |`);
            lines.push(`| Timezone | ${p.timezone} |`);
            lines.push('');

            lines.push('### Model');
            lines.push('| Field | Value |');
            lines.push('|---|---|');
            if (m.source === 'pre-baked') {
                lines.push(`| Source | **Pre-baked default** (build-time tet, sliders ignored) |`);
                lines.push(`| Preset | _N/A — drop OBJ folder to enable presets_ |`);
                if (m.sliderState) {
                    lines.push(`| Slider state (informational only) | ${m.sliderState.preset.toUpperCase()} (liver ${m.sliderState.values['gs-liver-low']}/${m.sliderState.values['gs-liver-high']}, vessel ${m.sliderState.values['gs-vessel-low']}/${m.sliderState.values['gs-vessel-high']}, skel ${m.sliderState.values['gs-skeleton']}) |`);
                }
            } else {
                lines.push(`| Source | OBJ-drop (slider values applied at tet generation) |`);
                lines.push(`| Preset | ${m.preset.toUpperCase()} |`);
                if (m.gridValues) {
                    lines.push(`| Grid (liver) | low ${m.gridValues['gs-liver-low']} / high ${m.gridValues['gs-liver-high']} |`);
                    lines.push(`| Grid (vessel) | low ${m.gridValues['gs-vessel-low']} / high ${m.gridValues['gs-vessel-high']} |`);
                    lines.push(`| Grid (skeleton) | ${m.gridValues['gs-skeleton']} |`);
                }
            }
            lines.push(`| Sim tets (low-res) | ${fmt(m.simTets)} |`);
            lines.push(`| Visual tets (high-res) | ${fmt(m.visualTets)} |`);
            lines.push(`| Surface triangles | ${fmt(m.surfaceTris)} |`);
            lines.push(`| Low-res particles | ${fmt(m.lowResParticles)} |`);
            lines.push(`| Child meshes | ${fmt(m.children)} |`);
            lines.push(`| Skeleton analyzed | ${m.skeletonAnalyzed ? '✓' : '✗'} |`);
            lines.push('');

            lines.push('### Initial load (ms from bench boot)');
            lines.push('| Milestone | Value |');
            lines.push('|---|---|');
            lines.push(`| DOMContentLoaded | ${fmtMs(lt.initial.domContentLoaded)} |`);
            lines.push(`| WASM ready | ${fmtMs(lt.initial.wasmReady)} |`);
            lines.push(`| SB created | ${fmtMs(lt.initial.sbCreated)} |`);
            lines.push(`| First interactable | ${fmtMs(lt.initial.firstInteractable)} |`);
            lines.push('');

            lines.push(`### OBJ drop history (n=${lt.objDrops.length})`);
            if (lt.objDrops.length === 0) {
                lines.push('_No OBJ drops yet._');
            } else {
                // v1.0.5: Unzip ms shown as a separate column (— for non-ZIP drops).
                //          Tet-only ms = drop→tet complete minus unzip (if any).
                // v1.0.6: Input column captures route ('folder-drop' / 'folder-pick' / 'zip-drop').
                lines.push('| # | Preset (used) | Input | Drop → Tet complete (ms) | Unzip (ms) | Tet only (ms) | Sim tets after | Visual tets after |');
                lines.push('|---|---|---|---|---|---|---|---|');
                lt.objDrops.forEach((d, i) => {
                    // v1.0.4: prefer preset captured at TET complete (= actually used). If different
                    //          from drop-event preset (= user changed in modal), surface as "(intended: X)"
                    const used   = d.presetAtTetGen ?? d.presetAtDrop ?? null;
                    const intent = d.presetAtDrop ?? null;
                    let presetCell = used ? used.toUpperCase() : '—';
                    if (used && intent && used !== intent) {
                        presetCell += ` (intended: ${intent.toUpperCase()})`;
                    }
                    const tetOnly = (d.durationMs != null && d.unzipDurationMs != null)
                        ? d.durationMs - d.unzipDurationMs
                        : (d.durationMs != null ? d.durationMs : null);
                    const input = d.inputMethod ?? '—';
                    lines.push(`| ${i + 1} | ${presetCell} | ${input} | ${fmtMs(d.durationMs)} | ${fmtMs(d.unzipDurationMs)} | ${fmtMs(tetOnly)} | ${fmt(d.simTetsAfter)} | ${fmt(d.visTetsAfter)} |`);
                });
            }
            lines.push('');

            lines.push('### FPS (per-second samples, by state)');
            lines.push('| State | n | Mean | Median | Std | 1%L | 5%L | Min | Max |');
            lines.push('|---|---|---|---|---|---|---|---|---|');
            lines.push(`| idle | ${fmtBucket(fps.buckets.idle).slice(2)}`);
            lines.push(`| rotation | ${fmtBucket(fps.buckets.rotation).slice(2)}`);
            lines.push(`| deform | ${fmtBucket(fps.buckets.deform).slice(2)}`);
            lines.push(`| post-cut | ${fmtBucket(fps.buckets.postCut).slice(2)}`);
            lines.push(`| **overall** | ${fmtBucket(fps.overall).slice(2)}`);
            lines.push('');

            lines.push('### Cut operations');
            const targets = Object.keys(iter.summary.byTarget);
            if (targets.length === 0) {
                lines.push('_No cuts recorded._');
            } else {
                lines.push('| target | n | compute ms (mean±std) | display ms (mean±std) |');
                lines.push('|---|---|---|---|');
                for (const t of targets) {
                    const s = iter.summary.byTarget[t];
                    const c = s.computeMs;
                    const d = s.displayMs;
                    const cStr = c.count > 0 ? `${c.mean} ± ${c.std}` : '—';
                    const dStr = d.count > 0 ? `${d.mean} ± ${d.std}` : '—';
                    lines.push(`| ${t} | ${s.count} | ${cStr} | ${dStr} |`);
                }
            }
            lines.push('');

            lines.push('### Memory (Phase 3 — stub)');
            lines.push('_Not implemented in Phase 1._');
            lines.push('');

            // ---- XR Sessions (Phase 2 / v1.0.7) ----
            const xr = report.xr;
            const xrSess = xr.sessions || [];
            lines.push(`### XR Sessions (n=${xrSess.length})`);
            if (xrSess.length === 0 && !xr.activeSession) {
                lines.push('_No XR session recorded. Enter VR/AR via the in-app button to capture._');
            } else {
                lines.push('| # | Mode | Blend | Duration | idle FPS (mean/min) | rot FPS (mean/min) | deform FPS (mean/min) | postCut FPS (mean/min) | Grabs L/R |');
                lines.push('|---|---|---|---|---|---|---|---|---|');
                const fmtFpsCell = (b) => (b && b.count > 0)
                    ? `${b.mean} / ${b.min} (n=${b.count})` : '—';
                const fmtDur = (ms) => ms == null ? '—' : (ms / 1000).toFixed(1) + 's';
                xrSess.forEach((s, i) => {
                    const f = s.fps || {};
                    lines.push(`| ${i + 1} | ${s.mode ?? '—'} | ${s.blendMode ?? '—'} | ${fmtDur(s.durationMs)} |` +
                        ` ${fmtFpsCell(f.idle)} | ${fmtFpsCell(f.rotation)} | ${fmtFpsCell(f.deform)} | ${fmtFpsCell(f.postCut)} |` +
                        ` ${s.grabCount?.left ?? 0} / ${s.grabCount?.right ?? 0} |`);
                });
                if (xr.activeSession) {
                    const a = xr.activeSession;
                    const fl = a.fpsLive || { buckets: {}, overall: {} };
                    lines.push(`| * | ${a.mode} | ${a.blendMode ?? '—'} | ${fmtDur(a.elapsedMs)} (live) |` +
                        ` ${fmtFpsCell(fl.buckets.idle)} | ${fmtFpsCell(fl.buckets.rotation)} |` +
                        ` ${fmtFpsCell(fl.buckets.deform)} | ${fmtFpsCell(fl.buckets.postCut)} |` +
                        ` ${a.grabCount?.left ?? 0} / ${a.grabCount?.right ?? 0} |`);
                }
                lines.push('');
                lines.push('_Mode: vr / ar / unknown.  Blend: opaque=VR, alpha-blend/additive=AR passthrough._');
                lines.push('_Rotation bucket = left-hand grab (model transform).  Deform bucket = right-hand grab (mesh manipulation)._');
            }
            lines.push('');

            lines.push('---');
            lines.push(`_Generated by benchmark.js v${report.bench.version}_`);

            return lines.join('\n');
        },
    };

    // ============================================================
    // ReportUI — floating button + overlay
    // ============================================================
    const ReportUI = {
        _btn: null,
        _panel: null,
        _body: null,
        _toast: null,

        init() {
            this._mountButton();
            this._mountPanel();
            this._mountToast();
        },

        _mountButton() {
            const btn = document.createElement('button');
            btn.id = 'bench-toggle-btn';
            btn.textContent = '📊 Bench v' + BENCH_VERSION;
            btn.style.cssText = 'position:fixed;bottom:12px;right:12px;z-index:99998;' +
                'background:#000a;color:#7dff7d;padding:8px 12px;' +
                'font-family:monospace;font-size:12px;' +
                'border:1px solid #7dff7d;border-radius:4px;cursor:pointer;';
            btn.addEventListener('click', () => this.show());
            document.body.appendChild(btn);
            this._btn = btn;
        },

        _mountPanel() {
            const panel = document.createElement('div');
            panel.id = 'bench-panel';
            panel.style.cssText = 'position:fixed;top:20px;right:20px;z-index:99999;' +
                'width:min(640px,92vw);max-height:90vh;overflow:auto;' +
                'background:#000e;color:#ddd;padding:16px;' +
                'font-family:monospace;font-size:12px;' +
                'border:1px solid #7dff7d;border-radius:6px;display:none;';
            panel.innerHTML = `
                <div style="display:flex;justify-content:space-between;align-items:center;">
                    <strong style="color:#7dff7d;">📊 Benchmark Report <span style="color:#888;font-size:11px;font-weight:normal;">v${BENCH_VERSION}</span></strong>
                    <button id="bench-close-btn" style="background:transparent;color:#aaa;border:0;font-size:18px;cursor:pointer;">×</button>
                </div>
                <div style="margin:10px 0;display:flex;gap:6px;flex-wrap:wrap;">
                    <button id="bench-copy-md"     style="${this._btnStyle('#7dff7d')}">Copy MD</button>
                    <button id="bench-copy-json"   style="${this._btnStyle('#88ccff')}">Copy JSON</button>
                    <button id="bench-download-json" style="${this._btnStyle('#ffcc88')}">Download JSON</button>
                    <button id="bench-refresh"     style="${this._btnStyle('#cccccc')}">Refresh</button>
                    <button id="bench-reset"       style="${this._btnStyle('#ff8888')}">Reset Samples</button>
                </div>
                <pre id="bench-report-body" style="white-space:pre-wrap;background:#0008;padding:10px;border-radius:4px;max-height:60vh;overflow:auto;margin:0;"></pre>
            `;
            document.body.appendChild(panel);
            this._panel = panel;
            this._body = panel.querySelector('#bench-report-body');

            panel.querySelector('#bench-close-btn').addEventListener('click', () => this.hide());
            panel.querySelector('#bench-copy-md').addEventListener('click', async () => {
                const md = ReportRenderer.toMarkdown(ReportRenderer.build());
                const ok = await copyToClipboard(md);
                this._toastMsg(ok ? 'Markdown copied' : 'Copy failed (see console)');
                if (!ok) console.log('[Bench] Markdown:\n' + md);
            });
            panel.querySelector('#bench-copy-json').addEventListener('click', async () => {
                const json = ReportRenderer.toJSON(ReportRenderer.build());
                const ok = await copyToClipboard(json);
                this._toastMsg(ok ? 'JSON copied' : 'Copy failed (see console)');
                if (!ok) console.log('[Bench] JSON:\n' + json);
            });
            panel.querySelector('#bench-download-json').addEventListener('click', () => {
                const json = ReportRenderer.toJSON(ReportRenderer.build());
                const blob = new Blob([json], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                const ts = nowIso().replace(/[:.]/g, '-');
                a.href = url;
                a.download = `bench_${ts}.json`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                this._toastMsg('JSON downloaded');
            });
            panel.querySelector('#bench-refresh').addEventListener('click', () => this._refresh());
            panel.querySelector('#bench-reset').addEventListener('click', () => {
                if (!confirm('Reset all FPS samples, cuts, and OBJ drop history?\n(initial load timeline is preserved)')) return;
                FPSSampler.reset();
                InteractionLogger.reset();
                LoadTimeTracker.reset();   // v1.0.4: also clear objDropEvents
                XRSessionProbe.reset();
                MemorySampler.reset();
                this._refresh();
                this._toastMsg('Samples reset');
            });
        },

        _mountToast() {
            const t = document.createElement('div');
            t.id = 'bench-toast';
            t.style.cssText = 'position:fixed;bottom:60px;right:20px;z-index:99999;' +
                'background:#000d;color:#7dff7d;padding:8px 14px;' +
                'font-family:monospace;font-size:12px;border:1px solid #7dff7d;' +
                'border-radius:4px;display:none;';
            document.body.appendChild(t);
            this._toast = t;
        },

        _btnStyle(color) {
            return `background:transparent;color:${color};border:1px solid ${color};` +
                   `padding:5px 10px;border-radius:3px;cursor:pointer;font-family:monospace;font-size:11px;`;
        },

        _toastMsg(msg) {
            if (!this._toast) return;
            this._toast.textContent = msg;
            this._toast.style.display = 'block';
            clearTimeout(this._toastTimer);
            this._toastTimer = setTimeout(() => { this._toast.style.display = 'none'; }, 1800);
        },

        show() {
            this._refresh();
            this._panel.style.display = 'block';
        },
        hide() { this._panel.style.display = 'none'; },

        _refresh() {
            const md = ReportRenderer.toMarkdown(ReportRenderer.build());
            this._body.textContent = md;
        },

        // Hide button while in XR session
        _xrPoll() {
            const inXR = !!$xrSession();
            if (this._btn) this._btn.style.display = inXR ? 'none' : '';
            if (inXR && this._panel.style.display !== 'none') this.hide();
            setTimeout(() => this._xrPoll(), 500);
        },
    };

    // ============================================================
    // Bootstrap
    // ============================================================
    function start() {
        try { PlatformProbe.init(); } catch (e) { console.warn('[Bench] PlatformProbe error:', e); }
        try { LoadTimeTracker.init(); } catch (e) { console.warn('[Bench] LoadTimeTracker error:', e); }
        try { FPSSampler.start(); } catch (e) { console.warn('[Bench] FPSSampler error:', e); }
        try { InteractionLogger.init(); } catch (e) { console.warn('[Bench] InteractionLogger error:', e); }
        try { XRSessionProbe.init(); } catch (e) { console.warn('[Bench] XRSessionProbe error:', e); }
        try { MemorySampler.init(); } catch (e) { console.warn('[Bench] MemorySampler error:', e); }
        try {
            ReportUI.init();
            ReportUI._xrPoll();
        } catch (e) { console.warn('[Bench] ReportUI error:', e); }
        console.log('[Bench] benchmark.js v' + BENCH_VERSION + ' active.');
    }

    // ============================================================
    // window.Bench public API
    // ============================================================
    window.Bench = {
        VERSION: BENCH_VERSION,
        getReport() { return ReportRenderer.build(); },
        getPlatform() { return PlatformProbe.data; },
        resetSamples() {
            FPSSampler.reset();
            InteractionLogger.reset();
            LoadTimeTracker.reset();   // v1.0.4: also clear objDropEvents
            XRSessionProbe.reset();
            MemorySampler.reset();
        },
        _internal: {
            PlatformProbe, LoadTimeTracker, FPSSampler,
            InteractionLogger, XRSessionProbe, MemorySampler,
            ReportRenderer, ReportUI,
        },
    };

    // ============================================================
    // Entry
    // ============================================================
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }
})();
