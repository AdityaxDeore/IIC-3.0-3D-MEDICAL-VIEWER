import * as T from 'three';

export class MriEditor {
  mesh: T.Mesh;
  camera: T.PerspectiveCamera;
  domElement: HTMLElement;
  overlay: HTMLElement;
  
  mode: 'resize' | 'align' | 'idle' = 'resize';
  aspectLocked = true;
  
  private handles: Record<string, HTMLElement> = {};
  private activeHandle: string | null | undefined = undefined;
  private plane = new T.Plane();
  private raycaster = new T.Raycaster();
  private initialScale = new T.Vector3();
  private initialPosition = new T.Vector3();
  private initialRotation = new T.Euler();
  private initialPointerWorld = new T.Vector3();
  public onChange?: () => void;
  
  constructor(mesh: T.Mesh, camera: T.PerspectiveCamera, domElement: HTMLElement, overlay: HTMLElement, onChange?: () => void) {
    this.mesh = mesh;
    this.camera = camera;
    this.domElement = domElement;
    this.overlay = overlay;
    this.onChange = onChange;
    
    this.createHandles();
    this.bindEvents();
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
  
  private onPointerDown = (id: string | null, e: PointerEvent) => {
    if (this.mode === 'idle') return;
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
  
  private canvasPointerDownHandler = (e: PointerEvent) => {
    if (this.mode === 'align') {
       const world = this.getPointerWorld(e);
       if (world) {
          const local = this.mesh.worldToLocal(world.clone());
          const geoSize = 1.5;
          if (Math.abs(local.x) <= geoSize/2 && Math.abs(local.y) <= geoSize/2) {
             this.onPointerDown(null, e);
          }
       }
    }
  };

  private bindEvents() {
    this.domElement.addEventListener('pointerdown', this.canvasPointerDownHandler, { capture: true });
  }
  
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
    if (this.activeHandle === undefined) return;
    
    const currentWorld = this.getPointerWorld(e);
    if (!currentWorld) return;
    
    // Use a fixed initial matrix so scaling the mesh doesn't break our delta math!
    const localCurrent = currentWorld.clone().applyMatrix4(this.inverseMatrix);
    const localStart = this.initialPointerWorld.clone().applyMatrix4(this.inverseMatrix);
    const deltaLocal = localCurrent.clone().sub(localStart);
    
    if (this.activeHandle === null) {
       // ALIGN translation logic
       const translation = currentWorld.clone().sub(this.initialPointerWorld);
       this.mesh.position.copy(this.initialPosition).add(translation);
       if (this.onChange) this.onChange();
       return;
    }
    
    if (this.activeHandle.startsWith('rot')) {
       // Rotation logic (apply delta to initial rotation)
       const angleStart = Math.atan2(localStart.y, localStart.x);
       const angleCurrent = Math.atan2(localCurrent.y, localCurrent.x);
       const angleDelta = angleCurrent - angleStart;
       
       const euler = new T.Euler().copy(this.initialRotation);
       this.mesh.quaternion.setFromEuler(euler);
       this.mesh.rotateZ(angleDelta);
       if (this.onChange) this.onChange();
       return;
    }

    const dx = deltaLocal.x;
    const dy = deltaLocal.y;
    
    const geoSize = 1.5;
    
    let scaleX = this.initialScale.x;
    let scaleY = this.initialScale.y;
    
    // First determine requested scale based on mouse drag
    switch (this.activeHandle) {
      case 'r': scaleX = this.initialScale.x * (1 + dx / (geoSize / 2)); break;
      case 'l': scaleX = this.initialScale.x * (1 - dx / (geoSize / 2)); break;
      case 't': scaleY = this.initialScale.y * (1 + dy / (geoSize / 2)); break;
      case 'b': scaleY = this.initialScale.y * (1 - dy / (geoSize / 2)); break;
      case 'tr': scaleX = this.initialScale.x * (1 + dx / (geoSize / 2)); scaleY = this.initialScale.y * (1 + dy / (geoSize / 2)); break;
      case 'tl': scaleX = this.initialScale.x * (1 - dx / (geoSize / 2)); scaleY = this.initialScale.y * (1 + dy / (geoSize / 2)); break;
      case 'br': scaleX = this.initialScale.x * (1 + dx / (geoSize / 2)); scaleY = this.initialScale.y * (1 - dy / (geoSize / 2)); break;
      case 'bl': scaleX = this.initialScale.x * (1 - dx / (geoSize / 2)); scaleY = this.initialScale.y * (1 - dy / (geoSize / 2)); break;
    }
    
    // Enforce aspect ratio if locked (only for corners)
    if (this.aspectLocked && !['r', 'l', 't', 'b'].includes(this.activeHandle)) {
      const ratioX = scaleX / this.initialScale.x;
      const ratioY = scaleY / this.initialScale.y;
      const ratio = Math.max(ratioX, ratioY);
      scaleX = this.initialScale.x * ratio;
      scaleY = this.initialScale.y * ratio;
    }
    
    // Clamp scales to prevent disappearing or exploding
    scaleX = Math.max(0.01, Math.min(10, scaleX));
    scaleY = Math.max(0.01, Math.min(10, scaleY));
    
    // Calculate the physical expansion in local units
    const diffX = (scaleX - this.initialScale.x) * (geoSize / 2);
    const diffY = (scaleY - this.initialScale.y) * (geoSize / 2);
    
    // Determine which way the center must shift to keep the opposite edge anchored
    let shiftX = 0;
    let shiftY = 0;
    
    switch (this.activeHandle) {
      case 'r': shiftX = diffX; break;
      case 'l': shiftX = -diffX; break;
      case 't': shiftY = diffY; break;
      case 'b': shiftY = -diffY; break;
      case 'tr': shiftX = diffX; shiftY = diffY; break;
      case 'tl': shiftX = -diffX; shiftY = diffY; break;
      case 'br': shiftX = diffX; shiftY = -diffY; break;
      case 'bl': shiftX = -diffX; shiftY = -diffY; break;
    }
    
    // Apply only initial rotation to the shift (scale is already baked into actual diffs)
    const centerShiftLocal = new T.Vector3(shiftX, shiftY, 0).applyEuler(this.initialRotation);
    
    this.mesh.position.copy(this.initialPosition).add(centerShiftLocal);
    this.mesh.scale.set(scaleX, scaleY, 1);
    if (this.onChange) this.onChange();
  };
  
  private onPointerUp = () => {
    this.activeHandle = undefined;
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
      
      const x = (point.x * 0.5 + 0.5) * rect.width + rect.left;
      const y = (-(point.y * 0.5) + 0.5) * rect.height + rect.top;
      
      const handle = this.handles[id];
      if (handle) {
        handle.style.left = `${x}px`;
        handle.style.top = `${y}px`;
      }
    }
  }
  
  public dispose() {
    Object.values(this.handles).forEach(el => el.remove());
    this.domElement.removeEventListener('pointerdown', this.canvasPointerDownHandler, { capture: true });
    document.removeEventListener('pointermove', this.onPointerMove);
    document.removeEventListener('pointerup', this.onPointerUp);
  }
}
