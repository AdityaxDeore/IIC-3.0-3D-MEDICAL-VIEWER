import React, { useState } from 'react';
import { Sparkles, X, Loader2, Maximize2 } from 'lucide-react';
import { analyzeImageWithGemini } from '@/lib/gemini';
import { SceneActions } from './scene';

export function AIAssistant({ sceneActionsRef }: { sceneActionsRef: React.MutableRefObject<SceneActions | null> }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("Analyze this medical scan and 3D anatomy. Identify any potential issues, stress fractures, or misalignments. Give me a brief, professional summary.");

  const analyzeScreen = async () => {
    if (!sceneActionsRef.current || !sceneActionsRef.current.takeSnapshot) return;
    
    setLoading(true);
    setSuggestion(null);
    setSnapshot(null);
    
    try {
      const dataUrl = await sceneActionsRef.current.takeSnapshot();
      setSnapshot(dataUrl);
      
      const response = await analyzeImageWithGemini(dataUrl, prompt);
      setSuggestion(response);
    } catch (e: any) {
      console.error(e);
      setSuggestion('Error: ' + (e.message || 'Could not connect to Gemini AI.'));
    } finally {
      setLoading(false);
    }
  };

  if (!open) {
    return (
      <button 
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 w-14 h-14 bg-indigo-600 text-white rounded-full shadow-lg flex items-center justify-center hover:bg-indigo-700 transition-colors z-50"
        title="Gemini AI Assistant"
      >
        <Sparkles size={24} />
      </button>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 w-96 bg-white/95 backdrop-blur shadow-2xl rounded-2xl border border-indigo-100 z-50 flex flex-col overflow-hidden max-h-[80vh]">
      <div className="bg-indigo-600 text-white px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2 font-semibold">
          <Sparkles size={18} />
          Gemini AI Assistant
        </div>
        <button onClick={() => setOpen(false)} className="text-indigo-100 hover:text-white transition">
          <X size={20} />
        </button>
      </div>
      
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4 text-sm text-slate-800">
        <p className="text-slate-500">I can read the 3D viewer and MRI scans using Gemini Vision.</p>
        
        <textarea 
          value={prompt} 
          onChange={(e) => setPrompt(e.target.value)}
          className="w-full p-2 border border-slate-200 rounded-md bg-slate-50 text-xs text-slate-700 focus:outline-none focus:border-indigo-400"
          rows={3}
          placeholder="Ask something about the scene..."
        />
        
        <button 
          onClick={analyzeScreen} 
          disabled={loading}
          className="w-full bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-md py-2 font-semibold hover:bg-indigo-100 transition flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {loading ? <Loader2 size={16} className="animate-spin" /> : <Maximize2 size={16} />}
          {loading ? 'Analyzing Scene...' : 'Analyze Current View'}
        </button>

        {snapshot && (
          <div className="border border-slate-200 rounded-md overflow-hidden relative">
             <div className="absolute top-1 left-1 bg-black/50 text-white text-[10px] px-1.5 py-0.5 rounded">Screen Snapshot</div>
             <img src={snapshot} alt="Captured Scene" className="w-full h-32 object-cover object-center" />
          </div>
        )}

        {suggestion && (
          <div className="bg-slate-50 border border-slate-100 p-3 rounded-lg leading-relaxed prose prose-sm prose-indigo">
             <div dangerouslySetInnerHTML={{ __html: suggestion.replace(/\n/g, '<br/>') }} />
          </div>
        )}
      </div>
    </div>
  );
}
