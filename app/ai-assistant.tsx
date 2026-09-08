import React, { useState, useEffect, useRef } from 'react';
import { Sparkles, X, Loader2, Camera, ChevronRight, AlertTriangle, CheckCircle2, Lightbulb, TrendingUp } from 'lucide-react';
import { analyzeImageWithGemini } from '@/lib/gemini';
import { SceneActions } from './scene';

const SYSTEM_PROMPT = `You are a medical AI assistant analyzing a 3D anatomical viewer with MRI overlay capabilities. 
Analyze the current screenshot and provide a structured response with EXACTLY these 4 sections using these exact headings:

**🔍 Current State**
Briefly describe what you see in the 3D viewer (bones visible, MRI scan if present, current mode/view).

**⚠️ Identified Issues**
List any problems you notice: misalignments, fractures visible, MRI overlay positioning issues, or anything that needs attention.

**✅ Progress So Far**
What has been achieved well in this session — good alignments, correct tool usage, features working properly.

**💡 Recommendations**
Specific actionable steps the user can take next to improve the analysis or alignment.

Be concise, professional, and medically focused. Keep each section to 2-3 bullet points max.`;

function parseResponse(text: string) {
  const sections = {
    state: '',
    issues: '',
    progress: '',
    recommendations: '',
  };

  const stateMatch = text.match(/\*\*🔍 Current State\*\*([\s\S]*?)(?=\*\*⚠️|\*\*✅|\*\*💡|$)/);
  const issuesMatch = text.match(/\*\*⚠️ Identified Issues\*\*([\s\S]*?)(?=\*\*🔍|\*\*✅|\*\*💡|$)/);
  const progressMatch = text.match(/\*\*✅ Progress So Far\*\*([\s\S]*?)(?=\*\*🔍|\*\*⚠️|\*\*💡|$)/);
  const recoMatch = text.match(/\*\*💡 Recommendations\*\*([\s\S]*?)(?=\*\*🔍|\*\*⚠️|\*\*✅|$)/);

  if (stateMatch) sections.state = stateMatch[1].trim();
  if (issuesMatch) sections.issues = issuesMatch[1].trim();
  if (progressMatch) sections.progress = progressMatch[1].trim();
  if (recoMatch) sections.recommendations = recoMatch[1].trim();

  // fallback: if no structured response, put everything in state
  if (!sections.state && !sections.issues) sections.state = text;

  return sections;
}

function Section({ icon, title, content, color }: { icon: React.ReactNode; title: string; content: string; color: string }) {
  if (!content) return null;
  const lines = content.split('\n').filter(l => l.trim());
  return (
    <div style={{ borderLeft: `3px solid ${color}`, paddingLeft: '12px', marginBottom: '14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, fontSize: '12px', color, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>
        {icon} {title}
      </div>
      <div style={{ fontSize: '13px', color: '#334155', lineHeight: 1.6 }}>
        {lines.map((line, i) => (
          <div key={i} style={{ display: 'flex', gap: '6px', marginBottom: '3px' }}>
            {line.startsWith('-') || line.startsWith('•') ? (
              <>
                <ChevronRight size={12} style={{ marginTop: '4px', flexShrink: 0, color }} />
                <span>{line.replace(/^[-•]\s*/, '')}</span>
              </>
            ) : <span>{line}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

export function AIAssistant({ sceneActionsRef }: { sceneActionsRef: React.MutableRefObject<SceneActions | null> }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [parsed, setParsed] = useState<ReturnType<typeof parseResponse> | null>(null);
  const [rawText, setRawText] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const analyzeScreen = async () => {
    if (!sceneActionsRef.current?.takeSnapshot) return;
    setLoading(true);
    setParsed(null);
    setRawText(null);
    setSnapshot(null);
    setError(null);

    try {
      const dataUrl = await sceneActionsRef.current.takeSnapshot();
      setSnapshot(dataUrl);
      const response = await analyzeImageWithGemini(dataUrl, SYSTEM_PROMPT);
      setRawText(response);
      setParsed(parseResponse(response));
    } catch (e: any) {
      setError(e.message || 'Could not connect to Gemini AI.');
    } finally {
      setLoading(false);
    }
  };

  // Auto-analyze when panel opens
  useEffect(() => {
    if (open) {
      const t = setTimeout(() => analyzeScreen(), 300);
      return () => clearTimeout(t);
    }
  }, [open]);

  return (
    <>
      {/* Slide-in styles */}
      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(110%); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
        @keyframes fadeInBtn {
          from { opacity: 0; transform: scale(0.8); }
          to   { opacity: 1; transform: scale(1); }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        .ai-spin { animation: spin 1s linear infinite; }
        .ai-panel { animation: slideInRight 0.35s cubic-bezier(0.22, 1, 0.36, 1) forwards; }
        .ai-btn   { animation: fadeInBtn 0.3s ease forwards; }
        .ai-pulse { animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite; }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.5} }
      `}</style>

      {/* Toggle button — top right, below nav bar */}
      {!open && (
        <button
          className="ai-btn"
          onClick={() => setOpen(true)}
          title="Gemini AI Medical Assistant"
          style={{
            position: 'fixed', top: '90px', right: '30px',
            background: 'linear-gradient(135deg, #4f46e5, #7c3aed)',
            color: 'white', border: 'none', borderRadius: '12px',
            padding: '10px 16px', display: 'flex', alignItems: 'center', gap: '8px',
            fontWeight: 600, fontSize: '13px', cursor: 'pointer',
            boxShadow: '0 8px 24px rgba(79, 70, 229, 0.4)',
            zIndex: 9999,
          }}
        >
          <Sparkles size={16} />
          AI Analysis
        </button>
      )}

      {/* Slide-in panel */}
      {open && (
        <div
          ref={panelRef}
          className="ai-panel"
          style={{
            position: 'fixed', top: '90px', right: '30px',
            width: '360px',
            maxHeight: 'calc(100vh - 120px)',
            background: 'rgba(255,255,255,0.97)',
            backdropFilter: 'blur(20px)',
            border: '1px solid rgba(79,70,229,0.2)',
            borderRadius: '16px',
            boxShadow: '0 24px 64px rgba(79,70,229,0.18), 0 4px 16px rgba(0,0,0,0.08)',
            display: 'flex', flexDirection: 'column',
            overflow: 'hidden',
            zIndex: 9999,
          }}
        >
          {/* Header */}
          <div style={{
            background: 'linear-gradient(135deg, #4f46e5, #7c3aed)',
            color: 'white', padding: '14px 16px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            flexShrink: 0,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Sparkles size={18} />
              <div>
                <div style={{ fontWeight: 700, fontSize: '14px', lineHeight: 1 }}>Gemini AI Assistant</div>
                <div style={{ fontSize: '11px', opacity: 0.8, marginTop: '2px' }}>Medical Scene Analysis</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <button
                onClick={analyzeScreen}
                disabled={loading}
                title="Re-analyze"
                style={{
                  background: 'rgba(255,255,255,0.2)', border: 'none', color: 'white',
                  borderRadius: '8px', padding: '6px 10px', cursor: loading ? 'default' : 'pointer',
                  display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px', fontWeight: 600,
                  opacity: loading ? 0.7 : 1,
                }}
              >
                {loading
                  ? <Loader2 size={13} className="ai-spin" />
                  : <Camera size={13} />}
                {loading ? 'Scanning…' : 'Scan'}
              </button>
              <button onClick={() => setOpen(false)} style={{ background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.8)', cursor: 'pointer', padding: '4px' }}>
                <X size={18} />
              </button>
            </div>
          </div>

          {/* Snapshot strip */}
          {snapshot && (
            <div style={{ position: 'relative', flexShrink: 0, height: '110px', overflow: 'hidden', borderBottom: '1px solid #e2e8f0' }}>
              <img src={snapshot} alt="Scene snapshot" style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center top', display: 'block' }} />
              <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(255,255,255,0.6), transparent)' }} />
              <div style={{ position: 'absolute', bottom: '6px', left: '8px', background: 'rgba(79,70,229,0.85)', color: 'white', fontSize: '10px', padding: '2px 7px', borderRadius: '4px', fontWeight: 600, letterSpacing: '0.05em' }}>
                LIVE SNAPSHOT
              </div>
            </div>
          )}

          {/* Loading skeleton */}
          {loading && !snapshot && (
            <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {[80, 60, 70, 50].map((w, i) => (
                <div key={i} className="ai-pulse" style={{ height: '12px', borderRadius: '6px', background: '#e2e8f0', width: `${w}%` }} />
              ))}
            </div>
          )}

          {/* Content */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
            {loading && snapshot && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#7c3aed', fontSize: '13px', fontWeight: 600, marginBottom: '12px' }}>
                <Loader2 size={14} className="ai-spin" />
                Gemini is analyzing the scene…
              </div>
            )}

            {error && (
              <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '10px', padding: '12px', color: '#dc2626', fontSize: '13px' }}>
                ⚠️ {error}
              </div>
            )}

            {parsed && !loading && (
              <>
                <Section icon={<Camera size={11} />} title="Current State" content={parsed.state} color="#4f46e5" />
                <Section icon={<AlertTriangle size={11} />} title="Identified Issues" content={parsed.issues} color="#dc2626" />
                <Section icon={<CheckCircle2 size={11} />} title="Progress So Far" content={parsed.progress} color="#16a34a" />
                <Section icon={<Lightbulb size={11} />} title="Recommendations" content={parsed.recommendations} color="#d97706" />

                {/* Re-analyze footer */}
                <button
                  onClick={analyzeScreen}
                  style={{
                    width: '100%', marginTop: '4px',
                    background: 'linear-gradient(135deg, #eef2ff, #f5f3ff)',
                    border: '1px solid #c7d2fe', borderRadius: '10px',
                    padding: '10px', color: '#4338ca', fontWeight: 600,
                    fontSize: '13px', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                  }}
                >
                  <Camera size={14} /> Refresh Analysis
                </button>
              </>
            )}

            {!parsed && !loading && !error && (
              <div style={{ textAlign: 'center', padding: '24px 16px', color: '#94a3b8' }}>
                <Sparkles size={32} style={{ margin: '0 auto 10px', opacity: 0.4 }} />
                <div style={{ fontSize: '13px' }}>Taking a snapshot of the scene…</div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
