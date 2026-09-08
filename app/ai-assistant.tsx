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
        style={{ position: 'fixed', bottom: '24px', right: '24px', width: '56px', height: '56px', backgroundColor: '#4f46e5', color: 'white', borderRadius: '50%', boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, border: 'none', cursor: 'pointer' }}
        title="Gemini AI Assistant"
      >
        <Sparkles size={24} />
      </button>
    );
  }

  return (
    <div style={{ position: 'fixed', bottom: '24px', right: '24px', width: '380px', backgroundColor: 'rgba(255, 255, 255, 0.95)', backdropFilter: 'blur(12px)', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)', borderRadius: '16px', border: '1px solid #e0e7ff', zIndex: 9999, display: 'flex', flexDirection: 'column', overflow: 'hidden', maxHeight: '80vh' }}>
      <div style={{ backgroundColor: '#4f46e5', color: 'white', padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600 }}>
          <Sparkles size={18} />
          Gemini AI Assistant
        </div>
        <button onClick={() => setOpen(false)} style={{ color: '#e0e7ff', background: 'transparent', border: 'none', cursor: 'pointer' }}>
          <X size={20} />
        </button>
      </div>
      
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px', fontSize: '14px', color: '#1e293b' }}>
        <p style={{ color: '#64748b', margin: 0 }}>I can read the 3D viewer and MRI scans using Gemini Vision.</p>
        
        <textarea 
          value={prompt} 
          onChange={(e) => setPrompt(e.target.value)}
          style={{ width: '100%', padding: '12px', border: '1px solid #e2e8f0', borderRadius: '8px', backgroundColor: '#f8fafc', color: '#334155', fontSize: '13px', outline: 'none', resize: 'vertical' }}
          rows={3}
          placeholder="Ask something about the scene..."
        />
        
        <button 
          onClick={analyzeScreen} 
          disabled={loading}
          style={{ width: '100%', backgroundColor: '#eef2ff', color: '#4338ca', border: '1px solid #c7d2fe', borderRadius: '8px', padding: '10px', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', cursor: loading ? 'default' : 'pointer', opacity: loading ? 0.7 : 1 }}
        >
          {loading ? <Loader2 size={16} className="animate-spin" /> : <Maximize2 size={16} />}
          {loading ? 'Analyzing Scene...' : 'Analyze Current View'}
        </button>

        {snapshot && (
          <div style={{ border: '1px solid #e2e8f0', borderRadius: '8px', overflow: 'hidden', position: 'relative' }}>
             <div style={{ position: 'absolute', top: '4px', left: '4px', backgroundColor: 'rgba(0,0,0,0.5)', color: 'white', fontSize: '10px', padding: '2px 6px', borderRadius: '4px' }}>Screen Snapshot</div>
             <img src={snapshot} alt="Captured Scene" style={{ width: '100%', height: '160px', objectFit: 'cover', objectPosition: 'center', display: 'block' }} />
          </div>
        )}

        {suggestion && (
          <div style={{ backgroundColor: '#f8fafc', border: '1px solid #f1f5f9', padding: '16px', borderRadius: '12px', lineHeight: 1.6, fontSize: '13px', color: '#334155' }}>
             <div dangerouslySetInnerHTML={{ __html: suggestion.replace(/\n/g, '<br/>') }} />
          </div>
        )}
      </div>
    </div>
  );
}
