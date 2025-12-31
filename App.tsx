
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage } from '@google/genai';
import { 
  Mic, 
  MicOff, 
  Settings, 
  RotateCcw,
  Bluetooth,
  Info,
  Smartphone,
  Headphones,
  Trash2,
  RefreshCw,
  AlertCircle,
  Activity,
  ChevronDown
} from 'lucide-react';
import { SUPPORTED_LANGUAGES, Language } from './types';
import { decode, decodeAudioData, createBlob } from './utils/audio-utils';

const App: React.FC = () => {
  const [isActive, setIsActive] = useState(false);
  const [userLang, setUserLang] = useState<Language>(SUPPORTED_LANGUAGES[0]); 
  const [guestLang, setGuestLang] = useState<Language>(SUPPORTED_LANGUAGES[1]); 
  const [status, setStatus] = useState<'idle' | 'connecting' | 'listening' | 'translating' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [isFlipped, setIsFlipped] = useState(true);
  
  const [audioInputDevices, setAudioInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [userInputDeviceId, setUserInputDeviceId] = useState<string>('');   
  
  const [liveGuestText, setLiveGuestText] = useState('');
  const [liveUserText, setLiveUserText] = useState('');

  // Refs for Audio Pipeline
  const inCtxRef = useRef<AudioContext | null>(null);
  const outCtxRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sessionRef = useRef<any>(null);
  const streamsRef = useRef<MediaStream[]>([]);
  const activeSources = useRef<Set<AudioBufferSourceNode>>(new Set());
  
  // Strict Routing State
  const currentTargetChannel = useRef<'user' | 'guest' | null>(null);
  const transcriptionBuffer = useRef<string>('');

  useEffect(() => {
    refreshDevices();
    navigator.mediaDevices.addEventListener('devicechange', refreshDevices);
    return () => navigator.mediaDevices.removeEventListener('devicechange', refreshDevices);
  }, []);

  const refreshDevices = async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs = devices.filter(d => d.kind === 'audioinput');
      setAudioInputDevices(inputs);
      // Auto-select if none selected
      if (!userInputDeviceId && inputs.length > 0) {
        // Prefer bluetooth if available in label
        const bt = inputs.find(i => i.label.toLowerCase().includes('bluetooth') || i.label.toLowerCase().includes('headset'));
        if (bt) setUserInputDeviceId(bt.deviceId);
      }
    } catch (e) {}
  };

  const stopSession = useCallback(() => {
    inCtxRef.current?.close().catch(() => {});
    outCtxRef.current?.close().catch(() => {});
    streamsRef.current.forEach(s => s.getTracks().forEach(t => t.stop()));
    activeSources.current.forEach(s => { try { s.stop(); } catch(e) {} });
    activeSources.current.clear();
    
    setIsActive(false);
    setStatus('idle');
    setLiveGuestText('');
    setLiveUserText('');
    sessionRef.current = null;
    nextStartTimeRef.current = 0;
    currentTargetChannel.current = null;
    transcriptionBuffer.current = '';
  }, []);

  const startSession = async () => {
    try {
      setStatus('connecting');
      setErrorMessage('');

      // Stop any existing tracks first
      streamsRef.current.forEach(s => s.getTracks().forEach(t => t.stop()));

      const constraints = {
        audio: userInputDeviceId 
          ? { deviceId: { exact: userInputDeviceId }, echoCancellation: true, noiseSuppression: true } 
          : { echoCancellation: true, noiseSuppression: true }
      };
      
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamsRef.current = [stream];

      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const inCtx = new AudioContextClass({ sampleRate: 16000 });
      const outCtx = new AudioContextClass();
      
      inCtxRef.current = inCtx;
      outCtxRef.current = outCtx;

      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        callbacks: {
          onopen: () => {
            setStatus('listening');
            const proc = inCtx.createScriptProcessor(4096, 1, 1);
            inCtx.createMediaStreamSource(stream).connect(proc);
            proc.onaudioprocess = (e) => {
              const data = e.inputBuffer.getChannelData(0);
              sessionRef.current?.sendRealtimeInput({ media: createBlob(data) });
            };
            proc.connect(inCtx.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            // Transcript handling for UI Routing
            if (message.serverContent?.outputTranscription) {
              const textChunk = message.serverContent.outputTranscription.text;
              transcriptionBuffer.current += textChunk;

              // Force channel switch based on tags
              if (transcriptionBuffer.current.includes('[USER_UI]')) {
                currentTargetChannel.current = 'user';
                const parts = transcriptionBuffer.current.split('[USER_UI]');
                const actualText = parts[parts.length - 1].trim();
                setLiveUserText(actualText);
                setLiveGuestText(''); // Clean guest panel
                transcriptionBuffer.current = actualText; 
              } 
              else if (transcriptionBuffer.current.includes('[GUEST_UI]')) {
                currentTargetChannel.current = 'guest';
                const parts = transcriptionBuffer.current.split('[GUEST_UI]');
                const actualText = parts[parts.length - 1].trim();
                setLiveGuestText(actualText);
                setLiveUserText(''); // Clean user panel
                transcriptionBuffer.current = actualText;
              } 
              else if (currentTargetChannel.current === 'user') {
                setLiveUserText(prev => (prev + textChunk).replace(/\[.*?\]/g, '').trim());
              } 
              else if (currentTargetChannel.current === 'guest') {
                setLiveGuestText(prev => (prev + textChunk).replace(/\[.*?\]/g, '').trim());
              }
            }

            if (message.serverContent?.turnComplete) {
              transcriptionBuffer.current = '';
            }

            // Audio output handling
            const base64 = message.serverContent?.modelTurn?.parts?.find(p => p.inlineData)?.inlineData?.data;
            if (base64 && outCtxRef.current) {
              const ctx = outCtxRef.current;
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
              
              const audioBuffer = await decodeAudioData(decode(base64), ctx, 24000, 1);
              const source = ctx.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(ctx.destination);
              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += audioBuffer.duration;
              activeSources.current.add(source);
              setStatus('translating');
              
              source.onended = () => { 
                activeSources.current.delete(source); 
                if (activeSources.current.size === 0) setStatus('listening'); 
              };
            }

            if (message.serverContent?.interrupted) {
              activeSources.current.forEach(s => { try { s.stop(); } catch(e) {} });
              activeSources.current.clear();
              nextStartTimeRef.current = 0;
              transcriptionBuffer.current = '';
              currentTargetChannel.current = null;
            }
          },
          onerror: (e) => {
            console.error('Session error:', e);
            stopSession();
          },
          onclose: () => isActive ? setTimeout(startSession, 1500) : stopSession()
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          systemInstruction: `You are a professional real-time translator.

STRICT ROUTING RULES:
1. If you hear ${userLang.name} (from the User):
   - You MUST translate it into ${guestLang.name}.
   - You MUST start your response with the tag [GUEST_UI].
   - This output will appear in the Guest's (Top) panel.
   
2. If you hear ${guestLang.name} (from the Guest):
   - You MUST translate it into ${userLang.name}.
   - You MUST start your response with the tag [USER_UI].
   - This output will appear in the User's (Bottom) panel.

STRICT FORBIDDEN ACTIONS:
- DO NOT repeat what was said in the original language.
- DO NOT say "They said..." or "The Guest says...".
- ONLY output the translated text.
- NEVER mix up the tags. [GUEST_UI] is for translations TO the Guest. [USER_UI] is for translations TO the User.

Your goal is fluid, accurate, and properly routed conversation.`,
        }
      });
      sessionRef.current = await sessionPromise;
      setIsActive(true);
    } catch (e: any) { 
      stopSession(); 
      setStatus('error'); 
      setErrorMessage(e?.message || 'Microphone Access Denied'); 
    }
  };

  return (
    <div className="flex flex-col h-screen max-w-2xl mx-auto bg-slate-950 text-slate-100 overflow-hidden relative font-sans select-none">
      
      {/* TOP PANEL: GUEST VIEW (Flipped if isFlipped) */}
      <div className={`relative flex-1 flex flex-col items-center justify-center p-12 transition-all duration-1000 ${isFlipped ? 'rotate-180' : ''} ${status === 'translating' && currentTargetChannel.current === 'guest' ? 'bg-blue-600/10' : 'bg-slate-950'}`}>
        <div className="absolute top-10 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-3">
            <div className="relative group">
              <select 
                value={guestLang.code} 
                onChange={e => setGuestLang(SUPPORTED_LANGUAGES.find(l => l.code === e.target.value)!)} 
                className="appearance-none bg-slate-900/80 border border-slate-800 rounded-full py-2.5 px-10 text-[10px] font-black uppercase tracking-widest focus:outline-none shadow-2xl backdrop-blur-md cursor-pointer hover:bg-slate-800 transition-colors"
              >
                {SUPPORTED_LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.flag} {l.name}</option>)}
              </select>
              <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-500 pointer-events-none" />
            </div>
        </div>
        <div className="max-w-full overflow-hidden">
          <p className="text-5xl font-black text-center text-white leading-tight tracking-tighter drop-shadow-2xl px-4 break-words">
            {liveGuestText || <span className="opacity-10 italic text-2xl font-normal tracking-normal uppercase">Listening...</span>}
          </p>
        </div>
      </div>

      {/* MID PANEL: MAIN CONTROLS */}
      <div className="h-40 bg-slate-900/90 backdrop-blur-3xl border-y border-slate-800/50 flex items-center justify-between px-8 relative z-40 shadow-[0_0_100px_rgba(0,0,0,1)]">
        <button onClick={() => setIsFlipped(!isFlipped)} className={`w-14 h-14 rounded-full flex items-center justify-center transition-all active:scale-90 border ${isFlipped ? 'bg-blue-600 border-blue-400 shadow-[0_0_20px_rgba(37,99,235,0.4)]' : 'bg-slate-800 border-slate-700 text-slate-500'}`}>
          <RotateCcw className="w-6 h-6" />
        </button>

        <div className="relative flex flex-col items-center">
          <button 
            onClick={isActive ? stopSession : startSession} 
            disabled={status === 'connecting'} 
            className={`w-28 h-28 rounded-full flex items-center justify-center border-[10px] border-slate-950 -mt-20 transition-all shadow-2xl relative ${isActive ? 'bg-red-500 ring-4 ring-red-500/20' : 'bg-blue-600 hover:scale-105 active:scale-95 ring-4 ring-blue-600/20'}`}
          >
            {status === 'connecting' ? <RefreshCw className="w-10 h-10 animate-spin text-white" /> : isActive ? <MicOff className="w-10 h-10 text-white" /> : <Mic className="w-10 h-10 text-white" />}
          </button>
          
          {/* MICROPHONE QUICK SELECT */}
          <div className="mt-4 flex flex-col items-center gap-1">
             <div className="flex items-center gap-2 px-3 py-1 bg-slate-800 rounded-full border border-slate-700 cursor-pointer hover:bg-slate-700 transition-colors" onClick={() => setShowSettings(true)}>
                <Bluetooth className={`w-3 h-3 ${userInputDeviceId ? 'text-blue-400' : 'text-slate-500'}`} />
                <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest truncate max-w-[120px]">
                  {audioInputDevices.find(d => d.deviceId === userInputDeviceId)?.label || 'Internal Mic'}
                </span>
             </div>
             {isActive && <Activity className="w-4 h-4 text-blue-500 animate-pulse mt-1" />}
          </div>
        </div>

        <button onClick={() => { refreshDevices(); setShowSettings(true); }} className={`w-14 h-14 rounded-full flex items-center justify-center transition-all active:scale-90 border ${showSettings ? 'bg-white text-black border-white shadow-[0_0_20px_rgba(255,255,255,0.3)]' : 'bg-slate-800 border-slate-700 text-slate-500'}`}>
          <Settings className="w-6 h-6" />
        </button>
      </div>

      {/* BOTTOM PANEL: USER VIEW */}
      <div className={`relative flex-1 flex flex-col items-center justify-center p-12 transition-all duration-700 ${status === 'translating' && currentTargetChannel.current === 'user' ? 'bg-emerald-500/10' : 'bg-slate-950'}`}>
        <div className="max-w-full overflow-hidden">
          <p className="text-5xl font-black text-center text-blue-50 leading-tight tracking-tighter drop-shadow-lg px-4 break-words">
            {liveUserText || <span className="opacity-10 italic text-2xl font-normal tracking-normal uppercase">Listening...</span>}
          </p>
        </div>
        <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-3">
            <div className="relative group">
              <select 
                value={userLang.code} 
                onChange={e => setUserLang(SUPPORTED_LANGUAGES.find(l => l.code === e.target.value)!)} 
                className="appearance-none bg-slate-900/80 border border-slate-800 rounded-full py-2.5 px-10 text-[10px] font-black uppercase tracking-widest focus:outline-none shadow-2xl backdrop-blur-md cursor-pointer hover:bg-slate-800 transition-colors"
              >
                {SUPPORTED_LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.flag} {l.name}</option>)}
              </select>
              <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-500 pointer-events-none" />
            </div>
        </div>
      </div>

      {/* SETTINGS MODAL */}
      {showSettings && (
        <div className="absolute inset-0 bg-slate-950/98 z-[100] p-10 flex flex-col animate-in slide-in-from-bottom-10 duration-500 backdrop-blur-3xl">
          <div className="flex justify-between items-center mb-10">
            <div>
              <h2 className="text-3xl font-black italic tracking-tighter uppercase text-white">Audio Settings</h2>
              <div className="h-1 w-10 bg-blue-600 mt-2 rounded-full"></div>
            </div>
            <button onClick={() => setShowSettings(false)} className="p-4 bg-slate-900 rounded-full text-slate-400 border border-slate-800 hover:text-white transition-colors"><Trash2 className="w-6 h-6 rotate-45" /></button>
          </div>

          <div className="flex-1 overflow-y-auto space-y-8 pr-2 custom-scrollbar pb-10">
            <div className="space-y-6">
               <div className="flex items-center gap-3 opacity-40"><Smartphone className="w-4 h-4" /><h3 className="text-[10px] font-black uppercase tracking-widest text-white">Input Source (Mic/Headphones)</h3></div>
               <div className="p-7 bg-slate-900 rounded-[35px] border border-slate-800 flex flex-col gap-4 shadow-xl">
                  <div className="flex items-center gap-2">
                    <Headphones className="w-4 h-4 text-blue-500" />
                    <p className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Select Microphone</p>
                  </div>
                  <div className="relative">
                    <select 
                      value={userInputDeviceId} 
                      onChange={e => {
                        setUserInputDeviceId(e.target.value);
                        if (isActive) {
                          stopSession();
                          setTimeout(startSession, 300);
                        }
                      }} 
                      className="w-full bg-slate-950 border border-slate-800 rounded-2xl py-4 px-6 text-sm appearance-none focus:border-blue-500 transition-all text-white pr-12 font-medium"
                    >
                      <option value="">Default System Microphone</option>
                      {audioInputDevices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || `Device ${d.deviceId.slice(0, 5)}`}</option>)}
                    </select>
                    <ChevronDown className="absolute right-5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
                  </div>
                  <p className="text-[10px] text-slate-500 italic px-2">
                    Pro tip: Connect Bluetooth headphones before selecting them here.
                  </p>
               </div>
            </div>

            <div className="p-8 bg-slate-900/50 border border-slate-800 rounded-[35px] flex flex-col gap-4">
                <div className="flex items-center gap-2 text-slate-500"><Info className="w-4 h-4" /><span className="text-[10px] font-black uppercase tracking-widest">Routing Stability</span></div>
                <p className="text-[11px] text-slate-600 leading-relaxed font-medium">
                  We've implemented strict UI tags to separate User and Guest channels. If you speak {userLang.name}, the translation is locked to the Guest's panel. If they speak {guestLang.name}, it's locked to your panel.
                </p>
            </div>
          </div>

          <button onClick={() => setShowSettings(false)} className="w-full py-8 bg-white text-black rounded-[30px] font-black uppercase tracking-[0.5em] text-[10px] shadow-2xl active:scale-95 transition-all mt-6 hover:bg-blue-50">
             Confirm Configuration
          </button>
        </div>
      )}

      {status === 'error' && (
        <div className="absolute top-6 left-6 right-6 z-[200] bg-rose-600 p-4 rounded-2xl flex items-center justify-between shadow-2xl animate-in fade-in zoom-in duration-300">
           <div className="flex items-center gap-3 text-white">
              <AlertCircle className="w-5 h-5" />
              <span className="text-[10px] font-black uppercase tracking-widest">{errorMessage}</span>
           </div>
           <button onClick={() => window.location.reload()} className="p-2 bg-white/20 rounded-lg"><RefreshCw className="w-4 h-4 text-white" /></button>
        </div>
      )}

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #1e293b; border-radius: 10px; }
        select { background-image: none !important; }
      `}</style>
    </div>
  );
};

export default App;
