import {useEffect,useRef,useState} from 'react';
import * as T from 'three';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js';
import {TrackballControls} from 'three/examples/jsm/controls/TrackballControls.js';
import {TransformControls} from 'three/examples/jsm/controls/TransformControls.js';
import {RoomEnvironment} from 'three/examples/jsm/environments/RoomEnvironment.js';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {createExplosionLayout} from './explosion-layout';
import {decodeModelResponse} from './model-download';
import {PointerTap} from './pointer-tap';
import {SYSTEMS,type Atlas,type SceneState} from './anatomy';
import { initializeHandTracking, startCamera, startTracking } from '../lib/hand-tracking';
import { InteractionCommand } from '../lib/gestures';
import { playConfirmationSound, playGrabSound, playSnapSound } from '@/lib/audio-manager';
import { MriEditor } from '../lib/mri-editor';
import { fitToBone, measureContent, type ImageContent } from '@/lib/mri-align';
import { getRegionBox, type RegionId } from '@/lib/vista/atlas-regions';

import { Maximize2, Minimize2 } from 'lucide-react';

export interface SceneActions {
  setTransformMode: (mode: 'translate' | 'rotate' | 'scale') => void;
  setMode: (mode: 'standard' | 'exoskeleton' | 'mri' | 'hidden') => void;
  setMriTarget: (target: 'body' | 'mri') => void;
  autoAlignToBone: () => void;
  /** Lay the loaded scan over a named skeletal region. */
  alignToRegion: (region: RegionId, side: 'left' | 'right' | null) => void;
  takeSnapshot?: () => Promise<string>;
}

interface Props {atlas:Atlas;state:SceneState;onSelect:(id:string)=>void;onProgress:(n:number)=>void;onError:(s:string)=>void;onMriUpload:(file:File)=>void;spawnToolRef:React.MutableRefObject<((tool:'screw'|'rod'|'clip')=>void)|null>;sceneActionsRef?:React.MutableRefObject<SceneActions|null>}
export default function AnatomyScene({atlas,state,onSelect,onProgress,onError,onMriUpload,spawnToolRef,sceneActionsRef}:Props){
 const host=useRef<HTMLDivElement>(null),latest=useRef(state),select=useRef(onSelect);
 const [mode, setMode] = useState<"standard" | "exoskeleton" | "mri" | "hidden">("standard");
 const [mriTarget, setMriTarget] = useState<"body" | "mri">("mri");
 const [transformMode, setTransformMode] = useState<"translate" | "rotate" | "scale">("translate");
 const [mriEditMode, setMriEditMode] = useState<"resize" | "align">("resize");
 const [cameraExpanded, setCameraExpanded] = useState(false);
 const onMriUploadRef = useRef<((f: File | string) => void) | null>(null);
 const mriTargetRef = useRef(mriTarget);
 const transformModeRef = useRef(transformMode);
 const mriEditModeRef = useRef(mriEditMode);
 const modeRef = useRef(mode);
 const transformControlsRef = useRef<TransformControls | null>(null);
 const mriEditorRef = useRef<MriEditor | null>(null);
 // Where the anatomy sits inside the loaded frame; set once the texture decodes.
 const mriContentRef = useRef<ImageContent | null>(null);
 // Region the scan is laid over. The sample scan is a left femoral neck study.
 const alignTargetRef = useRef<{region: RegionId; side: 'left' | 'right' | null}>({region: 'femur', side: 'left'});
 // Depth the last alignment put the plane at, so the Depth slider offsets from it.
 const alignDepthRef = useRef(0.4);
 // Set when a region was identified before the scan finished decoding.
 const pendingAlignRef = useRef(false);
 const dirtyRef = useRef<boolean>(true);
 mriTargetRef.current = mriTarget;
 transformModeRef.current = transformMode;
 mriEditModeRef.current = mriEditMode;
 modeRef.current = mode;
 latest.current=state;select.current=onSelect;

  const updateTransformMode = (m: "translate" | "rotate" | "scale") => {
    // Map legacy voice commands to new Canva-style modes
    const targetMode = m === 'scale' || m === 'rotate' ? 'resize' : 'align';
    setMriEditMode(targetMode);
    mriEditModeRef.current = targetMode;
    if (mriEditorRef.current) {
      mriEditorRef.current.mode = targetMode;
    }
    dirtyRef.current = true;
  };

  /**
   * Lay the scan over a skeletal region: the imaged anatomy is measured, sized
   * to that region's bounding box with the frame's aspect ratio intact, and
   * centred on it at the bone's own depth so the plane slices through.
   */
  const alignToRegion = (region: RegionId, side: 'left' | 'right' | null, silent = false) => {
    alignTargetRef.current = {region, side};
    const mesh = mriEditorRef.current?.mesh;
    const content = mriContentRef.current;
    // Identified before the scan decoded — the decode callback will retry.
    if (!mesh || !content) { pendingAlignRef.current = true; return; }
    // Fall back to both sides when the atlas has no parts for the named one.
    const box = getRegionBox(atlas, region, side ?? undefined) ?? getRegionBox(atlas, region);
    if (!box) return;

    const fit = fitToBone(content, box);
    mesh.scale.set(fit.scaleX, fit.scaleY, 1);
    mesh.position.set(fit.position[0], fit.position[1], fit.position[2]);
    mesh.rotation.set(0, 0, 0);
    alignDepthRef.current = fit.position[2];

    dirtyRef.current = true;
    if (!silent) playConfirmationSound();
  };

  const autoAlignToBone = () => {
    const {region, side} = alignTargetRef.current;
    alignToRegion(region, side);
  };

  const snapshotRequestRef = useRef<((dataUrl: string) => void) | null>(null);

  if (sceneActionsRef) {
    sceneActionsRef.current = {
      setTransformMode: updateTransformMode,
      setMode: (m) => {
        setMode(m);
        modeRef.current = m;
        dirtyRef.current = true;
      },
      setMriTarget: (t) => {
        setMriTarget(t);
        mriTargetRef.current = t;
        dirtyRef.current = true;
      },
      autoAlignToBone,
      alignToRegion,
      takeSnapshot: () => {
         return new Promise((resolve) => {
            snapshotRequestRef.current = resolve;
            dirtyRef.current = true;
         });
      }
    };
  }
 useEffect(()=>{
  const el=host.current!;let disposed=false,frame=0,dirty=true,ready=false,lastView='',lastReset=-1,lastIsolate='',layoutKey='',amount=0;
  let lastState:SceneState|null=null;
  const abort=new AbortController();
  let renderer:T.WebGLRenderer;
  try{renderer=new T.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance'});}catch{onError('This browser could not start the 3D viewer. Please try a browser with WebGL enabled.');return;}
  renderer.setPixelRatio(Math.min(devicePixelRatio,innerWidth<768?1.5:2));renderer.setClearColor('#f2f3f3');renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.CineonToneMapping;renderer.toneMappingExposure=0.92;el.appendChild(renderer.domElement);
  renderer.domElement.setAttribute('aria-label','Interactive human anatomy. Drag to orbit, pinch or scroll to zoom, and tap a structure to inspect it.');
  const scene=new T.Scene(),camera=new T.PerspectiveCamera(34,1,.005,100),controls=new OrbitControls(camera,renderer.domElement);
  const trackball=new TrackballControls(camera,renderer.domElement);
  trackball.rotateSpeed = 4.0; trackball.zoomSpeed = 1.2; trackball.panSpeed = 0.8; trackball.addEventListener('change',()=>{dirty=true;});
  camera.position.set(1.4,1.05,3.6);controls.target.set(0,.85,0);controls.enableDamping=true;controls.dampingFactor=.085;controls.minDistance=.07;controls.maxDistance=40;controls.minPolarAngle=0;controls.maxPolarAngle=Math.PI;controls.addEventListener('change',()=>{dirty=true;});
  scene.add(camera);
  const mriTextureRef = { current: null as T.Texture | null };
  onMriUploadRef.current = (file: File | string) => {
    const url = typeof file === 'string' ? file : URL.createObjectURL(file);
    if (mriEditorRef.current) {
      scene.remove(mriEditorRef.current.mesh);
      mriEditorRef.current.dispose();
    }
    // A new scan invalidates the previous frame's measurements.
    mriContentRef.current = null;
    const texture = new T.TextureLoader().load(url, (tex) => {
      const img = tex.image;
      if (img && (img.naturalWidth || img.width)) {
        // Measure where the anatomy sits in the frame so it can be sized to a bone.
        const content = measureContent(img);
        mriContentRef.current = content;
        const mesh = mriEditorRef.current?.mesh;
        if (mesh) {
          // Frame aspect, as a floor in case there is no region box to fit to.
          mesh.scale.set(content.aspect, 1, 1);
          mriEditorRef.current?.update();
        }
        // Size it against a bone as soon as it is measurable. Without this the
        // plane keeps the geometry's 1.5 m default — nearly as tall as the whole
        // body — until something explicitly asks for an alignment.
        pendingAlignRef.current = false;
        const {region, side} = alignTargetRef.current;
        alignToRegion(region, side, true);
      }
      dirty = true;
    });
    mriTextureRef.current = texture;
    const geo = new T.PlaneGeometry(1.5, 1.5);
    const mat = new T.MeshBasicMaterial({ map: texture, side: T.DoubleSide, transparent: true, opacity: 0.85, depthWrite: false });
    const mesh = new T.Mesh(geo, mat);
    mesh.position.set(0.6, 1.0, 0.4); // Placed in the physical scene next to the body
    scene.add(mesh);
    const overlayElement = document.getElementById('mri-editor-overlay');
    if (overlayElement) {
      mriEditorRef.current = new MriEditor(mesh, camera, renderer.domElement, overlayElement, () => {
         dirtyRef.current = true;
      });
    }
    dirty = true;
  };
  (window as any).mriTextureRef = mriTextureRef;
   // Load default image for the simulation if none loaded yet
   setTimeout(() => {
     if (onMriUploadRef.current && !mriTextureRef.current) {
       onMriUploadRef.current('/MRI-of-a-Stress-Fracture-in-the-Left-Femoral-Neck-MRI-image-showing-a-stress-fracture-of_Q320.webp');
     }
   }, 500);
  // Additive bridge for opt-in features (the VISTA-3D bone reconstruction).
  // It only exposes the scene and a redraw request; nothing here changes how
  // the viewer itself builds, animates or renders.
  (window as any).__anatomyScene = {
    scene, camera, requestRender: () => { if (!disposed) dirty = true; },
    extractFemur: () => {
      const femurIdx = atlas.parts.findIndex(p => p.id === 'FMA24475'); // Left Femur
      if (femurIdx < 0 || !pickers[femurIdx]) return;
      
      // Hide original femur in the atlas shader
      data[femurIdx * 4 + 3] = 0;
      partTexture.needsUpdate = true;
      
      // Extract vertices into a standalone geometry
      const femurGeo = pickers[femurIdx].geometry.clone();
      // Reset translation so TransformControls gizmo is centered
      femurGeo.computeBoundingBox();
      const center = new T.Vector3();
      femurGeo.boundingBox?.getCenter(center);
      femurGeo.translate(-center.x, -center.y, -center.z);
      
      const mat = new T.MeshStandardMaterial({ color: 0xffffff, metalness: 0.1, roughness: 0.4 });
      const femurMesh = new T.Mesh(femurGeo, mat);
      femurMesh.position.copy(center);
      scene.add(femurMesh);
      
      transformControls.attach(femurMesh);
      transformControls.setMode('translate');
      transformControls.visible = true;
      transformControls.enabled = true;
      
      dirty = true;
    }
  };
  if (spawnToolRef) {
    spawnToolRef.current = (toolType: 'screw' | 'rod' | 'clip') => {
      let geo: T.BufferGeometry;
      let mat = new T.MeshStandardMaterial({ color: 0x8899a6, metalness: 0.9, roughness: 0.2 });
      if (toolType === 'screw') {
        const body = new T.CylinderGeometry(0.02, 0.01, 0.3, 16);
        const head = new T.CylinderGeometry(0.04, 0.04, 0.05, 6);
        head.translate(0, 0.15, 0);
        geo = mergeGeometries([body, head]);
      } else if (toolType === 'rod') {
        geo = new T.CylinderGeometry(0.03, 0.03, 1.0, 16);
      } else if (toolType === 'clip') {
        const g1 = new T.BoxGeometry(0.02, 0.1, 0.02);
        g1.translate(0.02, 0, 0);
        g1.rotateZ(0.2);
        const g2 = new T.BoxGeometry(0.02, 0.1, 0.02);
        g2.translate(-0.02, 0, 0);
        g2.rotateZ(-0.2);
        geo = mergeGeometries([g1, g2]);
      } else { return; }
      
      const mesh = new T.Mesh(geo, mat);
      mesh.position.set(0, 0, -1.5);
      camera.add(mesh);
      transformControls.attach(mesh);
      dirty = true;
    };
  }

  const pmrem=new T.PMREMGenerator(renderer),room=new RoomEnvironment(),env=pmrem.fromScene(room,.04);scene.environment=env.texture;room.dispose();pmrem.dispose();
  scene.add(new T.HemisphereLight(0xffffff,0xa7acb2,0.85));
  const key=new T.DirectionalLight(0xfffaf4,1.8);key.position.set(-2,4,3);scene.add(key);
  const rim=new T.DirectionalLight(0xe9f0ff,1.35);rim.position.set(2,2,-3);scene.add(rim);
  const ground=new T.Mesh(new T.CircleGeometry(30,96),new T.MeshStandardMaterial({color:0xd5d9dc,roughness:1}));ground.rotation.x=-Math.PI/2;ground.position.y=-.019;scene.add(ground);
  const platform=new T.Mesh(new T.CylinderGeometry(.68,.7,.028,100),new T.MeshStandardMaterial({color:0xeeeeec,metalness:.12,roughness:.67}));platform.position.y=-.016;scene.add(platform);
  const ring=new T.Mesh(new T.RingGeometry(.63,.632,128),new T.MeshBasicMaterial({color:0x8c969f,transparent:true,opacity:.4,side:T.DoubleSide}));ring.rotation.x=-Math.PI/2;ring.position.y=.001;scene.add(ring);
  const innerRing=new T.Mesh(new T.RingGeometry(.55,.551,128),new T.MeshBasicMaterial({color:0xa4aeb8,transparent:true,opacity:.16,side:T.DoubleSide}));innerRing.rotation.x=-Math.PI/2;innerRing.position.y=.001;scene.add(innerRing);
  const width=T.MathUtils.ceilPowerOfTwo(atlas.parts.length),data=new Float32Array(width*4),partTexture=new T.DataTexture(data,width,1,T.RGBAFormat,T.FloatType);partTexture.needsUpdate=true;
  const selectedData=new Uint8Array(width*4),selectionTexture=new T.DataTexture(selectedData,width,1);selectionTexture.needsUpdate=true;
  const materials:T.Material[]=[],geometries:T.BufferGeometry[]=[],pickers:(T.Mesh|undefined)[]=[],centers=atlas.parts.map(p=>new T.Vector3().fromArray(p.bounds[0]).add(new T.Vector3().fromArray(p.bounds[1])).multiplyScalar(.5));
  const offsets:T.Vector3[]=[],bounds=atlas.parts.map(p=>new T.Box3(new T.Vector3().fromArray(p.bounds[0]),new T.Vector3().fromArray(p.bounds[1])));
  let packingWidth=1,packingHeight=1;
  const markerPositions=new Float32Array(atlas.parts.length*3),markerGeometry=new T.BufferGeometry();markerGeometry.setAttribute('position',new T.BufferAttribute(markerPositions,3));
  const markerMaterial=new T.PointsMaterial({color:0x64748b,size:5,sizeAttenuation:false,transparent:true,opacity:.72,depthTest:false});
  markerMaterial.onBeforeCompile=shader=>{shader.fragmentShader=shader.fragmentShader.replace('#include <clipping_planes_fragment>','#include <clipping_planes_fragment>\nif (distance(gl_PointCoord, vec2(0.5)) > 0.5) discard;');};
  const markers=new T.Points(markerGeometry,markerMaterial);markers.frustumCulled=false;markers.renderOrder=10;markers.visible=false;scene.add(markers);
  const hover=document.createElement('div');hover.className='part-hover';hover.setAttribute('role','tooltip');hover.hidden=true;el.appendChild(hover);
  type Target={index:number;x:number;y:number;left:number;right:number;top:number;bottom:number};let targets:Target[]=[];
  const projected=new T.Vector3();
  const findTarget=(x:number,y:number,radius:number)=>{
   let best=-1,score=Infinity;
   for(const t of targets){const dx=Math.max(t.left-x,0,x-t.right),dy=Math.max(t.top-y,0,y-t.bottom),distance=Math.hypot(dx,dy);if(distance>radius)continue;const candidate=distance+Math.hypot(t.x-x,t.y-y)*.025;if(candidate<score){score=candidate;best=t.index;}}
   return best;
  };
  const materialFor=(system:string)=>{
   const m=new T.MeshStandardMaterial({color:SYSTEMS.find(s=>s.id===system)?.color??'#aebbb8',metalness:.08,roughness:.53,side:T.DoubleSide,transparent:system==='integumentary',opacity:system==='integumentary'?.1:1,depthWrite:system!=='integumentary'});
   m.onBeforeCompile=shader=>{
    shader.uniforms.partState={value:partTexture};shader.uniforms.selectionState={value:selectionTexture};shader.uniforms.stateWidth={value:width};
    shader.vertexShader='attribute float partIndex; uniform sampler2D partState; uniform sampler2D selectionState; uniform float stateWidth; varying float partVisible; varying float partSelected;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvec2 stateUv = vec2((partIndex + 0.5) / stateWidth, 0.5); vec4 state = texture2D(partState, stateUv); transformed += state.xyz; partVisible = state.w; partSelected = texture2D(selectionState, stateUv).r;');
    shader.fragmentShader='varying float partVisible; varying float partSelected;\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <clipping_planes_fragment>','#include <clipping_planes_fragment>\nif (partVisible < 0.5) discard;');
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>','#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.42, 0.85, 0.78), partSelected * 0.75);');
   };materials.push(m);return m;
  };
  const mats=new Map(SYSTEMS.map(s=>[s.id,materialFor(s.id)]));
  let loaded=0;
  const loadChunk=async(ci:number)=>{
   const chunk=atlas.chunks[ci],compressed=!!chunk.gzip&&typeof DecompressionStream!=='undefined';const response=await fetch(compressed?chunk.gzip!:chunk.url,{signal:abort.signal});const buffer=await decodeModelResponse(response,chunk.bytes,compressed);if(disposed)return;
   const groups=new Map<string,T.BufferGeometry[]>();
   atlas.parts.forEach((p,i)=>{
    if(p.chunk!==ci)return;
    const g=new T.BufferGeometry();g.setAttribute('position',new T.BufferAttribute(new Float32Array(buffer,p.positions,p.vertexCount*3),3));
    g.setAttribute('normal',new T.BufferAttribute(new Int16Array(buffer,p.normals,p.vertexCount*3),3,true));g.setIndex(new T.BufferAttribute(new Uint32Array(buffer,p.indices,p.indexCount),1));
    g.boundingBox=bounds[i].clone();g.computeBoundingSphere();const pick=new T.Mesh(g);pick.matrixAutoUpdate=false;pickers[i]=pick;geometries.push(g);
    g.setAttribute('partIndex',new T.BufferAttribute(new Float32Array(p.vertexCount).fill(i),1));
    const list=groups.get(p.system)??[];list.push(g);groups.set(p.system,list);
   });
   groups.forEach((gs,system)=>{const geometry=mergeGeometries(gs,false);if(!geometry)throw new Error('Could not assemble anatomy geometry.');geometries.push(geometry);const mesh=new T.Mesh(geometry,mats.get(system as never));mesh.frustumCulled=false;scene.add(mesh);});
   lastState=null;loaded++;onProgress(Math.round(loaded/atlas.chunks.length*100));dirty=true;
  };
  (async()=>{try{let cursor=0;await Promise.all(Array.from({length:3},async()=>{while(cursor<atlas.chunks.length){const i=cursor++;await loadChunk(i);}}));if(!disposed){ready=true;dirty=true;}}catch(e){if(!disposed)onError(e instanceof Error?e.message:'Could not load the anatomy.');}})();
   const fit=(view:string,extent=0)=>{
    const aspect=camera.aspect,mobile=el.clientWidth<768,normalDistance=mobile?Math.max(4.5,1.8*el.clientHeight/Math.max(160,el.clientHeight-350)/(2*Math.tan(T.MathUtils.degToRad(camera.fov/2)))):4;
    const reservedHeight=mobile?350:270;const availableAspect=Math.max(.35,(el.clientWidth-(mobile?40:340))/Math.max(160,el.clientHeight-reservedHeight));const atlasDistance=Math.max(packingHeight,packingWidth/availableAspect)/(2*Math.tan(T.MathUtils.degToRad(camera.fov/2)))*(el.clientHeight/Math.max(160,el.clientHeight-reservedHeight))*1.08;
    const distance=T.MathUtils.lerp(normalDistance,Math.max(.2,atlasDistance),extent);if(extent>.8)view='front';
    const direction=view==='front'?new T.Vector3(0,.02,1):view==='back'?new T.Vector3(0,.02,-1):view==='side'?new T.Vector3(1,.02,0):new T.Vector3(.35,.06,1).normalize();
    controls.target.set(extent>.1&&el.clientWidth>767?-packingWidth*.12:0,extent>.1||mobile?.85:.68,0);trackball.target.copy(controls.target);camera.position.copy(controls.target).addScaledVector(direction,distance);controls.update();trackball.update();dirty=true;
   };
  const resize=()=>{layoutKey='';lastState=null;renderer.setPixelRatio(Math.min(devicePixelRatio,el.clientWidth<768||el.clientHeight<600?1.5:2));camera.aspect=el.clientWidth/el.clientHeight;camera.updateProjectionMatrix();renderer.setSize(el.clientWidth,el.clientHeight);fit(latest.current.view,amount);};const observer=new ResizeObserver(resize);observer.observe(el);
  const raycaster=new T.Raycaster(),pointer=new T.Vector2(),tap=new PointerTap(),worldBox=new T.Box3(),hitPoint=new T.Vector3();
  const down=(e:PointerEvent)=>{hover.hidden=true;tap.down(e.pointerId,e.clientX,e.clientY,e.pointerType==='touch'?12:5);};
  const move=(e:PointerEvent)=>{tap.move(e.pointerId,e.clientX,e.clientY);if(e.buttons||amount<.5||e.pointerType==='touch'){hover.hidden=true;return;}const rect=el.getBoundingClientRect(),x=e.clientX-rect.left,y=e.clientY-rect.top,index=findTarget(x,y,12);hover.hidden=index<0;renderer.domElement.style.cursor=index<0?'grab':'pointer';if(index>=0){hover.textContent=atlas.parts[index].name;hover.style.left=`${Math.max(8,Math.min(x+14,el.clientWidth-260))}px`;hover.style.top=`${Math.max(8,Math.min(y+18,el.clientHeight-55))}px`;}};
  const cancel=(e:PointerEvent)=>tap.cancel(e.pointerId);
  const up=(e:PointerEvent)=>{
   const validTap=tap.up(e.pointerId,e.clientX,e.clientY);if(!validTap||!ready)return;const rect=renderer.domElement.getBoundingClientRect();pointer.set((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);raycaster.setFromCamera(pointer,camera);
   let nearest=Infinity,found=-1;const hasSolid=atlas.parts.some((p,i)=>p.system!=='integumentary'&&data[i*4+3]>.5);
   pickers.forEach((mesh,i)=>{if(!mesh||data[i*4+3]<.5||(hasSolid&&atlas.parts[i].system==='integumentary'))return;worldBox.copy(bounds[i]).translate(mesh.position);if(!raycaster.ray.intersectBox(worldBox,hitPoint))return;const hits=raycaster.intersectObject(mesh,false);if(hits[0]&&hits[0].distance<nearest){nearest=hits[0].distance;found=i;}});
   if(found<0&&amount>.45)found=findTarget(e.clientX-rect.left,e.clientY-rect.top,e.pointerType==='touch'?24:16);if(found>=0){hover.hidden=true;select.current(atlas.parts[found].id);}
  };
  renderer.domElement.addEventListener('pointerdown',down);renderer.domElement.addEventListener('pointermove',move);renderer.domElement.addEventListener('pointerup',up);renderer.domElement.addEventListener('pointercancel',cancel);
  const clock=new T.Clock();let lastExtent=-1;
  const animate=()=>{
   if(disposed)return;frame=requestAnimationFrame(animate);const dt=Math.min(clock.getDelta(),.05),s=latest.current;
   if (mriEditorRef.current) {
     const isMriMode = modeRef.current === 'mri';
     mriEditorRef.current.mesh.visible = isMriMode;
     mriEditorRef.current.update();
   }
   const changed=lastState?.visible!==s.visible||lastState?.selected!==s.selected||lastState?.isolate!==s.isolate;
   const moving=Math.abs(amount-s.explode)>.0001;
   if(moving){amount=T.MathUtils.damp(amount,s.explode,8,dt);dirty=true;}
   if(changed||moving||lastExtent<0){
    const visible=new Set(s.visible),selection=new Set(s.selected);
    const visibleParts=atlas.parts.filter(p=>s.isolate?(selection.has(p.id) || p.system === 'nervous'):visible.has(p.system)||selection.has(p.id));
    const nextLayoutKey=visibleParts.map(p=>p.id).join(',')+':'+camera.aspect.toFixed(3);
    if(nextLayoutKey!==layoutKey){const layout=createExplosionLayout(visibleParts,camera.aspect);packingWidth=layout.width;packingHeight=layout.height;atlas.parts.forEach((p,i)=>{const cell=layout.cells.get(p.id);offsets[i]=cell?new T.Vector3(cell.x,cell.y+.85,0):centers[i].clone();});layoutKey=nextLayoutKey;if(amount>.05&&!s.isolate)fit(s.view,Math.max(0,(amount-.3)/.7));}

    atlas.parts.forEach((p,i)=>{
     const c=centers[i],destination=offsets[i];let dx=0,dy=0,dz=0;
     if(amount<=.45){const t=amount/.45;const group=SYSTEMS.findIndex(sys=>sys.id===p.system);const angle=group/SYSTEMS.length*Math.PI*2;dx=Math.sin(angle)*t*.48;dy=(c.y-.85)*t*.28;dz=Math.cos(angle)*t*.48;}
     else {const t=(amount-.45)/.55,group=SYSTEMS.findIndex(sys=>sys.id===p.system),angle=group/SYSTEMS.length*Math.PI*2;dx=T.MathUtils.lerp(Math.sin(angle)*.48,destination.x-c.x,t);dy=T.MathUtils.lerp((c.y-.85)*.28,destination.y-c.y,t);dz=T.MathUtils.lerp(Math.cos(angle)*.48,-c.z,t);}
     const selected=selection.has(p.id);data.set([dx,dy,dz,(s.isolate?(selected || p.system === 'nervous'):visible.has(p.system)||selected)?1:0],i*4);selectedData[i*4]=selected?255:0;
     markerPositions.set(data[i*4+3]>.5?[c.x+dx,c.y+dy,c.z+dz]:[10000,10000,10000],i*3);const mesh=pickers[i];if(mesh){mesh.position.set(dx,dy,dz);mesh.updateMatrix();mesh.updateMatrixWorld(true);}
    });partTexture.needsUpdate=true;selectionTexture.needsUpdate=true;markerGeometry.attributes.position.needsUpdate=true;lastState=s;lastExtent=amount;dirty=true;
   }
   if(s.view!==lastView||s.reset!==lastReset){fit(s.view,amount);lastView=s.view;lastReset=s.reset;}
   if(moving&&!s.isolate)fit(amount>.5?'front':s.view,Math.max(0,(amount-.3)/.7));
   const isolateKey=s.isolate?s.selected.join(',')+':'+s.reset+':'+s.inspectorOpen+':'+camera.aspect:'';
   if(isolateKey!==lastIsolate||(s.isolate&&moving)){
     if(s.isolate){const box=new T.Box3();atlas.parts.forEach((p,i)=>{if(s.selected.includes(p.id))box.union(bounds[i].clone().translate(new T.Vector3(data[i*4],data[i*4+1],data[i*4+2])));});
      if(!box.isEmpty()){const center=box.getCenter(new T.Vector3()),size=box.getSize(new T.Vector3());const w=el.clientWidth,h=el.clientHeight,mobile=w<768,landscape=w>h&&h<=600;let left=20,right=w-20,top=mobile?175:110,bottom=h-170;if(s.inspectorOpen){if(landscape){right=w-335;top=100;bottom=h-125;}else if(mobile){const sheet=document.querySelector('.detail-sheet')?.getBoundingClientRect(),header=document.querySelector('.identity')?.getBoundingClientRect();top=(header?.bottom??94)+16;bottom=(sheet?.top??h*.58-139)-16;}else{right=w-370;left=w>1100?285:25;}}const availableWidth=Math.max(150,right-left),availableHeight=Math.max(40,bottom-top);camera.setViewOffset(w,h,w/2-(left+right)/2,h/2-(top+bottom)/2,w,h);const distance=Math.max(.07,Math.max(size.y*h/availableHeight,size.x*w/availableWidth/camera.aspect,size.z)/(2*Math.tan(T.MathUtils.degToRad(camera.fov/2)))*1.35);controls.maxDistance=Math.max(40,distance*2);controls.target.copy(center);trackball.target.copy(center);camera.position.copy(center).add(new T.Vector3(.2,.1,1).normalize().multiplyScalar(distance));controls.update();trackball.update();dirty=true;}
     }else if(lastIsolate){camera.clearViewOffset();fit(s.view,amount);}
    lastIsolate=isolateKey;
   }
   // Camera is always allowed; interactions on the MRI image are isolated by stopPropagation in MriEditor.
   controls.enabled = (!s.isolate);
   trackball.enabled = (s.isolate);
   controls.enableRotate=amount<.8;controls.mouseButtons.LEFT=amount<.8?T.MOUSE.ROTATE:T.MOUSE.PAN;controls.touches.ONE=amount<.8?T.TOUCH.ROTATE:T.TOUCH.PAN;ground.visible=platform.visible=ring.visible=innerRing.visible=amount<.5&&!s.isolate;markers.visible=amount>.75;controls.autoRotate=s.rotate&&!s.isolate&&amount<.4;controls.autoRotateSpeed=.65;
   if(controls.enabled){controls.update();if(controls.autoRotate)dirty=true;}
   if(trackball.enabled){trackball.update();}
   if(dirty || dirtyRef.current){
    renderer.render(scene,camera);
    if (snapshotRequestRef.current) {
       const dataUrl = renderer.domElement.toDataURL('image/jpeg', 0.85);
       snapshotRequestRef.current(dataUrl);
       snapshotRequestRef.current = null;
    }
    targets=[];if(amount>.45){const hasSolid=atlas.parts.some((p,i)=>p.system!=='integumentary'&&data[i*4+3]>.5);atlas.parts.forEach((p,i)=>{if(data[i*4+3]<.5||(hasSolid&&p.system==='integumentary'))return;let left=Infinity,right=-Infinity,top=Infinity,bottom=-Infinity;for(let corner=0;corner<8;corner++){projected.set(p.bounds[(corner&1)?1:0][0]+data[i*4],p.bounds[(corner&2)?1:0][1]+data[i*4+1],p.bounds[(corner&4)?1:0][2]+data[i*4+2]).project(camera);const x=(projected.x+1)*el.clientWidth/2,y=(1-projected.y)*el.clientHeight/2;left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}projected.copy(centers[i]).add(new T.Vector3(data[i*4],data[i*4+1],data[i*4+2])).project(camera);if(projected.z< -1||projected.z>1)return;targets.push({index:i,x:(projected.x+1)*el.clientWidth/2,y:(1-projected.y)*el.clientHeight/2,left,right,top,bottom});});}dirty=false;dirtyRef.current=false;}
  };animate();
  const contextLost=(e:Event)=>{e.preventDefault();onError('The 3D session was paused by your device. Reload to continue.');};renderer.domElement.addEventListener('webglcontextlost',contextLost);

  // Orbit the camera around the current target by spherical deltas (radians).
  const orbitBy=(dTheta:number,dPhi:number)=>{
   const offset=camera.position.clone().sub(controls.target);
   const sph=new T.Spherical().setFromVector3(offset);
   sph.theta-=dTheta;sph.phi-=dPhi;
   sph.phi=Math.max(0.05,Math.min(Math.PI-0.05,sph.phi));
   offset.setFromSpherical(sph);
   camera.position.copy(controls.target).add(offset);camera.lookAt(controls.target);
   controls.update();trackball.target.copy(controls.target);dirty=true;
  };
  // Dolly the camera toward/away from the target. scale<1 moves closer (zoom in).
  const dollyBy=(scale:number)=>{
   const offset=camera.position.clone().sub(controls.target);
   const nextLen=offset.length()*scale;
   if(nextLen<controls.minDistance||nextLen>controls.maxDistance)return;
   offset.multiplyScalar(scale);camera.position.copy(controls.target).add(offset);
   controls.update();trackball.target.copy(controls.target);dirty=true;
  };
  // Slide camera + target across the view plane. Positive dx drags the model right.
  const panBy=(dx:number,dy:number)=>{
   camera.updateMatrixWorld();
   const dist=camera.position.distanceTo(controls.target);
   const viewHeight=2*dist*Math.tan(T.MathUtils.degToRad(camera.fov/2));
   const right=new T.Vector3().setFromMatrixColumn(camera.matrixWorld,0);
   const up=new T.Vector3().setFromMatrixColumn(camera.matrixWorld,1);
   const move=new T.Vector3().addScaledVector(right,-dx*viewHeight*camera.aspect).addScaledVector(up,dy*viewHeight);
   camera.position.add(move);controls.target.add(move);
   controls.update();trackball.target.copy(controls.target);dirty=true;
  };

  let lastX = 0, lastY = 0;
  // Two-finger rotate/pivot state (smoothed hand position + finger angle).
  let rotActive = false, rotSX = 0, rotSY = 0, rotSRoll = 0;
  // Closed-fist pan state (smoothed hand position).
  let panActive = false, panSX = 0, panSY = 0;
  // Two-hand pinch zoom state.
  let prevZoom = 0;
  const SMOOTH = 0.7;        // weight of the newest sample (higher = snappier, noisier)
  const HOLD_POS = 0.002;    // hand travel below this (normalised) is treated as "held still"
  const HOLD_ROLL = 0.008;   // finger-angle change below this (radians) is treated as "held still"
  const ROTATE_GAIN = 3.4;   // finger travel across the view -> radians of orbit
  const ROLL_GAIN = 2.2;     // finger rotation in camera space -> spin about the vertical axis
  const PAN_GAIN = 1.6;      // hand travel across the view -> viewport-heights of pan
  const initTracking = async () => {
    const video = document.getElementById('hand-video') as HTMLVideoElement;
    const canvas = document.getElementById('hand-canvas') as HTMLCanvasElement;
    if (!video || !canvas) return;
    await initializeHandTracking(video, canvas, (cmd) => {
      const cursor = document.getElementById('hand-cursor');

      // Reset transient state as soon as the driving gesture stops.
      if (!cmd || cmd.type !== 'ROTATE') { rotActive = false; }
      if (!cmd || cmd.type !== 'PAN') { panActive = false; }
      if (!cmd || cmd.type !== 'ZOOM') { prevZoom = 0; }
      if (!cmd) { if (cursor) cursor.style.display = 'none'; return; }

      if (cmd.type === 'PAN') {
        // Closed fist -> grab and drag the model. A roughly still fist holds it in place.
        const hx = 1 - cmd.dx;   // un-mirror (the webcam feed is flipped)
        const hy = cmd.dy;
        if (!panActive) {
          panActive = true;
          playGrabSound();
          panSX = hx; panSY = hy;
        } else {
          const nx = panSX * (1 - SMOOTH) + hx * SMOOTH;
          const ny = panSY * (1 - SMOOTH) + hy * SMOOTH;
          const dx = nx - panSX, dy = ny - panSY;
          panSX = nx; panSY = ny;
          if (Math.hypot(dx, dy) >= HOLD_POS) panBy(dx * PAN_GAIN, dy * PAN_GAIN);
        }
        if (cursor) cursor.style.display = 'none';
        return;
      }

      if (cmd.type === 'ZOOM') {
        // Widen the distance between the pinched hands -> go in; narrow it -> pull out.
        if (prevZoom > 0 && cmd.amount > 0.0001) {
          let scale = prevZoom / cmd.amount;
          scale = Math.max(0.9, Math.min(1.1, scale));
          dollyBy(scale);
        }
        prevZoom = prevZoom === 0 ? cmd.amount : prevZoom * 0.5 + cmd.amount * 0.5;
        if (cursor) cursor.style.display = 'none';
        return;
      }

      if (cmd.type === 'ROTATE') {
        // Two fingers (index + middle). Move them to orbit/pivot the model;
        // rotate the finger pair in camera space to spin it. A still hand holds.
        const hx = 1 - cmd.dx;   // un-mirror (the webcam feed is flipped)
        const hy = cmd.dy;
        if (!rotActive) {
          rotActive = true;
          playGrabSound();
          rotSX = hx; rotSY = hy; rotSRoll = cmd.roll;
          controls.target.set(0, 1.15, 0);   // pivot around the chest, not the feet
          controls.update();
          dirty = true;
          dirtyRef.current = true;
        } else {
          // Unwrap the finger angle onto the same branch as the running value.
          let roll = cmd.roll;
          while (roll - rotSRoll > Math.PI) roll -= Math.PI * 2;
          while (roll - rotSRoll < -Math.PI) roll += Math.PI * 2;
          const nx = rotSX * (1 - SMOOTH) + hx * SMOOTH;
          const ny = rotSY * (1 - SMOOTH) + hy * SMOOTH;
          const nr = rotSRoll * (1 - SMOOTH) + roll * SMOOTH;
          const dx = nx - rotSX, dy = ny - rotSY, dr = nr - rotSRoll;
          rotSX = nx; rotSY = ny; rotSRoll = nr;
          if (Math.hypot(dx, dy) >= HOLD_POS || Math.abs(dr) >= HOLD_ROLL) {
            orbitBy(dx * ROTATE_GAIN + dr * ROLL_GAIN, dy * ROTATE_GAIN);
          }
        }
        if (cursor) cursor.style.display = 'none';
        return;
      }

      // CURSOR / SELECT -> move the on-screen pointer, click on a pinch.
      if (cmd.type === 'CURSOR' || cmd.type === 'SELECT') {
        const x = (1 - cmd.x) * window.innerWidth;
        const y = cmd.y * window.innerHeight;
        if (lastX === 0 && lastY === 0) { lastX = x; lastY = y; }
        else { lastX = lastX * 0.35 + x * 0.65; lastY = lastY * 0.35 + y * 0.65; }
        if (cursor) {
          cursor.style.display = 'block';
          cursor.style.left = `${lastX - 6}px`;
          cursor.style.top = `${lastY - 6}px`;
          cursor.style.backgroundColor = cmd.type === 'SELECT' ? 'rgba(0, 150, 255, 0.9)' : 'rgba(255, 0, 0, 0.7)';
          cursor.style.transform = cmd.type === 'SELECT' ? 'scale(1.3)' : 'scale(1)';
        }
        let target = document.elementFromPoint(lastX, lastY) || renderer.domElement;
        
        // Attempt to pierce same-origin iframes
        if (target.tagName === 'IFRAME') {
          try {
            const iframeDoc = (target as HTMLIFrameElement).contentDocument;
            if (iframeDoc) {
              const rect = target.getBoundingClientRect();
              const innerX = lastX - rect.left;
              const innerY = lastY - rect.top;
              target = iframeDoc.elementFromPoint(innerX, innerY) || target;
            }
          } catch (e) {
            // Cross-origin iframe in dev, ignore
          }
        }

        target.dispatchEvent(new PointerEvent('pointermove', { pointerId: 99, clientX: lastX, clientY: lastY, button: -1, bubbles: true, cancelable: true }));
        if (cmd.type === 'SELECT') {
          target.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 99, clientX: lastX, clientY: lastY, button: 0, buttons: 1, bubbles: true, cancelable: true }));
          target.dispatchEvent(new PointerEvent('pointerup', { pointerId: 99, clientX: lastX, clientY: lastY, button: 0, buttons: 0, bubbles: true, cancelable: true }));
          target.dispatchEvent(new MouseEvent('click', { clientX: lastX, clientY: lastY, button: 0, bubbles: true, cancelable: true }));
        }
      }
    });
    await startCamera();
    startTracking();
  };
  initTracking();

  return()=>{disposed=true;abort.abort();cancelAnimationFrame(frame);observer.disconnect();controls.dispose();if(mriEditorRef.current)mriEditorRef.current.dispose();geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());scene.traverse(o=>{if(o instanceof T.Mesh&&!geometries.includes(o.geometry)){o.geometry.dispose();const ms=Array.isArray(o.material)?o.material:[o.material];ms.forEach(m=>m.dispose());}});env.dispose();partTexture.dispose();selectionTexture.dispose();markerGeometry.dispose();markerMaterial.dispose();hover.remove();renderer.dispose();renderer.domElement.remove();};
 },[atlas]);

 const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
  if (e.target.files && e.target.files[0] && onMriUploadRef.current) {
mriEditorRef.current(e.target.files[0]);
    onMriUpload(e.target.files[0]);
  }
 };

 const [mode, setMode] = useState<'standard' | 'mri' | 'brainchop' | 'yale' | 'surgical_simulator' | 'surgery'>('standard');

 const getAppUrl = (app: 'brainchop' | 'yale' | 'surgery') => {
   if (app === 'brainchop') return import.meta.env.DEV ? 'http://localhost:3017/' : '/brainchop/dist/index.html';
   if (app === 'yale') return import.meta.env.DEV ? 'http://localhost:3018/' : '/anatomy/dist/index.html';
   if (app === 'surgery') return '/liver-surgery/index.html';
   return '';
 };

 return (
  <>
   <div className="scene" ref={host}/>
   <div id="mri-editor-overlay" style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', pointerEvents: 'none', zIndex: 1000 }}></div>
   
   <div style={{ position: 'absolute', top: '10px', left: '50%', transform: 'translateX(-50%)', zIndex: 1002, display: 'flex', gap: '8px', background: 'rgba(255,255,255,0.8)', padding: '6px', borderRadius: '8px', boxShadow: '0 2px 10px rgba(0,0,0,0.1)' }}>
    <button onClick={() => setMode('standard')} style={{background: mode==='standard'?'#e2e8f0':'transparent', padding: '6px 12px', borderRadius: '6px', fontWeight: 500, fontSize: '14px', border: 'none', cursor: 'pointer'}}>Standard</button>
    <button onClick={() => setMode('mri')} style={{background: mode==='mri'?'#e2e8f0':'transparent', padding: '6px 12px', borderRadius: '6px', fontWeight: 500, fontSize: '14px', border: 'none', cursor: 'pointer'}}>MRI Mode</button>
    <button onClick={() => setMode('brainchop')} style={{background: mode==='brainchop'?'#e2e8f0':'transparent', padding: '6px 12px', borderRadius: '6px', fontWeight: 500, fontSize: '14px', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px'}}>🧠 Brainchop</button>
    <button onClick={() => setMode('yale')} style={{background: mode==='yale'?'#e2e8f0':'transparent', padding: '6px 12px', borderRadius: '6px', fontWeight: 500, fontSize: '14px', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px'}}>🏛️ Yale Anatomy</button>
    <button onClick={() => setMode('surgical_simulator')} style={{background: mode==='surgical_simulator'?'#e2e8f0':'transparent', padding: '6px 12px', borderRadius: '6px', fontWeight: 500, fontSize: '14px', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px'}}>🔪 Surgical Sim (Yale)</button>
    <button onClick={() => setMode('surgery')} style={{background: mode==='surgery'?'#e2e8f0':'transparent', padding: '6px 12px', borderRadius: '6px', fontWeight: 500, fontSize: '14px', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px'}}>🏥 Surgery Feature</button>
   </div>

   {(mode === 'brainchop' || mode === 'yale' || mode === 'surgery') && (
     <iframe 
       src={getAppUrl(mode)} 
       style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 'none', zIndex: 1001, background: '#f8fafc' }}
       title={mode}
     />
   )}

   {mode === 'surgical_simulator' && (
     <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: 1001, background: '#1e293b', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', flexDirection: 'column' }}>
       <h2>Surgical Simulator</h2>
       <p>Loading Yale models (hospital_operating_room_ward.glb)...</p>
     </div>
   )}

   {mode === 'mri' && (
    <div style={{ position: 'absolute', top: '60px', left: '50%', transform: 'translateX(-50%)', zIndex: 1002, background: 'rgba(255,255,255,0.9)', padding: '10px', borderRadius: '8px', boxShadow: '0 2px 10px rgba(0,0,0,0.1)', display: 'flex', flexDirection: 'column', gap: '10px', alignItems: 'center' }}>
      <div>
        <label style={{ fontSize: '14px', fontWeight: 500, marginRight: '10px' }}>Upload MRI Image:</label>
        <input type="file" accept="image/*" onChange={handleFileChange} />
      </div>
      <div style={{ display: 'flex', gap: '8px', marginTop: '5px' }}>
        <button onClick={() => setMriTarget('body')} id="btn-control-body" style={{background: '#e2e8f0', padding: '4px 10px', borderRadius: '4px', fontSize: '13px', cursor: 'pointer', border: mriTarget === 'body' ? '2px solid #3b82f6' : '2px solid transparent'}}>Control Body</button>
        <button onClick={() => setMriTarget('mri')} id="btn-control-mri" style={{background: '#e2e8f0', padding: '4px 10px', borderRadius: '4px', fontSize: '13px', cursor: 'pointer', border: mriTarget === 'mri' ? '2px solid #3b82f6' : '2px solid transparent'}}>Control MRI</button>
      </div>
      {mriTarget === 'mri' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '5px', width: '100%' }}>
          <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid #ccc', paddingBottom: '8px', width: '100%', justifyContent: 'center' }}>
            <button onClick={() => { setMriEditMode('resize'); if(mriEditorRef.current) mriEditorRef.current.mode = 'resize'; }} style={{background: mriEditMode === 'resize' ? '#3b82f6' : '#e2e8f0', color: mriEditMode === 'resize' ? 'white' : 'black', padding: '6px 12px', borderRadius: '4px', fontSize: '13px', cursor: 'pointer', border: 'none', fontWeight: 'bold'}}>RESIZE</button>
            <button onClick={() => { setMriEditMode('align'); if(mriEditorRef.current) mriEditorRef.current.mode = 'align'; }} style={{background: mriEditMode === 'align' ? '#3b82f6' : '#e2e8f0', color: mriEditMode === 'align' ? 'white' : 'black', padding: '6px 12px', borderRadius: '4px', fontSize: '13px', cursor: 'pointer', border: 'none', fontWeight: 'bold'}}>ALIGN</button>
          </div>
          
          {mriEditMode === 'resize' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', justifyContent: 'center' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
                <input type="checkbox" defaultChecked={true} onChange={e => { if(mriEditorRef.current) mriEditorRef.current.aspectLocked = e.target.checked; }} />
                Lock Ratio
              </label>
               <span style={{marginLeft: '10px'}}>Opacity:</span>
               <input type="range" min="0" max="1" step="0.05" defaultValue="0.85" onChange={e => {
                  if(mriEditorRef.current && mriEditorRef.current.mesh) {
                     (mriEditorRef.current.mesh.material as T.Material).opacity = parseFloat(e.target.value);
                     dirtyRef.current = true;
                  }
               }} style={{width: '60px'}} />
            </div>
          )}
          
          {mriEditMode === 'align' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
                <span>Target: <b>Femur ▼</b></span>
              </div>
              <button onClick={autoAlignToBone} style={{background: '#10b981', color: 'white', padding: '6px 12px', borderRadius: '4px', fontSize: '13px', cursor: 'pointer', border: 'none', fontWeight: 'bold'}}>
                 AUTO ALIGN
              </button>
              
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', marginTop: '4px' }}>
                 <span style={{width: '40px'}}>Depth</span>
                 {/* Offset from the aligned depth, so nudging it keeps the plane on the bone. */}
                 <input type="range" min="-0.3" max="0.3" step="0.005" defaultValue="0" onChange={e => {
                    if (mriEditorRef.current && mriEditorRef.current.mesh) {
                       const m = mriEditorRef.current.mesh;
                       m.position.z = alignDepthRef.current + parseFloat(e.target.value);
                       dirtyRef.current = true;
                    }
                 }} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
   )}

   <div style={{
     position: 'absolute',
     top: cameraExpanded ? 0 : 'auto',
     left: cameraExpanded ? 0 : 'auto',
     bottom: cameraExpanded ? 'auto' : '16px',
     right: cameraExpanded ? 'auto' : '16px',
     width: cameraExpanded ? '100vw' : '280px',
     height: cameraExpanded ? '100vh' : 'auto',
     aspectRatio: cameraExpanded ? 'auto' : '4/3',
     zIndex: cameraExpanded ? 2000 : 2000,
     borderRadius: cameraExpanded ? '0' : '12px',
     overflow: 'hidden',
     pointerEvents: 'none',
     transition: 'all 0.3s ease',
     boxShadow: cameraExpanded ? 'none' : '0 10px 25px rgba(0,0,0,0.2)'
   }}>
     <video id="hand-video" style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)', opacity: cameraExpanded ? 0.05 : 1, transition: 'opacity 0.3s' }} playsInline muted></video>
     <canvas id="hand-canvas" style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }}></canvas>
     
     <button 
       style={{ position: 'absolute', top: '8px', right: '8px', zIndex: 2001, background: 'rgba(0,0,0,0.2)', color: 'white', border: 'none', borderRadius: '4px', padding: '6px', pointerEvents: 'auto', cursor: 'pointer', transition: 'background 0.2s' }}
       onClick={() => setCameraExpanded(!cameraExpanded)}
       title={cameraExpanded ? "Minimize" : "Expand Camera"}
     >
       {cameraExpanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
     </button>
   </div>
   <div id="hand-cursor" style={{position: 'absolute', width: '12px', height: '12px', borderRadius: '50%', backgroundColor: 'rgba(255, 0, 0, 0.7)', border: '2px solid white', boxShadow: '0 0 4px rgba(0,0,0,0.5)', zIndex: 2001, pointerEvents: 'none', display: 'none', transition: 'background-color 0.15s ease, transform 0.15s ease'}} />
  </>
 );
}
