import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as T from 'three';
import { Activity, Box, ChevronDown, RefreshCw, Trash2, Upload, X } from 'lucide-react';
import { getSceneBridge } from '@/lib/vista/scene-bridge';
import type { Atlas } from '@/app/anatomy';
import { DEFAULT_SETTINGS, useSliceTo3D, type SliceResult, type SliceSettings } from '@/lib/mri3d/useSliceTo3D';

/**
 * MRI → 3D: a doctor uploads one scan slice, every structure in it is
 * identified, and each one is rebuilt beside the atlas by deforming the real
 * BodyParts3D mesh for that structure to match what the scan measures.
 *
 * Self-contained. It mounts its own group into the scene through the read-only
 * __anatomyScene bridge and touches nothing the viewer owns.
 */
/**
 * Whole-region picks, so the common cases are one click rather than two
 * searches. Paired names resolve to one mesh per side.
 */
const QUICK_PICKS: { label: string; names: string[] }[] = [
  { label: 'Both femurs', names: ['Left femur', 'Right femur'] },
  { label: 'Left femur', names: ['Left femur'] },
  { label: 'Right femur', names: ['Right femur'] },
  { label: 'Knees', names: ['Left tibia', 'Right tibia', 'Left patella', 'Right patella'] },
  { label: 'Pelvis', names: ['Left hip bone', 'Right hip bone', 'Sacrum'] },
];

export default function SliceTo3DPanel({ atlas }: { atlas: Atlas | null }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [opacity, setOpacity] = useState(1);
  const [size, setSize] = useState(0.45);
  // Manual structure naming: the path that needs no model call.
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<string[]>([]);
  const [appears, setAppears] = useState<'bright' | 'dark'>('bright');
  const [mirrored, setMirrored] = useState(false);
  // Mirrors the hook's settings so sliders track the pointer while the rebuild
  // is still debounced.
  const [draft, setDraft] = useState<SliceSettings>(DEFAULT_SETTINGS);
  const groupRef = useRef<T.Group | null>(null);
  const materialRef = useRef<T.MeshStandardMaterial | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftRef = useRef<SliceSettings>(DEFAULT_SETTINGS);

  const { state, settings, matched, load, retune, reset, nameStructures, retryIdentify } =
    useSliceTo3D(atlas);
  const identity = state.identification;

  /** Atlas structures whose name matches what has been typed. */
  const suggestions = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!atlas || term.length < 2) return [];
    const names = new Set<string>();
    for (const part of atlas.parts) {
      if (!part.name.toLowerCase().includes(term)) continue;
      names.add(part.name);
      if (names.size >= 60) break;
    }
    // Shortest first: "Left femur" should outrank "Head of left femur".
    return [...names].sort((a, b) => a.length - b.length);
  }, [atlas, query]);

  // Once identification succeeds, seed the picker with what it found, so
  // correcting one name does not mean retyping all of them.
  useEffect(() => {
    if (identity?.structures.length) setChosen(identity.structures.map((s) => s.name));
  }, [identity]);

  useEffect(() => { setDraft(settings); draftRef.current = settings; }, [settings]);
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const clear = useCallback(() => {
    const group = groupRef.current;
    if (group) {
      group.removeFromParent();
      group.traverse((o) => {
        if (o instanceof T.Mesh) { o.geometry.dispose(); (o.material as T.Material).dispose(); }
      });
    }
    groupRef.current = null;
    materialRef.current = null;
    setMounted(false);
    getSceneBridge()?.requestRender();
  }, []);

  useEffect(() => clear, [clear]);

  /** Swap the reconstruction into the scene, standing on the platform beside the body. */
  const mount = useCallback((result: SliceResult) => {
    const bridge = getSceneBridge();
    if (!bridge) return;
    clear();

    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.BufferAttribute(result.positions, 3));
    geometry.setAttribute('normal', new T.BufferAttribute(result.normals, 3));
    geometry.setAttribute('color', new T.BufferAttribute(result.colors, 3));
    geometry.setIndex(new T.BufferAttribute(result.indices, 1));
    geometry.computeBoundingSphere();

    const material = new T.MeshStandardMaterial({
      vertexColors: true, metalness: 0.05, roughness: 0.6, side: T.DoubleSide,
    });
    const group = new T.Group();
    group.name = 'mri-slice-reconstruction';
    group.add(new T.Mesh(geometry, material));
    // Worker output is normalised: longest axis 1, centred in X/Z, resting on Y=0.
    group.scale.setScalar(size);
    group.position.set(-0.62, 0, 0);
    bridge.scene.add(group);

    groupRef.current = group;
    materialRef.current = material;
    setMounted(true);
    setOpacity(1);
    bridge.requestRender();
  }, [clear, size]);

  // Live size and opacity, without rebuilding the mesh.
  useEffect(() => {
    if (!groupRef.current) return;
    groupRef.current.scale.setScalar(size);
    getSceneBridge()?.requestRender();
  }, [size]);

  useEffect(() => {
    const material = materialRef.current;
    if (!material) return;
    material.transparent = opacity < 1;
    material.opacity = opacity;
    material.depthWrite = opacity > 0.95;
    material.needsUpdate = true;
    getSceneBridge()?.requestRender();
  }, [opacity]);

  // Show what was actually segmented, so the outline can be checked by eye.
  useEffect(() => {
    const canvas = previewRef.current;
    const preview = state.result?.preview;
    if (!canvas || !preview) return;
    canvas.width = preview.width;
    canvas.height = preview.height;
    canvas.getContext('2d')?.putImageData(preview, 0, 0);
  }, [state.result]);

  const run = useCallback(async (fn: () => Promise<SliceResult | null>) => {
    const result = await fn();
    if (result) mount(result);
  }, [mount]);

  /**
   * Sliders fire on every pixel of travel; rebuilding each time would queue
   * dozens of workers. Update the control now, rebuild once the user pauses.
   */
  const tune = useCallback((patch: Partial<SliceSettings>, immediate = false) => {
    // Accumulate onto the draft so a change made during the pause is not dropped.
    const next = { ...draftRef.current, ...patch };
    draftRef.current = next;
    setDraft(next);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => run(() => retune(next)), immediate ? 0 : 260);
  }, [retune, run]);

  const button: React.CSSProperties = {
    border: '1px solid #cbd5e1', background: '#f8fafc', borderRadius: 7,
    padding: '6px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer', color: '#0f172a',
  };
  const primary: React.CSSProperties = { ...button, background: '#0f172a', color: '#fff', borderColor: '#0f172a' };
  const label: React.CSSProperties = {
    fontSize: 11, color: '#475569', display: 'flex', justifyContent: 'space-between', marginTop: 2,
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        title="Upload one MRI/CT slice and rebuild the structure in 3D"
        style={{
          position: 'fixed', top: 140, right: 30, zIndex: 9998,
          display: 'flex', alignItems: 'center', gap: 7,
          background: 'rgba(255,255,255,0.8)', padding: '6px 12px', borderRadius: 8,
          boxShadow: '0 2px 10px rgba(0,0,0,0.1)', border: 'none', cursor: 'pointer',
          fontWeight: 500, fontSize: 14, color: '#0f172a',
        }}
      >
        <Box size={15} /> MRI → 3D
        {mounted && <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#22c55e' }} />}
      </button>
    );
  }

  return (
    <div style={{
      position: 'absolute', top: 148, right: 24, zIndex: 1004, width: 330,
      maxHeight: 'calc(100vh - 300px)', display: 'flex', flexDirection: 'column',
      background: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(10px)',
      borderRadius: 14, border: '1px solid rgba(148,163,184,0.35)',
      boxShadow: '0 12px 34px rgba(15,23,42,0.16)', overflow: 'hidden',
      fontSize: 13, color: '#0f172a',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 12px', background: '#0f172a', color: '#fff', fontWeight: 600, flexShrink: 0,
      }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Box size={16} /> MRI → 3D structure</span>
        <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', opacity: 0.8 }}>
          <ChevronDown size={16} />
        </button>
      </div>

      <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 9, overflowY: 'auto' }}>
        <div style={{ fontSize: 11, color: '#64748b', lineHeight: 1.45 }}>
          Upload one MRI or CT slice. Every structure in it is identified, matched to the
          viewer&apos;s reference anatomy, and that reference mesh is reshaped to match what the
          scan measures — so the result is a real femur, not an inflated outline.
        </div>

        <button style={primary} disabled={state.busy} onClick={() => fileRef.current?.click()}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Upload size={13} /> {state.fileName ? 'Upload another slice' : 'Upload MRI slice'}
          </span>
        </button>
        <input
          ref={fileRef} type="file" accept="image/*" hidden
          onChange={(e) => { const f = e.target.files?.[0]; if (f) run(() => load(f)); e.target.value = ''; }}
        />

        {state.busy && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#475569', fontSize: 12, marginBottom: 6 }}>
              <Activity size={14} /> {state.stage}…
            </div>
            <div style={{ height: 5, background: '#e2e8f0', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ width: `${state.percent}%`, height: '100%', background: '#2563eb', transition: 'width .25s' }} />
            </div>
          </div>
        )}

        {state.error && (
          <div style={{
            display: 'flex', gap: 8, alignItems: 'flex-start', background: '#fef2f2',
            border: '1px solid #fecaca', color: '#991b1b', borderRadius: 8, padding: 9, fontSize: 11.5, lineHeight: 1.45,
          }}>
            <X size={14} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>{state.error}</span>
          </div>
        )}

        {identity && identity.structures.length > 0 && (
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 9, padding: 10 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.05em' }}>
              {identity.manual ? 'Structures you chose' : 'Identified'}
              {identity.structures.length > 1 && ` · ${identity.structures.length}`}
            </div>
            {matched.map(({ structure, parts }) => (
              <div key={structure.name} style={{ marginTop: 6 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: parts.length ? '#1d4ed8' : '#b45309' }}>
                  {structure.name}
                </div>
                <div style={{ fontSize: 10.5, color: '#64748b', lineHeight: 1.4 }}>
                  {structure.category} · reads {structure.appears}
                  {parts.length
                    ? ` · ${parts.length === 1 ? parts[0] : `${parts.length} reference meshes`}`
                    : ' · no reference mesh in the atlas'}
                </div>
              </div>
            ))}
            {identity.findings.length > 0 && (
              <ul style={{ margin: '7px 0 0', paddingLeft: 16, fontSize: 11.5, color: '#475569' }}>
                {identity.findings.map((f) => <li key={f}>{f}</li>)}
              </ul>
            )}
          </div>
        )}

        {/* Naming the structure by hand needs no model call, so the tool keeps
            working when identification is rate-limited, unkeyed or simply wrong. */}
        {state.fileName && !state.busy && (
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 9, padding: 10 }}>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
            }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.05em' }}>
                {identity?.structures.length ? 'Choose the structure yourself' : 'Name the structure'}
              </div>
              {identity && !identity.identified && identity.failure?.kind !== 'key' && (
                <button
                  style={{ ...button, padding: '3px 8px', fontSize: 11 }}
                  onClick={() => run(() => retryIdentify())}
                  title="Try automatic identification again"
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <RefreshCw size={11} /> Retry
                  </span>
                </button>
              )}
            </div>

            {!atlas ? (
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 6 }}>
                Waiting for the anatomy catalogue to finish loading…
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', margin: '7px 0' }}>
                  {QUICK_PICKS.map((pick) => (
                    <button
                      key={pick.label}
                      style={{ ...button, padding: '3px 8px', fontSize: 11 }}
                      onClick={() => setChosen(pick.names)}
                      title={pick.names.join(', ')}
                    >
                      {pick.label}
                    </button>
                  ))}
                </div>

                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search 2,234 structures — e.g. femur, tibia, vastus"
                  style={{
                    width: '100%', boxSizing: 'border-box', padding: '6px 8px', fontSize: 12,
                    border: '1px solid #cbd5e1', borderRadius: 7, color: '#0f172a',
                  }}
                />

                {chosen.length > 0 && (
                  <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 7 }}>
                    {chosen.map((name) => (
                      <button
                        key={name}
                        onClick={() => setChosen((c) => c.filter((n) => n !== name))}
                        style={{
                          ...button, padding: '3px 7px', fontSize: 11,
                          background: '#dbeafe', borderColor: '#93c5fd', color: '#1d4ed8',
                          display: 'inline-flex', alignItems: 'center', gap: 4,
                        }}
                        title="Remove"
                      >
                        {name} <X size={10} />
                      </button>
                    ))}
                  </div>
                )}

                {query.trim().length > 1 && (
                  <div style={{
                    maxHeight: 150, overflowY: 'auto', marginTop: 7,
                    border: '1px solid #e2e8f0', borderRadius: 7, background: '#fff',
                  }}>
                    {suggestions.length === 0 && (
                      <div style={{ padding: 8, fontSize: 11, color: '#94a3b8' }}>
                        Nothing in the atlas matches that.
                      </div>
                    )}
                    {suggestions.map((name) => (
                      <button
                        key={name}
                        onClick={() => {
                          setChosen((c) => (c.includes(name) ? c : [...c, name]));
                          setQuery('');
                        }}
                        style={{
                          display: 'block', width: '100%', textAlign: 'left', border: 'none',
                          background: 'none', padding: '5px 8px', fontSize: 11.5,
                          color: '#0f172a', cursor: 'pointer',
                        }}
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                )}

                <label style={{ ...label, marginTop: 8 }}>
                  <span>On the scan the structure looks</span>
                </label>
                <div style={{ display: 'flex', gap: 6 }}>
                  {(['bright', 'dark'] as const).map((look) => (
                    <button
                      key={look}
                      onClick={() => setAppears(look)}
                      style={{
                        ...button, flex: 1,
                        ...(appears === look ? { background: '#0f172a', color: '#fff', borderColor: '#0f172a' } : {}),
                      }}
                      title={look === 'bright'
                        ? 'Brighter than the tissue around it — usual for bone on CT'
                        : 'Darker than the tissue around it — usual for cortical bone on MRI'}
                    >
                      {look === 'bright' ? 'Brighter' : 'Darker'}
                    </button>
                  ))}
                </div>

                {chosen.some((name) => /\bleft\b|\bright\b/i.test(name)) && (
                  <label style={{ fontSize: 11, color: '#475569', display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', marginTop: 7 }}>
                    <input type="checkbox" checked={mirrored} onChange={(e) => setMirrored(e.target.checked)} />
                    Sides are mirrored in this image
                  </label>
                )}
                <div style={{ fontSize: 10.5, color: '#64748b', lineHeight: 1.4, marginTop: 4 }}>
                  {chosen.some((name) => /\bleft\b|\bright\b/i.test(name))
                    ? `A left structure is looked for on the ${mirrored ? 'left' : 'right'} of the image, ` +
                      'following the radiological convention. Tick the box if this scan is laid out the other way.'
                    : 'Pick the structures on this slice, then fit them to it.'}
                </div>

                <button
                  style={{ ...primary, marginTop: 8, width: '100%' }}
                  disabled={state.busy || chosen.length === 0}
                  onClick={() => run(() => nameStructures(chosen, appears, mirrored))}
                >
                  {chosen.length === 0
                    ? 'Choose a structure to fit'
                    : `Fit ${chosen.length === 1 ? chosen[0] : `${chosen.length} structures`} to this scan`}
                </button>
              </>
            )}
          </div>
        )}

        {state.result && (
          <>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.05em' }}>
              {state.result.structures.length === 1 ? 'Segmented outline' : 'Segmented outlines'}
            </div>
            <canvas
              ref={previewRef}
              style={{ width: '100%', height: 'auto', borderRadius: 8, border: '1px solid #e2e8f0', display: 'block', background: '#0f172a' }}
            />

            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {state.result.structures.map((report) => (
                <div key={report.name} style={{ fontSize: 11, color: '#475569', display: 'flex', gap: 6 }}>
                  <span style={{
                    width: 6, height: 6, borderRadius: '50%', flexShrink: 0, marginTop: 4,
                    background: report.fitted ? '#22c55e' : report.parts.length ? '#f59e0b' : '#cbd5e1',
                  }} />
                  <span>
                    <strong style={{ color: '#0f172a' }}>{report.name}</strong>
                    {report.fitted
                      ? ` · reshaped ${report.meanChange.toFixed(1)}% mean, ${report.maxChange.toFixed(1)}% peak`
                      : ` · ${report.reason}`}
                  </span>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 11, color: '#64748b' }}>
              {state.result.triangles.toLocaleString()} triangles · {state.result.ms} ms
            </div>

            <div style={{ height: 1, background: '#e2e8f0', margin: '2px 0' }} />
            <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.05em' }}>
              How the shape is built
            </div>

            <div style={{ display: 'flex', gap: 6 }}>
              {(['atlas', 'freeform'] as const).map((mode) => (
                <button
                  key={mode}
                  disabled={state.busy}
                  onClick={() => tune({ mode }, true)}
                  style={{
                    ...button, flex: 1,
                    ...(draft.mode === mode ? { background: '#0f172a', color: '#fff', borderColor: '#0f172a' } : {}),
                  }}
                  title={mode === 'atlas'
                    ? 'Reshape the reference mesh for each structure to match the scan'
                    : 'Build the surface from the segmented outline alone — one structure only'}
                >
                  {mode === 'atlas' ? 'Reference fit' : 'Free-form'}
                </button>
              ))}
            </div>

            {draft.mode === 'atlas' ? (
              <>
                <label style={label}>
                  <span>Follow the scan</span>
                  <span style={{ fontWeight: 700 }}>{Math.round(draft.strength * 100)}%</span>
                </label>
                <input
                  type="range" min={0} max={1} step={0.05} value={draft.strength}
                  onChange={(e) => tune({ strength: Number(e.target.value) })}
                />
                <div style={{ fontSize: 10.5, color: '#64748b', lineHeight: 1.4, marginTop: -2 }}>
                  0% is the reference anatomy untouched. 100% pulls it as far toward the
                  scan&apos;s measurements as stays anatomically safe.
                </div>
              </>
            ) : (
              <>
                <label style={label}><span>Thickness</span><span style={{ fontWeight: 700 }}>{draft.thickness.toFixed(2)}×</span></label>
                <input
                  type="range" min={0.15} max={2.5} step={0.05} value={draft.thickness}
                  onChange={(e) => tune({ thickness: Number(e.target.value) })}
                />
              </>
            )}

            <div style={{ height: 1, background: '#e2e8f0', margin: '2px 0' }} />
            <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.05em' }}>
              Tune the outline
            </div>

            <label style={{ fontSize: 11, color: '#475569', display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer' }}>
              <input
                type="checkbox" checked={draft.invert} disabled={state.busy}
                onChange={(e) => tune({ invert: e.target.checked }, true)}
              />
              Flip which side of the threshold is kept
            </label>

            <label style={label}><span>Threshold</span><span style={{ fontWeight: 700 }}>{draft.bias > 0 ? '+' : ''}{draft.bias.toFixed(2)}</span></label>
            <input
              type="range" min={-1} max={1} step={0.05} value={draft.bias}
              onChange={(e) => tune({ bias: Number(e.target.value) })}
            />

            <label style={label}><span>Detail</span><span style={{ fontWeight: 700 }}>{draft.detail}</span></label>
            <input
              type="range" min={128} max={640} step={32} value={draft.detail}
              onChange={(e) => tune({ detail: Number(e.target.value) })}
            />
          </>
        )}

        {mounted && (
          <>
            <div style={{ height: 1, background: '#e2e8f0', margin: '2px 0' }} />
            <label style={label}><span>Size in the scene</span><span style={{ fontWeight: 700 }}>{(size * 100).toFixed(0)} cm</span></label>
            <input type="range" min={0.15} max={1} step={0.01} value={size} onChange={(e) => setSize(Number(e.target.value))} />
            <label style={label}><span>Opacity</span><span style={{ fontWeight: 700 }}>{Math.round(opacity * 100)}%</span></label>
            <input type="range" min={0.15} max={1} step={0.05} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} />
            <button
              style={{ ...button, color: '#b91c1c', borderColor: '#fecaca', display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center' }}
              onClick={() => { clear(); reset(); }}
            >
              <Trash2 size={14} /> Remove from scene
            </button>
          </>
        )}
      </div>
    </div>
  );
}
