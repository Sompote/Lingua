
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
  Zap,
  Check,
  Volume2,
  Speaker
} from 'lucide-react';
import { SUPPORTED_LANGUAGES, Language } from './types';
import { decode, decodeAudioData, createBlob } from './utils/audio-utils';

// Brand Logo Component
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
  const [audioOutputDevices, setAudioOutputDevices] = useState<MediaDeviceInfo[]>([]);
  const [hasPermission, setHasPermission] = useState(false);
  
  const [userInputDeviceId, setUserInputDeviceId] = useState<string>('');   
  const [userOutputDeviceId, setUserOutputDeviceId] = useState<string>('');

  const [volumeLevel, setVolumeLevel] = useState(0);

  const [liveGuestText, setLiveGuestText] = useState('');
  const [liveUserText, setLiveUserText] = useState('');

  // Audio Context & State Refs
  const audioCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const oscillatorRef = useRef<OscillatorNode | null>(null);
  
  const nextStartTimeRef = useRef<number>(0);
  const sessionRef = useRef<any>(null);
  const streamsRef = useRef<MediaStream[]>([]);
  const activeSources = useRef<Set<AudioBufferSourceNode>>(new Set());
  
  // Text Processing Refs
  const currentTargetChannel = useRef<'user' | 'guest' | null>(null);
  const processingBuffer = useRef<string>('');
  const currentGuestTextRef = useRef('');
  const currentUserTextRef = useRef('');

  useEffect(() => {
    // Initial check for permissions/devices
    checkPermissionsAndEnumerate();
    navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange);
    return () => navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange);
  }, []);

  // Apply output device whenever it changes or context changes
  useEffect(() => {
    if (audioCtxRef.current && userOutputDeviceId) {
      applyOutputDevice(audioCtxRef.current, userOutputDeviceId);
    }
  }, [userOutputDeviceId]);

  const handleDeviceChange = useCallback(async () => {
    await refreshDevices();
  }, []);

  const checkPermissionsAndEnumerate = async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const hasLabels = devices.some(d => d.label.length > 0);
      if (hasLabels) {
        setHasPermission(true);
        refreshDevices();
      }
    } catch (e) {
      console.warn("Error enumerating devices", e);
    }
  };

  const requestPermission = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(t => t.stop());
      setHasPermission(true);
      await refreshDevices();
    } catch (e) {
      console.error("Permission denied", e);
      setErrorMessage("Microphone permission is required to detect Bluetooth devices.");
    }
  };

  const refreshDevices = async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs = devices.filter(d => d.kind === 'audioinput');
      const outputs = devices.filter(d => d.kind === 'audiooutput');
      
      setAudioInputDevices(inputs);
      setAudioOutputDevices(outputs);

      // Auto-select Bluetooth Input if not set
      if (!userInputDeviceId && inputs.length > 0) {
        const bt = inputs.find(i => i.label.toLowerCase().includes('bluetooth') || i.label.toLowerCase().includes('headset') || i.label.toLowerCase().includes('airpods'));
        if (bt) setUserInputDeviceId(bt.deviceId);
        else setUserInputDeviceId(inputs[0].deviceId);
      }

      // Auto-select Default Output if not set
      if (!userOutputDeviceId && outputs.length > 0) {
         const def = outputs.find(o => o.deviceId === 'default');
         if (def) setUserOutputDeviceId(def.deviceId);
         else setUserOutputDeviceId(outputs[0].deviceId);
      }

    } catch (e) {}
  };

  const applyOutputDevice = async (ctx: AudioContext, deviceId: string) => {
    // @ts-ignore
    if (typeof ctx.setSinkId === 'function') {
      try {
        // @ts-ignore
        await ctx.setSinkId(deviceId);
      } catch (e) {
        console.warn('Failed to set audio output device', e);
      }
    }
  };

  const cleanupNodes = () => {
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current.onaudioprocess = null;
      processorRef.current = null;
    }
    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    streamsRef.current.forEach(s => s.getTracks().forEach(t => t.stop()));
    streamsRef.current = [];
    sessionRef.current = null;
  };

  const fullDisconnect = async () => {
    cleanupNodes();
    if (oscillatorRef.current) {
      try { oscillatorRef.current.stop(); } catch(e){}
      oscillatorRef.current = null;
    }
    if (audioCtxRef.current) {
      try { await audioCtxRef.current.close(); } catch(e) {}
      audioCtxRef.current = null;
    }
    activeSources.current.forEach(s => { try { s.stop(); } catch(e) {} });
    activeSources.current.clear();
    processingBuffer.current = '';
    nextStartTimeRef.current = 0;
  };

  const stopSession = useCallback(async () => {
    setIsActive(false);
    await fullDisconnect();
    setStatus('idle');
    setLiveGuestText('');
    setLiveUserText('');
    currentGuestTextRef.current = '';
    currentUserTextRef.current = '';
    setVolumeLevel(0);
    currentTargetChannel.current = null;
  }, []);

  const downsampleTo16k = (inputData: Float32Array, inputSampleRate: number): Float32Array => {
    if (inputSampleRate === 16000) return inputData;
    const ratio = inputSampleRate / 16000;
    const newLength = Math.round(inputData.length / ratio);
    const result = new Float32Array(newLength);
    for (let i = 0; i < newLength; i++) {
      const originalIndex = i * ratio;
      const index1 = Math.floor(originalIndex);
      const index2 = Math.min(index1 + 1, inputData.length - 1);
      const fraction = originalIndex - index1;
      result[i] = inputData[index1] * (1 - fraction) + inputData[index2] * fraction;
    }
    return result;
  };

  const startSession = async (inputDeviceIdOverride?: string, outputDeviceIdOverride?: string) => {
    cleanupNodes();
    try {
      setStatus('connecting');
      setErrorMessage('');
      const targetInputId = inputDeviceIdOverride || userInputDeviceId;
      const targetOutputId = outputDeviceIdOverride || userOutputDeviceId;
      let ctx = audioCtxRef.current;
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!ctx || ctx.state === 'closed') {
        ctx = new AudioContextClass({ latencyHint: 'interactive' });
        audioCtxRef.current = ctx;
      }
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }
      if (!oscillatorRef.current) {
         try {
            const silentOsc = ctx.createOscillator();
            const silentGain = ctx.createGain();
            silentOsc.type = 'sine';
            silentOsc.frequency.value = 440; 
            silentGain.gain.value = 0.0001; 
            silentOsc.connect(silentGain);
            silentGain.connect(ctx.destination);
            silentOsc.start();
            oscillatorRef.current = silentOsc;
         } catch (e) { console.warn("Oscillator failed", e); }
      }
      let stream: MediaStream | null = null;
      const constraintsPreferences = [
         { audio: { deviceId: targetInputId ? { exact: targetInputId } : undefined, channelCount: 1, echoCancellation: true, autoGainControl: true, noiseSuppression: true }},
         { audio: { deviceId: targetInputId ? { ideal: targetInputId } : undefined, channelCount: 1, echoCancellation: true }},
         { audio: { echoCancellation: true }}
      ];
      for (const constraint of constraintsPreferences) {
         try {
            if (targetInputId && !constraint.audio.deviceId && !constraint.audio.echoCancellation) continue;
            stream = await navigator.mediaDevices.getUserMedia(constraint);
            break; 
         } catch (e) {
            stream = null;
         }
      }
      if (!stream) throw new Error("Could not access microphone.");
      streamsRef.current = [stream];
      if (targetOutputId) {
        await applyOutputDevice(ctx, targetOutputId);
      }
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        callbacks: {
          onopen: () => {
            setStatus('listening');
            if (!ctx) return; 
            const source = ctx.createMediaStreamSource(stream!);
            const processor = ctx.createScriptProcessor(4096, 1, 1);
            sourceRef.current = source;
            processorRef.current = processor;
            source.connect(processor);
            processor.connect(ctx.destination);
            let lastVolumeUpdate = 0;
            const NOISE_GATE_THRESHOLD = 0.01;
            processor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const outputData = e.outputBuffer.getChannelData(0);
              let sum = 0;
              for (let i = 0; i < inputData.length; i++) sum += inputData[i] * inputData[i];
              const rms = Math.sqrt(sum / inputData.length);
              const now = Date.now();
              if (now - lastVolumeUpdate > 50) {
                 setVolumeLevel(Math.min(rms * 10, 1));
                 lastVolumeUpdate = now;
              }
              for (let i = 0; i < outputData.length; i++) outputData[i] = 0; 
              if (ctx) {
                const downsampledData = downsampleTo16k(inputData, ctx.sampleRate);
                sessionPromise.then((session) => {
                  if (rms > NOISE_GATE_THRESHOLD) {
                    session.sendRealtimeInput({ media: createBlob(downsampledData) });
                  } else {
                    session.sendRealtimeInput({ media: createBlob(new Float32Array(downsampledData.length)) });
                  }
                });
              }
            };
          },
          onmessage: async (message: LiveServerMessage) => {
            if (message.serverContent?.outputTranscription) {
              const chunk = message.serverContent.outputTranscription.text;
              processingBuffer.current += chunk;
              while (true) {
                const userTagIndex = processingBuffer.current.indexOf('[TO_USER]');
                const guestTagIndex = processingBuffer.current.indexOf('[TO_GUEST]');
                let foundIndex = -1;
                let foundTag = '';
                if (userTagIndex !== -1 && (guestTagIndex === -1 || userTagIndex < guestTagIndex)) {
                  foundIndex = userTagIndex; foundTag = '[TO_USER]';
                } else if (guestTagIndex !== -1) {
                  foundIndex = guestTagIndex; foundTag = '[TO_GUEST]';
                }
                if (foundIndex === -1) {
                  if (currentTargetChannel.current && processingBuffer.current.length > 0) {
                     const text = processingBuffer.current;
                     if (currentTargetChannel.current === 'user') {
                        currentUserTextRef.current += text;
                        setLiveUserText(currentUserTextRef.current);
                     } else {
                        currentGuestTextRef.current += text;
                        setLiveGuestText(currentGuestTextRef.current);
                     }
                     processingBuffer.current = ''; 
                  }
                  break; 
                }
                const preText = processingBuffer.current.substring(0, foundIndex);
                if (preText.length > 0 && currentTargetChannel.current) {
                   if (currentTargetChannel.current === 'user') {
                      currentUserTextRef.current += preText;
                      setLiveUserText(currentUserTextRef.current);
                   } else {
                      currentGuestTextRef.current += preText;
                      setLiveGuestText(currentGuestTextRef.current);
                   }
                }
                if (foundTag === '[TO_USER]') {
                   currentTargetChannel.current = 'user';
                   currentUserTextRef.current = ''; 
                   setLiveUserText('');
                } else {
                   currentTargetChannel.current = 'guest';
                   currentGuestTextRef.current = ''; 
                   setLiveGuestText('');
                }
                processingBuffer.current = processingBuffer.current.substring(foundIndex + foundTag.length);
              }
            }
            if (message.serverContent?.interrupted) {
              activeSources.current.forEach(s => { try { s.stop(); } catch(e) {} });
              activeSources.current.clear();
              nextStartTimeRef.current = 0;
              setStatus('listening');
            }
            const base64 = message.serverContent?.modelTurn?.parts?.find(p => p.inlineData)?.inlineData?.data;
            if (base64 && audioCtxRef.current) {
              const ctx = audioCtxRef.current;
              if (nextStartTimeRef.current < ctx.currentTime) nextStartTimeRef.current = ctx.currentTime;
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
          },
          onclose: () => {
             if (isActive) {
               setStatus('error');
               setErrorMessage("Connection lost");
             }
          },
          onerror: (e) => {
            console.error(e);
            setStatus('error');
            setErrorMessage('Connection Error');
          },
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          systemInstruction: `You are a simultaneous interpreter.
User Language: ${userLang.name}.
Guest Language: ${guestLang.name}.
RULES:
1. When you hear ${userLang.name}, translate to ${guestLang.name}. START with "[TO_GUEST]".
2. When you hear ${guestLang.name}, translate to ${userLang.name}. START with "[TO_USER]".
3. Do not chat. Only translate.`,
        }
      });
      sessionRef.current = await sessionPromise;
      setIsActive(true);
    } catch (e: any) { 
      cleanupNodes();
      setStatus('error'); 
      setErrorMessage(e?.message || 'Mic Access Denied'); 
    }
  };

  const handleInputSelection = async (deviceId: string) => {
    setUserInputDeviceId(deviceId);
    if (isActive) {
      await startSession(deviceId, userOutputDeviceId);
    }
  };

  const handleOutputSelection = async (deviceId: string) => {
    setUserOutputDeviceId(deviceId);
    if (audioCtxRef.current) {
      await applyOutputDevice(audioCtxRef.current, deviceId);
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
      <div className="h-44 bg-slate-900/30 backdrop-blur-3xl border-y border-white/5 relative z-40 shadow-[0_0_100px_rgba(0,0,0,0.8)] shrink-0">
        <div className="h-full grid grid-cols-3 px-10 items-center">
          
          {/* Left Column: Rotate */}
          <div className="flex justify-start">
            <button 
              onClick={() => setIsFlipped(!isFlipped)} 
              className={`w-14 h-14 rounded-full flex items-center justify-center transition-all active:scale-90 border border-white/10 ${isFlipped ? 'bg-blue-600 shadow-[0_0_30px_rgba(37,99,235,0.4)] text-white' : 'bg-slate-800/50 text-slate-400'}`}
              aria-label="Flip Guest Panel"
            >
              <RotateCcw className="w-6 h-6" />
            </button>
          </div>

          {/* Center Column: Microphone & Volume Indicator */}
          <div className="flex flex-col items-center justify-center relative -mt-28">
            {status === 'translating' && (
              <div className="absolute -top-12 flex items-center gap-2 animate-pulse bg-emerald-500/20 px-4 py-1.5 rounded-full border border-emerald-500/30">
                 <Sparkles className="w-3 h-3 text-emerald-400" />
                 <span className="text-[10px] font-black uppercase tracking-widest text-emerald-300">Translating</span>
              </div>
            )}
            
            <div className="relative flex flex-col items-center">
              <button 
                onClick={() => isActive ? stopSession() : startSession()} 
                disabled={status === 'connecting'} 
                className={`relative w-32 h-32 rounded-full flex items-center justify-center border-[10px] border-[#030712] transition-all shadow-2xl z-10 ${status === 'connecting' ? 'bg-slate-800' : isActive ? 'bg-red-500 ring-4 ring-red-500/20' : 'bg-[#2563eb] hover:bg-blue-500 ring-4 ring-blue-500/10'}`}
                aria-label={isActive ? "Stop Listening" : "Start Listening"}
              >
                {isActive ? <MicOff className="w-10 h-10 text-white" /> : <Mic className="w-10 h-10 text-white" />}
                {isActive && status !== 'connecting' && (
                   <div className="absolute inset-0 rounded-full border-4 border-white/20 animate-ping" />
                )}
              </button>

              {/* Volume Indicator Bar - Anchored to center */}
              <div className="absolute -bottom-10 flex flex-col items-center w-full">
                {isActive && (
                  <div className="w-24 h-1.5 bg-slate-800/80 rounded-full overflow-hidden backdrop-blur-sm border border-white/10">
                     <div 
                       className="h-full bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.5)] transition-all duration-75 ease-out"
                       style={{ width: `${Math.min(volumeLevel * 100, 100)}%` }}
                     />
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right Column: Settings */}
          <div className="flex justify-end">
            <button 
              onClick={() => setShowSettings(true)} 
              className="w-14 h-14 rounded-full bg-slate-800/50 flex items-center justify-center text-slate-400 hover:text-white transition-all active:scale-90 border border-white/10"
              aria-label="Open Settings"
            >
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
           <div className="bg-slate-900 w-full max-w-md rounded-[32px] p-8 border border-white/10 shadow-3xl max-h-full flex flex-col">
              <div className="flex justify-between items-center mb-6 shrink-0">
                 <h2 className="text-xl font-bold">Preferences</h2>
                 <button onClick={() => setShowSettings(false)} className="p-2 bg-slate-800 rounded-full hover:bg-slate-700 transition-colors" aria-label="Close Settings"><Trash2 className="w-5 h-5 text-slate-400" /></button>
              </div>
              <div className="space-y-6 overflow-y-auto custom-scrollbar flex-1">
                <div>
                  <div className="flex justify-between items-end mb-3">
                     <div className="flex items-center gap-3">
                       <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 block">Microphone (Input)</label>
                       {isActive && (
                          <div className="w-12 h-1 bg-slate-800 rounded-full overflow-hidden">
                             <div 
                                className="h-full bg-blue-500 transition-all duration-75"
                                style={{ width: `${Math.min(volumeLevel * 100, 100)}%` }}
                             />
                          </div>
                       )}
                     </div>
                     {!hasPermission && (
                       <button onClick={requestPermission} className="text-[10px] font-bold text-blue-400 hover:text-blue-300">Grant Permission</button>
                     )}
                  </div>
                   <div className="space-y-2">
                     {audioInputDevices.map(d => (
                       <button 
                         key={d.deviceId} 
                         onClick={() => handleInputSelection(d.deviceId)} 
                         className={`w-full text-left p-4 rounded-2xl border transition-all flex items-center justify-between gap-3 group ${userInputDeviceId === d.deviceId ? 'bg-blue-600 border-blue-400 shadow-[0_0_20px_rgba(37,99,235,0.3)] text-white' : 'bg-slate-800 border-transparent text-slate-400 hover:bg-slate-700 hover:text-slate-200'}`}
                       >
                         <div className="flex items-center gap-3 overflow-hidden">
                           {d.label.toLowerCase().includes('bluetooth') || d.label.toLowerCase().includes('headset') 
                              ? <Bluetooth className={`w-5 h-5 ${userInputDeviceId === d.deviceId ? 'text-white' : 'text-blue-400'}`} /> 
                              : <Mic className="w-5 h-5" />
                           }
                           <span className="text-sm font-medium truncate">{d.label || `Mic ${d.deviceId.slice(0, 5)}`}</span>
                         </div>
                         {userInputDeviceId === d.deviceId && <Check className="w-4 h-4 text-white" />}
                       </button>
                     ))}
                   </div>
                </div>
                <div>
                   <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-3 block">Speaker (Output)</label>
                   {audioOutputDevices.length === 0 && hasPermission && (
                     <div className="p-4 bg-slate-800/50 border border-slate-700 rounded-2xl mb-2">
                        <div className="flex gap-3">
                          <Info className="w-5 h-5 text-blue-400 shrink-0" />
                          <div className="text-xs text-slate-300 leading-relaxed">
                            <p className="font-bold text-white mb-1">iPhone / iPad Users:</p>
                            Apple does not allow web apps to control speaker output directly. To separate audio:
                            <ol className="list-decimal ml-4 mt-2 space-y-1 text-slate-400">
                              <li>Start the session.</li>
                              <li>Open Control Center.</li>
                              <li>Tap the AirPlay icon.</li>
                              <li>Select iPhone as the destination.</li>
                            </ol>
                          </div>
                        </div>
                     </div>
                   )}
                   <div className="space-y-2">
                     {audioOutputDevices.map(d => (
                       <button 
                         key={d.deviceId} 
                         onClick={() => handleOutputSelection(d.deviceId)} 
                         className={`w-full text-left p-4 rounded-2xl border transition-all flex items-center justify-between gap-3 group ${userOutputDeviceId === d.deviceId ? 'bg-emerald-600 border-emerald-400 shadow-[0_0_20px_rgba(16,185,129,0.3)] text-white' : 'bg-slate-800 border-transparent text-slate-400 hover:bg-slate-700 hover:text-slate-200'}`}
                       >
                         <div className="flex items-center gap-3 overflow-hidden">
                           <Speaker className={`w-5 h-5 ${userOutputDeviceId === d.deviceId ? 'text-white' : 'text-emerald-400'}`} />
                           <span className="text-sm font-medium truncate">{d.label || `Speaker ${d.deviceId.slice(0, 5)}`}</span>
                         </div>
                         {userOutputDeviceId === d.deviceId && <Check className="w-4 h-4 text-white" />}
                       </button>
                     ))}
                   </div>
                </div>
              </div>
              <div className="pt-6 shrink-0">
                <button onClick={() => setShowSettings(false)} className="w-full bg-white text-black font-black py-4 rounded-2xl uppercase tracking-widest text-xs hover:bg-slate-200 transition-colors shadow-lg active:scale-95 transform duration-150">Done</button>
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
               <h3 className="text-xl font-bold mb-2">Connection Error</h3>
               <p className="text-slate-400 text-sm mb-8 leading-relaxed">{errorMessage}</p>
               <button onClick={() => startSession()} className="w-full bg-red-500 py-4 rounded-2xl font-black uppercase tracking-widest text-xs flex items-center justify-center gap-2 hover:bg-red-400 transition-colors">
                 <RefreshCw className="w-4 h-4" /> Retry
               </button>
            </div>
         </div>
      )}
    </div>
  );
};

export default App;
