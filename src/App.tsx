import { useEffect, useRef, useState, useCallback } from 'react';
import { DjMasterController } from './audio/djMasterController';
import { buildSyntheticTrack, decodeUploadedAudioFile, DEMO_PRESETS, DemoTrackPreset } from './audio/trackGenerator';
import { FIFTY_TEST_SONGS, SongLibraryItem } from './audio/songLibrary';
import { INBUILT_LOOPS, buildInbuiltLoopTrack } from './audio/inbuiltLoops';
import { DeckTelemetry, TrackData } from './types/dj';
import { DownbeatPhaseTelemetry, Vdj8StyleLaunchPlan } from './audio/vdj8StyleSyncEngine';
import { MasavuPhaseTelemetry } from './audio/masavuPhaseController';
import { HardwareChassis } from './components/HardwareChassis';
import { DualStackedWaveform } from './components/DualStackedWaveform';
import { DeckVinylView } from './components/DeckVinylView';
import { PerformanceBoard } from './components/PerformanceBoard';
import { MixerView } from './components/MixerView';
import { MasterOutputView } from './components/MasterOutputView';
import { TrackLibraryModal } from './components/TrackLibraryModal';
import { BpmAnalyzerModal } from './components/BpmAnalyzerModal';
import { SyncTelemetryPanel } from './components/SyncTelemetryPanel';
import { PhaseAndDownbeatVisualizer } from './components/PhaseAndDownbeatVisualizer';
import { SkeuomorphicFader } from './components/SkeuomorphicFader';
import { DjImanConsole } from './components/DjImanConsole';
import { LooperView } from './components/LooperView';
import { LooperSyncState, BeatLoopLength } from './audio/audioLooperEngine';
import { X, Wrench } from 'lucide-react';

export default function App() {
  const controllerRef = useRef<DjMasterController | null>(null);

  const [trackA, setTrackA] = useState<TrackData | null>(null);
  const [trackB, setTrackB] = useState<TrackData | null>(null);

  const [loopTrack, setLoopTrack] = useState<TrackData | null>(null);
  const [selectedInbuiltLoopId, setSelectedInbuiltLoopId] = useState<string | null>('inbuilt-loop-1');
  const [looperState, setLooperState] = useState<LooperSyncState>({
    loaded: false,
    playing: false,
    syncedTo: null,
    loopBeatCount: 4,
    loopStartSample: 0,
    loopEndSample: 0,
    baseTempoMultiplier: 1.0,
    currentSourceSample: 0,
  });

  const [masterDeckId, setMasterDeckId] = useState<'A' | 'B'>('A');
  const [crossfader, setCrossfader] = useState(0);

  // Top mode & Console tabs
  const [activeTopMode, setActiveTopMode] = useState<'music' | 'masterOut' | 'looper' | 'settings'>('music');
  const [activeConsoleTab, setActiveConsoleTab] = useState<'deckA' | 'mixer' | 'deckB'>('deckA');
  const [deckSubView, setDeckSubView] = useState<'vinyl' | 'performance'>('vinyl');

  const [quantizeMode, setQuantizeMode] = useState<'beat' | 'bar'>('beat');
  const [lastPlan, setLastPlan] = useState<Vdj8StyleLaunchPlan | null>(null);
  const [phaseErrorMs, setPhaseErrorMs] = useState<number>(0);
  const [phaseTelemetry, setPhaseTelemetry] = useState<MasavuPhaseTelemetry | null>(null);
  const [isLibraryOpen, setIsLibraryOpen] = useState<boolean>(false);
  const [calibratingDeck, setCalibratingDeck] = useState<'A' | 'B' | null>(null);
  const [isDiagnosticsOpen, setIsDiagnosticsOpen] = useState<boolean>(false);
  const [autoBpmLock, setAutoBpmLock] = useState<boolean>(true);

  // Local user-imported tracks list & loading indicator
  const [localTracks, setLocalTracks] = useState<TrackData[]>([]);
  const [isAnalyzingAudio, setIsAnalyzingAudio] = useState<boolean>(false);
  const [analyzingFileName, setAnalyzingFileName] = useState<string | null>(null);

  const [downbeatPhase, setDownbeatPhase] = useState<DownbeatPhaseTelemetry>({
    masterBeatInBar: 0,
    slaveBeatInBar: 0,
    masterBarIndex: 0,
    slaveBarIndex: 0,
    downbeatOffsetBeats: 0,
    isDownbeatMatched: true,
    isCurrentlyOnDownbeat: true,
  });

  const [syncAlert, setSyncAlert] = useState<{ message: string; type: 'success' | 'warning' | 'info' } | null>(null);

  // Telemetry states for rendering
  const [telemetryA, setTelemetryA] = useState<DeckTelemetry>({
    deckId: 'A',
    isPlaying: false,
    isPaused: true,
    currentSourceSample: 0,
    currentTimeSeconds: 0,
    totalDurationSeconds: 32,
    currentBeatFloat: 0,
    currentBeatInBar: 0,
    currentBarIndex: 0,
    isDownbeat: true,
    baseBpm: 124,
    effectiveBpm: 124,
    baseTempoMultiplier: 1.0,
    jogPitchNudge: 0,
    pllMultiplier: 1.0,
    pitchPercentage: 0,
    isSync: false,
    isMaster: true,
    volume: 0.85,
    cueSample: 0,
    lowEq: 0,
    midEq: 0,
    highEq: 0,
    filter: 0,
  });

  const [telemetryB, setTelemetryB] = useState<DeckTelemetry>({
    deckId: 'B',
    isPlaying: false,
    isPaused: true,
    currentSourceSample: 0,
    currentTimeSeconds: 0,
    totalDurationSeconds: 32,
    currentBeatFloat: 0,
    currentBeatInBar: 0,
    currentBarIndex: 0,
    isDownbeat: true,
    baseBpm: 126,
    effectiveBpm: 126,
    baseTempoMultiplier: 1.0,
    jogPitchNudge: 0,
    pllMultiplier: 1.0,
    pitchPercentage: 0,
    isSync: false,
    isMaster: false,
    volume: 0.85,
    cueSample: 0,
    lowEq: 0,
    midEq: 0,
    highEq: 0,
    filter: 0,
  });

  // Initialize Audio Engine on first mount
  useEffect(() => {
    const controller = new DjMasterController();
    controllerRef.current = controller;

    // Build initial synthetic demo tracks
    const tA = buildSyntheticTrack(controller.audioCtx, DEMO_PRESETS[0]); // 124 BPM House
    const tB = buildSyntheticTrack(controller.audioCtx, DEMO_PRESETS[1]); // 126 BPM Tech

    controller.deckA.loadTrack(tA);
    controller.deckB.loadTrack(tB);

    setTrackA(tA);
    setTrackB(tB);

    // Initialize looper with first inbuilt loop preset (Loop 1: Afrobeat Rhythm)
    const initialLoopDef = INBUILT_LOOPS[0];
    const initialLoopTrack = buildInbuiltLoopTrack(controller.audioCtx, initialLoopDef);
    controller.audioLooperEngine.loadLoop(initialLoopTrack, 'AUTO');
    setLoopTrack(initialLoopTrack);
    setSelectedInbuiltLoopId(initialLoopDef.id);

    // Animation / Telemetry Loop with adaptive throttling
    let animId: number;
    let lastIdleTime = 0;
    const updateLoop = (time: number) => {
      if (controllerRef.current) {
        try {
          const c = controllerRef.current;
          const telA = c.deckA.getTelemetry();
          const telB = c.deckB.getTelemetry();

          // If playing, update smoothly; if idle, throttle to 10 FPS to avoid render churn
          const isAnyPlaying = telA.isPlaying || telB.isPlaying;
          if (isAnyPlaying || time - lastIdleTime > 100) {
            lastIdleTime = time;
            setTelemetryA(telA);
            setTelemetryB(telB);
            setLooperState(c.audioLooperEngine.getState());

            // Compute phase error
            const tMaster = c.getMasterDeckId() === 'A' ? c.deckA.getTrack() : c.deckB.getTrack();
            const tSlave = c.getMasterDeckId() === 'A' ? c.deckB.getTrack() : c.deckA.getTrack();
            const masterSample = c.getMasterDeckId() === 'A' ? telA.currentSourceSample : telB.currentSourceSample;
            const slaveSample = c.getMasterDeckId() === 'A' ? telB.currentSourceSample : telA.currentSourceSample;

            if (tMaster && tSlave && isAnyPlaying) {
              const pTel = c.updatePhaseController();
              setPhaseTelemetry(pTel);
              setPhaseErrorMs(pTel.phaseErrorMs);

              const downbeat = c.vdj8StyleSyncEngine.measureDownbeatPhase({
                masterCurrentSourceSample: masterSample,
                masterGrid: tMaster.beatGrid,
                slaveCurrentSourceSample: slaveSample,
                slaveGrid: tSlave.beatGrid,
              });
              setDownbeatPhase(downbeat);
            } else {
              setPhaseTelemetry(null);
            }
          }
        } catch (err) {
          console.warn('Telemetry update suppressed:', err);
        }
      }
      animId = requestAnimationFrame(updateLoop);
    };

    animId = requestAnimationFrame(updateLoop);

    return () => {
      cancelAnimationFrame(animId);
      controller.dispose();
    };
  }, []);

  // Set Master Deck
  const handleSetMaster = useCallback((deckId: 'A' | 'B') => {
    if (!controllerRef.current) return;
    controllerRef.current.setMasterDeckId(deckId);
    setMasterDeckId(deckId);
    if (controllerRef.current.audioLooperEngine.isPlaying()) {
      controllerRef.current.syncLooperToCurrentMaster();
    }
  }, []);

  // TRIGGER CLEAN-ROOM DISCDJ SYNC
  const handleTriggerVdj8Sync = useCallback((_targetDeckId?: 'A' | 'B') => {
    if (!controllerRef.current) return;
    const targetDeckId = _targetDeckId ?? (controllerRef.current.getMasterDeckId() === 'A' ? 'B' : 'A');
    const plan = controllerRef.current.triggerBeatPerfectSlaveStartForDeck(targetDeckId, quantizeMode) as Vdj8StyleLaunchPlan | null;

    if (plan) {
      setLastPlan(plan);
      setSyncAlert({
        message: `DiscDJ Sync Locked on Deck ${targetDeckId}: Matched ${plan.familyFactor}x Tempo Family (${plan.equivalentSlaveBpm.toFixed(1)} BPM), 4-beat boundary phase aligned!`,
        type: 'success',
      });
    } else {
      setSyncAlert({
        message: 'Cannot sync: Ensure both decks have tracks loaded and master deck is playing.',
        type: 'warning',
      });
    }
  }, [quantizeMode]);

  // Transport handlers
  const handlePlayPause = useCallback(
    (deckId: 'A' | 'B') => {
      if (!controllerRef.current) return;
      const deck = deckId === 'A' ? controllerRef.current.deckA : controllerRef.current.deckB;
      if (deck.getTelemetry().isPlaying) {
        deck.pause();
        const activeMaster = controllerRef.current.handleDeckPlaybackStateChanged();
        if (activeMaster) {
          setMasterDeckId(activeMaster);
        }
      } else {
        controllerRef.current.promoteDeckIfNoActiveMaster(deckId);
        setMasterDeckId(controllerRef.current.getMasterDeckId());

        const currentMaster = controllerRef.current.getMasterDeckId();
        const isSlave = (currentMaster === 'A' && deckId === 'B') || (currentMaster === 'B' && deckId === 'A');
        const masterDeck = currentMaster === 'A' ? controllerRef.current.deckA : controllerRef.current.deckB;
        if (isSlave && masterDeck.getTelemetry().isPlaying && deck.getSync()) {
          handleTriggerVdj8Sync(deckId);
        } else {
          deck.play();
        }
      }
    },
    [handleTriggerVdj8Sync]
  );

  const handleCue = useCallback((deckId: 'A' | 'B') => {
    if (!controllerRef.current) return;
    const deck = deckId === 'A' ? controllerRef.current.deckA : controllerRef.current.deckB;
    deck.cue();
    const activeMaster = controllerRef.current.handleDeckPlaybackStateChanged();
    if (activeMaster) {
      setMasterDeckId(activeMaster);
    }
  }, []);

  // Looper handlers
  const handleSelectInbuiltLoop = useCallback(async (loopId: string) => {
    if (!controllerRef.current) return;
    const controller = controllerRef.current;
    const loopDef = INBUILT_LOOPS.find((l) => l.id === loopId);
    if (!loopDef) return;

    setSelectedInbuiltLoopId(loopId);

    let track: TrackData;
    if (loopId === 'inbuilt-loop-6') {
      try {
        const { fetchInbuiltLoopFromUrl } = await import('./audio/inbuiltLoops');
        // Will try to fetch 'dembow-loop.mp3' from public directory
        track = await fetchInbuiltLoopFromUrl(controller.audioCtx, loopDef, '/dembow-loop.mp3');
      } catch (err) {
        console.info('Using synthesized Dembow loop (custom mp3 not found):', err instanceof Error ? err.message : err);
        track = buildInbuiltLoopTrack(controller.audioCtx, loopDef);
        setSyncAlert({
          message: 'Using synthesized Dembow loop (96 BPM).',
          type: 'success',
        });
      }
    } else {
      track = buildInbuiltLoopTrack(controller.audioCtx, loopDef);
    }

    controller.audioLooperEngine.loadLoop(track, 'AUTO');
    setLoopTrack(track);

    // If currently playing and master deck exists, re-sync to the master deck
    const activeMaster = controller.getActiveMasterDeckId();
    const isPlaying = controller.audioLooperEngine.getState().playing;
    if (isPlaying && activeMaster) {
      const masterDeck = activeMaster === 'A' ? controller.deckA : controller.deckB;
      controller.audioLooperEngine.syncToMaster(activeMaster, masterDeck);
    }

    setLooperState(controller.audioLooperEngine.getState());
    if (loopId === 'inbuilt-loop-6' && track.artist === 'Imported') {
       setSyncAlert({
         message: `Loaded ${loopDef.name} (${loopDef.bpm} BPM) - Playing your original MP3 file perfectly synced!`,
         type: 'success',
       });
    } else {
       setSyncAlert({
         message: `Loaded ${loopDef.name} (${loopDef.bpm} BPM) - Original audio intact`,
         type: 'success',
       });
    }
  }, []);

  const handleLooperUpload = useCallback(async (file: File) => {
    if (!controllerRef.current) return;
    const controller = controllerRef.current;
    setIsAnalyzingAudio(true);
    setAnalyzingFileName(`[BEAT LOOP] ${file.name}`);
    try {
      const track = await decodeUploadedAudioFile(controller.audioCtx, file);
      controller.audioLooperEngine.loadLoop(track, 'AUTO');
      setLoopTrack(track);
      setSelectedInbuiltLoopId(null);
      setSyncAlert({
        message: `Loaded custom beat loop "${track.title}" (${track.bpm.toFixed(1)} BPM) - Ready for quantized sync`,
        type: 'success',
      });
    } catch (err) {
      console.error('Error decoding looper audio file:', err);
      setSyncAlert({
        message: 'Failed to decode beat loop file. Please try another audio file.',
        type: 'warning',
      });
    } finally {
      setIsAnalyzingAudio(false);
      setAnalyzingFileName(null);
    }
  }, []);

  const handleLooperPlay = useCallback(() => {
    if (!controllerRef.current) return;
    const success = controllerRef.current.syncLooperToCurrentMaster();
    if (!success) {
      const activeMaster = controllerRef.current.getActiveMasterDeckId();
      if (!activeMaster) {
        setSyncAlert({
          message: 'Cannot sync looper: Please start Deck A or Deck B first as the song master.',
          type: 'warning',
        });
      }
    }
  }, []);

  const handleLooperStop = useCallback(() => {
    controllerRef.current?.audioLooperEngine.stop();
  }, []);

  const handleLooperBeatCount = useCallback((count: BeatLoopLength) => {
    controllerRef.current?.audioLooperEngine.setLoopBeatCount(count);
  }, []);

  const handleLooperStartSample = useCallback((sample: number) => {
    controllerRef.current?.audioLooperEngine.setLoopStartSample(sample);
  }, []);

  const handleLooperVolume = useCallback((vol: number) => {
    controllerRef.current?.audioLooperEngine.setVolume(vol);
  }, []);

  const handleSeek = useCallback((deckId: 'A' | 'B', sample: number) => {
    if (!controllerRef.current) return;
    const deck = deckId === 'A' ? controllerRef.current.deckA : controllerRef.current.deckB;
    deck.seek(sample);
  }, []);

  const handlePitchChange = useCallback((deckId: 'A' | 'B', percentage: number) => {
    if (!controllerRef.current) return;
    const deck = deckId === 'A' ? controllerRef.current.deckA : controllerRef.current.deckB;
    deck.setPitchPercentage(percentage);
  }, []);

  const handleJogNudge = useCallback((deckId: 'A' | 'B', nudge: number) => {
    if (!controllerRef.current) return;
    const deck = deckId === 'A' ? controllerRef.current.deckA : controllerRef.current.deckB;
    deck.setJogPitchNudge(nudge);
  }, []);

  const handleVolumeChange = useCallback((deckId: 'A' | 'B', vol: number) => {
    if (!controllerRef.current) return;
    const deck = deckId === 'A' ? controllerRef.current.deckA : controllerRef.current.deckB;
    deck.setVolume(vol);
  }, []);

  const handleEqChange = useCallback((deckId: 'A' | 'B', low: number, mid: number, high: number) => {
    if (!controllerRef.current) return;
    const deck = deckId === 'A' ? controllerRef.current.deckA : controllerRef.current.deckB;
    deck.setEQ(low, mid, high);
  }, []);

  const handleFilterChange = useCallback((deckId: 'A' | 'B', val: number) => {
    if (!controllerRef.current) return;
    const deck = deckId === 'A' ? controllerRef.current.deckA : controllerRef.current.deckB;
    deck.setFilter(val);
  }, []);

  const handleSelectPreset = useCallback(
    (deckId: 'A' | 'B', preset: DemoTrackPreset | SongLibraryItem) => {
      if (!controllerRef.current) return;
      const track = buildSyntheticTrack(controllerRef.current.audioCtx, preset);
      const deck = deckId === 'A' ? controllerRef.current.deckA : controllerRef.current.deckB;
      deck.loadTrack(track);

      if (deckId === 'A') setTrackA(track);
      else setTrackB(track);

      const isSlave = (masterDeckId === 'A' && deckId === 'B') || (masterDeckId === 'B' && deckId === 'A');
      if (autoBpmLock && isSlave) {
        setTimeout(() => {
          controllerRef.current?.matchSlaveTempoToMaster();
        }, 50);
      }
    },
    [autoBpmLock, masterDeckId]
  );

  const handleFileUpload = useCallback(
    async (deckId: 'A' | 'B', file: File) => {
      if (!controllerRef.current) return;
      setIsAnalyzingAudio(true);
      setAnalyzingFileName(file.name);

      try {
        const track = await decodeUploadedAudioFile(controllerRef.current.audioCtx, file);
        setLocalTracks((prev) => [track, ...prev.filter((t) => t.title !== track.title)]);

        const deck = deckId === 'A' ? controllerRef.current.deckA : controllerRef.current.deckB;
        deck.loadTrack(track);

        if (deckId === 'A') setTrackA(track);
        else setTrackB(track);

        const isSlave = (masterDeckId === 'A' && deckId === 'B') || (masterDeckId === 'B' && deckId === 'A');
        if (autoBpmLock && isSlave) {
          setTimeout(() => {
            controllerRef.current?.matchSlaveTempoToMaster();
          }, 50);
        }

        setSyncAlert({
          message: `Loaded ${file.name} into Deck ${deckId} (${track.bpm.toFixed(1)} BPM - beatgrid analyzed)`,
          type: 'info',
        });
      } catch (err) {
        console.error('Audio decode error:', err);
        setSyncAlert({
          message: `Failed to decode audio file: ${file.name}. Please ensure it is a valid audio file (MP3, WAV, FLAC, M4A, etc.).`,
          type: 'warning',
        });
      } finally {
        setIsAnalyzingAudio(false);
        setAnalyzingFileName(null);
      }
    },
    [autoBpmLock, masterDeckId]
  );

  const handleLoadLocalTrack = useCallback(
    (deckId: 'A' | 'B', track: TrackData) => {
      if (!controllerRef.current) return;
      const deck = deckId === 'A' ? controllerRef.current.deckA : controllerRef.current.deckB;
      deck.loadTrack(track);

      if (deckId === 'A') setTrackA(track);
      else setTrackB(track);

      const isSlave = (masterDeckId === 'A' && deckId === 'B') || (masterDeckId === 'B' && deckId === 'A');
      if (autoBpmLock && isSlave) {
        setTimeout(() => {
          controllerRef.current?.matchSlaveTempoToMaster();
        }, 50);
      }

      setSyncAlert({
        message: `Loaded "${track.title}" into Deck ${deckId} (${track.bpm.toFixed(1)} BPM)`,
        type: 'info',
      });
    },
    [autoBpmLock, masterDeckId]
  );

  const handleCrossfader = (val: number) => {
    setCrossfader(val);
    controllerRef.current?.setCrossfader(val);
  };

  const handleTopModeSelect = (mode: 'music' | 'masterOut' | 'looper' | 'settings') => {
    if (mode === 'masterOut') {
      setActiveTopMode(activeTopMode === 'masterOut' ? 'music' : 'masterOut');
    } else if (mode === 'music') {
      setActiveTopMode('music');
    } else if (mode === 'looper') {
      setActiveTopMode(activeTopMode === 'looper' ? 'music' : 'looper');
    } else if (mode === 'settings') {
      setIsDiagnosticsOpen(true);
    }
  };

  // Time format helper
  const fmtTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = (s % 60).toFixed(1).padStart(4, '0');
    return `${m}:${sec}`;
  };

  const activeTelemetry = activeConsoleTab === 'deckB' ? telemetryB : telemetryA;
  const activeTrack = activeConsoleTab === 'deckB' ? trackB : trackA;

  const elapsedStr = fmtTime(activeTelemetry.currentTimeSeconds);
  const totalStr = fmtTime(activeTelemetry.totalDurationSeconds);
  const remainStr = fmtTime(Math.max(0, activeTelemetry.totalDurationSeconds - activeTelemetry.currentTimeSeconds));

  return (
    <div className="min-h-screen bg-[#07090c] text-neutral-100 flex flex-col items-center justify-center p-1 sm:p-3 relative select-none">
      {/* Alert Notification if any */}
      {syncAlert && (
        <div
          className={`fixed top-3 z-50 max-w-md p-2.5 rounded-lg border text-xs font-mono flex items-center justify-between shadow-2xl ${
            syncAlert.type === 'success'
              ? 'bg-emerald-950/90 border-emerald-500/80 text-emerald-300'
              : syncAlert.type === 'warning'
              ? 'bg-amber-950/90 border-amber-500/80 text-amber-300'
              : 'bg-blue-950/90 border-blue-500/80 text-blue-300'
          }`}
        >
          <span>{syncAlert.message}</span>
          <button onClick={() => setSyncAlert(null)} className="text-neutral-400 hover:text-white px-2 cursor-pointer">
            ✕
          </button>
        </div>
      )}

      {/* Audio File Decoding & Beatgrid Analysis HUD */}
      {isAnalyzingAudio && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex flex-col items-center justify-center p-4">
          <div className="bg-[#0e1117] border-2 border-cyan-400 rounded-2xl p-6 max-w-md w-full flex flex-col items-center text-center shadow-[0_0_50px_rgba(0,229,255,0.7)]">
            <div className="w-12 h-12 rounded-full border-4 border-cyan-400 border-t-transparent animate-spin mb-4" />
            <span className="text-sm font-black font-mono text-white uppercase tracking-wider">
              ANALYZING AUDIO & BUILDING BEATGRID
            </span>
            <span className="text-xs font-mono text-cyan-300 mt-1 truncate max-w-full font-bold">
              {analyzingFileName}
            </span>
            <p className="text-[11px] font-mono text-neutral-400 mt-3 leading-relaxed">
              Performing multi-band autocorrelation BPM detection, kick transient extraction, and downbeat synchronization...
            </p>
          </div>
        </div>
      )}

      {/* PRIMARY HARDWARE CHASSIS CONSOLE (ORIGINAL DJ INTERFACE) */}
      <HardwareChassis
        activeTopMode={activeTopMode}
        onSelectTopMode={handleTopModeSelect}
        activeConsoleTab={activeConsoleTab}
        onSelectConsoleTab={(tab) => setActiveConsoleTab(tab)}
        deckSubView={deckSubView}
        onToggleDeckSubView={(view) => setDeckSubView(view)}
        trackTitleA={trackA?.title}
        trackArtistA={trackA?.artist}
        bpmA={telemetryA.effectiveBpm}
        keyA={trackA?.key || '02A'}
        trackTitleB={trackB?.title}
        trackArtistB={trackB?.artist}
        bpmB={telemetryB.effectiveBpm}
        keyB={trackB?.key || '07B'}
        elapsedA={elapsedStr}
        remainA={remainStr}
        totalA={totalStr}
        onUploadLocalFile={(deckId, file) => handleFileUpload(deckId, file)}
      >
        {/* STACKED HORIZONTAL DUAL WAVEFORM (UNTOUCHED ENGINE WAVEFORM ARRANGEMENT) */}
        <DualStackedWaveform
          trackA={trackA}
          trackB={trackB}
          currentSampleA={telemetryA.currentSourceSample}
          currentSampleB={telemetryB.currentSourceSample}
          isPlayingA={telemetryA.isPlaying}
          isPlayingB={telemetryB.isPlaying}
          onSeekA={(s) => handleSeek('A', s)}
          onSeekB={(s) => handleSeek('B', s)}
        />

        {/* ACTIVE CONSOLE SUB-VIEW: DECK A */}
        {activeConsoleTab === 'deckA' && (
          deckSubView === 'vinyl' ? (
            <DeckVinylView
              deckId="A"
              track={trackA}
              telemetry={telemetryA}
              isMaster={masterDeckId === 'A'}
              onPlayPause={() => handlePlayPause('A')}
              onCue={() => handleCue('A')}
              onSync={() => handleTriggerVdj8Sync('A')}
              onSeek={(s) => handleSeek('A', s)}
              onPitchChange={(pct) => handlePitchChange('A', pct)}
              onJogNudge={(n) => handleJogNudge('A', n)}
              tempoFamilyLock={null}
              onFileUpload={(f) => handleFileUpload('A', f)}
            />
          ) : (
            <PerformanceBoard
              deckId="A"
              track={trackA}
              telemetry={telemetryA}
              onPlayPause={() => handlePlayPause('A')}
              onCue={() => handleCue('A')}
              onSync={() => handleTriggerVdj8Sync('A')}
              onSeek={(s) => handleSeek('A', s)}
              tempoFamilyLock={null}
              onFileUpload={(f) => handleFileUpload('A', f)}
            />
          )
        )}

        {/* ACTIVE CONSOLE SUB-VIEW: DECK B */}
        {activeConsoleTab === 'deckB' && (
          deckSubView === 'vinyl' ? (
            <DeckVinylView
              deckId="B"
              track={trackB}
              telemetry={telemetryB}
              isMaster={masterDeckId === 'B'}
              onPlayPause={() => handlePlayPause('B')}
              onCue={() => handleCue('B')}
              onSync={() => handleTriggerVdj8Sync('B')}
              onSeek={(s) => handleSeek('B', s)}
              onPitchChange={(pct) => handlePitchChange('B', pct)}
              onJogNudge={(n) => handleJogNudge('B', n)}
              tempoFamilyLock={null}
              onFileUpload={(f) => handleFileUpload('B', f)}
            />
          ) : (
            <PerformanceBoard
              deckId="B"
              track={trackB}
              telemetry={telemetryB}
              onPlayPause={() => handlePlayPause('B')}
              onCue={() => handleCue('B')}
              onSync={() => handleTriggerVdj8Sync('B')}
              onSeek={(s) => handleSeek('B', s)}
              tempoFamilyLock={null}
              onFileUpload={(f) => handleFileUpload('B', f)}
            />
          )
        )}

        {/* ACTIVE CONSOLE SUB-VIEW: MIXER */}
        {activeConsoleTab === 'mixer' && (
          <MixerView
            telemetryA={telemetryA}
            telemetryB={telemetryB}
            crossfader={crossfader}
            onCrossfaderChange={handleCrossfader}
            onPlayPauseA={() => handlePlayPause('A')}
            onPlayPauseB={() => handlePlayPause('B')}
            onCueA={() => handleCue('A')}
            onCueB={() => handleCue('B')}
            onEqChangeA={(l, m, h) => handleEqChange('A', l, m, h)}
            onEqChangeB={(l, m, h) => handleEqChange('B', l, m, h)}
            onFilterChangeA={(f) => handleFilterChange('A', f)}
            onFilterChangeB={(f) => handleFilterChange('B', f)}
            onVolumeChangeA={(v) => handleVolumeChange('A', v)}
            onVolumeChangeB={(v) => handleVolumeChange('B', v)}
          />
        )}

        {/* QUICK CROSSFADER & VIEW BAR ON DECK VIEWS */}
        {activeConsoleTab !== 'mixer' && (
          <div className="flex items-center justify-between gap-4 py-2 px-4 bg-[#090b0e] rounded-lg border border-neutral-800 shadow-inner mt-1">
            <button
              onClick={() => setActiveConsoleTab('deckA')}
              className={`text-xs font-black font-mono transition-all cursor-pointer ${
                crossfader < 0 ? 'text-cyan-400 drop-shadow-[0_0_8px_rgba(0,229,255,0.9)]' : 'text-neutral-500'
              }`}
            >
              DECK A
            </button>
            <SkeuomorphicFader
              orientation="horizontal"
              width={260}
              value={crossfader}
              min={-1}
              max={1}
              trackColor="silver"
              capSize="md"
              onChange={handleCrossfader}
            />
            <button
              onClick={() => setActiveConsoleTab('deckB')}
              className={`text-xs font-black font-mono transition-all cursor-pointer ${
                crossfader > 0 ? 'text-red-500 drop-shadow-[0_0_8px_rgba(255,51,68,0.9)]' : 'text-neutral-500'
              }`}
            >
              DECK B
            </button>
          </div>
        )}
      </HardwareChassis>

      {/* MASTER OUTPUT & SUPERPOWERED FX RACK OVERLAY */}
      {activeTopMode === 'masterOut' && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-2 sm:p-4 overflow-y-auto">
          <div className="w-full max-w-5xl my-auto">
            <MasterOutputView onClose={() => setActiveTopMode('music')} />
          </div>
        </div>
      )}

      {/* 5-INBUILT LOOPS & AUDIO LOOPER BOARD OVERLAY */}
      {activeTopMode === 'looper' && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-2 sm:p-4 overflow-y-auto">
          <div className="w-full max-w-4xl my-auto">
            <LooperView
              looperState={looperState}
              loopTrack={loopTrack}
              activeMasterDeckId={controllerRef.current?.getActiveMasterDeckId() ?? null}
              masterBpm={masterDeckId === 'A' ? telemetryA.effectiveBpm : telemetryB.effectiveBpm}
              selectedInbuiltLoopId={selectedInbuiltLoopId}
              onSelectInbuiltLoop={handleSelectInbuiltLoop}
              onUploadFile={handleLooperUpload}
              onPlaySync={handleLooperPlay}
              onStop={handleLooperStop}
              onSetLoopBeatCount={handleLooperBeatCount}
              onSetLoopStartSample={handleLooperStartSample}
              onVolumeChange={handleLooperVolume}
              onClose={() => setActiveTopMode('music')}
            />
          </div>
        </div>
      )}

      {/* 50-Song Multi-BPM Test Library Modal */}
      <TrackLibraryModal
        isOpen={isLibraryOpen}
        onClose={() => setIsLibraryOpen(false)}
        onLoadSong={(deckId, song) => handleSelectPreset(deckId, song)}
        onFileUpload={(deckId, file) => handleFileUpload(deckId, file)}
        localTracks={localTracks}
        onLoadLocalTrack={handleLoadLocalTrack}
      />

      {/* Deep BPM & Beatgrid Calibration Modal */}
      {calibratingDeck && (
        <BpmAnalyzerModal
          isOpen={true}
          onClose={() => setCalibratingDeck(null)}
          track={calibratingDeck === 'A' ? trackA : trackB}
          deckId={calibratingDeck}
          currentPlaybackSample={calibratingDeck === 'A' ? telemetryA.currentSourceSample : telemetryB.currentSourceSample}
          onApplyTrackAnalysis={(deckId, updatedTrack) => {
            if (!controllerRef.current) return;
            const deck =
              deckId === 'A'
                ? controllerRef.current.deckA
                : controllerRef.current.deckB;

            deck.setTrackAnalysisMetadata(updatedTrack);

            if (deckId === 'A') {
              setTrackA(updatedTrack);
            } else {
              setTrackB(updatedTrack);
            }

            setSyncAlert({
              message: `Deck ${deckId} BeatGrid & BPM updated (${updatedTrack.bpm.toFixed(3)} BPM). Live playback untouched.`,
              type: 'success',
            });
          }}
        />
      )}

      {/* Settings / Sync Diagnostics & Telemetry Modal */}
      {isDiagnosticsOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-[#0e1117] border-2 border-neutral-700 rounded-2xl max-w-5xl w-full max-h-[90vh] overflow-y-auto p-4 flex flex-col gap-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-neutral-800 pb-3">
              <div className="flex items-center gap-2 text-sm font-black text-white uppercase font-mono">
                <Wrench className="w-4 h-4 text-cyan-400" />
                <span>MASAVU ENGINE SETTINGS & PHASE TELEMETRY</span>
              </div>
              <button
                onClick={() => setIsDiagnosticsOpen(false)}
                className="p-1 rounded-full bg-neutral-800 hover:bg-neutral-700 text-neutral-300"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Quick preset tests & Auto BPM lock */}
            <div className="flex items-center justify-between p-3 bg-neutral-900/80 rounded-lg border border-neutral-800">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setAutoBpmLock(!autoBpmLock)}
                  className={`px-3 py-1 text-xs font-mono font-bold rounded border ${
                    autoBpmLock
                      ? 'bg-emerald-950 border-emerald-500 text-emerald-300'
                      : 'bg-neutral-800 border-neutral-700 text-neutral-400'
                  }`}
                >
                  AUTO-BPM LOCK: {autoBpmLock ? 'ENABLED' : 'DISABLED'}
                </button>
                <button
                  onClick={() => setIsLibraryOpen(true)}
                  className="px-3 py-1 text-xs font-mono font-bold rounded bg-cyan-950 border border-cyan-600 text-cyan-300"
                >
                  OPEN 50-SONG LIBRARY ({FIFTY_TEST_SONGS.length} SONGS)
                </button>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setCalibratingDeck('A')}
                  className="px-2.5 py-1 text-xs font-mono font-bold rounded bg-neutral-800 border border-neutral-700 text-neutral-300 hover:bg-neutral-700"
                >
                  CALIBRATE DECK A
                </button>
                <button
                  onClick={() => setCalibratingDeck('B')}
                  className="px-2.5 py-1 text-xs font-mono font-bold rounded bg-neutral-800 border border-neutral-700 text-neutral-300 hover:bg-neutral-700"
                >
                  CALIBRATE DECK B
                </button>
              </div>
            </div>

            {/* Telemetry panel */}
            <SyncTelemetryPanel
              lastPlan={lastPlan}
              masterTelemetry={masterDeckId === 'A' ? telemetryA : telemetryB}
              slaveTelemetry={masterDeckId === 'A' ? telemetryB : telemetryA}
              phaseErrorMs={phaseErrorMs}
              phaseTelemetry={phaseTelemetry}
              quantizeMode={quantizeMode}
              onQuantizeModeChange={setQuantizeMode}
              onTriggerVdj8Sync={handleTriggerVdj8Sync}
              onTriggerLegacySync={() => {
                if (!controllerRef.current) return;
                controllerRef.current.triggerLegacyDefectiveSlaveStart();
              }}
            />

            {/* Phase & Downbeat Visualizer */}
            <PhaseAndDownbeatVisualizer
              masterDeckId={masterDeckId}
              telemetryA={telemetryA}
              telemetryB={telemetryB}
              phaseErrorMs={phaseErrorMs}
              downbeatPhase={downbeatPhase}
              onApplySoftPhaseCorrection={() => {
                controllerRef.current?.applySoftPhaseCorrection(0.4);
              }}
              onForceDownbeatAlignment={() => {
                controllerRef.current?.forceDownbeatAlignment();
              }}
              onInjectDrift={(ms) => {
                controllerRef.current?.injectPhaseDrift(ms);
              }}
              onHardReanchor={handleTriggerVdj8Sync}
              quantizeMode={quantizeMode}
              onSetQuantizeMode={setQuantizeMode}
            />
          </div>
        </div>
      )}
    </div>
  );
}
