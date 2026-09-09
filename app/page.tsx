import {flushSync} from 'react-dom';
import {registerAtlasTools} from './agent-tools';
import {useEffect,useMemo,useRef,useState} from 'react';
import {Activity,ArrowUpRight,ChevronRight,Focus,Info,Layers3,Pause,RotateCcw,RotateCw,Search,X,Mic,MicOff} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Badge} from '@/components/ui/badge';
import {Slider} from '@/components/ui/slider';
import {Switch} from '@/components/ui/switch';
import {Sheet,SheetContent,SheetTitle,SheetDescription} from '@/components/ui/sheet';
import {Combobox,ComboboxInput,ComboboxContent,ComboboxList,ComboboxItem,ComboboxEmpty} from '@/components/ui/combobox';
import AnatomyScene, { type SceneActions } from './scene';
import { AIAssistant } from './ai-assistant';
import {DEFAULT_VISIBLE,SYSTEMS,EXPLANATIONS,explanation,type Atlas,type Concept,type SceneState,type SystemId,type View} from './anatomy';
import {initVoiceCommands, startVoice, stopVoice, type VoiceCommand} from '@/lib/voice-commands';
import { playIsolateSound } from '@/lib/audio-manager';
import { classifyMRI, ClassificationResult } from '../lib/ai';
import BoneReconstructionPanel from '@/components/vista/BoneReconstructionPanel';
import HipPlanTools from '@/components/HipPlanTools';
import SliceTo3DPanel from '@/components/mri3d/SliceTo3DPanel';

const initial:SceneState={explode:0,visible:DEFAULT_VISIBLE,selected:[],isolate:false,view:'three-quarter',rotate:false,reset:0};
export default function Home(){
 const detailTitle=useRef<HTMLHeadingElement>(null);
 const [atlas,setAtlas]=useState<Atlas|null>(null),[state,setState]=useState(initial),[progress,setProgress]=useState(0),[error,setError]=useState(''),[panel,setPanel]=useState<'layers'|'search'|null>(null),[details,setDetails]=useState(false),[about,setAbout]=useState(false),[query,setQuery]=useState(''),[chosen,setChosen]=useState<Concept|null>(null),[listening,setListening]=useState(false);
 const [classification, setClassification] = useState<ClassificationResult | null>(null);
 const [classifying, setClassifying] = useState(false);
 const spawnToolRef = useRef<((tool: 'screw' | 'rod' | 'clip') => void) | null>(null);
 const sceneActionsRef = useRef<SceneActions | null>(null);
 useEffect(()=>{const abort=new AbortController();setProgress(0);setError('');setAtlas(null);setChosen(null);setDetails(false);setState({...initial,visible:DEFAULT_VISIBLE});fetch('/models/atlas.json',{signal:abort.signal}).then(r=>{if(!r.ok)throw new Error('The anatomy catalogue could not be loaded.');return r.json();}).then(data=>setAtlas(data as Atlas)).catch(e=>{if(e.name!=='AbortError')setError(e.message);});return()=>abort.abort();},[]);
 useEffect(()=>{
    const key=(e:KeyboardEvent)=>{
      if(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if(e.key==='/'){e.preventDefault();setPanel('search');setDetails(false);}
      else if(e.key==='ArrowUp'){e.preventDefault();setState(s=>({...s, view:'front'}));}
      else if(e.key==='ArrowDown'){e.preventDefault();setState(s=>({...s, view:'back'}));}
      else if(e.key==='ArrowLeft'){e.preventDefault();setState(s=>({...s, view:'side'}));}
      else if(e.key==='ArrowRight'){e.preventDefault();setState(s=>({...s, view:'three-quarter'}));}
    };
    window.addEventListener('keydown',key);
    return()=>window.removeEventListener('keydown',key);
  },[]);
 const parts=useMemo(()=>new Map(atlas?.parts.map(p=>[p.id,p])),[atlas]);
 const counts=useMemo(()=>Object.fromEntries(SYSTEMS.map(s=>[s.id,atlas?.parts.filter(p=>p.system===s.id).length??0])),[atlas]);
 const activeSystems=SYSTEMS.filter(s=>counts[s.id]>0);
 const selectedParts=state.selected.map(id=>parts.get(id)).filter(p=>!!p),selected=selectedParts[0],system=SYSTEMS.find(s=>s.id===selected?.system);
 const visibleCount=atlas?.parts.filter(p=>state.isolate?state.selected.includes(p.id):state.visible.includes(p.system)||state.selected.includes(p.id)).length??0;
 const results=useMemo(()=>{if(!atlas)return[];const term=query.toLowerCase().trim();if(!term)return ['heart','brain','liver','stomach','spleen','pancreas','urinary bladder','trachea'].map(name=>atlas.concepts.find(c=>c.name.toLowerCase()===name)).filter((x):x is Concept=>!!x);return atlas.concepts.filter(c=>c.name.toLowerCase().includes(term)||c.id.toLowerCase().includes(term)).sort((a,b)=>a.name.length-b.name.length).slice(0,80);},[atlas,query]);
 const choose=(c:Concept)=>{setChosen(c);setState(s=>({...s,selected:c.elements,isolate:s.isolate,rotate:false}));setDetails(true);setPanel(null);};
 useEffect(()=>{if(!atlas)return;return registerAtlasTools(atlas,c=>flushSync(()=>choose(c)));},[atlas]);
 const choosePart=(id:string)=>{const p=parts.get(id);if(!p)return;setChosen({id:p.conceptId,name:p.name,elements:[id]});setState(s=>({...s,selected:[id],isolate:s.isolate,rotate:false}));setDetails(true);setPanel(null);};
 const toggle=(id:SystemId)=>{setDetails(false);setState(s=>({...s,selected:[],isolate:false,visible:s.visible.includes(id)?s.visible.filter(x=>x!==id):[...s.visible,id]}));};
 const reset=()=>{setState(s=>({...initial,visible:DEFAULT_VISIBLE,reset:s.reset+1}));setChosen(null);setDetails(false);setPanel(null);};
 const openPanel=(next:'layers'|'search')=>{setDetails(false);setPanel(p=>p===next?null:next);};
  const onVoiceRef = useRef<((cmd: VoiceCommand) => void) | null>(null);
  onVoiceRef.current = (cmd: VoiceCommand) => {
    if(!atlas) return;
    if(cmd.type === 'RESET') reset();
    else if(cmd.type === 'ISOLATE') {
      setState(s => ({...s, isolate: true, explode: 0}));
      playIsolateSound();
    }
    else if(cmd.type === 'AUTO_ALIGN') {
      sceneActionsRef.current?.autoAlignToBone();
    }
    else if(cmd.type === 'SET_TRANSFORM_MODE') {
      sceneActionsRef.current?.setTransformMode(cmd.mode);
    }
    else if(cmd.type === 'SET_APP_MODE') {
      sceneActionsRef.current?.setMode(cmd.mode);
    }
    else if(cmd.type === 'SET_MRI_TARGET') {
      sceneActionsRef.current?.setMriTarget(cmd.target);
    }
    else if(cmd.type === 'SHOW' && cmd.term) {
      const term = cmd.term.toLowerCase();
      const found = atlas.concepts.find(c=>c.name.toLowerCase().includes(term) || c.id.toLowerCase().includes(term));
      if(found) choose(found);
    } else if(cmd.type === 'HIDE' && cmd.term) {
      const term = cmd.term.toLowerCase();
      const foundSystem = SYSTEMS.find(s=>s.name.toLowerCase().includes(term));
      if(foundSystem && state.visible.includes(foundSystem.id)) toggle(foundSystem.id);
    }
  };
  useEffect(()=>{if(atlas) initVoiceCommands((cmd: VoiceCommand)=>onVoiceRef.current?.(cmd));},[atlas]);
  const toggleVoice = () => { if(listening) { stopVoice(); setListening(false); } else { startVoice(); setListening(true); } };

 const onMriUpload = async (file: File) => {
    setClassifying(true);
    try {
      const result = await classifyMRI(file);
      setClassification(result);
      // Size and lay the scan over the bone it was identified as.
      sceneActionsRef.current?.alignToRegion(result.region, result.side);
    } catch (e) {
      console.error("Classification failed:", e);
    } finally {
      setClassifying(false);
    }
  };

  if(!atlas) return <main className="studio"><div className="loading glass" role="status"><Activity size={18}/><div><strong>Preparing the anatomy</strong><span>{progress}% · Loading 2,234 pieces</span><div className="loading-track"><i style={{width:`${progress}%`}}/></div></div></div></main>;
  return(
   <main className="studio">
    <div className="absolute inset-0 z-0">
      <AnatomyScene atlas={atlas} state={{...state,inspectorOpen:details&&selectedParts.length>0}} onSelect={choosePart} onProgress={n=>{setProgress(n);if(n===100)setError('');}} onError={setError} onMriUpload={onMriUpload} spawnToolRef={spawnToolRef} sceneActionsRef={sceneActionsRef} />
     </div>

     {/* NVIDIA VISTA-3D: CT/MRI volume -> skeletal mesh in this same scene. */}
     <BoneReconstructionPanel atlas={atlas} />

     {/* One 2D MRI/CT slice -> identified structure rebuilt as a 3D solid. */}
     <SliceTo3DPanel atlas={atlas} />

     {/* Entry/exit + screw/rod trajectory tools — left hip bone only. */}
     {chosen?.name?.toLowerCase() === 'left hip bone' && <HipPlanTools bounds={parts.get('FJ3288')?.bounds} />}

     {/* Surgical Plan UI Overlay */}
     {(classifying || classification) && (
       <div className="absolute right-6 top-24 w-80 bg-white/95 backdrop-blur shadow-lg rounded-xl overflow-hidden border border-slate-200 z-10 transition-all">
         <div className="bg-slate-900 text-white p-3 font-semibold flex items-center justify-between">
           <div className="flex items-center gap-2">
             <Activity size={18} />
             <span>Surgical Planner (VISTA)</span>
           </div>
           <button onClick={() => setClassification(null)} className="opacity-70 hover:opacity-100 transition"><X size={16}/></button>
         </div>
         <div className="p-4 flex flex-col gap-4 text-sm">
           {classifying ? (
             <div className="flex items-center gap-3 text-slate-500 animate-pulse">
               <div className="w-5 h-5 rounded-full border-2 border-blue-500 border-t-transparent animate-spin"/>
               Identifying the scanned region...
             </div>
           ) : classification ? (
             <>
               <div>
                 <div className="text-xs font-semibold text-slate-400 uppercase mb-1">Detected Anatomy</div>
                 <div className="text-lg font-bold text-blue-600">{classification.organ}</div>
               </div>
               <div>
                 <div className="text-xs font-semibold text-slate-400 uppercase mb-1">Possible Pathologies</div>
                 <ul className="list-disc pl-4 text-slate-700">
                   {classification.pathologies.map((p, i) => <li key={i}>{p}</li>)}
                 </ul>
               </div>
               <div>
                 <div className="text-xs font-semibold text-slate-400 uppercase mb-2">Recommended Surgical Tools</div>
                 <div className="flex flex-wrap gap-2">
                   {classification.recommendedTools.map((tool, i) => (
                     <button key={i} onClick={() => spawnToolRef.current && spawnToolRef.current(tool)} className="flex items-center gap-1 bg-slate-100 hover:bg-blue-50 border border-slate-200 hover:border-blue-300 text-slate-700 px-3 py-1.5 rounded-md transition cursor-pointer capitalize font-medium">
                       + Add {tool}
                     </button>
                   ))}
                 </div>
               </div>
             </>
           ) : null}
         </div>
       </div>
     )}

      {/* Gemini AI Assistant Overlay */}
      <AIAssistant sceneActionsRef={sceneActionsRef} />

  <header className="identity"><div className="eyebrow"><span className="status-dot"/> INTERACTIVE ANATOMY</div><h1>Human Atlas<Badge variant="outline" className="edition">3D</Badge></h1><div className="identity-meta">{atlas?atlas.parts.length.toLocaleString():'2,234'} modeled pieces <span>·</span> BodyParts3D</div></header>
  <nav className="top-actions" aria-label="Explorer panels"><Button variant="ghost" className={panel==='search'?'active':''} onClick={()=>openPanel('search')} aria-label="Search anatomy"><Search size={18}/><span>Find a structure</span><kbd>/</kbd></Button><Button variant="ghost" className="icon-button" aria-label="About this atlas" onClick={()=>{setDetails(false);setPanel(null);setAbout(true);}}><Info size={18}/></Button><Button variant="ghost" className={`icon-button ${listening?'active':''}`} onClick={toggleVoice} aria-label="Voice commands">{listening?<MicOff size={18}/>:<Mic size={18}/>}</Button></nav>
  <section className={`layers-panel glass ${panel==='layers'?'mobile-open':''}`} aria-label="Anatomical layers">
   <div className="panel-heading"><span>Systems</span><Button variant="ghost" className="mobile-only icon-button" onClick={()=>setPanel(null)} aria-label="Close systems"><X size={18}/></Button><Badge variant="secondary" className="desktop-only small-number">{activeSystems.length}</Badge></div>
   <div className="layer-presets"><Button variant="ghost" aria-pressed={activeSystems.every(x=>state.visible.includes(x.id))} onClick={()=>setState(s=>({...s,selected:[],isolate:false,visible:activeSystems.map(x=>x.id)}))}>All</Button><Button variant="ghost" aria-pressed={state.visible.length===1&&state.visible[0]==='skeletal'} onClick={()=>setState(s=>({...s,selected:[],isolate:false,visible:['skeletal']}))}>Skeleton</Button><Button variant="ghost" aria-pressed={state.visible.length===6&&['cardiac','respiratory','digestive','urinary','endocrine','reproductive'].every(id=>state.visible.includes(id as SystemId))} onClick={()=>setState(s=>({...s,selected:[],isolate:false,visible:['cardiac','respiratory','digestive','urinary','endocrine','reproductive']}))}>Organs</Button></div>
   <div className="system-list">{activeSystems.map(s=><div className={`system-row ${state.visible.includes(s.id)?'enabled':''}`} key={s.id}><Button variant="ghost" className="system-name" title={`Show only ${s.name.toLowerCase()}`} onClick={()=>setState(v=>({...v,visible:[s.id],isolate:false,selected:[]}))}><span className="system-dot" style={{background:s.color}}/>{s.name}<span className="system-count">{counts[s.id]}</span></Button><Switch checked={state.visible.includes(s.id)} onCheckedChange={()=>toggle(s.id)} aria-label={`Show ${s.name.toLowerCase()}`} /></div>)}</div>
   <div className="panel-foot"><span>{visibleCount.toLocaleString()} pieces visible</span><Button variant="ghost" onClick={()=>setState(s=>({...s,visible:[],selected:[],isolate:false}))}>Hide all</Button></div>
  </section>
  {panel==='search'&&<section className="search-panel glass" aria-label="Find anatomy"><div className="panel-heading"><span>Find a structure</span><Button variant="ghost" className="icon-button" onClick={()=>setPanel(null)} aria-label="Close search"><X size={18}/></Button></div><Combobox<Concept> items={results} value={null} onValueChange={value=>{if(value)choose(value);}} inputValue={query} onInputValueChange={setQuery} itemToStringLabel={c=>c.name} filter={null} open onOpenChange={open=>{if(!open)setPanel(null);}}><ComboboxInput autoFocus placeholder="Heart, femur, cranial nerve…" aria-label="Search named anatomical structures" showTrigger={false}/><ComboboxContent className="anatomy-search-results"><ComboboxEmpty>No structures match your search.</ComboboxEmpty><ComboboxList>{(c:Concept)=><ComboboxItem key={c.id} value={c}><span className="search-result-name">{c.name}</span><span className="small-number">{c.elements.length} {c.elements.length===1?'piece':'pieces'}</span></ComboboxItem>}</ComboboxList></ComboboxContent></Combobox><p className="search-note">{query?'Showing up to 80 matches. Refine your search to find smaller structures.':'Start with a major organ, or search every named structure.'}</p></section>}
  <nav className="view-controls glass" aria-label="Camera controls">{(['three-quarter','front','side','back'] as View[]).map((v,i)=><Button variant="ghost" key={v} className={state.view===v?'active':''} aria-pressed={state.view===v} disabled={state.explode>.8&&v!=='front'} onClick={()=>setState(s=>({...s,view:v,reset:s.reset+1,rotate:false}))} title={`${v} view`} aria-label={`${v} view`}><span>{['¾','F','S','B'][i]}</span></Button>)}<i/><Button variant="ghost" disabled={state.explode>=.4} aria-label={state.rotate?'Pause rotation':'Rotate body'} title="Auto rotate" className={state.rotate?'active':''} onClick={()=>setState(s=>({...s,rotate:!s.rotate}))}>{state.rotate?<Pause size={17}/>:<RotateCw size={18}/>}</Button><Button variant="ghost" aria-label="Reset view and layers" title="Reset" onClick={reset}><RotateCcw size={17}/></Button></nav>
  <div className="scene-caption"><span className="caption-line"/><span>{state.isolate?(chosen?.name??'SELECTED STRUCTURE'):state.explode>.95?'ANATOMICAL INVENTORY':state.explode>.05?'SEPARATED STRUCTURES':'ADULT HUMAN · MALE'}</span><span className="caption-line"/></div>
  <div className="bottom-dock glass">
    <Button variant="outline" className="text-xs mr-2 font-semibold text-blue-600 border-blue-200 bg-blue-50 hover:bg-blue-100" onClick={() => (window as any).__anatomyScene?.extractFemur()}>
       🦴 Extract Femur
    </Button>
    <Button variant="ghost" className="mobile-only dock-layers" onClick={()=>openPanel('layers')} aria-label="Open system layers"><Layers3 size={20}/><span>Systems</span></Button>
    <div className="explode-control" style={{ flexGrow: 1, padding: '0 1rem' }}>
      <div className="explode-label" style={{ marginBottom: '8px', display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
        <label id="explode-label" style={{ fontSize: '1.1rem', fontWeight: 'bold', color: '#1e293b' }}>
          {chosen?.name ?? 'Explode anatomy'}
        </label>
        {chosen && selected && (
          <span style={{ fontSize: '0.85rem', color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '400px' }}>
            {explanation(chosen.name, selected.system) || 'Select a piece to learn more about its function.'}
          </span>
        )}
      </div>
      {!chosen && (
        <>
          <div style={{ display: 'flex', width: '100%', gap: '8px', alignItems: 'center' }}>
            <Slider aria-labelledby="explode-label" min={0} max={100} step={1} value={[state.explode*100]} onValueChange={v=>setState(s=>({...s,explode:(Array.isArray(v)?v[0]:v)/100,view:(Array.isArray(v)?v[0]:v)>80?'front':s.view,rotate:false}))}/>
            <output style={{ fontSize: '0.85rem', fontWeight: 'bold' }}>{Math.round(state.explode*100)}<span>%</span></output>
          </div>
          <div className="slider-endpoints" style={{ display: 'flex', justifyContent: 'space-between', width: '100%', fontSize: '0.75rem', color: '#94a3b8', marginTop: '4px' }}><span>Assembled</span><span>Every piece</span></div>
        </>
      )}
    </div>
    <Button variant="ghost" className="dock-reset" onClick={reset} aria-label="Assemble and reset"><RotateCcw size={18}/><span>Reset</span></Button>
  </div>
  <footer className="studio-footer"><span>{state.explode>.8?'Drag to pan':'Drag to orbit'} <b>·</b> Pinch to zoom <b>·</b> Tap to inspect</span><Button variant="ghost" onClick={()=>{setDetails(false);setPanel(null);setAbout(true);}}>Source & credits <ArrowUpRight size={12}/></Button></footer>
  {progress<100&&!error&&<div className="loading glass" role="status"><Activity size={18}/><div><strong>Preparing the anatomy</strong><span>{progress}% · Loading {atlas?.parts.length.toLocaleString()??'2,234'} pieces</span><div className="loading-track"><i style={{width:`${progress}%`}}/></div></div></div>}
  {error&&<div className="loading glass error" role="alert"><p>{error}</p><Button variant="ghost" onClick={()=>location.reload()}>Reload viewer</Button></div>}
  <Sheet open={details&&selectedParts.length>0} modal={false} disablePointerDismissal onOpenChange={setDetails}><SheetContent initialFocus={detailTitle} className={`detail-sheet glass ${state.isolate?'is-isolated':''}`} showCloseButton={true}><div className="detail-header"><div className="detail-accent" style={{background:system?.color}}/><div className="eyebrow">{system?.name??'ANATOMY'}</div><SheetTitle ref={detailTitle} tabIndex={-1} className="structure-title">{chosen?.name}</SheetTitle></div><div className="detail-scroll" key={`${chosen?.id}-${state.isolate}`}><SheetDescription className="structure-description">{chosen&&selected?explanation(chosen.name,selected.system):''}</SheetDescription>{chosen&&!EXPLANATIONS[chosen.name.toLowerCase()]&&<span className="context-note">System overview · structure identified from source anatomy</span>}<div className="structure-meta"><span>Atlas reference<strong>{chosen?.id}</strong></span><span>Selected pieces<strong>{state.selected.length.toLocaleString()}</strong></span></div>{selectedParts.length>1&&<div className="member-list"><h3>Included structures</h3>{selectedParts.slice(0,50).map(p=><Button variant="ghost" key={p.id} onClick={()=>choosePart(p.id)}><span>{p.name}</span><ChevronRight size={14}/></Button>)}{selectedParts.length>50&&<p>And {selectedParts.length-50} more modeled pieces.</p>}</div>}<a className="source-link" href="https://lifesciencedb.jp/bp3d/" target="_blank" rel="noreferrer">View anatomical source <ArrowUpRight size={14}/></a></div><div className="detail-actions"><Button className={`primary-action ${state.isolate?'active':''}`} onClick={()=>{if(!state.isolate){playIsolateSound();}setState(s=>({...s,isolate:!s.isolate,explode:0}));}}><Focus size={18}/>{state.isolate?'Show surrounding anatomy':'Isolate structure'}<ChevronRight size={16}/></Button><Button variant="ghost" className="secondary-action" onClick={()=>{setState(s=>({...s,selected:[],isolate:false}));setDetails(false);}}>Clear selection</Button></div></SheetContent></Sheet>
  <Sheet open={about} onOpenChange={setAbout}><SheetContent className="about-sheet glass"><div className="eyebrow">SOURCE & SCOPE</div><SheetTitle className="structure-title">A body, revealed.</SheetTitle><SheetDescription>Explore the adult male reference anatomy from BodyParts3D.</SheetDescription><div className="about-copy"><p><strong>Male · BodyParts3D</strong><br/>2,234 individual meshes and 3,432 named concepts from an adult male reference anatomy.</p><p>This reference does not contain every human structure or variation. Named concepts can contain multiple pieces; each source mesh is rendered once.</p><p>Colors and system groupings are designed for exploration. The geometry is simplified for the web, and short explanations provide general educational context. This is an anatomical reference, not a diagnostic or surgical tool.</p><h3>Source</h3><p>BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International.</p><a href="https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html" target="_blank" rel="noreferrer">Dataset license <ArrowUpRight size={14}/></a><a href="https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html" target="_blank" rel="noreferrer">Original geometry & metadata <ArrowUpRight size={14}/></a><a href="https://academic.oup.com/nar/article/37/suppl_1/D782/1000752" target="_blank" rel="noreferrer">Read the source publication <ArrowUpRight size={14}/></a></div></SheetContent></Sheet>
 </main>
 );
}
