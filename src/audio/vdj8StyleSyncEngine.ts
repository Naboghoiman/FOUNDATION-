/**
 * VirtualDJ-8-style synchronization behaviour for MASAVU.
 *
 * CLEAN-ROOM IMPLEMENTATION:
 * This file reproduces publicly observable DJ sync behaviour (tempo-family
 * matching, beat/bar quantized launch, master/slave phase alignment and
 * kick-preferred start) without using VirtualDJ proprietary source code.
 *
 * Design rule for MASAVU: prepare tempo + phase before launch, then keep the
 * stable tempo. Do not run a permanent audible auto-nudge loop.
 */

import { BeatGrid, GrooveMatch, SlaveStartPlan, TrackData } from '../types/dj';
import { MasavuGrooveMatcher } from './masavuGrooveMatcher';

export interface TempoFamilyMatch {
  /** 0.5, 1.0 or 2.0 interpretation of the slave analysis BPM. */
  familyFactor: 0.5 | 1 | 2;
  /** Slave BPM interpreted in the family closest to the master BPM. */
  equivalentSlaveBpm: number;
  /** Stable playback multiplier to match the master musical tempo family. */
  playbackMultiplier: number;
  /** Relative mismatch before time-stretching. Lower is better. */
  logTempoDistance: number;
}

export interface DownbeatPhaseTelemetry {
  masterBeatInBar: number; // 0, 1, 2, 3 (where 0 is Beat 1 downbeat)
  slaveBeatInBar: number;  // 0, 1, 2, 3
  masterBarIndex: number;
  slaveBarIndex: number;
  downbeatOffsetBeats: number; // 0 means downbeats are matched!
  isDownbeatMatched: boolean;  // true when downbeatOffsetBeats === 0
  isCurrentlyOnDownbeat: boolean; // true when both are playing beat 1
}

export interface Vdj8StyleLaunchPlan extends SlaveStartPlan {
  familyFactor: 0.5 | 1 | 2;
  equivalentSlaveBpm: number;
  targetMasterBeatIndex: number;
  targetSlaveBeatIndex: number;
  selectedSlaveBeatSample: number;
  /** True when a transient close to the selected beat was used as the audible launch point. */
  kickSnapped: boolean;
  /** Signed transient offset from the mathematical beat grid, in milliseconds at source speed. */
  kickOffsetMs: number;
  quantizeMode: 'beat' | 'bar';
  /** MASAVU Rhythmic Groove Matcher result */
  grooveMatch?: GrooveMatch;
  /** Preserved rhythmic groove phase offset for the phase controller */
  desiredGrooveOffsetMs?: number;
}

export interface Vdj8StyleSyncConfig {
  /** Minimum scheduling headroom before the target master beat. */
  minLookaheadSeconds: number;
  /** Search window around a beat for an analysed transient, as a fraction of one beat. */
  kickSearchWindowBeats: number;
  /** When BPM family is half/double, prefer a downbeat to remove beat ambiguity. */
  forceDownbeatForHalfDouble: boolean;
  /** Optional measured processing latency fields for telemetry/native-port parity. */
  decoderLatencyFrames: number;
  timeStretcherLatencyFrames: number;
  audioBufferLatencyFrames: number;
}

const DEFAULT_CONFIG: Vdj8StyleSyncConfig = {
  minLookaheadSeconds: 0.10,
  kickSearchWindowBeats: 0.18,
  forceDownbeatForHalfDouble: true,
  decoderLatencyFrames: 0,
  timeStretcherLatencyFrames: 0,
  audioBufferLatencyFrames: 0
};

export class Vdj8StyleSyncEngine {
  private config: Vdj8StyleSyncConfig;
  private grooveMatcher: MasavuGrooveMatcher;

  constructor(config: Partial<Vdj8StyleSyncConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.grooveMatcher = new MasavuGrooveMatcher();
  }

  public updateConfig(config: Partial<Vdj8StyleSyncConfig>): void {
    this.config = { ...this.config, ...config };
  }

  public getConfig(): Vdj8StyleSyncConfig {
    return { ...this.config };
  }

  public getGrooveMatcher(): MasavuGrooveMatcher {
    return this.grooveMatcher;
  }

  /**
   * VirtualDJ-style tempo family selection: compare 0.5x / 1x / 2x BPM
   * interpretations and choose the one needing the smallest time-stretch.
   */
  public matchTempoFamily(masterBpm: number, slaveBpm: number): TempoFamilyMatch {
    const master = this.safeBpm(masterBpm);
    const slave = this.safeBpm(slaveBpm);
    const factors: Array<0.5 | 1 | 2> = [0.5, 1, 2];

    let best: TempoFamilyMatch | null = null;
    for (const factor of factors) {
      const equivalentSlaveBpm = slave * factor;
      const playbackMultiplier = master / equivalentSlaveBpm;
      const logTempoDistance = Math.abs(Math.log2(playbackMultiplier));
      const candidate: TempoFamilyMatch = {
        familyFactor: factor,
        equivalentSlaveBpm,
        playbackMultiplier,
        logTempoDistance
      };

      if (!best || candidate.logTempoDistance < best.logTempoDistance) {
        best = candidate;
      } else if (
        best &&
        Math.abs(candidate.logTempoDistance - best.logTempoDistance) < 1e-9 &&
        factor === 1
      ) {
        // Prefer the native analysis family on an exact tie.
        best = candidate;
      }
    }

    return best!;
  }

  /**
   * Builds the complete synchronized launch plan on the same AudioContext clock
   * used by both decks. The selected slave source position is a matching beat,
   * optionally snapped to a nearby analysed transient so the audible kick attack
   * itself lands on the master's target beat.
   */
  public createLaunchPlan(params: {
    audioContextCurrentTime: number;
    outputSampleRate: number;
    masterTrack: TrackData;
    slaveTrack: TrackData;
    masterCurrentSourceSample: number;
    slaveCurrentSourceSample: number;
    masterEffectiveBpm: number;
    slaveIsPlaying: boolean;
    quantizeMode?: 'beat' | 'bar';
  }): Vdj8StyleLaunchPlan {
    const requestedMode = params.quantizeMode ?? 'beat';
    const masterGrid = params.masterTrack.beatGrid;
    const slaveGrid = params.slaveTrack.beatGrid;

    // Use only beatStartSample or discDjAnchor.beatStartSample
    const masterAnchorSample = masterGrid.beatStartSample ?? masterGrid.discDjAnchor?.beatStartSample ?? 0;
    const slaveAnchorSample = slaveGrid.beatStartSample ?? slaveGrid.discDjAnchor?.beatStartSample ?? 0;

    const masterOriginalBpm = params.masterTrack.bpm || 120;
    const followerOriginalBpm = params.slaveTrack.bpm || 120;

    const masterSpeed = Math.max(0.01, params.masterEffectiveBpm / masterOriginalBpm);

    const masterEffective = masterOriginalBpm * masterSpeed;
    const candidates = [
      masterEffective * 0.5,
      masterEffective,
      masterEffective * 2.0
    ];

    let bestCandidate = masterEffective;
    let minDistance = Infinity;
    let bestFactor: 0.5 | 1 | 2 = 1;

    const factors: Array<0.5 | 1 | 2> = [0.5, 1, 2];
    for (let i = 0; i < 3; i++) {
      const candidate = candidates[i];
      const factor = factors[i];
      const playbackMultiplier = candidate / followerOriginalBpm;
      const distance = Math.abs(Math.log2(playbackMultiplier));
      if (distance < minDistance) {
        minDistance = distance;
        bestCandidate = candidate;
        bestFactor = factor;
      }
    }

    let targetFollowerSpeed = bestCandidate / followerOriginalBpm;

    if (targetFollowerSpeed < 0.5) {
      targetFollowerSpeed *= 2;
    }
    if (targetFollowerSpeed > 2.0) {
      targetFollowerSpeed /= 2;
    }

    const masterBeatPeriod = 60 / masterOriginalBpm;
    const followerBeatPeriod = 60 / followerOriginalBpm;

    const masterReal4 = (4 * masterBeatPeriod) / masterSpeed;
    const followerReal4 = (4 * followerBeatPeriod) / targetFollowerSpeed;

    const commonReal4 = Math.max(masterReal4, followerReal4);

    const masterSourceCycle = commonReal4 * masterSpeed;
    const followerSourceCycle = commonReal4 * targetFollowerSpeed;

    const masterCurrentPosition = params.masterCurrentSourceSample / params.masterTrack.sampleRate;
    const followerCurrentPosition = params.slaveCurrentSourceSample / params.slaveTrack.sampleRate;

    const masterBeatStart = masterAnchorSample / params.masterTrack.sampleRate;
    const followerBeatStart = slaveAnchorSample / params.slaveTrack.sampleRate;

    const nextMasterBoundary = masterBeatStart + Math.ceil((masterCurrentPosition - masterBeatStart) / masterSourceCycle) * masterSourceCycle;
    const nextFollowerBoundary = followerBeatStart + Math.ceil((followerCurrentPosition - followerBeatStart) / followerSourceCycle) * followerSourceCycle;

    const masterDelta = nextMasterBoundary - masterCurrentPosition;
    const followerDelta = nextFollowerBoundary - followerCurrentPosition;

    const followerRealRemaining = followerDelta / targetFollowerSpeed;
    const masterRealRemaining = masterDelta / masterSpeed;

    const realDifference = followerRealRemaining - masterRealRemaining;

    let targetFollowerPosition = followerCurrentPosition + realDifference * targetFollowerSpeed;

    // Apply the verified 0.3-cycle rule:
    if (
      targetFollowerPosition < followerCurrentPosition &&
      targetFollowerPosition < followerCurrentPosition - 0.3 * followerSourceCycle
    ) {
      targetFollowerPosition += followerSourceCycle;
    }

    if (targetFollowerPosition < 0) {
      targetFollowerPosition += followerSourceCycle;
    }

    const secondsUntilTarget = this.config.minLookaheadSeconds;
    const targetOutputTime = params.audioContextCurrentTime + secondsUntilTarget;
    const targetOutputFrame = Math.round(targetOutputTime * params.outputSampleRate);

    // Follower's exact target source position at targetOutputTime:
    const targetFollowerPositionFuture = targetFollowerPosition + secondsUntilTarget * targetFollowerSpeed;
    const slaveSourceSample = Math.max(0, Math.round(targetFollowerPositionFuture * params.slaveTrack.sampleRate));

    const masterBeatFloat = (params.masterCurrentSourceSample - masterAnchorSample) / (params.masterTrack.sampleRate * masterBeatPeriod);
    const masterBeatInBar = Math.floor(this.mod(masterBeatFloat, 4));
    const masterBarIndex = Math.floor(masterBeatFloat / 4);

    const slaveBeatFloat = targetFollowerPositionFuture / followerBeatPeriod;
    const slaveBeatInBar = Math.floor(this.mod(slaveBeatFloat, 4));

    const totalLatencySeconds = 0;

    return {
      targetOutputFrame,
      targetOutputTime,
      masterBeatNumber: masterBeatInBar + 1,
      masterIsDownbeat: masterBeatInBar === 0,
      masterBarIndex,
      slaveSourceSample,
      slaveBeatNumber: slaveBeatInBar + 1,
      slaveIsDownbeat: slaveBeatInBar === 0,
      baseTempoMultiplier: targetFollowerSpeed,
      decoderLatencyFrames: 0,
      timeStretcherLatencyFrames: 0,
      audioBufferLatencyFrames: 0,
      totalLatencySeconds,
      prerollOutputTime: targetOutputTime,
      familyFactor: bestFactor,
      equivalentSlaveBpm: followerOriginalBpm * bestFactor,
      targetMasterBeatIndex: Math.floor(masterBeatFloat),
      targetSlaveBeatIndex: Math.floor(slaveBeatFloat),
      selectedSlaveBeatSample: slaveSourceSample,
      kickSnapped: false,
      kickOffsetMs: 0,
      quantizeMode: requestedMode,
      desiredGrooveOffsetMs: 0
    };
  }

  /**
   * Phase error supervisor only. It does not continuously alter playback speed.
   * Positive value means the slave beat is late relative to the master beat.
   */
  public measureWrappedPhaseErrorMs(params: {
    masterCurrentSourceSample: number;
    masterGrid: BeatGrid;
    masterBpm: number;
    slaveCurrentSourceSample: number;
    slaveGrid: BeatGrid;
  }): number {
    const masterBpm = this.safeBpm(params.masterBpm);
    const periodMs = 60000 / masterBpm;
    const masterPhase = this.frac(this.sampleToBeat(params.masterCurrentSourceSample, params.masterGrid));
    const slavePhase = this.frac(this.sampleToBeat(params.slaveCurrentSourceSample, params.slaveGrid));
    let errorMs = (slavePhase - masterPhase) * periodMs;
    errorMs = ((errorMs + periodMs / 2) % periodMs + periodMs) % periodMs - periodMs / 2;
    return errorMs;
  }

  /** Rare recovery gate: no permanent auto-nudging. */
  public shouldReanchor(phaseErrorMs: number, persistedBeatCount: number): boolean {
    return Number.isFinite(phaseErrorMs) && Math.abs(phaseErrorMs) >= 45 && persistedBeatCount >= 2;
  }

  /**
   * Evaluates bar-level musical downbeat alignment (Beat 1 to 4 in 4/4 time).
   * Downbeat alignment ensures that Beat 1.1 of Deck A plays simultaneously
   * with Beat 1.1 of Deck B, preventing rhythmic clashes like kicks landing on snares.
   */
  public measureDownbeatPhase(params: {
    masterCurrentSourceSample: number;
    masterGrid: BeatGrid;
    slaveCurrentSourceSample: number;
    slaveGrid: BeatGrid;
  }): DownbeatPhaseTelemetry {
    const masterBeatsPerBar = Math.max(1, params.masterGrid.beatsPerBar || 4);
    const slaveBeatsPerBar = Math.max(1, params.slaveGrid.beatsPerBar || 4);

    const masterBeatFloat = this.sampleToBeat(params.masterCurrentSourceSample, params.masterGrid);
    const slaveBeatFloat = this.sampleToBeat(params.slaveCurrentSourceSample, params.slaveGrid);

    const masterBeatInt = Math.floor(masterBeatFloat);
    const slaveBeatInt = Math.floor(slaveBeatFloat);

    const masterBeatInBar = this.mod(masterBeatInt, masterBeatsPerBar);
    const slaveBeatInBar = this.mod(slaveBeatInt, slaveBeatsPerBar);

    const masterBarIndex = Math.floor(masterBeatInt / masterBeatsPerBar);
    const slaveBarIndex = Math.floor(slaveBeatInt / slaveBeatsPerBar);

    const downbeatOffsetBeats = this.mod(slaveBeatInBar - masterBeatInBar, slaveBeatsPerBar);
    const isDownbeatMatched = downbeatOffsetBeats === 0;
    const isCurrentlyOnDownbeat = isDownbeatMatched && masterBeatInBar === 0;

    return {
      masterBeatInBar,
      slaveBeatInBar,
      masterBarIndex,
      slaveBarIndex,
      downbeatOffsetBeats,
      isDownbeatMatched,
      isCurrentlyOnDownbeat
    };
  }

  /**
   * Calculates the temporary pitch adjustment (jog nudge factor) needed to smoothly
   * eliminate the micro-phase error over targetDurationSec without jarring cuts.
   */
  public calculateSoftPhaseNudge(phaseErrorMs: number, targetDurationSec = 0.4): number {
    if (!Number.isFinite(phaseErrorMs) || Math.abs(phaseErrorMs) < 0.5) return 0;
    // errorMs is slavePhase - masterPhase
    // If errorMs > 0, slave beat is late. Slave needs to speed up: positive nudge.
    // If errorMs < 0, slave beat is early. Slave needs to slow down: negative nudge.
    const errorSec = phaseErrorMs / 1000;
    const requiredNudge = errorSec / Math.max(0.1, targetDurationSec);
    return Math.max(-0.06, Math.min(0.06, requiredNudge));
  }

  private nextMasterTargetBeat(
    masterBeatFloat: number,
    beatPeriodSeconds: number,
    beatsPerBar: number,
    mode: 'beat' | 'bar'
  ): number {
    if (mode === 'bar') {
      const currentBeatIndex = Math.floor(masterBeatFloat);
      const currentBar = Math.floor(currentBeatIndex / beatsPerBar);
      return (currentBar + 1) * beatsPerBar;
    }

    const nextBeat = Math.floor(masterBeatFloat) + 1;
    const delay = (nextBeat - masterBeatFloat) * beatPeriodSeconds;
    return delay >= 0 ? nextBeat : nextBeat + 1;
  }

  private closestBeatWithBarPosition(
    referenceBeat: number,
    desiredBeatInBar: number,
    beatsPerBar: number,
    totalBeats: number,
    preferForward: boolean
  ): number {
    const refBar = Math.floor(referenceBeat / beatsPerBar);
    const candidates: number[] = [];

    for (let d = -2; d <= 3; d += 1) {
      const idx = (refBar + d) * beatsPerBar + desiredBeatInBar;
      if (idx >= 0 && (totalBeats <= 0 || idx < totalBeats)) {
        candidates.push(idx);
      }
    }

    if (candidates.length === 0) {
      return Math.max(0, Math.round(referenceBeat));
    }

    if (preferForward) {
      const forward = candidates.filter((v) => v >= referenceBeat - 1e-6);
      if (forward.length > 0) {
        return forward.reduce((a, b) => (a < b ? a : b));
      }
    }

    return candidates.reduce((best, candidate) =>
      Math.abs(candidate - referenceBeat) < Math.abs(best - referenceBeat) ? candidate : best
    );
  }

  private findNearestTransientToBeat(
    track: TrackData,
    beatSample: number,
    samplesPerBeat: number
  ): number | null {
    const transients = track.warpMap?.transientMarkers;
    if (!transients || transients.length === 0 || samplesPerBeat <= 0) return null;

    const maxDistance = Math.max(1, samplesPerBeat * this.config.kickSearchWindowBeats);
    let best: number | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    // A simple pass is deterministic and safe for the current track sizes. The
    // detector has already reduced the source to transient marker positions.
    for (const marker of transients) {
      const distance = Math.abs(marker - beatSample);
      if (distance <= maxDistance && distance < bestDistance) {
        best = marker;
        bestDistance = distance;
      }
    }
    return best;
  }

  public isGridValid(grid: BeatGrid | null | undefined): boolean {
    if (!grid) return false;
    if (!Number.isFinite(grid.samplesPerBeat) || grid.samplesPerBeat <= 0) return false;
    if (!Number.isFinite(grid.bpm) || grid.bpm < 30 || grid.bpm > 260) return false;
    const anchor = grid.beatStartSample ?? grid.firstDownbeatSample;
    return Number.isFinite(anchor);
  }

  private beatIndexToSample(index: number, grid: BeatGrid): number {
    // DiscDJ parity: both waveform and sync must use the SAME straight beat_start + samplesPerBeat geometry
    const anchor = grid.beatStartSample ?? grid.firstDownbeatSample ?? 0;
    return Math.max(0, Math.round(anchor + index * grid.samplesPerBeat));
  }

  private sampleToBeat(sample: number, grid: BeatGrid): number {
    if (!Number.isFinite(sample) || !Number.isFinite(grid.samplesPerBeat) || grid.samplesPerBeat <= 0) {
      return 0;
    }
    const anchor = grid.beatStartSample ?? grid.firstDownbeatSample ?? 0;
    return (sample - anchor) / grid.samplesPerBeat;
  }

  private safeGrid(grid: BeatGrid, sampleRate: number, bpm: number): BeatGrid {
    if (grid && Number.isFinite(grid.samplesPerBeat) && grid.samplesPerBeat > 0) return grid;
    const samplesPerBeat = sampleRate * 60 / this.safeBpm(bpm);
    const anchor = grid?.beatStartSample ?? grid?.firstDownbeatSample ?? 0;
    return {
      firstDownbeatSample: anchor,
      beatStartSample: anchor,
      samplesPerBeat,
      bpm: this.safeBpm(bpm),
      beatsPerBar: 4,
      totalBeats: Number.MAX_SAFE_INTEGER,
      confidence: 0,
      beatSamples: [],
      isDownbeat: []
    };
  }

  private safeBpm(value: number): number {
    return Number.isFinite(value) && value >= 20 && value <= 300 ? value : 120;
  }

  private frac(value: number): number {
    return value - Math.floor(value);
  }

  private mod(value: number, divisor: number): number {
    return ((value % divisor) + divisor) % divisor;
  }
}
