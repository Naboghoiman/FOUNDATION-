import React, { useState, useEffect, useRef } from 'react';
import { TrackData, DeckTelemetry } from '../types/dj';
import { DjMasterController } from '../audio/djMasterController';
import { SuperpoweredFxType, SUPERPOWERED_FX_LIST } from '../audio/superpoweredFxRack';
import {
  Play,
  Pause,
  RotateCw,
  Sliders,
  Volume2,
  Folder,
  Disc,
  Headphones,
  Settings,
  Music,
  ChevronLeft,
  ChevronRight,
  Menu,
  Grid,
  Radio,
  Sparkles,
  Layers,
  ChevronDown
} from 'lucide-react';

interface DjImanConsoleProps {
  controller: DjMasterController | null;
  trackA: TrackData | null;
  trackB: TrackData | null;
  telemetryA: DeckTelemetry;
  telemetryB: DeckTelemetry;
  crossfader: number;
  onCrossfaderChange: (val: number) => void;
  onPlayPauseA: () => void;
  onPlayPauseB: () => void;
  onCueA: () => void;
  onCueB: () => void;
  onSyncA: () => void;
  onSyncB: () => void;
  onSeekA: (sample: number) => void;
  onSeekB: (sample: number) => void;
  onOpenLibrary: () => void;
  onOpenLooper: () => void;
  onOpenFx: () => void;
  onOpenSettings: () => void;
  onOpenDeckView?: (deck: 'A' | 'B') => void;
}

// Realistic Screw Component
const AllenScrew: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div
    className={`w-3.5 h-3.5 rounded-full bg-gradient-to-br from-neutral-400 via-neutral-600 to-neutral-800 shadow-[inset_0_1px_1px_rgba(255,255,255,0.6),0_1px_2px_rgba(0,0,0,0.8)] border border-neutral-700 flex items-center justify-center ${className}`}
  >
    <div className="w-1.5 h-1.5 rounded-[1px] bg-neutral-900 border border-neutral-600/60 rotate-45 shadow-inner" />
  </div>
);

// LED VU Meter Segment Definition
const VU_SEGMENTS = [
  { label: 'CLIP', color: '#ef4444', isClip: true },
  { label: '6', color: '#ef4444', isClip: false },
  { label: '3', color: '#f97316', isClip: false },
  { label: '0', color: '#f97316', isClip: false },
  { label: '-3', color: '#22c55e', isClip: false },
  { label: '-6', color: '#22c55e', isClip: false },
  { label: '-9', color: '#22c55e', isClip: false },
  { label: '-12', color: '#22c55e', isClip: false },
  { label: '-18', color: '#22c55e', isClip: false },
  { label: '-24', color: '#22c55e', isClip: false },
];

export const DjImanConsole: React.FC<DjImanConsoleProps> = ({
  controller,
  trackA,
  trackB,
  telemetryA,
  telemetryB,
  crossfader,
  onCrossfaderChange,
  onPlayPauseA,
  onPlayPauseB,
  onCueA,
  onCueB,
  onSyncA,
  onSyncB,
  onSeekA,
  onSeekB,
  onOpenLibrary,
  onOpenLooper,
  onOpenFx,
  onOpenSettings,
  onOpenDeckView,
}) => {
  // Waveform canvas refs
  const canvasRefA = useRef<HTMLCanvasElement | null>(null);
  const canvasRefB = useRef<HTMLCanvasElement | null>(null);

  // Mixer Local Knobs & States
  const [trimA, setTrimA] = useState(1.0);
  const [trimB, setTrimB] = useState(1.0);
  const [faderA, setFaderA] = useState(0.85);
  const [faderB, setFaderB] = useState(0.85);

  const [hiA, setHiA] = useState(0);
  const [midA, setMidA] = useState(0);
  const [lowA, setLowA] = useState(0);
  const [filterA, setFilterA] = useState(0.5); // 0.5 = center neutral

  const [hiB, setHiB] = useState(0);
  const [midB, setMidB] = useState(0);
  const [lowB, setLowB] = useState(0);
  const [filterB, setFilterB] = useState(0.5);

  // Master Section States
  const [masterLevel, setMasterLevel] = useState(1.0);
  const [isoHi, setIsoHi] = useState(0);
  const [isoMid, setIsoMid] = useState(0);
  const [isoLow, setIsoLow] = useState(0);

  // Master FX Rack States
  const [activeFx, setActiveFx] = useState<SuperpoweredFxType>('FLANGER');
  const [fxEnabled, setFxEnabled] = useState(true);
  const [fxTime, setFxTime] = useState(0.5);
  const [fxDepth, setFxDepth] = useState(0.65);
  const [fxLevel, setFxLevel] = useState(0.5);

  // Headphone CUE toggles
  const [cueChannelA, setCueChannelA] = useState(false);
  const [cueChannelB, setCueChannelB] = useState(false);

  // VU Levels animation state
  const [vuL, setVuL] = useState(0.4);
  const [vuR, setVuR] = useState(0.38);

  // Sync state with audio engine
  useEffect(() => {
    if (!controller) return;

    // Set initial values
    controller.deckA.setVolume(faderA * trimA);
    controller.deckB.setVolume(faderB * trimB);
    controller.deckA.setEQ(lowA, midA, hiA);
    controller.deckB.setEQ(lowB, midB, hiB);
    controller.deckA.setFilter(filterA);
    controller.deckB.setFilter(filterB);

    controller.fxRack.setMasterLevel(masterLevel);
    controller.fxRack.setIsolatorGains(isoLow, isoMid, isoHi);
    controller.fxRack.setActiveFx(activeFx);
    controller.fxRack.setFxEnabled(fxEnabled);
    controller.fxRack.setTimeKnob(fxTime);
    controller.fxRack.setDepthKnob(fxDepth);
    controller.fxRack.setLevelKnob(fxLevel);
  }, [controller]);

  // Real-time meter animation loop (throttled to ~20 FPS for silky, CPU-friendly LED response)
  useEffect(() => {
    let animId: number;
    let lastMeterUpdate = 0;
    const updateVu = (time: number) => {
      if (controller && time - lastMeterUpdate > 50) {
        lastMeterUpdate = time;
        try {
          const levels = controller.fxRack.getVuLevels();
          const baseA = telemetryA.isPlaying ? 0.35 + Math.random() * 0.45 : 0;
          const baseB = telemetryB.isPlaying ? 0.35 + Math.random() * 0.45 : 0;
          const netL = Math.max(levels.leftLinear, baseA);
          const netR = Math.max(levels.rightLinear, baseB);
          setVuL(netL);
          setVuR(netR);
        } catch {
          // ignore
        }
      }
      animId = requestAnimationFrame(updateVu);
    };
    animId = requestAnimationFrame(updateVu);
    return () => cancelAnimationFrame(animId);
  }, [controller, telemetryA.isPlaying, telemetryB.isPlaying]);

  // Master FX Controls Handlers
  const handleCyclePrevFx = () => {
    if (!controller) return;
    const next = controller.fxRack.cyclePrevFx();
    setActiveFx(next);
  };

  const handleCycleNextFx = () => {
    if (!controller) return;
    const next = controller.fxRack.cycleNextFx();
    setActiveFx(next);
  };

  const handleToggleFx = () => {
    if (!controller) return;
    const enabled = controller.fxRack.toggleFx();
    setFxEnabled(enabled);
  };

  const handleMasterLevelChange = (val: number) => {
    setMasterLevel(val);
    controller?.fxRack.setMasterLevel(val);
  };

  // Draw Dual Waveforms with center playhead
  useEffect(() => {
    const drawDeck = (
      canvas: HTMLCanvasElement | null,
      track: TrackData | null,
      currentSample: number,
      colorHex: string,
      glowColor: string
    ) => {
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const w = canvas.width;
      const h = canvas.height;
      const centerY = h / 2;
      const centerPixel = w / 2;

      ctx.clearRect(0, 0, w, h);

      // Deep dark reflective metallic background
      const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
      bgGrad.addColorStop(0, '#06080b');
      bgGrad.addColorStop(0.5, '#0b0e13');
      bgGrad.addColorStop(1, '#05070a');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, w, h);

      // Center subtle horizontal guideline
      ctx.strokeStyle = '#1e2430';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, centerY);
      ctx.lineTo(w, centerY);
      ctx.stroke();

      if (!track || !track.audioBuffer) {
        // Flat line idle
        ctx.strokeStyle = '#374151';
        ctx.stroke();
        return;
      }

      const channelData = track.audioBuffer.getChannelData(0);
      const totalSamples = channelData.length;
      const samplesPerBeat = track.beatGrid.samplesPerBeat || 22050;
      const visibleBeats = 12;
      const visibleSamples = samplesPerBeat * visibleBeats;
      const startSample = currentSample - visibleSamples / 2;

      // Draw Waveform Bars
      const numBars = 180;
      const barWidth = w / numBars;
      const samplesPerBar = Math.floor(visibleSamples / numBars);

      for (let i = 0; i < numBars; i++) {
        const barSampleStart = Math.floor(startSample + i * samplesPerBar);
        const x = i * barWidth;

        let maxAmp = 0;
        if (barSampleStart >= 0 && barSampleStart < totalSamples) {
          const checkLen = Math.min(samplesPerBar, totalSamples - barSampleStart);
          for (let s = 0; s < checkLen; s += 8) {
            const val = Math.abs(channelData[barSampleStart + s]);
            if (val > maxAmp) maxAmp = val;
          }
        }

        const ampHeight = Math.max(2, maxAmp * (h * 0.44));

        // Gradient for waveform bar
        const barGrad = ctx.createLinearGradient(0, centerY - ampHeight, 0, centerY + ampHeight);
        barGrad.addColorStop(0, glowColor);
        barGrad.addColorStop(0.5, colorHex);
        barGrad.addColorStop(1, glowColor);

        ctx.fillStyle = barGrad;
        ctx.fillRect(x, centerY - ampHeight, Math.max(1.5, barWidth - 1), ampHeight * 2);
      }

      // Draw Beat Grid Lines
      const beatStart = track.beatGrid.beatStartSample || 0;
      const firstVisibleBeat = Math.floor((startSample - beatStart) / samplesPerBeat);
      const lastVisibleBeat = Math.ceil((startSample + visibleSamples - beatStart) / samplesPerBeat);

      for (let b = firstVisibleBeat; b <= lastVisibleBeat; b++) {
        const bSample = beatStart + b * samplesPerBeat;
        if (bSample >= startSample && bSample <= startSample + visibleSamples) {
          const bx = ((bSample - startSample) / visibleSamples) * w;
          const isDownbeat = (b % 4 === 0);

          ctx.strokeStyle = isDownbeat ? '#ffffff' : '#4b5563';
          ctx.lineWidth = isDownbeat ? 1.5 : 1;
          ctx.beginPath();
          ctx.moveTo(bx, h - 8);
          ctx.lineTo(bx, h);
          ctx.stroke();

          // Small downbeat square tick
          if (isDownbeat) {
            ctx.fillStyle = isDownbeat ? colorHex : '#6b7280';
            ctx.fillRect(bx - 1.5, h - 6, 3, 4);
          }
        }
      }

      // Center Vertical Playhead Line with red marker
      ctx.shadowColor = '#ffffff';
      ctx.shadowBlur = 8;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(centerPixel, 0);
      ctx.lineTo(centerPixel, h);
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Top and Bottom Playhead Pointer Flags
      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.moveTo(centerPixel - 4, 0);
      ctx.lineTo(centerPixel + 4, 0);
      ctx.lineTo(centerPixel, 6);
      ctx.closePath();
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(centerPixel - 4, h);
      ctx.lineTo(centerPixel + 4, h);
      ctx.lineTo(centerPixel, h - 6);
      ctx.closePath();
      ctx.fill();
    };

    drawDeck(canvasRefA.current, trackA, telemetryA.currentSourceSample, '#ff7700', '#ffaa33');
    drawDeck(canvasRefB.current, trackB, telemetryB.currentSourceSample, '#00bfff', '#66d9ff');
  }, [trackA, trackB, telemetryA.currentSourceSample, telemetryB.currentSourceSample]);

  // Knobs drag interaction helper
  const makeKnob = (
    label: string,
    value: number,
    min: number,
    max: number,
    onChange: (val: number) => void,
    options?: {
      notchColor?: string;
      minLabel?: string;
      maxLabel?: string;
      size?: number;
      isBi?: boolean;
    }
  ) => {
    const {
      notchColor = '#00e5ff',
      minLabel = '-∞',
      maxLabel = '+10',
      size = 50,
      isBi = false,
    } = options || {};

    const norm = Math.max(0, Math.min(1, (value - min) / (max - min || 1)));
    const angle = -135 + norm * 270;

    const handlePointerDown = (e: React.PointerEvent) => {
      const startY = e.clientY;
      const startVal = value;
      const target = e.currentTarget as HTMLElement;
      target.setPointerCapture(e.pointerId);

      const handleMove = (moveEv: PointerEvent) => {
        const dy = startY - moveEv.clientY;
        const range = max - min;
        const sensitivity = range / 160;
        const newVal = Math.max(min, Math.min(max, startVal + dy * sensitivity));
        onChange(newVal);
      };

      const handleUp = (upEv: PointerEvent) => {
        target.removeEventListener('pointermove', handleMove);
        target.removeEventListener('pointerup', handleUp);
        try {
          target.releasePointerCapture(upEv.pointerId);
        } catch {}
      };

      target.addEventListener('pointermove', handleMove);
      target.addEventListener('pointerup', handleUp);
    };

    return (
      <div className="flex flex-col items-center select-none">
        {label && (
          <span className="text-[10px] font-extrabold tracking-wider text-neutral-300 uppercase mb-0.5 drop-shadow">
            {label}
          </span>
        )}
        <div
          onPointerDown={handlePointerDown}
          style={{ width: `${size}px`, height: `${size}px` }}
          className="relative rounded-full cursor-ns-resize bg-gradient-to-b from-[#404652] via-[#20242b] to-[#121519] border-2 border-neutral-700 shadow-[0_4px_10px_rgba(0,0,0,0.9),inset_0_1px_2px_rgba(255,255,255,0.3)] hover:brightness-110 active:scale-95 transition-transform flex items-center justify-center p-1"
        >
          {/* Inner Dial Face */}
          <div
            className="w-full h-full rounded-full shadow-[inset_0_2px_6px_rgba(0,0,0,0.8)] relative flex items-center justify-center"
            style={{
              background: 'radial-gradient(circle at 45% 45%, #4a525f 0%, #1e2229 60%, #101216 100%)',
            }}
          >
            {/* Rotating Notch Line */}
            <div
              className="absolute inset-0 flex items-start justify-center"
              style={{
                transform: `rotate(${angle}deg)`,
                transformOrigin: 'center center',
              }}
            >
              <div
                className="w-1 h-3 rounded-full mt-1 shadow-[0_0_6px_currentColor]"
                style={{
                  backgroundColor: notchColor,
                  color: notchColor,
                }}
              />
            </div>
            {/* Center Cap */}
            <div className="w-3.5 h-3.5 rounded-full bg-gradient-to-tr from-neutral-800 to-neutral-600 border border-neutral-700/80 shadow-inner" />
          </div>
        </div>
        {/* Min/Max Labels */}
        <div className="flex items-center justify-between w-full px-1 mt-0.5 text-[8px] font-mono text-neutral-400">
          <span>{minLabel}</span>
          <span>{maxLabel}</span>
        </div>
      </div>
    );
  };

  // Channel Vertical Fader Helper
  const makeFader = (
    label: string,
    value: number,
    onChange: (val: number) => void
  ) => {
    const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
      const target = e.currentTarget;
      const rect = target.getBoundingClientRect();
      target.setPointerCapture(e.pointerId);

      const update = (clientY: number) => {
        const fraction = Math.max(0, Math.min(1, (rect.bottom - clientY) / rect.height));
        onChange(fraction);
      };

      update(e.clientY);

      const handleMove = (ev: PointerEvent) => update(ev.clientY);
      const handleUp = (ev: PointerEvent) => {
        target.removeEventListener('pointermove', handleMove);
        target.removeEventListener('pointerup', handleUp);
        try {
          target.releasePointerCapture(ev.pointerId);
        } catch {}
      };

      target.addEventListener('pointermove', handleMove);
      target.addEventListener('pointerup', handleUp);
    };

    const norm = Math.max(0, Math.min(1, value));

    return (
      <div className="flex flex-col items-center select-none w-full px-2 py-1">
        <div
          onPointerDown={handlePointerDown}
          className="relative w-12 h-36 bg-[#090b0e] border border-neutral-800 rounded-sm shadow-inner cursor-ns-resize flex items-center justify-center"
        >
          {/* Fader Slot */}
          <div className="w-1.5 h-32 bg-black border-x border-neutral-700/80 shadow-[inset_0_0_4px_rgba(0,0,0,0.9)]" />

          {/* Calibrated dB markings */}
          <div className="absolute left-1 top-2 bottom-2 flex flex-col justify-between text-[7px] font-mono text-neutral-500 pointer-events-none">
            <span>+6</span>
            <span>0</span>
            <span>-6</span>
            <span>-12</span>
            <span>-24</span>
            <span>-∞</span>
          </div>

          <div className="absolute right-1 top-2 bottom-2 flex flex-col justify-between text-[7px] font-mono text-neutral-500 pointer-events-none">
            <span>—</span>
            <span>—</span>
            <span>—</span>
            <span>—</span>
            <span>—</span>
            <span>—</span>
          </div>

          {/* Metallic Knurled Fader Cap */}
          <div
            className="absolute left-1/2 -translate-x-1/2 w-10 h-7 rounded bg-gradient-to-b from-neutral-200 via-neutral-400 to-neutral-600 border border-neutral-700 shadow-[0_4px_8px_rgba(0,0,0,0.9),inset_0_1px_1px_rgba(255,255,255,0.8)] pointer-events-none flex items-center justify-center transition-all"
            style={{
              bottom: `calc(${norm * 100}% - 14px)`,
            }}
          >
            {/* Center White Marker Line */}
            <div className="w-full h-[2px] bg-white shadow-[0_0_3px_#fff]" />
            {/* Grip lines */}
            <div className="absolute inset-y-1 left-2 flex flex-col justify-around">
              <div className="w-1.5 h-[1px] bg-neutral-600" />
              <div className="w-1.5 h-[1px] bg-neutral-600" />
            </div>
            <div className="absolute inset-y-1 right-2 flex flex-col justify-around">
              <div className="w-1.5 h-[1px] bg-neutral-600" />
              <div className="w-1.5 h-[1px] bg-neutral-600" />
            </div>
          </div>
        </div>
        <span className="text-sm font-black font-mono text-white mt-1">{label}</span>
      </div>
    );
  };

  // LED VU Meter Ladder
  const renderVuMeter = (level: number, label: string) => {
    const activeCount = Math.floor(level * VU_SEGMENTS.length);
    return (
      <div className="flex flex-col items-center bg-[#07090c] p-1 rounded border border-neutral-800/80 shadow-inner">
        <div className="flex flex-col gap-[2px]">
          {VU_SEGMENTS.map((seg, idx) => {
            const isActive = idx >= VU_SEGMENTS.length - activeCount;
            return (
              <div key={idx} className="flex items-center gap-1">
                <span className="text-[7px] font-mono text-neutral-500 w-3 text-right">
                  {seg.label}
                </span>
                <div
                  className="w-3 h-1.5 rounded-[1px] transition-all duration-75"
                  style={{
                    backgroundColor: isActive ? seg.color : '#16191f',
                    boxShadow: isActive ? `0 0 6px ${seg.color}` : 'none',
                    opacity: isActive ? 1 : 0.4,
                  }}
                />
              </div>
            );
          })}
        </div>
        <span className="text-[8px] font-mono font-bold text-neutral-400 mt-1">{label}</span>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[#07090c] text-slate-100 flex flex-col items-center justify-start p-1 sm:p-3 font-sans select-none">
      {/* Outer DJ Chassis Bezel */}
      <div className="w-full max-w-5xl bg-[#0e1116] border-2 border-neutral-700/80 rounded-2xl shadow-[0_12px_40px_rgba(0,0,0,0.95)] overflow-hidden flex flex-col">
        {/* 1. TOP HEADER BAR */}
        <div className="flex items-center justify-between px-3 py-2 bg-gradient-to-b from-[#1c212a] via-[#12161e] to-[#0d1017] border-b border-neutral-800 shadow-md">
          {/* Left Controls */}
          <div className="flex items-center gap-2">
            <button
              onClick={onOpenSettings}
              className="p-2 rounded bg-gradient-to-b from-neutral-700 to-neutral-900 border border-neutral-600 hover:brightness-125 transition-all cursor-pointer shadow"
              title="Menu"
            >
              <Menu className="w-4 h-4 text-neutral-200" />
            </button>
            <button
              onClick={onOpenLibrary}
              className="px-3 py-1.5 rounded bg-gradient-to-b from-neutral-700 to-neutral-900 border border-neutral-600 text-xs font-bold font-mono tracking-wider text-neutral-200 flex items-center gap-1.5 hover:brightness-125 transition-all cursor-pointer shadow"
            >
              <Music className="w-3.5 h-3.5 text-cyan-400" />
              <span>LIBRARY</span>
            </button>
          </div>

          {/* Center Embossed Metallic Branding */}
          <div className="flex items-center gap-2 px-4 py-1">
            <h1
              className="text-2xl font-black italic tracking-wider uppercase font-sans drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]"
              style={{
                background: 'linear-gradient(180deg, #ffffff 0%, #d1d5db 40%, #9ca3af 70%, #4b5563 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}
            >
              DJ IMAN
            </h1>
            <Headphones className="w-6 h-6 text-neutral-300 drop-shadow-[0_2px_6px_rgba(255,255,255,0.4)]" />
          </div>

          {/* Right Controls */}
          <div className="flex items-center gap-2">
            <button
              onClick={onOpenFx}
              className="px-3 py-1.5 rounded bg-[#181d26] border-2 border-amber-500/80 shadow-[0_0_12px_rgba(245,158,11,0.3)] text-amber-300 text-xs font-bold font-mono flex items-center gap-1.5 hover:bg-amber-950/40 transition-all cursor-pointer"
              title="Master Output & Effects Rack"
            >
              <Volume2 className="w-3.5 h-3.5 text-amber-400" />
              <span>MASTER OUTPUT</span>
              <ChevronDown className="w-3 h-3 text-amber-400" />
            </button>
            <button
              onClick={onOpenSettings}
              className="p-2 rounded bg-gradient-to-b from-neutral-700 to-neutral-900 border border-neutral-600 hover:brightness-125 transition-all cursor-pointer shadow text-neutral-200"
              title="Settings"
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* 2. DUAL STACKED WAVEFORMS (DECK A & DECK B) */}
        <div className="bg-[#080a0e] p-2 space-y-1.5 border-b border-neutral-800">
          {/* Deck A Waveform Lane (Orange) */}
          <div className="flex items-center gap-2 bg-[#0c0f15] border border-neutral-800 rounded-lg p-1.5 shadow-inner">
            {/* Deck Badge */}
            <div className="w-10 h-10 rounded-lg bg-[#1a0f05] border-2 border-orange-500 flex items-center justify-center shrink-0 shadow-[0_0_10px_rgba(249,115,22,0.4)]">
              <span className="text-xl font-black text-orange-400 font-mono">A</span>
            </div>

            {/* Track Info Header */}
            <div className="w-44 shrink-0 overflow-hidden leading-tight">
              <div className="text-xs font-bold text-white truncate drop-shadow">
                {trackA?.title || 'Insane (Howwe.biz.ug)'}
              </div>
              <div className="text-[10px] text-neutral-400 font-mono flex items-center gap-2">
                <span className="text-orange-400 font-bold">128.0 BPM</span>
                <span>03:06</span>
                <span className="text-neutral-500">Em</span>
              </div>
            </div>

            {/* Scrolling Waveform Canvas */}
            <div className="flex-1 h-12 relative overflow-hidden rounded bg-[#06080b] border border-neutral-800 cursor-pointer">
              <canvas
                ref={canvasRefA}
                width={600}
                height={48}
                className="w-full h-full block"
                onClick={(e) => {
                  if (!trackA?.audioBuffer) return;
                  const rect = e.currentTarget.getBoundingClientRect();
                  const ratio = (e.clientX - rect.left) / rect.width;
                  const target = Math.floor(ratio * trackA.audioBuffer.length);
                  onSeekA(target);
                }}
              />
            </div>

            {/* Right Artwork & Meta */}
            <div className="flex items-center gap-2 shrink-0">
              {/* Album Art Box */}
              <div className="w-10 h-10 rounded border border-neutral-700 bg-neutral-900 overflow-hidden relative flex items-center justify-center shadow">
                <Disc className="w-6 h-6 text-orange-400 animate-spin" style={{ animationDuration: telemetryA.isPlaying ? '3s' : '0s' }} />
              </div>
              <div className="text-[9px] font-mono text-neutral-400 flex flex-col items-end leading-tight">
                <div>KEY <span className="text-white font-bold">Em</span></div>
                <div>BPM <span className="text-orange-400 font-bold">128.0</span></div>
              </div>
              <div className="flex items-center gap-0.5">
                <button
                  onClick={() => onSeekA(Math.max(0, telemetryA.currentSourceSample - 44100 * 5))}
                  className="p-1 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-300 transition-colors"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => onSeekA(telemetryA.currentSourceSample + 44100 * 5)}
                  className="p-1 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-300 transition-colors"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>

          {/* Deck B Waveform Lane (Cyan/Blue) */}
          <div className="flex items-center gap-2 bg-[#0c0f15] border border-neutral-800 rounded-lg p-1.5 shadow-inner">
            {/* Deck Badge */}
            <div className="w-10 h-10 rounded-lg bg-[#05131a] border-2 border-cyan-500 flex items-center justify-center shrink-0 shadow-[0_0_10px_rgba(6,182,212,0.4)]">
              <span className="text-xl font-black text-cyan-400 font-mono">B</span>
            </div>

            {/* Track Info Header */}
            <div className="w-44 shrink-0 overflow-hidden leading-tight">
              <div className="text-xs font-bold text-white truncate drop-shadow">
                {trackB?.title || 'Howwe Music - Data Cable'}
              </div>
              <div className="text-[10px] text-neutral-400 font-mono flex items-center gap-2">
                <span className="text-cyan-400 font-bold">128.0 BPM</span>
                <span>03:03</span>
                <span className="text-neutral-500">Em</span>
              </div>
            </div>

            {/* Scrolling Waveform Canvas */}
            <div className="flex-1 h-12 relative overflow-hidden rounded bg-[#06080b] border border-neutral-800 cursor-pointer">
              <canvas
                ref={canvasRefB}
                width={600}
                height={48}
                className="w-full h-full block"
                onClick={(e) => {
                  if (!trackB?.audioBuffer) return;
                  const rect = e.currentTarget.getBoundingClientRect();
                  const ratio = (e.clientX - rect.left) / rect.width;
                  const target = Math.floor(ratio * trackB.audioBuffer.length);
                  onSeekB(target);
                }}
              />
            </div>

            {/* Right Artwork & Meta */}
            <div className="flex items-center gap-2 shrink-0">
              <div className="w-10 h-10 rounded border border-neutral-700 bg-neutral-900 overflow-hidden relative flex items-center justify-center shadow">
                <Disc className="w-6 h-6 text-cyan-400 animate-spin" style={{ animationDuration: telemetryB.isPlaying ? '3s' : '0s' }} />
              </div>
              <div className="text-[9px] font-mono text-neutral-400 flex flex-col items-end leading-tight">
                <div>KEY <span className="text-white font-bold">Em</span></div>
                <div>BPM <span className="text-cyan-400 font-bold">128.0</span></div>
              </div>
              <div className="flex items-center gap-0.5">
                <button
                  onClick={() => onSeekB(Math.max(0, telemetryB.currentSourceSample - 44100 * 5))}
                  className="p-1 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-300 transition-colors"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => onSeekB(telemetryB.currentSourceSample + 44100 * 5)}
                  className="p-1 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-300 transition-colors"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* 3. MAIN HARDWARE CONSOLE BODY (3 MAIN COLUMNS: DECK A | MIXER | DECK B) */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-2 p-3 bg-gradient-to-b from-[#111419] to-[#0c0e12] relative">
          {/* Corner Allen Screws on the main chassis */}
          <AllenScrew className="absolute top-2 left-2" />
          <AllenScrew className="absolute top-2 right-2" />
          <AllenScrew className="absolute bottom-2 left-2" />
          <AllenScrew className="absolute bottom-2 right-2" />

          {/* LEFT COLUMN: DECK A (Col span 3) */}
          <div className="md:col-span-3 bg-[#0a0d11] border border-neutral-800/80 rounded-xl p-3 flex flex-col items-center justify-between shadow-lg relative">
            <div className="w-full flex items-center justify-between border-b border-neutral-800 pb-2 mb-2">
              <span className="text-xs font-black font-mono tracking-wider text-neutral-300 flex items-center gap-1.5">
                <Menu className="w-3.5 h-3.5 text-neutral-400" />
                DECK A
              </span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-orange-950/80 border border-orange-600/50 text-orange-400 font-bold">
                CH 1
              </span>
            </div>

            {/* Circular Vinyl / Platter */}
            <div
              onClick={() => onOpenDeckView?.('A')}
              className="w-40 h-40 sm:w-44 sm:h-44 rounded-full bg-[#050608] border-4 border-orange-500 shadow-[0_0_25px_rgba(249,115,22,0.3),inset_0_0_15px_rgba(0,0,0,0.9)] cursor-pointer relative flex items-center justify-center group hover:scale-[1.02] transition-transform my-2"
            >
              {/* Vinyl Grooves Texture */}
              <div className="absolute inset-2 rounded-full border border-neutral-800/90" />
              <div className="absolute inset-4 rounded-full border border-neutral-800/80" />
              <div className="absolute inset-6 rounded-full border border-neutral-800/70" />
              <div className="absolute inset-8 rounded-full border border-neutral-800/60" />
              <div className="absolute inset-10 rounded-full border border-neutral-800/50" />

              {/* Center Platter Hub */}
              <div className="w-16 h-16 rounded-full bg-gradient-to-tr from-neutral-800 via-neutral-900 to-neutral-700 border border-neutral-600 shadow-xl flex flex-col items-center justify-center text-center p-1">
                <Disc className={`w-6 h-6 text-orange-400 ${telemetryA.isPlaying ? 'animate-spin' : ''}`} style={{ animationDuration: '2s' }} />
                <span className="text-[8px] font-black font-mono text-white tracking-tight mt-0.5">
                  TAP TO OPEN
                </span>
              </div>
            </div>

            {/* Vertical Performance & Transport Buttons */}
            <div className="w-full space-y-2 mt-2">
              {/* Big Green PLAY/PAUSE */}
              <button
                onClick={onPlayPauseA}
                className={`w-full py-2.5 px-3 rounded-lg border-2 font-mono font-black text-xs tracking-wider flex items-center justify-center gap-2 transition-all cursor-pointer shadow-lg ${
                  telemetryA.isPlaying
                    ? 'bg-emerald-950/80 border-emerald-500 text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.4)]'
                    : 'bg-[#101712] border-emerald-600/70 text-emerald-500 hover:brightness-125'
                }`}
              >
                {telemetryA.isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current" />}
                <span>PLAY / PAUSE</span>
              </button>

              {/* CUE Button */}
              <button
                onClick={onCueA}
                className="w-full py-2 px-3 rounded-lg bg-gradient-to-b from-neutral-700 to-neutral-900 border border-neutral-600 hover:brightness-125 text-white font-mono font-black text-xs tracking-wider transition-all cursor-pointer shadow"
              >
                CUE
              </button>

              {/* SYNC Button (Orange outline) */}
              <button
                onClick={onSyncA}
                className="w-full py-2 px-3 rounded-lg bg-gradient-to-b from-[#1c1208] to-[#0f0a04] border-2 border-orange-500/80 shadow-[0_0_12px_rgba(249,115,22,0.3)] text-orange-400 font-mono font-black text-xs tracking-wider hover:brightness-125 transition-all cursor-pointer"
              >
                SYNC
              </button>

              {/* LOOP Button */}
              <button
                onClick={onOpenLooper}
                className="w-full py-1.5 px-3 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-700 text-neutral-300 font-mono font-bold text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <RotateCw className="w-3.5 h-3.5 text-cyan-400" />
                <span>LOOP</span>
              </button>

              {/* HOT CUES & SAMPLE Buttons */}
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  onClick={() => onOpenDeckView?.('A')}
                  className="py-1.5 px-2 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-700 text-neutral-300 font-mono font-bold text-[10px] flex items-center justify-center gap-1 transition-colors cursor-pointer"
                >
                  <Grid className="w-3 h-3 text-emerald-400" />
                  <span>HOT CUES</span>
                </button>
                <button
                  onClick={onOpenLibrary}
                  className="py-1.5 px-2 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-700 text-neutral-300 font-mono font-bold text-[10px] flex items-center justify-center gap-1 transition-colors cursor-pointer"
                >
                  <Grid className="w-3 h-3 text-cyan-400" />
                  <span>SAMPLE</span>
                </button>
              </div>
            </div>
          </div>

          {/* CENTER COLUMN: MIXER & MASTER FX (Col span 6) */}
          <div className="md:col-span-6 bg-[#0c0f14] border-2 border-neutral-700 rounded-xl p-3 shadow-2xl relative flex flex-col justify-between">
            {/* 4 Corner Allen Screws on Mixer Faceplate */}
            <AllenScrew className="absolute top-2 left-2" />
            <AllenScrew className="absolute top-2 right-2" />
            <AllenScrew className="absolute bottom-2 left-2" />
            <AllenScrew className="absolute bottom-2 right-2" />

            {/* Top Mixer Strip: Channel 1 | Center Master | Channel 2 */}
            <div className="grid grid-cols-3 gap-2">
              {/* --- CHANNEL 1 --- */}
              <div className="flex flex-col items-center space-y-2 border-r border-neutral-800 pr-1">
                <span className="text-[11px] font-black font-mono text-neutral-300 tracking-wider">
                  CHANNEL 1
                </span>

                {/* TRIM */}
                {makeKnob('TRIM', trimA, 0, 2, (v) => {
                  setTrimA(v);
                  controller?.deckA.setVolume(faderA * v);
                }, { notchColor: '#ffffff', minLabel: '-∞', maxLabel: '+10', size: 44 })}

                {/* HI (Red) */}
                {makeKnob('HI', hiA, -26, 6, (v) => {
                  setHiA(v);
                  controller?.deckA.setEQ(lowA, midA, v);
                }, { notchColor: '#ef4444', minLabel: '-26', maxLabel: '+6', size: 42 })}

                {/* MID (Orange) */}
                {makeKnob('MID', midA, -26, 6, (v) => {
                  setMidA(v);
                  controller?.deckA.setEQ(lowA, v, hiA);
                }, { notchColor: '#f97316', minLabel: '-26', maxLabel: '+6', size: 42 })}

                {/* LOW (Cyan/Blue) */}
                {makeKnob('LOW', lowA, -26, 6, (v) => {
                  setLowA(v);
                  controller?.deckA.setEQ(v, midA, hiA);
                }, { notchColor: '#00bfff', minLabel: '-26', maxLabel: '+6', size: 42 })}

                {/* FILTER */}
                {makeKnob('FILTER', filterA, 0, 1, (v) => {
                  setFilterA(v);
                  controller?.deckA.setFilter(v);
                }, { notchColor: '#06b6d4', minLabel: '-LPF', maxLabel: '+HPF', size: 42 })}

                {/* Headphone CUE button */}
                <button
                  onClick={() => setCueChannelA(!cueChannelA)}
                  className={`px-3 py-1 rounded border flex items-center gap-1 text-[10px] font-mono font-bold transition-all cursor-pointer mt-1 ${
                    cueChannelA
                      ? 'bg-orange-950 border-orange-500 text-orange-400 shadow-[0_0_8px_rgba(249,115,22,0.5)]'
                      : 'bg-neutral-900 border-neutral-700 text-neutral-400'
                  }`}
                >
                  <Headphones className="w-3 h-3" />
                  <span>CUE</span>
                </button>
              </div>

              {/* --- CENTER SUB-COLUMN: MASTER & ISOLATOR --- */}
              <div className="flex flex-col items-center justify-between px-1">
                {/* MASTER Title & Big Level Knob flanked by Stereo LED meters */}
                <div className="w-full flex flex-col items-center">
                  <span className="text-[11px] font-black font-mono text-neutral-300 tracking-wider mb-1">
                    MASTER
                  </span>
                  <div className="flex items-center justify-center gap-2 w-full">
                    {/* Left VU Meter */}
                    {renderVuMeter(vuL, 'L')}

                    {/* Master Level Knob */}
                    {makeKnob('LEVEL', masterLevel, 0, 2, handleMasterLevelChange, {
                      notchColor: '#ffffff',
                      minLabel: '-∞',
                      maxLabel: '+10',
                      size: 52,
                    })}

                    {/* Right VU Meter */}
                    {renderVuMeter(vuR, 'R')}
                  </div>
                </div>

                {/* ISOLATOR Section */}
                <div className="w-full flex flex-col items-center mt-2 border-t border-neutral-800 pt-1">
                  <span className="text-[10px] font-black font-mono text-neutral-400 tracking-wider mb-1">
                    ISOLATOR
                  </span>
                  <div className="grid grid-cols-3 gap-1 w-full">
                    {makeKnob('HI', isoHi, -26, 6, (v) => {
                      setIsoHi(v);
                      controller?.fxRack.setIsolatorGains(isoLow, isoMid, v);
                    }, { notchColor: '#ef4444', minLabel: '-∞', maxLabel: '+6', size: 36 })}

                    {makeKnob('MID', isoMid, -26, 6, (v) => {
                      setIsoMid(v);
                      controller?.fxRack.setIsolatorGains(isoLow, v, isoHi);
                    }, { notchColor: '#f97316', minLabel: '-∞', maxLabel: '+6', size: 36 })}

                    {makeKnob('LOW', isoLow, -26, 6, (v) => {
                      setIsoLow(v);
                      controller?.fxRack.setIsolatorGains(v, isoMid, isoHi);
                    }, { notchColor: '#00bfff', minLabel: '-∞', maxLabel: 'MAX', size: 36 })}
                  </div>
                </div>
              </div>

              {/* --- CHANNEL 2 --- */}
              <div className="flex flex-col items-center space-y-2 border-l border-neutral-800 pl-1">
                <span className="text-[11px] font-black font-mono text-neutral-300 tracking-wider">
                  CHANNEL 2
                </span>

                {/* TRIM */}
                {makeKnob('TRIM', trimB, 0, 2, (v) => {
                  setTrimB(v);
                  controller?.deckB.setVolume(faderB * v);
                }, { notchColor: '#ffffff', minLabel: '-∞', maxLabel: '+10', size: 44 })}

                {/* HI (Red) */}
                {makeKnob('HI', hiB, -26, 6, (v) => {
                  setHiB(v);
                  controller?.deckB.setEQ(lowB, midB, v);
                }, { notchColor: '#ef4444', minLabel: '-26', maxLabel: '+6', size: 42 })}

                {/* MID (Orange) */}
                {makeKnob('MID', midB, -26, 6, (v) => {
                  setMidB(v);
                  controller?.deckB.setEQ(lowB, v, hiB);
                }, { notchColor: '#f97316', minLabel: '-26', maxLabel: '+6', size: 42 })}

                {/* LOW (Cyan/Blue) */}
                {makeKnob('LOW', lowB, -26, 6, (v) => {
                  setLowB(v);
                  controller?.deckB.setEQ(v, midB, hiB);
                }, { notchColor: '#00bfff', minLabel: '-26', maxLabel: '+6', size: 42 })}

                {/* FILTER */}
                {makeKnob('FILTER', filterB, 0, 1, (v) => {
                  setFilterB(v);
                  controller?.deckB.setFilter(v);
                }, { notchColor: '#06b6d4', minLabel: '-LPF', maxLabel: '+HPF', size: 42 })}

                {/* Headphone CUE button */}
                <button
                  onClick={() => setCueChannelB(!cueChannelB)}
                  className={`px-3 py-1 rounded border flex items-center gap-1 text-[10px] font-mono font-bold transition-all cursor-pointer mt-1 ${
                    cueChannelB
                      ? 'bg-orange-950 border-orange-500 text-orange-400 shadow-[0_0_8px_rgba(249,115,22,0.5)]'
                      : 'bg-neutral-900 border-neutral-700 text-neutral-400'
                  }`}
                >
                  <Headphones className="w-3 h-3" />
                  <span>CUE</span>
                </button>
              </div>
            </div>

            {/* Inset Hardware Box: MASTER FX MODULE */}
            <div className="bg-[#080a0e] border border-neutral-800 rounded-lg p-2.5 mt-3 shadow-inner relative">
              <AllenScrew className="absolute top-1.5 left-1.5" />
              <AllenScrew className="absolute top-1.5 right-1.5" />

              <div className="flex flex-col items-center">
                <span className="text-[10px] font-black font-mono text-neutral-300 tracking-widest uppercase mb-1">
                  MASTER FX
                </span>

                {/* LCD FX Selector */}
                <div className="flex items-center gap-2 mb-2">
                  <button
                    onClick={handleCyclePrevFx}
                    className="p-1 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-300 transition-colors cursor-pointer"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <div className="w-28 py-1 rounded bg-[#03060a] border-2 border-cyan-500/80 shadow-[0_0_10px_rgba(6,182,212,0.3)] text-center">
                    <span className="text-xs font-mono font-black text-cyan-400 tracking-wider uppercase">
                      {activeFx}
                    </span>
                  </div>
                  <button
                    onClick={handleCycleNextFx}
                    className="p-1 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-300 transition-colors cursor-pointer"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>

                {/* 3 Master FX Knobs: TIME (Cyan), DEPTH (Purple), LEVEL (Red) */}
                <div className="grid grid-cols-3 gap-3 w-full px-2">
                  {makeKnob('TIME', fxTime, 0, 1, (v) => {
                    setFxTime(v);
                    controller?.fxRack.setTimeKnob(v);
                  }, { notchColor: '#00e5ff', minLabel: 'MIN', maxLabel: 'MAX', size: 38 })}

                  {makeKnob('DEPTH', fxDepth, 0, 1, (v) => {
                    setFxDepth(v);
                    controller?.fxRack.setDepthKnob(v);
                  }, { notchColor: '#bf5af2', minLabel: 'MIN', maxLabel: 'MAX', size: 38 })}

                  {makeKnob('LEVEL', fxLevel, 0, 1, (v) => {
                    setFxLevel(v);
                    controller?.fxRack.setLevelKnob(v);
                  }, { notchColor: '#ef4444', minLabel: 'MIN', maxLabel: 'MAX', size: 38 })}
                </div>

                {/* Bottom FX Buttons: ON/OFF & TAP */}
                <div className="flex items-center justify-center gap-3 w-full mt-2 pt-1 border-t border-neutral-900">
                  <button
                    onClick={handleToggleFx}
                    className={`px-4 py-1.5 rounded font-mono font-black text-xs tracking-wider transition-all cursor-pointer shadow ${
                      fxEnabled
                        ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-[0_0_12px_rgba(37,99,235,0.6)]'
                        : 'bg-neutral-800 text-neutral-400 border border-neutral-700'
                    }`}
                  >
                    ON/OFF
                  </button>
                  <button
                    onClick={() => {
                      if (controller) {
                        const eff = controller.deckA.getEffectiveBpm();
                        controller.fxRack.setMasterBpm(eff);
                      }
                    }}
                    className="px-4 py-1.5 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-white font-mono font-black text-xs tracking-wider transition-colors cursor-pointer shadow"
                  >
                    TAP
                  </button>
                </div>
              </div>
            </div>

            {/* Lower Mixer Section: Channel Faders & Crossfader */}
            <div className="mt-3 pt-2 border-t border-neutral-800">
              <div className="grid grid-cols-3 gap-2 items-end">
                {/* Channel 1 Fader */}
                {makeFader('1', faderA, (v) => {
                  setFaderA(v);
                  controller?.deckA.setVolume(v * trimA);
                })}

                {/* Crossfader Section */}
                <div className="flex flex-col items-center justify-end pb-2">
                  <span className="text-[10px] font-black font-mono text-neutral-400 tracking-wider mb-2">
                    CROSSFADER
                  </span>

                  {/* Horizontal Crossfader Slider */}
                  <div className="w-full flex items-center justify-between gap-1">
                    <span className="text-sm font-black font-mono text-orange-400">A</span>
                    <div
                      onPointerDown={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        const update = (clientX: number) => {
                          const fraction = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
                          const cf = (fraction - 0.5) * 2; // -1 to +1
                          onCrossfaderChange(cf);
                        };
                        update(e.clientX);

                        const handleMove = (ev: PointerEvent) => update(ev.clientX);
                        const handleUp = () => {
                          window.removeEventListener('pointermove', handleMove);
                          window.removeEventListener('pointerup', handleUp);
                        };
                        window.addEventListener('pointermove', handleMove);
                        window.addEventListener('pointerup', handleUp);
                      }}
                      className="flex-1 h-10 bg-[#090b0e] border border-neutral-800 rounded-sm relative shadow-inner cursor-ew-resize flex items-center"
                    >
                      {/* Center tick */}
                      <div className="absolute left-1/2 -translate-x-1/2 h-full w-[1px] bg-neutral-600" />
                      {/* Slot */}
                      <div className="w-full h-1.5 bg-black border-y border-neutral-700/80 shadow-[inset_0_0_4px_rgba(0,0,0,0.9)]" />

                      {/* Silver Knurled Crossfader Cap */}
                      <div
                        className="absolute -translate-x-1/2 w-6 h-8 rounded bg-gradient-to-r from-neutral-300 via-neutral-100 to-neutral-400 border border-neutral-600 shadow-[0_4px_8px_rgba(0,0,0,0.9)] pointer-events-none flex items-center justify-center"
                        style={{
                          left: `${((crossfader + 1) / 2) * 100}%`,
                        }}
                      >
                        <div className="w-[2px] h-full bg-neutral-800" />
                      </div>
                    </div>
                    <span className="text-sm font-black font-mono text-cyan-400">B</span>
                  </div>
                </div>

                {/* Channel 2 Fader */}
                {makeFader('2', faderB, (v) => {
                  setFaderB(v);
                  controller?.deckB.setVolume(v * trimB);
                })}
              </div>
            </div>
          </div>

          {/* RIGHT COLUMN: DECK B (Col span 3) */}
          <div className="md:col-span-3 bg-[#0a0d11] border border-neutral-800/80 rounded-xl p-3 flex flex-col items-center justify-between shadow-lg relative">
            <div className="w-full flex items-center justify-between border-b border-neutral-800 pb-2 mb-2">
              <span className="text-xs font-black font-mono tracking-wider text-neutral-300 flex items-center gap-1.5">
                <Menu className="w-3.5 h-3.5 text-neutral-400" />
                DECK B
              </span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-cyan-950/80 border border-cyan-600/50 text-cyan-400 font-bold">
                CH 2
              </span>
            </div>

            {/* Circular Vinyl / Platter */}
            <div
              onClick={() => onOpenDeckView?.('B')}
              className="w-40 h-40 sm:w-44 sm:h-44 rounded-full bg-[#050608] border-4 border-cyan-500 shadow-[0_0_25px_rgba(6,182,212,0.3),inset_0_0_15px_rgba(0,0,0,0.9)] cursor-pointer relative flex items-center justify-center group hover:scale-[1.02] transition-transform my-2"
            >
              {/* Vinyl Grooves Texture */}
              <div className="absolute inset-2 rounded-full border border-neutral-800/90" />
              <div className="absolute inset-4 rounded-full border border-neutral-800/80" />
              <div className="absolute inset-6 rounded-full border border-neutral-800/70" />
              <div className="absolute inset-8 rounded-full border border-neutral-800/60" />
              <div className="absolute inset-10 rounded-full border border-neutral-800/50" />

              {/* Center Platter Hub */}
              <div className="w-16 h-16 rounded-full bg-gradient-to-tr from-neutral-800 via-neutral-900 to-neutral-700 border border-neutral-600 shadow-xl flex flex-col items-center justify-center text-center p-1">
                <Disc className={`w-6 h-6 text-cyan-400 ${telemetryB.isPlaying ? 'animate-spin' : ''}`} style={{ animationDuration: '2s' }} />
                <span className="text-[8px] font-black font-mono text-white tracking-tight mt-0.5">
                  TAP TO OPEN
                </span>
              </div>
            </div>

            {/* Vertical Performance & Transport Buttons */}
            <div className="w-full space-y-2 mt-2">
              {/* Big Green PLAY/PAUSE */}
              <button
                onClick={onPlayPauseB}
                className={`w-full py-2.5 px-3 rounded-lg border-2 font-mono font-black text-xs tracking-wider flex items-center justify-center gap-2 transition-all cursor-pointer shadow-lg ${
                  telemetryB.isPlaying
                    ? 'bg-emerald-950/80 border-emerald-500 text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.4)]'
                    : 'bg-[#101712] border-emerald-600/70 text-emerald-500 hover:brightness-125'
                }`}
              >
                {telemetryB.isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current" />}
                <span>PLAY / PAUSE</span>
              </button>

              {/* CUE Button */}
              <button
                onClick={onCueB}
                className="w-full py-2 px-3 rounded-lg bg-gradient-to-b from-neutral-700 to-neutral-900 border border-neutral-600 hover:brightness-125 text-white font-mono font-black text-xs tracking-wider transition-all cursor-pointer shadow"
              >
                CUE
              </button>

              {/* SYNC Button (Orange outline) */}
              <button
                onClick={onSyncB}
                className="w-full py-2 px-3 rounded-lg bg-gradient-to-b from-[#1c1208] to-[#0f0a04] border-2 border-orange-500/80 shadow-[0_0_12px_rgba(249,115,22,0.3)] text-orange-400 font-mono font-black text-xs tracking-wider hover:brightness-125 transition-all cursor-pointer"
              >
                SYNC
              </button>

              {/* LOOP Button */}
              <button
                onClick={onOpenLooper}
                className="w-full py-1.5 px-3 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-700 text-neutral-300 font-mono font-bold text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <RotateCw className="w-3.5 h-3.5 text-cyan-400" />
                <span>LOOP</span>
              </button>

              {/* HOT CUES & SAMPLE Buttons */}
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  onClick={() => onOpenDeckView?.('B')}
                  className="py-1.5 px-2 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-700 text-neutral-300 font-mono font-bold text-[10px] flex items-center justify-center gap-1 transition-colors cursor-pointer"
                >
                  <Grid className="w-3 h-3 text-emerald-400" />
                  <span>HOT CUES</span>
                </button>
                <button
                  onClick={onOpenLibrary}
                  className="py-1.5 px-2 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-700 text-neutral-300 font-mono font-bold text-[10px] flex items-center justify-center gap-1 transition-colors cursor-pointer"
                >
                  <Grid className="w-3 h-3 text-cyan-400" />
                  <span>SAMPLE</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* 4. BOTTOM HARDWARE NAVIGATION BAR */}
        <div className="flex items-center justify-around px-2 py-2.5 bg-gradient-to-b from-[#1c212a] via-[#12161e] to-[#090b0e] border-t border-neutral-800 shadow-2xl relative">
          <AllenScrew className="absolute left-2 top-1/2 -translate-y-1/2" />
          <AllenScrew className="absolute right-2 top-1/2 -translate-y-1/2" />

          {/* 1. LIBRARY */}
          <button
            onClick={onOpenLibrary}
            className="flex flex-col items-center justify-center py-1.5 px-3 rounded-lg bg-neutral-900/90 hover:bg-neutral-800 border border-neutral-700/80 text-neutral-300 hover:text-white transition-all cursor-pointer shadow min-w-[72px]"
          >
            <Music className="w-4 h-4 text-neutral-200 mb-0.5" />
            <span className="text-[10px] font-mono font-bold uppercase tracking-wider">LIBRARY</span>
          </button>

          {/* 2. AUTOMIX */}
          <button
            onClick={() => {
              // Trigger smooth automix crossfader transition
              let step = 0;
              const dir = crossfader <= 0 ? 1 : -1;
              const interval = setInterval(() => {
                step += 0.05;
                if (step >= 1) {
                  clearInterval(interval);
                  onCrossfaderChange(dir);
                } else {
                  onCrossfaderChange(crossfader + dir * step);
                }
              }, 40);
            }}
            className="flex flex-col items-center justify-center py-1.5 px-3 rounded-lg bg-neutral-900/90 hover:bg-neutral-800 border border-neutral-700/80 text-neutral-300 hover:text-white transition-all cursor-pointer shadow min-w-[72px]"
          >
            <div className="w-4 h-4 rounded-full border border-current flex items-center justify-center text-[10px] font-bold mb-0.5">
              A
            </div>
            <span className="text-[10px] font-mono font-bold uppercase tracking-wider">AUTOMIX</span>
          </button>

          {/* 3. SAMPLER */}
          <button
            onClick={onOpenLibrary}
            className="flex flex-col items-center justify-center py-1.5 px-3 rounded-lg bg-neutral-900/90 hover:bg-neutral-800 border border-neutral-700/80 text-neutral-300 hover:text-white transition-all cursor-pointer shadow min-w-[72px]"
          >
            <Grid className="w-4 h-4 text-neutral-200 mb-0.5" />
            <span className="text-[10px] font-mono font-bold uppercase tracking-wider">SAMPLER</span>
          </button>

          {/* 4. LOOPER (Highlighted with glowing orange border as in photo!) */}
          <button
            onClick={onOpenLooper}
            className="flex flex-col items-center justify-center py-1.5 px-4 rounded-lg bg-gradient-to-b from-[#1f1308] to-[#100a04] border-2 border-orange-500/90 shadow-[0_0_15px_rgba(249,115,22,0.4)] text-orange-400 transition-all cursor-pointer min-w-[80px]"
          >
            <RotateCw className="w-4 h-4 text-orange-400 mb-0.5" />
            <span className="text-[10px] font-mono font-black uppercase tracking-wider">LOOPER</span>
          </button>

          {/* 5. FX */}
          <button
            onClick={onOpenFx}
            className="flex flex-col items-center justify-center py-1.5 px-3 rounded-lg bg-neutral-900/90 hover:bg-neutral-800 border border-neutral-700/80 text-neutral-300 hover:text-white transition-all cursor-pointer shadow min-w-[72px]"
          >
            <Sliders className="w-4 h-4 text-neutral-200 mb-0.5" />
            <span className="text-[10px] font-mono font-bold uppercase tracking-wider">FX</span>
          </button>

          {/* 6. BROWSER */}
          <button
            onClick={onOpenLibrary}
            className="flex flex-col items-center justify-center py-1.5 px-3 rounded-lg bg-neutral-900/90 hover:bg-neutral-800 border border-neutral-700/80 text-neutral-300 hover:text-white transition-all cursor-pointer shadow min-w-[72px]"
          >
            <Folder className="w-4 h-4 text-neutral-200 mb-0.5" />
            <span className="text-[10px] font-mono font-bold uppercase tracking-wider">BROWSER</span>
          </button>
        </div>
      </div>
    </div>
  );
};
