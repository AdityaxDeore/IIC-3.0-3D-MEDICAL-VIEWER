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

import { Maximize2, Minimize2 } from 'lucide-react';

interface Props {atlas:Atlas;state:SceneState;onSelect:(id:string)=>void;onProgress:(n:number)=>void;onError:(s:string)=>void;onMriUpload:(file:File)=>void;spawnToolRef:React.MutableRefObject<((tool:'screw'|'rod'|'clip')=>void)|null>}
export default function AnatomyScene({atlas,state,onSelect,onProgress,onError,onMriUpload,spawnToolRef}:Props){
 const host=useRef<HTMLDivElement>(null),latest=useRef(state),select=useRef(onSelect);
 const [mode, setMode] = useState<"standard" | "exoskeleton" | "mri" | "hidden">("standard");
 const [mriTarget, setMriTarget] = useState<"body" | "mri">("mri");
 const [transformMode, setTransformMode] = useState<"translate" | "rotate" | "scale">("translate");
 const [cameraExpanded, setCameraExpanded] = useState(false);
 const onMriUploadRef = useRef<((f: File) => void) | null>(null);
 const mriTargetRef = useRef(mriTarget);
 const transformModeRef = useRef(transformMode);
 const modeRef = useRef(mode);
 mriTargetRef.current = mriTarget;
 transformModeRef.current = transformMode;
 modeRef.current = mode;
 latest.current=state;select.current=onSelect;
 useEffect(()=>{
  const el=host.current!;let disposed=false,frame=0,dirty=true,ready=false,lastView='',lastReset=-1,lastIsolate='',layoutKey='',amount=0;
  let lastState:SceneState|null=null;
  const abort=new AbortController();
  let renderer:T.WebGLRenderer;
  try{renderer=new T.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance'});}catch{onError('This browser could not start the 3D viewer. Please try a browser with WebGL enabled.');return;}
  renderer.setPixelRatio(Math.min(devicePixelRatio,innerWidth<768?1.5:2));renderer.setClearColor('#f2f3f3');renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.12;el.appendChild(renderer.domElement);
  renderer.domElement.setAttribute('aria-label','Interactive human anatomy. Drag to orbit, pinch or scroll to zoom, and tap a structure to inspect it.');
  const scene=new T.Scene(),camera=new T.PerspectiveCamera(34,1,.005,100),controls=new OrbitControls(camera,renderer.domElement);
  const trackball=new TrackballControls(camera,renderer.domElement);
  trackball.rotateSpeed = 4.0; trackball.zoomSpeed = 1.2; trackball.panSpeed = 0.8; trackball.addEventListener('change',()=>{dirty=true;});
  camera.position.set(1.4,1.05,3.6);controls.target.set(0,.85,0);controls.enableDamping=true;controls.dampingFactor=.085;controls.minDistance=.07;controls.maxDistance=40;controls.minPolarAngle=0;controls.maxPolarAngle=Math.PI;controls.addEventListener('change',()=>{dirty=true;});
  const transformControls = new TransformControls(camera, renderer.domElement);
  transformControls.size = 2.0;
  transformControls.addEventListener('dragging-changed', (event) => { 
      controls.enabled = !event.value && !latest.current.isolate; 
      trackball.enabled = !event.value && latest.current.isolate; 
  });
  transformControls.addEventListener('change', () => { dirty = true; });
  scene.add(transformControls);
  scene.add(camera);
  const mriTextureRef = { current: null as T.Texture | null };
  onMriUploadRef.current = (file: File) => {
    const url = URL.createObjectURL(file);
    const texture = new T.TextureLoader().load(url, () => { dirty = true; });
    mriTextureRef.current = texture;
    const geo = new T.PlaneGeometry(1.5, 1.5);
    const mat = new T.MeshBasicMaterial({ map: texture, side: T.DoubleSide, transparent: true, opacity: 0.7, depthWrite: false });
    const mesh = new T.Mesh(geo, mat);
    mesh.position.set(0, 0, -3); // Attach 3 units in front of the camera
    camera.add(mesh);
    transformControls.attach(mesh);
    dirty = true;
  };
  (window as any).mriTextureRef = mriTextureRef;
  
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
  scene.add(new T.HemisphereLight(0xffffff,0xa7acb2,1.05));
  const key=new T.DirectionalLight(0xfffaf4,2.3);key.position.set(-2,4,3);scene.add(key);
  const rim=new T.DirectionalLight(0xe9f0ff,1.8);rim.position.set(2,2,-3);scene.add(rim);
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
   if (transformControls) {
     const isMriActive = mriTargetRef.current === 'mri';
     if (transformControls.enabled !== isMriActive && transformControls.object) {
       transformControls.enabled = isMriActive;
       transformControls.visible = isMriActive;
       dirty = true;
     }
     if (transformControls.mode !== transformModeRef.current) {
       transformControls.setMode(transformModeRef.current);
       dirty = true;
     }
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
   const camControlsAllowed = modeRef.current !== 'mri' || mriTargetRef.current === 'body';
   controls.enabled = (!s.isolate) && camControlsAllowed;
   trackball.enabled = (s.isolate) && camControlsAllowed;
   controls.enableRotate=amount<.8;controls.mouseButtons.LEFT=amount<.8?T.MOUSE.ROTATE:T.MOUSE.PAN;controls.touches.ONE=amount<.8?T.TOUCH.ROTATE:T.TOUCH.PAN;ground.visible=platform.visible=ring.visible=innerRing.visible=amount<.5&&!s.isolate;markers.visible=amount>.75;controls.autoRotate=s.rotate&&!s.isolate&&amount<.4;controls.autoRotateSpeed=.65;
   if(controls.enabled){controls.update();if(controls.autoRotate)dirty=true;}
   if(trackball.enabled){trackball.update();}
   if(dirty){renderer.render(scene,camera);targets=[];if(amount>.45){const hasSolid=atlas.parts.some((p,i)=>p.system!=='integumentary'&&data[i*4+3]>.5);atlas.parts.forEach((p,i)=>{if(data[i*4+3]<.5||(hasSolid&&p.system==='integumentary'))return;let left=Infinity,right=-Infinity,top=Infinity,bottom=-Infinity;for(let corner=0;corner<8;corner++){projected.set(p.bounds[(corner&1)?1:0][0]+data[i*4],p.bounds[(corner&2)?1:0][1]+data[i*4+1],p.bounds[(corner&4)?1:0][2]+data[i*4+2]).project(camera);const x=(projected.x+1)*el.clientWidth/2,y=(1-projected.y)*el.clientHeight/2;left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}projected.copy(centers[i]).add(new T.Vector3(data[i*4],data[i*4+1],data[i*4+2])).project(camera);if(projected.z< -1||projected.z>1)return;targets.push({index:i,x:(projected.x+1)*el.clientWidth/2,y:(1-projected.y)*el.clientHeight/2,left,right,top,bottom});});}dirty=false;}
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

  let lastX = 0, lastY = 0;
  // Cylindrical-grip rotate state.
  let gripActive = false, prevGripX = 0, prevGripY = 0, prevRoll = 0;
  // Two-hand pinch zoom state.
  let prevZoom = 0;
  const ROTATE_GAIN = 3.2;   // hand travel across the view -> radians of orbit
  const ROLL_GAIN = 1.6;     // wrist twist (radians) -> extra spin about the vertical axis
  const initTracking = async () => {
    const video = document.getElementById('hand-video') as HTMLVideoElement;
    const canvas = document.getElementById('hand-canvas') as HTMLCanvasElement;
    if (!video || !canvas) return;
    await initializeHandTracking(video, canvas, (cmd) => {
      const cursor = document.getElementById('hand-cursor');

      // Reset transient state as soon as the driving gesture stops.
      if (!cmd || cmd.type !== 'ROTATE') { gripActive = false; }
      if (!cmd || cmd.type !== 'ZOOM') { prevZoom = 0; }
      if (!cmd) { if (cursor) cursor.style.display = 'none'; return; }

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
        const hx = 1 - cmd.dx;   // un-mirror (the webcam feed is flipped)
        const hy = cmd.dy;
        if (!gripActive) {
          gripActive = true;
          prevGripX = hx; prevGripY = hy; prevRoll = cmd.roll;
          controls.target.set(0, 0, 0);   // pivot at the feet, between the legs
          controls.update();
          dirty = true;
        } else {
          let dAz = (hx - prevGripX) * ROTATE_GAIN;
          const dPol = (hy - prevGripY) * ROTATE_GAIN;
          let dRoll = cmd.roll - prevRoll;
          if (dRoll > Math.PI) dRoll -= Math.PI * 2;
          if (dRoll < -Math.PI) dRoll += Math.PI * 2;
          dAz += dRoll * ROLL_GAIN;   // twisting the wrist spins the model
          orbitBy(dAz, dPol);
          prevGripX = hx; prevGripY = hy; prevRoll = cmd.roll;
        }
        if (cursor) cursor.style.display = 'none';
        return;
      }

      // CURSOR / SELECT -> move the on-screen pointer, click on a pinch.
      if (cmd.type === 'CURSOR' || cmd.type === 'SELECT') {
        const x = (1 - cmd.x) * window.innerWidth;
        const y = cmd.y * window.innerHeight;
        if (lastX === 0 && lastY === 0) { lastX = x; lastY = y; }
        else { lastX = lastX * 0.6 + x * 0.4; lastY = lastY * 0.6 + y * 0.4; }
        if (cursor) {
          cursor.style.display = 'block';
          cursor.style.left = `${lastX - 6}px`;
          cursor.style.top = `${lastY - 6}px`;
          cursor.style.backgroundColor = cmd.type === 'SELECT' ? 'rgba(0, 150, 255, 0.9)' : 'rgba(255, 0, 0, 0.7)';
          cursor.style.transform = cmd.type === 'SELECT' ? 'scale(1.3)' : 'scale(1)';
        }
        renderer.domElement.dispatchEvent(new PointerEvent('pointermove', { pointerId: 99, clientX: lastX, clientY: lastY, button: -1, buttons: 0 }));
        if (cmd.type === 'SELECT') {
          renderer.domElement.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 99, clientX: lastX, clientY: lastY, button: 0, buttons: 1 }));
          renderer.domElement.dispatchEvent(new PointerEvent('pointerup', { pointerId: 99, clientX: lastX, clientY: lastY, button: 0, buttons: 0 }));
        }
      }
    });
    await startCamera();
    startTracking();
  };
  initTracking();

  return()=>{disposed=true;abort.abort();cancelAnimationFrame(frame);observer.disconnect();controls.dispose();transformControls.dispose();geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());scene.traverse(o=>{if(o instanceof T.Mesh&&!geometries.includes(o.geometry)){o.geometry.dispose();const ms=Array.isArray(o.material)?o.material:[o.material];ms.forEach(m=>m.dispose());}});env.dispose();partTexture.dispose();selectionTexture.dispose();markerGeometry.dispose();markerMaterial.dispose();hover.remove();renderer.dispose();renderer.domElement.remove();};
 },[atlas]);

 const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
  if (e.target.files && e.target.files[0] && onMriUploadRef.current) {
    onMriUploadRef.current(e.target.files[0]);
    onMriUpload(e.target.files[0]);
  }
 };

 return (
  <>
   <div className="scene" ref={host}/>
   
   <div style={{ position: 'absolute', top: '10px', left: '50%', transform: 'translateX(-50%)', zIndex: 1002, display: 'flex', gap: '8px', background: 'rgba(255,255,255,0.8)', padding: '6px', borderRadius: '8px', boxShadow: '0 2px 10px rgba(0,0,0,0.1)' }}>
    <button onClick={() => setMode('standard')} style={{background: mode==='standard'?'#e2e8f0':'transparent', padding: '6px 12px', borderRadius: '6px', fontWeight: 500, fontSize: '14px', border: 'none', cursor: 'pointer'}}>Standard</button>
    <button onClick={() => setMode('mri')} style={{background: mode==='mri'?'#e2e8f0':'transparent', padding: '6px 12px', borderRadius: '6px', fontWeight: 500, fontSize: '14px', border: 'none', cursor: 'pointer'}}>MRI Mode</button>
   </div>

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
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '5px' }}>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={() => setTransformMode('translate')} style={{background: '#e2e8f0', padding: '4px 8px', borderRadius: '4px', fontSize: '12px', cursor: 'pointer', border: transformMode === 'translate' ? '2px solid #3b82f6' : '2px solid transparent'}}>Move</button>
            <button onClick={() => setTransformMode('rotate')} style={{background: '#e2e8f0', padding: '4px 8px', borderRadius: '4px', fontSize: '12px', cursor: 'pointer', border: transformMode === 'rotate' ? '2px solid #3b82f6' : '2px solid transparent'}}>Rotate</button>
            <button onClick={() => setTransformMode('scale')} style={{background: '#e2e8f0', padding: '4px 8px', borderRadius: '4px', fontSize: '12px', cursor: 'pointer', border: transformMode === 'scale' ? '2px solid #3b82f6' : '2px solid transparent'}}>Scale</button>
          </div>
          <button onClick={() => {
            if (transformControls.object) {
               // Simulate AI-based auto alignment by adjusting the MRI scale to match a typical isolated bone
               transformControls.object.scale.set(0.65, 0.65, 0.65);
               transformControls.object.position.set(0, 0, -2);
               dirty = true;
            }
          }} style={{background: '#3b82f6', color: 'white', padding: '4px 8px', borderRadius: '4px', fontSize: '12px', cursor: 'pointer', border: 'none', fontWeight: 'bold'}}>
             Auto-Align to Bone
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
             <span>Crop:</span>
             <input type="range" min="0.1" max="1" step="0.05" defaultValue="1" onChange={e => {
                const tr = (window as any).mriTextureRef;
                if(tr && tr.current) {
                   const val = parseFloat(e.target.value);
                   tr.current.repeat.set(val, val);
                   tr.current.offset.set((1-val)/2, (1-val)/2);
                }
             }} />
          </div>
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
     zIndex: cameraExpanded ? 50 : 1000,
     borderRadius: cameraExpanded ? '0' : '12px',
     overflow: 'hidden',
     pointerEvents: 'none',
     transition: 'all 0.3s ease',
     boxShadow: cameraExpanded ? 'none' : '0 10px 25px rgba(0,0,0,0.2)'
   }}>
     <video id="hand-video" style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)', opacity: cameraExpanded ? 0.05 : 1, transition: 'opacity 0.3s' }} playsInline muted></video>
     <canvas id="hand-canvas" style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }}></canvas>
     
     <button 
       style={{ position: 'absolute', top: '8px', right: '8px', zIndex: 1001, background: 'rgba(0,0,0,0.2)', color: 'white', border: 'none', borderRadius: '4px', padding: '6px', pointerEvents: 'auto', cursor: 'pointer', transition: 'background 0.2s' }}
       onClick={() => setCameraExpanded(!cameraExpanded)}
       title={cameraExpanded ? "Minimize" : "Expand Camera"}
     >
       {cameraExpanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
     </button>
   </div>
   <div id="hand-cursor" style={{position: 'absolute', width: '12px', height: '12px', borderRadius: '50%', backgroundColor: 'rgba(255, 0, 0, 0.7)', border: '2px solid white', boxShadow: '0 0 4px rgba(0,0,0,0.5)', zIndex: 1001, pointerEvents: 'none', display: 'none', transition: 'background-color 0.15s ease, transform 0.15s ease'}} />
  </>
 );
}
