import { useCallback, useEffect, useRef, useState } from 'react';
import * as T from 'three';

type Bounds = [number[], number[]];
type Bridge = { scene: T.Scene; camera: T.PerspectiveCamera; requestRender: () => void };

/**
 * Surgical-plan overlay shown ONLY while the left hip bone is selected.
 * Click "Set entry" / "Set exit", then click on the bone in 3D to drop a
 * tiny dot; a thin line auto-connects the two. Uses the read-only
 * __anatomyScene bridge and touches nothing else.
 */
export default function HipPlanTools({ bounds }: { bounds?: Bounds }) {
  const groupRef = useRef<T.Group | null>(null);
  const entryRef = useRef<T.Vector3 | null>(null);
  const exitRef = useRef<T.Vector3 | null>(null);
  const lineRef = useRef<T.Mesh | null>(null);
  const [arming, setArming] = useState<'entry' | 'exit' | null>(null);
  const [done, setDone] = useState({ entry: false, exit: false });

  const bridge = (): Bridge | null =>
    (typeof window !== 'undefined' ? (window as unknown as { __anatomyScene?: Bridge }).__anatomyScene ?? null : null);
  const canvas = () => document.querySelector('.scene canvas') as HTMLCanvasElement | null;

  const group = () => {
    const b = bridge();
    if (!b) return null;
    if (!groupRef.current) {
      const g = new T.Group();
      g.name = 'hip-surgical-plan';
      b.scene.add(g);
      groupRef.current = g;
    }
    return groupRef.current;
  };

  const clear = useCallback(() => {
    const g = groupRef.current;
    if (g) {
      g.traverse((o) => { if (o instanceof T.Mesh) { o.geometry.dispose(); (o.material as T.Material).dispose(); } });
      g.removeFromParent();
      groupRef.current = null;
    }
    entryRef.current = exitRef.current = null;
    lineRef.current = null;
    setDone({ entry: false, exit: false });
    setArming(null);
    bridge()?.requestRender();
  }, []);

  useEffect(() => clear, [clear]); // wipe the plan when the hip bone is deselected

  const box = bounds
    ? new T.Box3(new T.Vector3().fromArray(bounds[0]), new T.Vector3().fromArray(bounds[1]))
    : null;
  const unit = box ? Math.max(1e-4, Math.min(...box.getSize(new T.Vector3()).toArray())) : 0.05;

  const drawLine = () => {
    const g = group();
    const a = entryRef.current;
    const b = exitRef.current;
    if (!g || !a || !b) return;
    if (lineRef.current) { lineRef.current.geometry.dispose(); (lineRef.current.material as T.Material).dispose(); lineRef.current.removeFromParent(); }
    const dir = b.clone().sub(a);
    const len = Math.max(1e-4, dir.length());
    const n = dir.clone().normalize();
    // Extend the trajectory past both surface points so there's a length in air.
    const ext = len * 0.45;
    const from = a.clone().addScaledVector(n, -ext);
    const to = b.clone().addScaledVector(n, ext);
    const cyl = new T.Mesh(
      new T.CylinderGeometry(unit * 0.015, unit * 0.015, len + 2 * ext, 12),
      // depthTest on -> the bone occludes the buried part; the part in air stays visible.
      new T.MeshBasicMaterial({ color: 0x2563eb, depthTest: true, depthWrite: false }),
    );
    cyl.position.copy(from).add(to).multiplyScalar(0.5);
    cyl.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), n);
    cyl.renderOrder = 1;
    g.add(cyl);
    lineRef.current = cyl;
    bridge()?.requestRender();
  };

  const placeDot = (pos: T.Vector3, which: 'entry' | 'exit') => {
    const g = group();
    if (!g) return;
    const color = which === 'entry' ? 0x22c55e : 0xef4444;
    const ref = which === 'entry' ? entryRef : exitRef;
    // reuse the existing dot if re-placing
    const existing = g.children.find((o) => o.userData.dot === which) as T.Mesh | undefined;
    if (existing) existing.position.copy(pos);
    else {
      const dot = new T.Mesh(
        new T.SphereGeometry(unit * 0.03, 16, 16),
        new T.MeshBasicMaterial({ color, depthTest: false }),
      );
      dot.userData.dot = which;
      dot.position.copy(pos);
      dot.renderOrder = 42;
      g.add(dot);
    }
    ref.current = pos.clone();
    setDone((d) => ({ ...d, [which]: true }));
    drawLine();
    bridge()?.requestRender();
  };

  // While arming, the next click on the canvas raycasts onto the bone.
  useEffect(() => {
    if (!arming) return;
    const el = canvas();
    const b = bridge();
    if (!el || !b) return;
    const onClick = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      const ndc = new T.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      const ray = new T.Raycaster();
      ray.setFromCamera(ndc, b.camera);
      // Keep only real geometry hits that land inside the hip bone's own box,
      // ignoring the ground/platform/rings and our own markers.
      const tol = box ? box.clone().expandByScalar(unit * 0.1) : null;
      const onBone = ray
        .intersectObjects(b.scene.children, true)
        .filter((h) => {
          let p: T.Object3D | null = h.object;
          while (p) { if (p.name === 'hip-surgical-plan') return false; p = p.parent; }
          return tol ? tol.containsPoint(h.point) : true;
        });
      if (onBone.length === 0) { setArming(null); return; } // clicked off the bone -> ignore
      // User rotates the camera and clicks the surface to set the point. 
      // The surface they click is always the first intersection (onBone[0]).
      const hit = onBone[0];
      placeDot(hit.point, arming);
      setArming(null);
    };
    el.addEventListener('click', onClick, { once: true, capture: true });
    return () => el.removeEventListener('click', onClick, { capture: true } as EventListenerOptions);
  }, [arming]); // eslint-disable-line react-hooks/exhaustive-deps

  const btn = (active: boolean): React.CSSProperties => ({
    border: `1px solid ${active ? '#2563eb' : '#cbd5e1'}`,
    background: active ? '#eff6ff' : '#f8fafc',
    borderRadius: 7, padding: '7px 8px', fontSize: 12, fontWeight: 600, cursor: 'pointer', color: '#0f172a',
  });

  return (
    <div style={{
      position: 'absolute', right: 24, top: 96, zIndex: 1004, width: 218,
      background: 'rgba(255,255,255,0.96)', backdropFilter: 'blur(10px)',
      border: '1px solid rgba(148,163,184,0.4)', borderRadius: 12,
      boxShadow: '0 12px 30px rgba(15,23,42,0.18)', padding: 12, fontSize: 13, color: '#0f172a',
    }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>Left hip · surgical plan</div>
      <div style={{ fontSize: 10.5, color: '#64748b', marginBottom: 8 }}>
        {arming ? `Click on the bone to set the ${arming} point` : 'Pick a button, then click the bone'}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <button style={btn(arming === 'entry')} onClick={() => setArming(arming === 'entry' ? null : 'entry')}>
          {done.entry ? '✓ ' : ''}Set entry
        </button>
        <button style={btn(arming === 'exit')} onClick={() => setArming(arming === 'exit' ? null : 'exit')}>
          {done.exit ? '✓ ' : ''}Set exit
        </button>
      </div>
      <button
        style={{ ...btn(false), width: '100%', marginTop: 8, color: '#b91c1c', borderColor: '#fecaca', background: '#fff' }}
        onClick={clear}
      >
        Clear plan
      </button>
    </div>
  );
}
