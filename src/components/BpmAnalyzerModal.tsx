import React, { useState, useRef, useCallback, useEffect } from 'react';
import { TrackData } from '../types/dj';
import { analyzeAudioBufferBpm, buildEditedTrackAnalysis, refineTrackBeatGrid } from '../audio/bpmAnalyzer';
import {
  Activity,
  CheckCircle,
  RefreshCw,
  Sliders,
  X,
  Zap,
  Sparkles,
  Anchor,
  ShieldCheck,
  Check,
  RotateCcw,
  Clock,
  Disc3
} from 'lucide-react';

interface BpmAnalyzerModalProps {
  isOpen: boolean;
  deckId: 'A' | 'B';
  track: TrackData | null;
  currentPlaybackSample?: number;
  onClose: () => void;
  onApplyTrackAnalysis: (deckId: 'A' | 'B', updatedTrack: TrackData) => void;
}

/**
 * Helper to round BPM to exactly 3 decimal places
 */
function roundBpm3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export const BpmAnalyzerModal: React.FC<BpmAnalyzerModalProps> = ({
  isOpen,
  deckId,
  track,
  currentPlaybackSample = 0,
  onClose,
  onApplyTrackAnalysis,
}) => {
  // Local DRAFT metadata state (Section 3)
  const [draftBpm, setDraftBpm] = useState<number>(() =>
    roundBpm3(track?.bpm ?? 124)
  );

  const [draftBeatStartSample, setDraftBeatStartSample] = useState<number>(() =>
    track?.beatGrid.beatStartSample ??
    track?.beatGrid.discDjAnchor?.beatStartSample ??
    0
  );

  const [draftFirstDownbeatSample, setDraftFirstDownbeatSample] = useState<number>(() =>
    track?.beatGrid.firstDownbeatSample ?? 0
  );

  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [isRefining, setIsRefining] = useState<boolean>(false);
  const [analysisStatus, setAnalysisStatus] = useState<string | null>(null);
  const [hasAppliedRecently, setHasAppliedRecently] = useState<boolean>(false);

  // Tap tempo state
  const tapTimesRef = useRef<number[]>([]);
  const [tapBpm, setTapBpm] = useState<number | null>(null);

  // Sync draft state with track when the track changes
  const prevTrackIdRef = useRef<string | null>(track?.id ?? null);
  useEffect(() => {
    if (track && track.id !== prevTrackIdRef.current) {
      prevTrackIdRef.current = track.id;
      setDraftBpm(roundBpm3(track.bpm));
      setDraftBeatStartSample(
        track.beatGrid.beatStartSample ??
        track.beatGrid.discDjAnchor?.beatStartSample ??
        0
      );
      setDraftFirstDownbeatSample(track.beatGrid.firstDownbeatSample ?? 0);
      setAnalysisStatus(null);
      setHasAppliedRecently(false);
    }
  }, [track]);

  // Fine BPM controls (Section 5)
  const handleAdjustDraftBpm = (delta: number) => {
    setDraftBpm((current) =>
      roundBpm3(Math.max(40, Math.min(240, current + delta)))
    );
    setHasAppliedRecently(false);
  };

  // Octave controls /2 and x2 (Section 7)
  const handleDraftOctave = (multiplier: number) => {
    setDraftBpm((current) =>
      roundBpm3(Math.max(40, Math.min(240, current * multiplier)))
    );
    setHasAppliedRecently(false);
  };

  // Beatgrid phase edit - DRAFT ONLY (Section 8)
  const handleDraftGridNudge = (offsetMs: number) => {
    if (!track) return;
    const deltaSamples = Math.round((offsetMs / 1000) * track.sampleRate);
    setDraftBeatStartSample((current) => current + deltaSamples);
    setHasAppliedRecently(false);
  };

  // Set Grid Anchor - DRAFT ONLY (Section 9)
  const handleSetDraftGridAnchor = () => {
    const targetSample = Math.max(0, Math.round(currentPlaybackSample));
    setDraftBeatStartSample(targetSample);
    setAnalysisStatus(
      `Draft Grid Anchor set to sample #${targetSample.toLocaleString()} (${((targetSample / (track?.sampleRate || 44100))).toFixed(3)}s). Click APPLY to commit.`
    );
    setHasAppliedRecently(false);
  };

  // Set Musical Downbeat - DRAFT ONLY (Section 10)
  const handleSetDraftDownbeat = () => {
    const targetSample = Math.max(0, Math.round(currentPlaybackSample));
    setDraftFirstDownbeatSample(targetSample);
    setAnalysisStatus(
      `Draft Musical Downbeat set to sample #${targetSample.toLocaleString()} (${((targetSample / (track?.sampleRate || 44100))).toFixed(3)}s). Click APPLY to commit.`
    );
    setHasAppliedRecently(false);
  };

  // Tap Tempo - DRAFT ONLY (Section 6)
  const handleTap = useCallback(() => {
    const now = performance.now();
    const times = tapTimesRef.current;

    if (times.length > 0 && now - times[times.length - 1] > 2000) {
      tapTimesRef.current = [now];
      setTapBpm(null);
      return;
    }

    times.push(now);
    if (times.length > 8) {
      times.shift();
    }

    if (times.length < 2) {
      return;
    }

    const intervals: number[] = [];
    for (let i = 1; i < times.length; i++) {
      intervals.push(times[i] - times[i - 1]);
    }

    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    if (!Number.isFinite(avgInterval) || avgInterval <= 0) {
      return;
    }

    let bpm = 60000 / avgInterval;
    while (bpm < 80) bpm *= 2;
    while (bpm > 160) bpm *= 0.5;

    bpm = roundBpm3(bpm);
    setTapBpm(bpm);
    setDraftBpm(bpm);
    setHasAppliedRecently(false);
  }, []);

  // Run deep FFT & Autocorrelation analysis - DRAFT ONLY (Section 17)
  const handleRunDeepAnalysis = useCallback(() => {
    if (!track || !track.audioBuffer) return;
    setIsAnalyzing(true);
    setAnalysisStatus('Scanning audio buffer energy flux & autocorrelation lags...');

    setTimeout(() => {
      try {
        const result = analyzeAudioBufferBpm(track.audioBuffer);
        const bpm3 = roundBpm3(result.bpm);
        setDraftBpm(bpm3);
        setDraftBeatStartSample(result.beatStartSample);
        setDraftFirstDownbeatSample(result.firstDownbeatSample);
        setAnalysisStatus(
          `Analysis complete: ${bpm3.toFixed(3)} BPM (${(result.confidence * 100).toFixed(1)}% confidence, ${result.beatSamples.length} beats). Ready to APPLY.`
        );
        setHasAppliedRecently(false);
      } catch (err) {
        setAnalysisStatus(`Analysis error: ${String(err)}`);
      } finally {
        setIsAnalyzing(false);
      }
    }, 50);
  }, [track]);

  // Run MASAVU BeatGrid Refinement - DRAFT ONLY (Section 18)
  const handleRunBeatGridRefinement = useCallback(() => {
    if (!track || !track.audioBuffer) return;
    setIsRefining(true);
    setAnalysisStatus('Running multi-band spectral flux, kick onset search & error classification...');

    setTimeout(() => {
      try {
        const { result } = refineTrackBeatGrid(track);
        const refinedBpm = roundBpm3(result.refinedGrid.bpm);
        setDraftBpm(refinedBpm);
        setDraftBeatStartSample(result.refinedGrid.beatStartSample ?? 0);
        setDraftFirstDownbeatSample(result.refinedGrid.firstDownbeatSample);
        setAnalysisStatus(
          `Refinement [${result.refinementInfo.classification}]: ${result.refinementInfo.statusMessage}. Click APPLY to commit.`
        );
        setHasAppliedRecently(false);
      } catch (err) {
        setAnalysisStatus(`Refinement error: ${String(err)}`);
      } finally {
        setIsRefining(false);
      }
    }, 50);
  }, [track]);

  // Reset draft to current committed track metadata
  const handleResetToCommitted = () => {
    if (!track) return;
    setDraftBpm(roundBpm3(track.bpm));
    setDraftBeatStartSample(
      track.beatGrid.beatStartSample ??
      track.beatGrid.discDjAnchor?.beatStartSample ??
      0
    );
    setDraftFirstDownbeatSample(track.beatGrid.firstDownbeatSample ?? 0);
    setAnalysisStatus('Draft reset to track committed metadata.');
    setHasAppliedRecently(false);
  };

  // APPLY BUTTON - COMMITS METADATA SAFELY (Section 13)
  const handleApply = () => {
    if (!track) return;

    const updated = buildEditedTrackAnalysis(
      track,
      draftBpm,
      draftBeatStartSample,
      draftFirstDownbeatSample
    );

    onApplyTrackAnalysis(deckId, updated);
    setHasAppliedRecently(true);
    setAnalysisStatus(
      `Committed metadata: ${draftBpm.toFixed(3)} BPM • BeatStart: #${draftBeatStartSample.toLocaleString()} • Downbeat: #${draftFirstDownbeatSample.toLocaleString()}. Live audio preserved.`
    );
  };

  if (!isOpen) return null;

  const sampleRate = track?.sampleRate || 44100;
  const committedBpm = track ? roundBpm3(track.bpm) : 124.000;
  const isDraftModified =
    Math.abs(draftBpm - committedBpm) > 0.0005 ||
    draftBeatStartSample !== (track?.beatGrid.beatStartSample ?? 0) ||
    draftFirstDownbeatSample !== (track?.beatGrid.firstDownbeatSample ?? 0);

  const refinement = track?.beatGrid.refinementInfo;
  const gridType = track?.beatGrid.gridType || (refinement?.classification ?? 'STRAIGHT');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4 font-sans select-none">
      <div className="bg-[#0c0f14] border-2 border-neutral-700 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden text-slate-100 flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-neutral-800 bg-[#080a0e]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-cyan-950/80 border border-cyan-500/60 flex items-center justify-center">
              <Activity className="w-4 h-4 text-cyan-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-black text-white uppercase tracking-wider font-mono">
                  DiscDJ BPM & BeatGrid Editor
                </h2>
                <span className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold border ${
                  deckId === 'A'
                    ? 'bg-cyan-950/80 border-cyan-500/60 text-cyan-300'
                    : 'bg-amber-950/80 border-amber-500/60 text-amber-300'
                }`}>
                  DECK {deckId}
                </span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded font-bold bg-neutral-900 border border-neutral-700 text-neutral-400">
                  {gridType} GRID
                </span>
              </div>
              <p className="text-xs text-neutral-400 font-mono truncate max-w-md">
                {track?.title ?? 'No Track Loaded'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-neutral-400 hover:text-white rounded-lg hover:bg-neutral-800 transition-colors cursor-pointer"
            title="Close Editor"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 space-y-4 overflow-y-auto">
          {/* Main Dual BPM & Metadata Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* Draft Working Tempo Card */}
            <div className={`p-4 rounded-xl border-2 transition-all ${
              isDraftModified
                ? 'bg-[#10141d] border-emerald-500/70 shadow-[0_0_15px_rgba(16,185,129,0.2)]'
                : 'bg-[#0f1217] border-neutral-800'
            }`}>
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-mono uppercase tracking-wider text-emerald-400 font-bold flex items-center gap-1.5">
                  <Sliders className="w-3.5 h-3.5" />
                  DRAFT WORKING TEMPO
                </span>
                {isDraftModified && (
                  <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-amber-950 border border-amber-600/50 text-amber-300 font-bold">
                    UNCOMMITTED
                  </span>
                )}
              </div>
              <div className="text-3xl font-mono font-black text-white tracking-tight mt-1 flex items-baseline gap-2">
                <span className="text-emerald-400">{draftBpm.toFixed(3)}</span>
                <span className="text-sm font-sans font-normal text-neutral-400">BPM</span>
              </div>
              <div className="text-[11px] text-neutral-400 font-mono mt-1.5 space-y-0.5">
                <div>
                  <span className="text-neutral-500">Grid Anchor:</span> #{draftBeatStartSample.toLocaleString()} smp ({(draftBeatStartSample / sampleRate).toFixed(3)}s)
                </div>
                <div>
                  <span className="text-neutral-500">Downbeat:</span> #{draftFirstDownbeatSample.toLocaleString()} smp ({(draftFirstDownbeatSample / sampleRate).toFixed(3)}s)
                </div>
              </div>
            </div>

            {/* Committed Live Tempo Card */}
            <div className="p-4 rounded-xl border border-neutral-800 bg-[#0f1217]">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-mono uppercase tracking-wider text-neutral-400 font-bold flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-neutral-400" />
                  CURRENT COMMITTED METADATA
                </span>
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-neutral-900 border border-neutral-700 text-neutral-400">
                  LIVE TRACK
                </span>
              </div>
              <div className="text-3xl font-mono font-black text-neutral-300 tracking-tight mt-1 flex items-baseline gap-2">
                <span>{committedBpm.toFixed(3)}</span>
                <span className="text-sm font-sans font-normal text-neutral-500">BPM</span>
              </div>
              <div className="text-[11px] text-neutral-400 font-mono mt-1.5 space-y-0.5">
                <div>
                  <span className="text-neutral-500">Grid Anchor:</span> #{(track?.beatGrid.beatStartSample ?? 0).toLocaleString()} smp
                </div>
                <div>
                  <span className="text-neutral-500">Downbeat:</span> #{(track?.beatGrid.firstDownbeatSample ?? 0).toLocaleString()} smp
                </div>
              </div>
            </div>
          </div>

          {/* Prominent Action Bar: APPLY & RESET */}
          <div className="flex flex-col sm:flex-row items-center gap-3 p-3 bg-neutral-950 rounded-xl border border-neutral-800">
            <button
              onClick={handleApply}
              disabled={!track}
              className={`flex-1 w-full py-2.5 px-4 rounded-lg font-mono font-black text-xs tracking-wider flex items-center justify-center gap-2 transition-all cursor-pointer shadow-lg ${
                isDraftModified
                  ? 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-emerald-950/60 ring-2 ring-emerald-500/40'
                  : 'bg-emerald-950/80 hover:bg-emerald-900/80 border border-emerald-600/50 text-emerald-300'
              }`}
            >
              {hasAppliedRecently ? <Check className="w-4 h-4 text-white" /> : <CheckCircle className="w-4 h-4" />}
              <span>{hasAppliedRecently ? 'METADATA APPLIED' : 'APPLY METADATA TO TRACK'}</span>
            </button>

            <button
              onClick={handleResetToCommitted}
              disabled={!isDraftModified}
              className="py-2.5 px-4 rounded-lg font-mono font-bold text-xs bg-neutral-900 hover:bg-neutral-800 disabled:opacity-40 disabled:hover:bg-neutral-900 text-neutral-300 border border-neutral-700 flex items-center gap-1.5 transition-colors cursor-pointer"
              title="Discard draft changes and revert to live track metadata"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>DISCARD DRAFT</span>
            </button>
          </div>

          {/* Status Message */}
          {analysisStatus && (
            <div className="p-2.5 rounded-lg bg-neutral-950 border border-neutral-800 text-xs font-mono text-cyan-300 flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{analysisStatus}</span>
            </div>
          )}

          {/* BPM Fine Controls (Section 5) */}
          <div className="bg-[#0e1116] border border-neutral-800 rounded-xl p-3.5 space-y-2.5">
            <div className="text-xs font-bold text-slate-300 flex items-center justify-between font-mono">
              <span className="flex items-center gap-1.5 text-cyan-300">
                <Sliders className="w-3.5 h-3.5 text-cyan-400" />
                BPM FINE CONTROLS (DRAFT ONLY)
              </span>
              <span className="text-[10px] text-neutral-500">±0.001 / ±0.010 / ±0.100 / ±1.000</span>
            </div>

            <div className="grid grid-cols-4 sm:grid-cols-8 gap-1.5">
              <button
                onClick={() => handleAdjustDraftBpm(-1.0)}
                className="py-2 px-1 bg-neutral-900 hover:bg-neutral-800 text-xs font-mono font-bold rounded border border-neutral-700 text-neutral-300 transition-colors cursor-pointer"
              >
                -1.000
              </button>
              <button
                onClick={() => handleAdjustDraftBpm(-0.1)}
                className="py-2 px-1 bg-neutral-900 hover:bg-neutral-800 text-xs font-mono font-bold rounded border border-neutral-700 text-neutral-300 transition-colors cursor-pointer"
              >
                -0.100
              </button>
              <button
                onClick={() => handleAdjustDraftBpm(-0.01)}
                className="py-2 px-1 bg-neutral-900 hover:bg-neutral-800 text-xs font-mono font-bold rounded border border-neutral-700 text-neutral-400 transition-colors cursor-pointer"
              >
                -0.010
              </button>
              <button
                onClick={() => handleAdjustDraftBpm(-0.001)}
                className="py-2 px-1 bg-neutral-900 hover:bg-neutral-800 text-xs font-mono font-bold rounded border border-cyan-900 text-cyan-400 transition-colors cursor-pointer"
              >
                -0.001
              </button>
              <button
                onClick={() => handleAdjustDraftBpm(0.001)}
                className="py-2 px-1 bg-neutral-900 hover:bg-neutral-800 text-xs font-mono font-bold rounded border border-cyan-900 text-cyan-400 transition-colors cursor-pointer"
              >
                +0.001
              </button>
              <button
                onClick={() => handleAdjustDraftBpm(0.01)}
                className="py-2 px-1 bg-neutral-900 hover:bg-neutral-800 text-xs font-mono font-bold rounded border border-neutral-700 text-neutral-400 transition-colors cursor-pointer"
              >
                +0.010
              </button>
              <button
                onClick={() => handleAdjustDraftBpm(0.1)}
                className="py-2 px-1 bg-neutral-900 hover:bg-neutral-800 text-xs font-mono font-bold rounded border border-neutral-700 text-neutral-300 transition-colors cursor-pointer"
              >
                +0.100
              </button>
              <button
                onClick={() => handleAdjustDraftBpm(1.0)}
                className="py-2 px-1 bg-neutral-900 hover:bg-neutral-800 text-xs font-mono font-bold rounded border border-neutral-700 text-neutral-300 transition-colors cursor-pointer"
              >
                +1.000
              </button>
            </div>
          </div>

          {/* BeatGrid Phase Nudge & Anchor Section (Sections 8, 9, 10) */}
          <div className="bg-[#0e1116] border border-neutral-800 rounded-xl p-3.5 space-y-2.5">
            <div className="text-xs font-bold text-slate-300 flex items-center justify-between font-mono">
              <span className="flex items-center gap-1.5 text-amber-300">
                <Anchor className="w-3.5 h-3.5 text-amber-400" />
                BEATGRID PHASE EDIT (DRAFT ONLY)
              </span>
              <span className="text-[10px] text-neutral-500">Nudge grid or anchor to playhead</span>
            </div>

            {/* Anchors: SET GRID ANCHOR & SET DOWNBEAT */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                onClick={handleSetDraftGridAnchor}
                className="py-2 px-3 bg-amber-950/70 hover:bg-amber-900/70 text-amber-300 text-xs font-mono font-bold rounded-lg border border-amber-800/60 flex items-center justify-center gap-2 transition-colors cursor-pointer"
                title="Set canonical repeating phase anchor to current playhead sample"
              >
                <Anchor className="w-3.5 h-3.5 text-amber-400" />
                <span>SET GRID ANCHOR (PLAYHEAD)</span>
              </button>

              <button
                onClick={handleSetDraftDownbeat}
                className="py-2 px-3 bg-rose-950/70 hover:bg-rose-900/70 text-rose-300 text-xs font-mono font-bold rounded-lg border border-rose-800/60 flex items-center justify-center gap-2 transition-colors cursor-pointer"
                title="Set musical downbeat (Bar 1, Beat 1) to current playhead sample"
              >
                <Disc3 className="w-3.5 h-3.5 text-rose-400" />
                <span>SET DOWNBEAT (BAR 1 BEAT 1)</span>
              </button>
            </div>

            {/* Grid Nudges: -10ms, -5ms, -1ms, +1ms, +5ms, +10ms */}
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5 pt-1">
              <button
                onClick={() => handleDraftGridNudge(-10)}
                className="py-2 px-2 bg-neutral-900 hover:bg-neutral-800 text-xs font-mono font-bold rounded border border-neutral-700 text-cyan-300 transition-colors cursor-pointer"
              >
                -10 ms
              </button>
              <button
                onClick={() => handleDraftGridNudge(-5)}
                className="py-2 px-2 bg-neutral-900 hover:bg-neutral-800 text-xs font-mono font-bold rounded border border-neutral-700 text-cyan-300 transition-colors cursor-pointer"
              >
                -5 ms
              </button>
              <button
                onClick={() => handleDraftGridNudge(-1)}
                className="py-2 px-2 bg-neutral-900 hover:bg-neutral-800 text-xs font-mono font-bold rounded border border-neutral-700 text-cyan-400 transition-colors cursor-pointer"
              >
                -1 ms
              </button>
              <button
                onClick={() => handleDraftGridNudge(1)}
                className="py-2 px-2 bg-neutral-900 hover:bg-neutral-800 text-xs font-mono font-bold rounded border border-neutral-700 text-cyan-400 transition-colors cursor-pointer"
              >
                +1 ms
              </button>
              <button
                onClick={() => handleDraftGridNudge(5)}
                className="py-2 px-2 bg-neutral-900 hover:bg-neutral-800 text-xs font-mono font-bold rounded border border-neutral-700 text-cyan-300 transition-colors cursor-pointer"
              >
                +5 ms
              </button>
              <button
                onClick={() => handleDraftGridNudge(10)}
                className="py-2 px-2 bg-neutral-900 hover:bg-neutral-800 text-xs font-mono font-bold rounded border border-neutral-700 text-cyan-300 transition-colors cursor-pointer"
              >
                +10 ms
              </button>
            </div>
          </div>

          {/* Octave & Tap Tempo Row (Sections 6, 7) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Octave /2 and x2 */}
            <div className="bg-[#0e1116] border border-neutral-800 rounded-xl p-3 flex flex-col justify-between">
              <div>
                <div className="text-xs font-bold text-neutral-300 font-mono">OCTAVE TEMPO FIX (DRAFT)</div>
                <div className="text-[11px] text-neutral-500 mt-0.5 font-mono">
                  Double or halve tempo (e.g. 174 ↔ 87)
                </div>
              </div>
              <div className="mt-2.5 flex items-center gap-2">
                <button
                  onClick={() => handleDraftOctave(0.5)}
                  className="flex-1 py-2 bg-purple-950/80 hover:bg-purple-900 text-purple-300 text-xs font-mono font-bold rounded-lg border border-purple-700/60 transition-colors cursor-pointer"
                >
                  BPM /2
                </button>
                <button
                  onClick={() => handleDraftOctave(2.0)}
                  className="flex-1 py-2 bg-purple-950/80 hover:bg-purple-900 text-purple-300 text-xs font-mono font-bold rounded-lg border border-purple-700/60 transition-colors cursor-pointer"
                >
                  BPM x2
                </button>
              </div>
            </div>

            {/* Tap Tempo Calculator */}
            <div className="bg-[#0e1116] border border-neutral-800 rounded-xl p-3 flex flex-col justify-between">
              <div>
                <div className="text-xs font-bold text-neutral-300 font-mono">TAP TEMPO CALCULATOR</div>
                <div className="text-[11px] text-neutral-500 mt-0.5 font-mono">
                  Tap rhythmically with music kick
                </div>
              </div>
              <div className="mt-2.5 flex items-center gap-2">
                <button
                  onClick={handleTap}
                  className="flex-1 py-2 bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-mono font-bold rounded-lg uppercase tracking-wider active:scale-95 transition-all shadow-md cursor-pointer"
                >
                  TAP BEAT
                </button>
                {tapBpm && (
                  <span className="font-mono text-xs font-bold text-emerald-400 px-2 py-1.5 bg-emerald-950 border border-emerald-800 rounded">
                    {tapBpm.toFixed(3)}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Automated Analysis & Refinement (Populates Draft Only) */}
          <div className="bg-[#0e1116] border border-neutral-800 rounded-xl p-3 space-y-2">
            <div className="text-xs font-bold text-neutral-300 font-mono flex items-center justify-between">
              <span>AUTOMATED ANALYSIS ENGINES (POPULATES DRAFT)</span>
              <span className="text-[10px] text-neutral-500">Requires APPLY to commit</span>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <button
                onClick={handleRunBeatGridRefinement}
                disabled={isRefining || isAnalyzing || !track}
                className="flex-1 px-3.5 py-2.5 bg-gradient-to-r from-emerald-900 to-teal-900 hover:from-emerald-800 hover:to-teal-800 disabled:opacity-40 text-emerald-200 text-xs font-bold font-mono rounded-lg border border-emerald-700/60 flex items-center justify-center gap-2 transition-all cursor-pointer"
                title="Search ±80ms around predicted beats for kick transient energy, classify error, and draft refined markers"
              >
                <Sparkles className={`w-4 h-4 ${isRefining ? 'animate-spin' : ''}`} />
                {isRefining ? 'Refining...' : 'Auto-Refine BeatGrid (Draft)'}
              </button>
              <button
                onClick={handleRunDeepAnalysis}
                disabled={isAnalyzing || isRefining || !track}
                className="flex-1 px-3.5 py-2.5 bg-neutral-900 hover:bg-neutral-800 disabled:opacity-40 text-neutral-300 text-xs font-bold font-mono rounded-lg flex items-center justify-center gap-2 transition-colors border border-neutral-700 cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isAnalyzing ? 'animate-spin' : ''}`} />
                {isAnalyzing ? 'Scanning...' : 'Re-Run Autocorrelation (Draft)'}
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-neutral-800 bg-[#080a0e]">
          <div className="text-[11px] text-neutral-400 font-mono flex items-center gap-1.5">
            <Zap className="w-3.5 h-3.5 text-amber-400" />
            <span>Strict Synchronization-Safe: Edits are draft-only until APPLY. Live audio playback is never disturbed.</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs font-mono font-bold rounded-lg transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
