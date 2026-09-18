/**
 * MASAVU master controller with stable VirtualDJ-style synchronization.
 *
 * CLEAN-ROOM IMPLEMENTATION:
 * This controller uses VirtualDJ-8 style one-shot scheduled alignment (launch-and-lock)
 * with a telemetry-only phase lock that does not run continuous rate correction.
 */

import { SlaveStartPlan } from '../types/dj';
import { DjMasterController as BaseDjMasterController } from './djMasterControllerBase';
import { Vdj8StyleLaunchPlan, Vdj8StyleSyncEngine } from './vdj8StyleSyncEngine';
import { MasavuPhaseController, MasavuPhaseTelemetry } from './masavuPhaseController';
import { AudioLooperEngine } from './audioLooperEngine';

export class DjMasterController extends BaseDjMasterController {
  public readonly vdj8StyleSyncEngine = new Vdj8StyleSyncEngine();
  public readonly masavuPhaseController = new MasavuPhaseController();
  public readonly audioLooperEngine: AudioLooperEngine;
  private vdj8LastSlaveStartPlan: Vdj8StyleLaunchPlan | null = null;

  constructor(audioCtx?: AudioContext) {
    super(audioCtx);

    this.audioLooperEngine = new AudioLooperEngine(
      this.audioCtx,
      this.vdj8StyleSyncEngine
    );

    this.audioLooperEngine
      .getOutputNode()
      .connect(this.masterGain);
  }

  public syncLooperToCurrentMaster(): boolean {
    const activeMasterId = this.getActiveMasterDeckId();

    if (!activeMasterId) {
      return false;
    }

    const masterDeck =
      activeMasterId === 'A'
        ? this.deckA
        : this.deckB;

    return this.audioLooperEngine.syncToMaster(
      activeMasterId,
      masterDeck
    );
  }

  public override handleDeckPlaybackStateChanged(): 'A' | 'B' | null {
    const previousMaster = this.getMasterDeckId();
    const activeMaster = super.handleDeckPlaybackStateChanged();

    if (
      activeMaster &&
      activeMaster !== previousMaster &&
      this.audioLooperEngine.isPlaying()
    ) {
      this.syncLooperToCurrentMaster();
    }

    return activeMaster;
  }

  /**
   * Starts target deck (follower) aligned to opposite deck (reference/master).
   */
  public triggerBeatPerfectSlaveStartForDeck(
    targetDeckId: 'A' | 'B',
    quantizeMode: 'beat' | 'bar' = 'beat'
  ): SlaveStartPlan | null {
    const slaveDeck = targetDeckId === 'A' ? this.deckA : this.deckB;
    const masterDeck = targetDeckId === 'A' ? this.deckB : this.deckA;

    const masterTrack = masterDeck.getTrack();
    const slaveTrack = slaveDeck.getTrack();
    if (!masterTrack || !slaveTrack) return null;

    masterDeck.updateCurrentPosition();
    slaveDeck.updateCurrentPosition();
    const masterTelemetry = masterDeck.getTelemetry();

    if (!masterTelemetry.isPlaying) {
      return null;
    }

    const plan = this.vdj8StyleSyncEngine.createLaunchPlan({
      audioContextCurrentTime: this.audioCtx.currentTime,
      outputSampleRate: this.audioCtx.sampleRate,
      masterTrack,
      slaveTrack,
      masterCurrentSourceSample: masterDeck.getCurrentSourceSample(),
      slaveCurrentSourceSample: slaveDeck.getCurrentSourceSample(),
      masterEffectiveBpm: masterTelemetry.effectiveBpm,
      slaveIsPlaying: slaveDeck.getTelemetry().isPlaying,
      quantizeMode
    });

    slaveDeck.setSync(true);
    slaveDeck.setBaseTempoMultiplier(plan.baseTempoMultiplier);
    slaveDeck.play(plan.targetOutputTime, plan.slaveSourceSample);

    this.vdj8LastSlaveStartPlan = plan;
    this.masavuPhaseController.reset();
    this.masavuPhaseController.setDesiredGrooveOffsetMs(plan.desiredGrooveOffsetMs ?? 0);

    return plan;
  }

  /**
   * MASAVU trigger: starts slave at future master beat using VDJ8-style plan.
   */
  public override triggerBeatPerfectSlaveStart(
    quantizeMode: 'beat' | 'bar' = 'beat'
  ): SlaveStartPlan | null {
    const masterDeckId = this.getMasterDeckId();
    const targetDeckId = masterDeckId === 'A' ? 'B' : 'A';
    return this.triggerBeatPerfectSlaveStartForDeck(targetDeckId, quantizeMode);
  }

  public updatePhaseController(): MasavuPhaseTelemetry {
    const masterDeckId = this.getMasterDeckId();
    const slaveDeck = masterDeckId === 'A' ? this.deckB : this.deckA;
    const masterDeck = masterDeckId === 'A' ? this.deckA : this.deckB;

    const masterTrack = masterDeck.getTrack();
    const slaveTrack = slaveDeck.getTrack();

    masterDeck.updateCurrentPosition();
    slaveDeck.updateCurrentPosition();

    const masterTelemetry = masterDeck.getTelemetry();
    const slaveTelemetry = slaveDeck.getTelemetry();

    if (!masterTrack || !slaveTrack) {
      return {
        phaseErrorMs: 0,
        gridPhaseErrorMs: 0,
        desiredGrooveOffsetMs: 0,
        isGrooveLocked: false,
        phaseErrorDegrees: 0,
        masterBpm: masterTrack ? masterTrack.bpm : 120,
        slaveEffectiveBpm: slaveTrack ? slaveTrack.bpm : 120,
        baseTempoMultiplier: 1.0,
        temporaryCorrectionPercent: 0,
        numberOfPersistentBadBeats: 0,
        syncState: 'LOCKED',
        reanchorCount: 0
      };
    }

    const masterBpm =
      masterTelemetry.effectiveBpm > 20
        ? masterTelemetry.effectiveBpm
        : masterTrack.bpm;
    const slaveBpm = slaveTrack.bpm;

    const result = this.masavuPhaseController.update({
      currentTimeSec: this.audioCtx.currentTime,
      isMasterPlaying: masterTelemetry.isPlaying,
      isSlavePlaying: slaveTelemetry.isPlaying,
      masterBpm,
      slaveBpm,
      masterCurrentSample: masterDeck.getCurrentSourceSample(),
      slaveCurrentSample: slaveDeck.getCurrentSourceSample(),
      masterSampleRate: masterTrack.sampleRate,
      slaveSampleRate: slaveTrack.sampleRate,
      masterGrid: masterTrack.beatGrid,
      slaveGrid: slaveTrack.beatGrid,
      baseTempoMultiplier: slaveDeck.getBaseTempoMultiplier(),
      slaveEffectiveBpm: slaveTelemetry.effectiveBpm,
      onScheduleReanchor: () => {
        // RESTORE: No automatic re-anchor
      }
    });

    // While SYNC LOCK is ON, keep the existing stable OMWELU rule.
    // While SYNC LOCK is OFF, this controller becomes observation-only
    // and must not write to manual playback controls.
    if (slaveTelemetry.isSync) {
      slaveDeck.setPLLMultiplier(1.0);
      slaveDeck.setJogPitchNudge(0);
    }

    // Continuously sync looper to master deck (no PLL)
    this.audioLooperEngine.updateContinuousSync(masterDeck);

    return result.telemetry;
  }

  public override getLastSlaveStartPlan(): SlaveStartPlan | null {
    return this.vdj8LastSlaveStartPlan ?? super.getLastSlaveStartPlan();
  }

  public getLastVdj8Plan(): Vdj8StyleLaunchPlan | null {
    return this.vdj8LastSlaveStartPlan;
  }

  public triggerDownbeatAlignment(): SlaveStartPlan | null {
    return this.triggerBeatPerfectSlaveStart('bar');
  }

  public forceDownbeatAlignment(): SlaveStartPlan | null {
    return this.triggerDownbeatAlignment();
  }

  public applySoftPhaseCorrection(
    _targetDurationSec = 0.4
  ): { nudgeApplied: number; phaseErrorMs: number } | null {
    return null;
  }

  public injectPhaseDrift(offsetMs: number): void {
    const slaveDeck = this.getMasterDeckId() === 'A' ? this.deckB : this.deckA;
    const slaveTrack = slaveDeck.getTrack();
    if (!slaveTrack) return;

    const sampleOffset = Math.round((offsetMs / 1000) * slaveTrack.sampleRate);
    const currentSample = slaveDeck.getCurrentSourceSample();
    const newSample = Math.max(0, currentSample + sampleOffset);
    slaveDeck.seek(newSample);
  }

  public matchSlaveTempoToMaster(): { matchedBpm: number; multiplier: number } | null {
    const masterDeck = this.getMasterDeckId() === 'A' ? this.deckA : this.deckB;
    const slaveDeck = this.getMasterDeckId() === 'A' ? this.deckB : this.deckA;

    const masterTrack = masterDeck.getTrack();
    const slaveTrack = slaveDeck.getTrack();
    if (!masterTrack || !slaveTrack) return null;

    masterDeck.updateCurrentPosition();
    slaveDeck.updateCurrentPosition();

    const masterTelemetry = masterDeck.getTelemetry();
    const masterBpm =
      masterTelemetry.effectiveBpm > 20
        ? masterTelemetry.effectiveBpm
        : masterTrack.bpm;
    const slaveBpm = slaveTrack.bpm;

    const tempo = this.vdj8StyleSyncEngine.matchTempoFamily(masterBpm, slaveBpm);
    slaveDeck.setTempoFamilyLock(tempo.playbackMultiplier);
    slaveDeck.setBaseTempoMultiplier(tempo.playbackMultiplier);
    slaveDeck.setSync(true);

    return {
      matchedBpm: tempo.equivalentSlaveBpm,
      multiplier: tempo.playbackMultiplier
    };
  }

  public triggerLegacyDefectiveSlaveStart(): SlaveStartPlan | null {
    return super.triggerBeatPerfectSlaveStart('beat');
  }

  public override dispose(): void {
    this.audioLooperEngine.stop();
    super.dispose();
  }
}
