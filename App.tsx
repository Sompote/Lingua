
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
  ChevronDown,
  CheckCircle2,
  Loader2,
  Sparkles,
  Zap,
  ArrowDown
} from 'lucide-react';
import { SUPPORTED_LANGUAGES, Language } from './types';
import { decode, decodeAudioData, createBlob } from './utils/audio-utils';

// Custom Logo Component
const LingualLogo: React.FC<{ size?: number }> = ({ size = 32 }) => (
  <svg width={size} height={size} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="50" cy="50" r="40" fill="#E0F2FE" />
    <path d="M50 10C50 10 35 25 35 50C35 75 50 90 50 90M50 10C50 10 65 25 65 50C65 75 50 90 50 90M15 40H85M12 60H88M50 10V90" stroke="#7DD3FC" strokeWidth="1.5" />
    <path d="M48 30C48 30 25 30 25 45C25 60 40 60 40 60L40 68L48 60C48 60 52 60 52 45C52 30 48 30 48 30Z" fill="#0284C7" />
    <text x="32" y="52" fill="white" fontSize="18" fontWeight="bold" fontFamily="Arial">A</text>
    <path d="M52 35C52 35 75 35 75 50C75 65 60 65 60 65L60 73L52 65C52 65 48 65 48 50C48 35 52 35 52 35Z" fill="#65A30D" />
    <text x="58" y="56" fill="white" fontSize="16" fontWeight="bold" fontFamily="Arial">文</text>
    <path d="M47 48H53M47 52H53" stroke="white" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

const App: React.FC = () => {
  const [isActive, setIsActive] = useState(false);
  const [userLang, setUserLang] = useState<Language>(SUPPORTED_LANGUAGES[0]); 
  const [guestLang, setGuestLang] = useState<Language>(SUPPORTED_LANGUAGES[1]); 
  const [status, setStatus] = useState<'idle' | 'connecting' | 'listening' | 'translating' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [isFlipped, setIsFlipped] = useState(true);
  
  const [notification, setNotification] = useState<{message: string, type: 'error' | 'success' | 'info'} | null>(null);

  const [audioInputDevices, setAudioInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [userInputDeviceId, setUserInputDeviceId] = useState<string>('');   
  
  // Audio Level State
  const [volumeLevel, setVolumeLevel] = useState(0);

  // Text State - We keep history in state but don't render it in the main view to keep it clean
  const [guestHistory, setGuestHistory] = useState<string[]>([]);
  const [userHistory, setUserHistory] = useState<string[]>([]);
  const [liveGuestText, setLiveGuestText] = useState('');
  const [liveUserText, setLiveUserText] = useState('');

  // Refs for logic (avoid stale closures)
  const liveGuestTextRef = useRef('');
  const liveUserTextRef = useRef('');
  const isGuestTurnFinished = useRef(false);
  const isUserTurnFinished = useRef(false);
  
  // Refs for Audio Pipeline
  const inCtxRef = useRef<AudioContext | null>(null);
  const outCtxRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sessionRef = useRef<any>(null);
  const streamsRef = useRef<MediaStream[]>([]);
  const activeSources = useRef<Set<AudioBufferSourceNode>>(new Set());
  
  // Routing State
  const currentTargetChannel = useRef<'user' | 'guest' | null>(null);
  const transcriptionBuffer = useRef<string>('');

  useEffect(() => {
    refreshDevices();
    navigator.mediaDevices.addEventListener('devicechange', refreshDevices);
    return () => navigator.mediaDevices.removeEventListener('devicechange', refreshDevices);
  }, []);

  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 3500);
      return () => clearTimeout(timer);
    }
  }, [notification]);

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
    } catch (e) {
      console.warn("Cleanup warning", e);
    }
    
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
              
              // Calculate Volume RMS
              let sum = 0;
              for (let i = 0; i < inputData.length; i++) {
                sum += inputData[i] * inputData[i];
              }
              const rms = Math.sqrt(sum / inputData.length);
              
              // Throttle UI updates for volume (max 20fps)
              const now = Date.now();
              if (now - lastVolumeUpdate > 50) {
                 setVolumeLevel(Math.min(rms * 5, 1)); // Amplify a bit for visual effect
                 lastVolumeUpdate = now;
              }

              sessionRef.current?.sendRealtimeInput({ media: createBlob(inputData) });
            };
            proc.connect(inCtx.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            if (message.serverContent?.outputTranscription) {
              const textChunk = message.serverContent.outputTranscription.text;
              transcriptionBuffer.current += textChunk;

              // --- ROUTING LOGIC START ---
              // Check for Routing Tags which indicate start of a new channel turn
              if (transcriptionBuffer.current.includes('USER_CHANNEL:')) {
                // Detected a specific start for USER. 
                // 1. Commit any previous finished text for USER to history
                if (liveUserTextRef.current.trim()) {
                   setUserHistory(prev => [...prev, liveUserTextRef.current]);
                }
                
                // 2. Switch Channel
                currentTargetChannel.current = 'user';
                
                // 3. Extract new text
                const parts = transcriptionBuffer.current.split('USER_CHANNEL:');
                const actualText = parts[parts.length - 1].trim();
                
                // 4. Update Live State
                setLiveUserText(actualText);
                liveUserTextRef.current = actualText;
                
                // 5. Reset Finished Flag
                isUserTurnFinished.current = false;
                
                // 6. Clean buffer to just the current text
                transcriptionBuffer.current = actualText; 
              } 
              else if (transcriptionBuffer.current.includes('GUEST_CHANNEL:')) {
                // Detected a specific start for GUEST.
                // 1. Commit any previous finished text for GUEST to history
                if (liveGuestTextRef.current.trim()) {
                   setGuestHistory(prev => [...prev, liveGuestTextRef.current]);
                }

                // 2. Switch Channel
                currentTargetChannel.current = 'guest';

                // 3. Extract new text
                const parts = transcriptionBuffer.current.split('GUEST_CHANNEL:');
                const actualText = parts[parts.length - 1].trim();

                // 4. Update Live State
                setLiveGuestText(actualText);
                liveGuestTextRef.current = actualText;

                // 5. Reset Finished Flag
                isGuestTurnFinished.current = false;

                // 6. Clean buffer
                transcriptionBuffer.current = actualText;
              } 
              // --- CONTINUATION LOGIC ---
              else if (currentTargetChannel.current === 'user') {
                // We are continuing in User channel.
                // Check if the previous turn was marked 'finished'. If so, this is a NEW turn that lacked a tag (fallback).
                if (isUserTurnFinished.current) {
                     if (liveUserTextRef.current.trim()) {
                         setUserHistory(prev => [...prev, liveUserTextRef.current]);
                     }
                     setLiveUserText('');
                     liveUserTextRef.current = '';
                     isUserTurnFinished.current = false;
                }

                // Standard append
                const newText = (liveUserTextRef.current + textChunk).replace(/USER_CHANNEL:|GUEST_CHANNEL:/g, '').trim();
                setLiveUserText(newText);
                liveUserTextRef.current = newText;
              } 
              else if (currentTargetChannel.current === 'guest') {
                // We are continuing in Guest channel.
                if (isGuestTurnFinished.current) {
                     if (liveGuestTextRef.current.trim()) {
                         setGuestHistory(prev => [...prev, liveGuestTextRef.current]);
                     }
                     setLiveGuestText('');
                     liveGuestTextRef.current = '';
                     isGuestTurnFinished.current = false;
                }

                const newText = (liveGuestTextRef.current + textChunk).replace(/USER_CHANNEL:|GUEST_CHANNEL:/g, '').trim();
                setLiveGuestText(newText);
                liveGuestTextRef.current = newText;
              }
            }

            if (message.serverContent?.turnComplete) {
              transcriptionBuffer.current = '';
              
              // MARK turn as finished, but DO NOT remove text from UI yet.
              // It will remain visible as the "last spoken phrase" until a new phrase starts.
              if (currentTargetChannel.current === 'user') {
                isUserTurnFinished.current = true;
              } else if (currentTargetChannel.current === 'guest') {
                isGuestTurnFinished.current = true;
              }
            }

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
              isUserTurnFinished.current = false;
              isGuestTurnFinished.current = false;
            }
          },
          onerror: (e) => {
            console.error('Session error:', e);
          },
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          systemInstruction: `You are a professional bi-directional translator. 
User Language: ${userLang.name}. 
Guest Language: ${guestLang.name}.

INSTRUCTIONS:
1. Listen to the incoming audio.
2. Detect the language spoken.
3. IF language is ${userLang.name}:
   - Translate to ${guestLang.name}.
   - START response with "GUEST_CHANNEL: ".
4. IF language is ${guestLang.name}:
   - Translate to ${userLang.name}.
   - START response with "USER_CHANNEL: ".

IMPORTANT:
- YOU MUST SPEAK THE TAGS "GUEST_CHANNEL" or "USER_CHANNEL" at the start of your response so the system can route the audio.
- DO NOT CHAT. ONLY TRANSLATE.
- If you cannot hear clear speech, stay silent.`,
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

  const clearHistory = () => {
    setGuestHistory([]);
    setUserHistory([]);
    setLiveGuestText('');
    setLiveUserText('');
  }

  return (
    <div className="flex flex-col h-screen max-w-2xl mx-auto bg-slate-950 text-slate-100 overflow-hidden relative font-sans select-none">
      
      {/* BRANDING LOGO */}
      <div className="absolute top-8 left-8 z-[60]">
        <div className="flex items-center gap-3 bg-[#030712]/70 backdrop-blur-2xl border border-white/5 py-2 px-4 rounded-[20px] shadow-2xl">
          <LingualLogo size={28} />
          <span className="text-xl font-bold tracking-tight lowercase text-white">
            lingual<span className="text-[#a3e635]">.</span>ai
          </span>
        </div>
      </div>

      {/* NOTIFICATION TOAST */}
      {notification && (
        <div className={`absolute top-28 left-1/2 -translate-x-1/2 z-[70] px-6 py-3 rounded-full shadow-2xl backdrop-blur-md border animate-in slide-in-from-top-4 fade-in duration-300 flex items-center gap-3 ${notification.type === 'error' ? 'bg-red-500/20 border-red-500/50 text-red-200' : notification.type === 'success' ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-200' : 'bg-blue-500/20 border-blue-500/50 text-blue-200'}`}>
          {notification.type === 'error' ? <AlertCircle className="w-4 h-4" /> : notification.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <Loader2 className="w-4 h-4 animate-spin" />}
          <span className="text-xs font-bold uppercase tracking-widest">{notification.message}</span>
        </div>
      )}

      {/* TOP PANEL: GUEST VIEW */}
      <div className={`relative flex-1 flex flex-col p-8 transition-all duration-1000 ${isFlipped ? 'rotate-180' : ''} ${status === 'translating' && currentTargetChannel.current === 'guest' ? 'bg-blue-600/10' : 'bg-slate-950'} min-h-0`}>
        
        {/* Language Selector */}
        <div className="absolute top-10 left-1/2 -translate-x-1/2 z-20">
            <div className="relative group">
              <select 
                value={guestLang.code} 
                onChange={e => setGuestLang(SUPPORTED_LANGUAGES.find(l => l.code === e.target.value)!)} 
                className="appearance-none bg-slate-900/80 border border-slate-800 rounded-full py-2 px-8 text-[10px] font-black uppercase tracking-widest focus:outline-none shadow-2xl backdrop-blur-md cursor-pointer hover:bg-slate-800 transition-colors"
              >
                {SUPPORTED_LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.flag} {l.name}</option>)}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-500 pointer-events-none" />
            </div>
        </div>

        {/* Guest Active Text ONLY */}
        <div className="flex-1 flex flex-col justify-end items-center px-4 pb-4">
           {liveGuestText ? (
              <p className="text-3xl font-bold text-white leading-tight drop-shadow-lg animate-in fade-in slide-in-from-bottom-2 text-center">
                {liveGuestText}
              </p>
           ) : (
              <div className="flex items-center justify-center opacity-10">
                 <p className="text-2xl font-light uppercase tracking-widest italic">Listening...</p>
              </div>
           )}
        </div>
      </div>

      {/* MID PANEL: MAIN CONTROLS */}
      <div className="h-40 bg-slate-900/90 backdrop-blur-3xl border-y border-slate-800/50 flex flex-col relative z-40 shadow-[0_0_100px_rgba(0,0,0,1)] shrink-0">
        <div className="flex-1 flex items-center justify-between px-8 relative">
          
          {/* Rotate Button */}
          <button onClick={() => setIsFlipped(!isFlipped)} className={`w-14 h-14 rounded-full flex items-center justify-center transition-all active:scale-90 border ${isFlipped ? 'bg-blue-600 border-blue-400 shadow-[0_0_20px_rgba(37,99,235,0.4)]' : 'bg-slate-800 border-slate-700 text-slate-500'}`}>
            <RotateCcw className="w-6 h-6" />
          </button>

          {/* Main Mic Button with Visualizer */}
          <div className="relative flex flex-col items-center justify-center -mt-24">
            
            {/* Processing/Translating Indicator */}
            {status === 'translating' && (
              <div className="absolute -top-10 flex items-center gap-2 animate-pulse bg-emerald-500/20 px-3 py-1 rounded-full border border-emerald-500/30">
                 <Sparkles className="w-3 h-3 text-emerald-400" />
                 <span className="text-[9px] font-black uppercase tracking-widest text-emerald-300">Translating</span>
              </div>
            )}

            <button 
              onClick={isActive ? stopSession : startSession} 
              disabled={status === 'connecting'} 
              className={`relative w-28 h-28 rounded-full flex items-center justify-center border-[8px] border-slate-950 transition-all shadow-2xl z-10 
                ${status === 'connecting' ? 'bg-slate-800' : 
                  isActive ? 'bg-red-500 ring-0' : 'bg-blue-600 hover:scale-105 active:scale-95'}`}
            >
              {status === 'connecting' ? <RefreshCw className="w-10 h-10 animate-spin text-white/50" /> : 
               status === 'translating' ? <Zap className="w-10 h-10 text-white animate-pulse" /> :
               isActive ? <MicOff className="w-10 h-10 text-white" /> : 
               <Mic className="w-10 h-10 text-white" />}
            </button>
            
            {/* Voice Level Visualizer Ring */}
            {isActive && (
              <div 
                className="absolute w-full h-full rounded-full border-2 border-blue-500 opacity-50 pointer-events-none transition-all duration-75"
                style={{ 
                  transform: `scale(${1 + volumeLevel})`,
                  borderColor: volumeLevel > 0.5 ? '#f43f5e' : '#3b82f6'
                }}
              />
            )}
             {isActive && (
              <div 
                className="absolute w-full h-full rounded-full bg-blue-500/20 blur-xl transition-all duration-75"
                style={{ 
                  transform: `scale(${0.8 + volumeLevel * 1.5})`,
                  opacity: 0.5 + volumeLevel
                }}
              />
            )}

            {/* Device Info */}
            <div className="mt-6 flex flex-col items-center gap-1 z-20">
               <div className="flex items-center gap-2 px-3 py-1 bg-slate-800 rounded-full border border-slate-700 cursor-pointer hover:bg-slate-700 transition-colors" onClick={() => setShowSettings(true)}>
                  <Bluetooth className={`w-3 h-3 ${userInputDeviceId ? 'text-blue-400' : 'text-slate-500'}`} />
                  <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest truncate max-w-[120px]">
                    {audioInputDevices.find(d => d.deviceId === userInputDeviceId)?.label || 'Internal Mic'}
                  </span>
               </div>
            </div>
          </div>

          {/* Settings Button */}
          <div className="flex items-center gap-3">
             <button onClick={() => { refreshDevices(); setShowSettings(true); }} className={`w-14 h-14 rounded-full flex items-center justify-center transition-all active:scale-90 border ${showSettings ? 'bg-white text-black border-white shadow-[0_0_20px_rgba(255,255,255,0.3)]' : 'bg-slate-800 border-slate-700 text-slate-500'}`}>
               <Settings className="w-6 h-6" />
             </button>
          </div>
        </div>
      </div>

      {/* BOTTOM PANEL: USER VIEW */}
      <div className={`relative flex-1 flex flex-col p-8 transition-all duration-700 ${status === 'translating' && currentTargetChannel.current === 'user' ? 'bg-emerald-500/10' : 'bg-slate-950'} min-h-0`}>
         
         {/* User Active Text ONLY */}
         <div className="flex-1 flex flex-col justify-end items-center px-4 pb-20">
            {liveUserText ? (
              <p className="text-3xl font-bold text-white leading-tight drop-shadow-lg animate-in fade-in slide-in-from-bottom-2 text-center">
                {liveUserText}
              </p>
            ) : (
              <div className="flex items-center justify-center opacity-10">
                 <p className="text-2xl font-light uppercase tracking-widest italic">Ready...</p>
              </div>
            )}
         </div>

        {/* Language Selector */}
        <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-20">
            <div className="relative group">
                <select 
                  value={userLang.code} 
                  onChange={e => setUserLang(SUPPORTED_LANGUAGES.find(l => l.code === e.target.value)!)} 
                  className="appearance-none bg-slate-900/80 border border-slate-800 rounded-full py-2 px-8 text-[10px] font-black uppercase tracking-widest focus:outline-none shadow-2xl backdrop-blur-md cursor-pointer hover:bg-slate-800 transition-colors"
                >
                  {SUPPORTED_LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.flag} {l.name}</option>)}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-500 pointer-events-none" />
            </div>
        </div>
      </div>

      {/* SETTINGS MODAL */}
      {showSettings && (
        <div className="absolute inset-0 bg-slate-950/98 z-[100] p-10 flex flex-col animate-in slide-in-from-bottom-10 duration-500 backdrop-blur-3xl">
          <div className="flex justify-between items-center mb-10">
            <div className="flex items-center gap-5">
              <LingualLogo size={48} />
              <div>
                <h2 className="text-3xl font-bold tracking-tight lowercase text-white">
                  lingual<span className="text-[#a3e635]">.</span>ai
                </h2>
                <p className="text-[10px] font-bold text-blue-500 tracking-widest uppercase mt-1">Professional Translation</p>
              </div>
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
                    Pro tip: Connect Bluetooth headphones before selecting them here for best results.
                  </p>
               </div>
            </div>

            <div className="p-7 bg-slate-900 border border-slate-800 rounded-[35px] flex items-center justify-between">
               <div className="flex items-center gap-3">
                 <Trash2 className="w-4 h-4 text-red-400" />
                 <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Clear Conversation History</span>
               </div>
               <button onClick={clearHistory} className="px-4 py-2 bg-red-500/10 text-red-400 rounded-full text-[10px] font-black uppercase hover:bg-red-500 hover:text-white transition-colors">Clear</button>
            </div>

            <div className="p-8 bg-slate-900/50 border border-slate-800 rounded-[35px] flex flex-col gap-4">
                <div className="flex items-center gap-2 text-slate-500"><Info className="w-4 h-4" /><span className="text-[10px] font-black uppercase tracking-widest">About lingual.ai</span></div>
                <p className="text-[11px] text-slate-600 leading-relaxed font-medium">
                  lingual.ai utilizes Gemini 2.5 Flash for ultra-low latency translation. 
                  We've implemented strict UI tags to separate User and Guest channels. 
                  The bottom panel is dedicated to you, while the top panel is for your guest.
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
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2); border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.3); }
        select { background-image: none !important; }
      `}</style>
    </div>
  );
};

export default App;
