import * as T from 'three';

export class MriEditor {
  mesh: T.Mesh;
  camera: T.PerspectiveCamera;
  domElement: HTMLElement;
  overlay: HTMLElement;
  
  mode: 'resize' | 'align' | 'idle' = 'resize';
  aspectLocked = true;
  
  private handles: Record<string, HTMLElement> = {};
  private activeHandle: string | null = null;
  private plane = new T.Plane();
  private raycaster = new T.Raycaster();
  private initialScale = new T.Vector3();
  private initialPosition = new T.Vector3();
  private initialRotation = new T.Euler();
  private initialPointerWorld = new T.Vector3();
  
  constructor(mesh: T.Mesh, camera: T.PerspectiveCamera, domElement: HTMLElement, overlay: HTMLElement) {
    this.mesh = mesh;
    this.camera = camera;
    this.domElement = domElement;
    this.overlay = overlay;
    
    this.createHandles();
  }
  
  private createHandles() {
    const handleIds = ['tl', 'tr', 'bl', 'br', 't', 'b', 'l', 'r', 'rotRight', 'rotBottom'];
    handleIds.forEach(id => {
      const el = document.createElement('div');
      el.className = `mri-handle mri-handle-${id}`;
      const isRot = id.startsWith('rot');
      Object.assign(el.style, {
        position: 'absolute',
        width: isRot ? '20px' : '12px',
        height: isRot ? '20px' : '12px',
        background: isRot ? '#3b82f6' : 'white',
        border: '2px solid #3b82f6',
        borderRadius: isRot ? '50%' : '2px',
        transform: 'translate(-50%, -50%)',
        pointerEvents: 'auto',
        cursor: this.getCursorForHandle(id)
      });
      
      el.addEventListener('pointerdown', (e) => this.onPointerDown(id, e));
      this.overlay.appendChild(el);
      this.handles[id] = el;
    });
  }
  
  private getCursorForHandle(id: string) {
    if (id === 'tl' || id === 'br') return 'nwse-resize';
    if (id === 'tr' || id === 'bl') return 'nesw-resize';
    if (id === 't' || id === 'b') return 'ns-resize';
    if (id === 'l' || id === 'r') return 'ew-resize';
    if (id.startsWith('rot')) return 'grab';
    return 'default';
  }
  
  private onPointerDown = (id: string, e: PointerEvent) => {
    if (this.mode !== 'resize') return;
    e.stopPropagation();
    e.preventDefault();
    this.activeHandle = id;
    
    this.initialScale.copy(this.mesh.scale);
    this.initialPosition.copy(this.mesh.position);
    this.initialRotation.copy(this.mesh.rotation);
    
    const worldPointer = this.getPointerWorld(e);
    if (worldPointer) {
      this.initialPointerWorld.copy(worldPointer);
    }
    
    document.addEventListener('pointermove', this.onPointerMove);
    document.addEventListener('pointerup', this.onPointerUp);
  };
  
  private getPointerWorld(e: PointerEvent): T.Vector3 | null {
    const rect = this.domElement.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(new T.Vector2(x, y), this.camera);
    
    const normal = new T.Vector3(0, 0, 1).applyQuaternion(this.mesh.quaternion).normalize();
    this.plane.setFromNormalAndCoplanarPoint(normal, this.initialPosition);
    
    const intersect = new T.Vector3();
    if (this.raycaster.ray.intersectPlane(this.plane, intersect)) {
      return intersect;
    }
    return null;
  }
  
  private onPointerMove = (e: PointerEvent) => {
    if (!this.activeHandle) return;
    
    const currentWorld = this.getPointerWorld(e);
    if (!currentWorld) return;
    
    const localStart = this.mesh.worldToLocal(this.initialPointerWorld.clone());
    const localCurrent = this.mesh.worldToLocal(currentWorld.clone());
    const delta = localCurrent.sub(localStart);
    
    const geoSize = 1.5; // matching PlaneGeometry
    
    if (this.activeHandle.startsWith('rot')) {
       // Rotation logic
       const angleStart = Math.atan2(localStart.y, localStart.x);
       const angleCurrent = Math.atan2(localCurrent.y, localCurrent.x);
       const angleDelta = angleCurrent - angleStart;
       
       const euler = new T.Euler().copy(this.initialRotation);
       this.mesh.quaternion.setFromEuler(euler);
       this.mesh.rotateZ(angleDelta);
       return;
    }
    
    // Resizing logic
    let dx = 0;
    let dy = 0;
    
    if (this.activeHandle.includes('l')) dx = -delta.x;
    if (this.activeHandle.includes('r')) dx = delta.x;
    if (this.activeHandle.includes('t')) dy = delta.y;
    if (this.activeHandle.includes('b')) dy = -delta.y;
    
    let scaleX = this.initialScale.x + dx / (geoSize / 2);
    let scaleY = this.initialScale.y + dy / (geoSize / 2);
    
    if (this.aspectLocked) {
       const maxScale = Math.max(scaleX, scaleY);
       scaleX = maxScale;
       scaleY = maxScale;
    }
    
    this.mesh.scale.set(Math.max(0.1, scaleX), Math.max(0.1, scaleY), 1);
  };
  
  private onPointerUp = () => {
    this.activeHandle = null;
    document.removeEventListener('pointermove', this.onPointerMove);
    document.removeEventListener('pointerup', this.onPointerUp);
  };
  
  public update() {
    if (this.mode !== 'resize' || !this.mesh.visible) {
      this.overlay.style.display = 'none';
      return;
    }
    this.overlay.style.display = 'block';
    
    const geoSize = 1.5;
    const sx = geoSize / 2;
    const sy = geoSize / 2;
    
    const points = {
      tl: new T.Vector3(-sx, sy, 0),
      tr: new T.Vector3(sx, sy, 0),
      bl: new T.Vector3(-sx, -sy, 0),
      br: new T.Vector3(sx, -sy, 0),
      t: new T.Vector3(0, sy, 0),
      b: new T.Vector3(0, -sy, 0),
      l: new T.Vector3(-sx, 0, 0),
      r: new T.Vector3(sx, 0, 0),
      rotRight: new T.Vector3(sx + 0.3, 0, 0),
      rotBottom: new T.Vector3(0, -sy - 0.3, 0)
    };
    
    const rect = this.domElement.getBoundingClientRect();
    
    for (const [id, point] of Object.entries(points)) {
      point.applyMatrix4(this.mesh.matrixWorld);
      point.project(this.camera);
      
      const x = (point.x * 0.5 + 0.5) * rect.width;
      const y = (-(point.y * 0.5) + 0.5) * rect.height;
      
      const handle = this.handles[id];
      if (handle) {
        handle.style.left = `${x}px`;
        handle.style.top = `${y}px`;
      }
    }
  }
  
  public dispose() {
    Object.values(this.handles).forEach(el => el.remove());
  }
}
