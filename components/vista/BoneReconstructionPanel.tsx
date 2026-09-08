import { useCallback, useEffect, useRef, useState } from 'react';
import * as T from 'three';
import { Activity, Bone, ChevronDown, Trash2, X } from 'lucide-react';
import { getSceneBridge } from '@/lib/vista/scene-bridge';
import { useBoneReconstruction, type BoneResult } from '@/lib/vista/useBoneReconstruction';

const SAMPLE = 'https://assets.ngc.nvidia.com/products/api-catalog/vista3d/example-1.nii.gz';

/**
 * Self-contained CT/MRI -> 3D bone reconstruction.
 * Mounts its own group into the existing scene and never touches the viewer's
 * own objects, camera or render loop beyond asking for a redraw.
 */
export default function BoneReconstructionPanel() {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [quality, setQuality] = useState(224);
  const [hu, setHu] = useState(300);
  const [opacity, setOpacity] = useState(1);
  const [scale, setScale] = useState(1);
  const [mounted, setMounted] = useState(false);
  const groupRef = useRef<T.Group | null>(null);
  const materialRef = useRef<T.MeshStandardMaterial | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const maskRef = useRef<HTMLInputElement>(null);
  const ctRef = useRef<HTMLInputElement>(null);

  const { state, reset, segmentFromUrl, segmentFromFile, meshFromFile, ctFromFile } = useBoneReconstruction();

  const clear = useCallback(() => {
    const bridge = getSceneBridge();
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
    bridge?.requestRender();
  }, []);

  useEffect(() => clear, [clear]);

  const mount = useCallback((result: BoneResult) => {
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
      vertexColors: true, metalness: 0.05, roughness: 0.62, side: T.DoubleSide,
    });
    const group = new T.Group();
    group.name = 'vista-bone-reconstruction';
    group.add(new T.Mesh(geometry, material));
    bridge.scene.add(group);

    groupRef.current = group;
    materialRef.current = material;
    setMounted(true);
    setOpacity(1);
    setScale(1);
    bridge.requestRender();
  }, [clear]);

  // Live opacity / scale without rebuilding the mesh.
  useEffect(() => {
    const material = materialRef.current;
    if (!material) return;
    material.transparent = opacity < 1;
    material.opacity = opacity;
    material.depthWrite = opacity > 0.95;
    material.needsUpdate = true;
    getSceneBridge()?.requestRender();
  }, [opacity]);

  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    group.scale.setScalar(scale);
    getSceneBridge()?.requestRender();
  }, [scale]);

  const run = async (fn: () => Promise<BoneResult | null>) => {
    const result = await fn();
    if (result) mount(result);
  };

  const panel: React.CSSProperties = {
    position: 'absolute', left: 24, bottom: 132, zIndex: 1003, width: 322,
    background: 'rgba(255,255,255,0.94)', backdropFilter: 'blur(10px)',
    borderRadius: 14, border: '1px solid rgba(148,163,184,0.35)',
    boxShadow: '0 12px 34px rgba(15,23,42,0.16)', overflow: 'hidden',
    fontSize: 13, color: '#0f172a',
  };
  const button: React.CSSProperties = {
    border: '1px solid #cbd5e1', background: '#f8fafc', borderRadius: 7,
    padding: '6px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer', color: '#0f172a',
  };
  const primary: React.CSSProperties = {
    ...button, background: '#0f172a', color: '#fff', borderColor: '#0f172a',
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        title="Reconstruct bones from a CT/MRI volume with NVIDIA VISTA-3D"
        style={{
          position: 'absolute', left: 24, bottom: 132, zIndex: 1003,
          display: 'flex', alignItems: 'center', gap: 8, padding: '9px 13px',
          background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(10px)',
          border: '1px solid rgba(148,163,184,0.35)', borderRadius: 11,
          boxShadow: '0 8px 22px rgba(15,23,42,0.14)', cursor: 'pointer',
          fontSize: 13, fontWeight: 600, color: '#0f172a',
        }}
      >
        <Bone size={16} /> CT/MRI → 3D bones
        {mounted && <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#22c55e' }} />}
      </button>
    );
  }

  return (
    <div style={panel}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 12px', background: '#0f172a', color: '#fff', fontWeight: 600,
      }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Bone size={16} /> Bone reconstruction
        </span>
        <span style={{ display: 'flex', gap: 4 }}>
          <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', opacity: 0.8 }}>
            <ChevronDown size={16} />
          </button>
        </span>
      </div>

      <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {/* Offline path — primary, because NVIDIA retired the hosted endpoint. */}
        <div style={{ fontSize: 11, color: '#64748b', lineHeight: 1.45 }}>
          Reconstruct bones straight from a CT volume (<code>.nii/.nii.gz/.nrrd</code>).
          Runs in a worker, no API or GPU needed.
        </div>
        <button style={primary} disabled={state.busy} onClick={() => ctRef.current?.click()}>
          Reconstruct bones from CT (offline)
        </button>
        <input
          ref={ctRef} type="file" accept=".nii,.gz,.nrrd" hidden
          onChange={(e) => { const f = e.target.files?.[0]; if (f) run(() => ctFromFile(f, quality, hu)); e.target.value = ''; }}
        />
        <label style={{ fontSize: 11, color: '#475569', display: 'flex', justifyContent: 'space-between' }}>
          <span>Bone threshold</span><span style={{ fontWeight: 700 }}>{hu} HU</span>
        </label>
        <input
          type="range" min={120} max={600} step={20} value={hu}
          disabled={state.busy} onChange={(e) => setHu(Number(e.target.value))}
        />

        <details>
          <summary style={{ cursor: 'pointer', fontSize: 11, color: '#64748b', fontWeight: 600 }}>
            NVIDIA VISTA-3D (needs a local NIM — hosted API retired 2026-08-25)
          </summary>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
        <label style={{ fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase' }}>
          Public scan URL (.nii.gz / .nrrd)
        </label>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={SAMPLE}
          spellCheck={false}
          style={{
            width: '100%', padding: '7px 9px', border: '1px solid #cbd5e1',
            borderRadius: 7, fontSize: 12, fontFamily: 'ui-monospace, monospace',
          }}
        />
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button style={primary} disabled={state.busy} onClick={() => run(() => segmentFromUrl(url.trim() || SAMPLE, quality))}>
            Segment & build
          </button>
          <button style={button} disabled={state.busy} onClick={() => setUrl(SAMPLE)}>Use sample</button>
        </div>

        <div style={{ height: 1, background: '#e2e8f0' }} />

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button style={button} disabled={state.busy} onClick={() => fileRef.current?.click()}>
            Upload scan…
          </button>
          <button style={button} disabled={state.busy} onClick={() => maskRef.current?.click()}>
            Load mask (no API)
          </button>
        </div>
        <input
          ref={fileRef} type="file" accept=".nii,.gz,.nrrd" hidden
          onChange={(e) => { const f = e.target.files?.[0]; if (f) run(() => segmentFromFile(f, quality)); e.target.value = ''; }}
        />
        <input
          ref={maskRef} type="file" accept=".nii,.gz,.nrrd" hidden
          onChange={(e) => { const f = e.target.files?.[0]; if (f) run(() => meshFromFile(f, quality)); e.target.value = ''; }}
        />
          </div>
        </details>

        <label style={{ fontSize: 11, color: '#475569', display: 'flex', justifyContent: 'space-between' }}>
          <span>Mesh detail</span><span style={{ fontWeight: 700 }}>{quality}</span>
        </label>
        <input
          type="range" min={96} max={384} step={32} value={quality}
          disabled={state.busy} onChange={(e) => setQuality(Number(e.target.value))}
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

        {state.result && (
          <>
            <div style={{ height: 1, background: '#e2e8f0' }} />
            <div style={{ fontSize: 11.5, color: '#334155' }}>
              <strong>{state.result.triangles.toLocaleString()}</strong> triangles ·{' '}
              <strong>{state.result.ms} ms</strong> ·{' '}
              {state.result.size.map((n) => n.toFixed(2)).join(' × ')} m
            </div>
            <details>
              <summary style={{ cursor: 'pointer', fontSize: 11.5, color: '#2563eb', fontWeight: 600 }}>
                {state.result.found.length} structures detected
              </summary>
              <ul style={{ margin: '6px 0 0', paddingLeft: 16, maxHeight: 132, overflowY: 'auto', fontSize: 11, color: '#475569' }}>
                {state.result.found.map((line) => <li key={line}>{line}</li>)}
              </ul>
            </details>
          </>
        )}

        {mounted && (
          <>
            <label style={{ fontSize: 11, color: '#475569', display: 'flex', justifyContent: 'space-between' }}>
              <span>Opacity</span><span style={{ fontWeight: 700 }}>{Math.round(opacity * 100)}%</span>
            </label>
            <input type="range" min={0.15} max={1} step={0.05} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} />
            <label style={{ fontSize: 11, color: '#475569', display: 'flex', justifyContent: 'space-between' }}>
              <span>Scale</span><span style={{ fontWeight: 700 }}>{scale.toFixed(2)}×</span>
            </label>
            <input type="range" min={0.2} max={3} step={0.05} value={scale} onChange={(e) => setScale(Number(e.target.value))} />
            <button style={{ ...button, color: '#b91c1c', borderColor: '#fecaca', display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center' }}
              onClick={() => { clear(); reset(); }}>
              <Trash2 size={14} /> Remove from scene
            </button>
          </>
        )}
      </div>
    </div>
  );
}
