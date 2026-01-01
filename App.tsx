
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
  ChevronDown,
  Sparkles,
  Zap
} from 'lucide-react';
import { SUPPORTED_LANGUAGES, Language } from './types';
import { decode, decodeAudioData, createBlob } from './utils/audio-utils';

// Brand Logo Component matching the screenshot
const LinguaLogo: React.FC = () => (
  <div className="flex items-center gap-2 bg-[#2563eb] py-2 px-4 rounded-xl shadow-lg border border-white/10">
    <div className="bg-white/20 p-1 rounded-md">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="m5 8 6 6" /><path d="m4 14 6-6 2-3" /><path d="M2 5h12" /><path d="M7 2h1" /><path d="m22 22-5-10-5 10" /><path d="M14 18h6" />
      </svg>
    </div>
    <span className="text-sm font-black tracking-widest text-white uppercase">Lingua</span>
  </div>
);

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
  const [volumeLevel, setVolumeLevel] = useState(0);

  const [liveGuestText, setLiveGuestText] = useState('');
  const [liveUserText, setLiveUserText] = useState('');

  const liveGuestTextRef = useRef('');
  const liveUserTextRef = useRef('');
  const isGuestTurnFinished = useRef(false);
  const isUserTurnFinished = useRef(false);
  
  const inCtxRef = useRef<AudioContext | null>(null);
  const outCtxRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sessionRef = useRef<any>(null);
  const streamsRef = useRef<MediaStream[]>([]);
  const activeSources = useRef<Set<AudioBufferSourceNode>>(new Set());
  
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
      if (!userInputDeviceId && inputs.length > 0) {
        const bt = inputs.find(i => i.label.toLowerCase().includes('bluetooth') || i.label.toLowerCase().includes('headset'));
        if (bt) setUserInputDeviceId(bt.deviceId);
      }
    } catch (e) {}
  };

  const stopSession = useCallback(async () => {
    setIsActive(false);
    try {
      if (inCtxRef.current && inCtxRef.current.state !== 'closed') {
        await inCtxRef.current.close().catch(() => {});
      }
      if (outCtxRef.current && outCtxRef.current.state !== 'closed') {
        await outCtxRef.current.close().catch(() => {});
      }
      streamsRef.current.forEach(s => s.getTracks().forEach(t => t.stop()));
      activeSources.current.forEach(s => { try { s.stop(); } catch(e) {} });
      activeSources.current.clear();
      streamsRef.current = [];
    } catch (e) {}
    setStatus('idle');
    setLiveGuestText('');
    setLiveUserText('');
    liveGuestTextRef.current = '';
    liveUserTextRef.current = '';
    isUserTurnFinished.current = false;
    isGuestTurnFinished.current = false;
    setVolumeLevel(0);
    sessionRef.current = null;
    nextStartTimeRef.current = 0;
    currentTargetChannel.current = null;
    transcriptionBuffer.current = '';
  }, []);

  const startSession = async () => {
    try {
      setStatus('connecting');
      setErrorMessage('');
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

      // Create a new GoogleGenAI instance right before connecting to the session
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        callbacks: {
          onopen: () => {
            setStatus('listening');
            const proc = inCtx.createScriptProcessor(4096, 1, 1);
            inCtx.createMediaStreamSource(stream).connect(proc);
            let lastVolumeUpdate = 0;
            proc.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              let sum = 0;
              for (let i = 0; i < inputData.length; i++) sum += inputData[i] * inputData[i];
              const rms = Math.sqrt(sum / inputData.length);
              const now = Date.now();
              if (now - lastVolumeUpdate > 50) {
                 setVolumeLevel(Math.min(rms * 5, 1));
                 lastVolumeUpdate = now;
              }
              // Solely rely on sessionPromise resolves to send realtime input to prevent race conditions
              sessionPromise.then((session) => {
                session.sendRealtimeInput({ media: createBlob(inputData) });
              });
            };
            proc.connect(inCtx.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            // Process model's audio transcription (translation text)
            if (message.serverContent?.outputTranscription) {
              const textChunk = message.serverContent.outputTranscription.text;
              transcriptionBuffer.current += textChunk;
              const cleanText = (txt: string) => txt.replace(/USER_CHANNEL:|GUEST_CHANNEL:/g, '').replace(/\n/g, ' ').trim();

              if (transcriptionBuffer.current.includes('USER_CHANNEL:')) {
                currentTargetChannel.current = 'user';
                const parts = transcriptionBuffer.current.split('USER_CHANNEL:');
                const actualText = cleanText(parts[parts.length - 1]);
                setLiveUserText(actualText);
                liveUserTextRef.current = actualText;
                isUserTurnFinished.current = false;
              } 
              else if (transcriptionBuffer.current.includes('GUEST_CHANNEL:')) {
                currentTargetChannel.current = 'guest';
                const parts = transcriptionBuffer.current.split('GUEST_CHANNEL:');
                const actualText = cleanText(parts[parts.length - 1]);
                setLiveGuestText(actualText);
                liveGuestTextRef.current = actualText;
                isGuestTurnFinished.current = false;
              } 
              else if (currentTargetChannel.current === 'user') {
                if (isUserTurnFinished.current) {
                  setLiveUserText('');
                  liveUserTextRef.current = '';
                  isUserTurnFinished.current = false;
                }
                const newText = cleanText(liveUserTextRef.current + textChunk);
                setLiveUserText(newText);
                liveUserTextRef.current = newText;
              } 
              else if (currentTargetChannel.current === 'guest') {
                if (isGuestTurnFinished.current) {
                  setLiveGuestText('');
                  liveGuestTextRef.current = '';
                  isGuestTurnFinished.current = false;
                }
                const newText = cleanText(liveGuestTextRef.current + textChunk);
                setLiveGuestText(newText);
                liveGuestTextRef.current = newText;
              }
            }

            // Handle turn completion to reset transcription states
            if (message.serverContent?.turnComplete) {
              transcriptionBuffer.current = '';
              if (currentTargetChannel.current === 'user') isUserTurnFinished.current = true;
              else if (currentTargetChannel.current === 'guest') isGuestTurnFinished.current = true;
            }

            // Handle session interruptions by stopping active audio playback
            if (message.serverContent?.interrupted) {
              activeSources.current.forEach(s => { try { s.stop(); } catch(e) {} });
              activeSources.current.clear();
              nextStartTimeRef.current = 0;
              setStatus('listening');
            }

            // Extract and play audio content from the model turn
            const base64 = message.serverContent?.modelTurn?.parts?.find(p => p.inlineData)?.inlineData?.data;
            if (base64 && outCtxRef.current) {
              const ctx = outCtxRef.current;
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
              const audioBuffer = await decodeAudioData(decode(base64), ctx, 24000, 1);
              const source = ctx.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(ctx.destination);
              
              // Schedule each chunk to start at the exact end of the previous one for gapless playback
              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += audioBuffer.duration;
              activeSources.current.add(source);
              setStatus('translating');
              
              source.onended = () => { 
                activeSources.current.delete(source); 
                if (activeSources.current.size === 0) setStatus('listening'); 
              };
            }
          },
          onerror: (e) => {
            console.error('Session error:', e);
            setStatus('error');
            setErrorMessage('A communication error occurred with the translation service.');
          },
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          systemInstruction: `You are a professional bi-directional translator. 
User Language: ${userLang.name}. Guest Language: ${guestLang.name}.
Detect the language. Translate. Always start with "GUEST_CHANNEL: " or "USER_CHANNEL: ". 
Only translate, no chat. Keep translations concise and clear.`,
        }
      });
      sessionRef.current = await sessionPromise;
      setIsActive(true);
      return sessionRef.current;
    } catch (e: any) { 
      stopSession(); 
      setStatus('error'); 
      setErrorMessage(e?.message || 'Microphone Access Denied'); 
      return null;
    }
  };

  return (
    <div className="flex flex-col h-screen max-w-2xl mx-auto bg-[#030712] text-slate-100 overflow-hidden relative font-sans select-none">
      
      {/* BRANDING */}
      <div className="absolute top-8 left-8 z-[60]">
        <LinguaLogo />
      </div>

      {/* TOP PANEL: GUEST */}
      <div className={`relative flex-1 flex flex-col p-8 transition-all duration-1000 ${isFlipped ? 'rotate-180' : ''} ${status === 'translating' && currentTargetChannel.current === 'guest' ? 'bg-blue-600/10' : ''} min-h-0`}>
        <div className="absolute top-10 left-1/2 -translate-x-1/2 z-20">
            <div className="relative group">
              <select value={guestLang.code} onChange={e => setGuestLang(SUPPORTED_LANGUAGES.find(l => l.code === e.target.value)!)} className="appearance-none bg-slate-900/40 border border-slate-800 rounded-full py-2 px-10 text-[10px] font-black uppercase tracking-widest focus:outline-none shadow-2xl backdrop-blur-md cursor-pointer hover:bg-slate-800 transition-colors">
                {SUPPORTED_LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.flag} {l.name}</option>)}
              </select>
              <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-500 pointer-events-none" />
            </div>
        </div>
        <div className="flex-1 flex flex-col justify-center items-center px-4">
           {liveGuestText ? (
              <p className="text-3xl font-bold text-white leading-tight drop-shadow-lg animate-in fade-in slide-in-from-bottom-2 text-center max-h-full overflow-hidden">
                {liveGuestText}
              </p>
           ) : (
              <div className="flex items-center justify-center opacity-20">
                 <p className="text-2xl font-light uppercase tracking-[0.4em] italic text-slate-400">Listening...</p>
              </div>
           )}
        </div>
      </div>

      {/* MID PANEL: CONTROLS */}
      <div className="h-44 bg-slate-900/30 backdrop-blur-3xl border-y border-white/5 flex flex-col relative z-40 shadow-[0_0_100px_rgba(0,0,0,0.8)] shrink-0">
        <div className="flex-1 flex items-center justify-between px-10 relative">
          
          <button onClick={() => setIsFlipped(!isFlipped)} className={`w-14 h-14 rounded-full flex items-center justify-center transition-all active:scale-90 border border-white/10 ${isFlipped ? 'bg-blue-600 shadow-[0_0_30px_rgba(37,99,235,0.4)] text-white' : 'bg-slate-800/50 text-slate-400'}`}>
            <RotateCcw className="w-6 h-6" />
          </button>

          <div className="relative flex flex-col items-center justify-center -mt-28">
            {status === 'translating' && (
              <div className="absolute -top-12 flex items-center gap-2 animate-pulse bg-emerald-500/20 px-4 py-1.5 rounded-full border border-emerald-500/30">
                 <Sparkles className="w-3 h-3 text-emerald-400" />
                 <span className="text-[10px] font-black uppercase tracking-widest text-emerald-300">Translating</span>
              </div>
            )}
            
            <div className="relative">
              <button 
                onClick={isActive ? stopSession : startSession} 
                disabled={status === 'connecting'} 
                className={`relative w-32 h-32 rounded-full flex items-center justify-center border-[10px] border-[#030712] transition-all shadow-2xl z-10 ${status === 'connecting' ? 'bg-slate-800' : isActive ? 'bg-red-500 ring-4 ring-red-500/20' : 'bg-[#2563eb] hover:bg-blue-500 ring-4 ring-blue-500/10'}`}>
                {isActive ? <MicOff className="w-10 h-10 text-white" /> : <Mic className="w-10 h-10 text-white" />}
                
                {isActive && status !== 'connecting' && (
                   <div className="absolute inset-0 rounded-full border-4 border-white/20 animate-ping" />
                )}
              </button>

              {/* Volume Visualizer */}
              {isActive && (
                <div className="absolute -inset-4 rounded-full border-2 border-white/5 flex items-center justify-center pointer-events-none">
                   <div 
                    className="w-full h-full rounded-full border-2 border-blue-500/30 transition-transform duration-75"
                    style={{ transform: `scale(${1 + volumeLevel})` }}
                   />
                </div>
              )}
            </div>

            <button onClick={() => setShowSettings(true)} className="w-14 h-14 rounded-full bg-slate-800/50 flex items-center justify-center text-slate-400 hover:text-white transition-all active:scale-90 border border-white/10">
              <Settings className="w-6 h-6" />
            </button>
          </div>
        </div>
      </div>

      {/* BOTTOM PANEL: USER */}
      <div className={`relative flex-1 flex flex-col p-8 transition-all duration-1000 ${status === 'translating' && currentTargetChannel.current === 'user' ? 'bg-emerald-600/10' : ''} min-h-0`}>
        <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-20">
            <div className="relative group">
              <select value={userLang.code} onChange={e => setUserLang(SUPPORTED_LANGUAGES.find(l => l.code === e.target.value)!)} className="appearance-none bg-slate-900/40 border border-slate-800 rounded-full py-2 px-10 text-[10px] font-black uppercase tracking-widest focus:outline-none shadow-2xl backdrop-blur-md cursor-pointer hover:bg-slate-800 transition-colors">
                {SUPPORTED_LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.flag} {l.name}</option>)}
              </select>
              <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-500 pointer-events-none" />
            </div>
        </div>
        <div className="flex-1 flex flex-col justify-center items-center px-4">
           {liveUserText ? (
              <p className="text-3xl font-bold text-white leading-tight drop-shadow-lg animate-in fade-in slide-in-from-bottom-2 text-center max-h-full overflow-hidden">
                {liveUserText}
              </p>
           ) : (
              <div className="flex items-center justify-center opacity-20">
                 <p className="text-2xl font-light uppercase tracking-[0.4em] italic text-slate-400">Listening...</p>
              </div>
           )}
        </div>
      </div>

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 backdrop-blur-xl bg-black/60">
           <div className="bg-slate-900 w-full max-w-sm rounded-[32px] p-8 border border-white/10 shadow-3xl">
              <div className="flex justify-between items-center mb-8">
                 <h2 className="text-xl font-bold">Preferences</h2>
                 <button onClick={() => setShowSettings(false)} className="p-2 bg-slate-800 rounded-full hover:bg-slate-700 transition-colors"><Trash2 className="w-5 h-5 text-slate-400" /></button>
              </div>
              
              <div className="space-y-6">
                <div>
                   <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-3 block">Audio Input</label>
                   <div className="space-y-2 max-h-60 overflow-y-auto pr-2">
                     {audioInputDevices.map(d => (
                       <button key={d.deviceId} onClick={() => setUserInputDeviceId(d.deviceId)} className={`w-full text-left p-4 rounded-2xl border transition-all flex items-center gap-3 ${userInputDeviceId === d.deviceId ? 'bg-blue-600 border-blue-400 shadow-[0_0_20px_rgba(37,99,235,0.3)] text-white' : 'bg-slate-800 border-transparent text-slate-400 hover:bg-slate-700'}`}>
                         {d.label.toLowerCase().includes('bluetooth') ? <Bluetooth className="w-5 h-5" /> : <Headphones className="w-5 h-5" />}
                         <span className="text-sm font-medium truncate">{d.label || 'Default Input'}</span>
                       </button>
                     ))}
                   </div>
                </div>

                <div className="pt-4 flex gap-3">
                  <button onClick={() => setShowSettings(false)} className="flex-1 bg-white text-black font-black py-4 rounded-2xl uppercase tracking-widest text-xs hover:bg-slate-200 transition-colors">Done</button>
                </div>
              </div>
           </div>
        </div>
      )}

      {/* Error Overlay */}
      {status === 'error' && (
         <div className="absolute inset-0 z-[150] bg-red-600/20 backdrop-blur-md flex items-center justify-center p-8">
            <div className="bg-slate-950 border border-red-500/50 p-8 rounded-[40px] text-center shadow-2xl">
               <div className="bg-red-500/20 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6">
                  <AlertCircle className="w-8 h-8 text-red-500" />
               </div>
               <h3 className="text-xl font-bold mb-2">Mic Error</h3>
               <p className="text-slate-400 text-sm mb-8 leading-relaxed">{errorMessage}</p>
               <button onClick={startSession} className="w-full bg-red-500 py-4 rounded-2xl font-black uppercase tracking-widest text-xs flex items-center justify-center gap-2 hover:bg-red-400 transition-colors">
                 <RefreshCw className="w-4 h-4" /> Retry
               </button>
            </div>
         </div>
      )}
    </div>
  );
};

export default App;
