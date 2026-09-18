import { DjDeck } from './djDeck';
import { timeStretchWsola } from './wsolaTimeStretch';

export class BeatLoopDeck extends DjDeck {
  private loopStartSample = 0;
  private loopEndSample = 0;
  private loopBeatCount = 4;

  // Cached prepared loop at the target tempo
  private cachedPreparedBuffer: AudioBuffer | null = null;
  private cachedStartSample = -1;
  private cachedEndSample = -1;
  private cachedTempoMultiplier = -1;

  // Prepared loop playback tracking
  private playStartPreparedSec = 0;
  private currentTempoMultiplier = 1.0;
  private dynamicRate = 1.0;
  private bufferRoundingCompensation = 1.0;

  public configureMusicalLoop(
    startSample: number,
    beatCount: number
  ): void {
    const track = this.getTrack();

    if (!track || !track.audioBuffer) {
      return;
    }

    const samplesPerBeat = track.beatGrid.samplesPerBeat;

    if (!Number.isFinite(samplesPerBeat) || samplesPerBeat <= 0) {
      return;
    }

    const allowed = [1, 2, 4, 8, 16, 32];
    const safeBeatCount = allowed.includes(beatCount) ? beatCount : 4;
    const totalSamples = track.audioBuffer.length;

    const safeStart = Math.max(
      0,
      Math.min(totalSamples - 1, Math.round(startSample))
    );

    const requestedEnd = Math.round(
      safeStart + safeBeatCount * samplesPerBeat
    );

    if (requestedEnd > totalSamples) {
      return;
    }

    this.loopStartSample = safeStart;
    this.loopEndSample = requestedEnd;
    this.loopBeatCount = safeBeatCount;

    // Invalidate prepared loop cache when boundaries change
    this.cachedPreparedBuffer = null;
    this.cachedStartSample = -1;
    this.cachedEndSample = -1;
    this.cachedTempoMultiplier = -1;
  }

  public getLoopStartSample(): number {
    return this.loopStartSample;
  }

  public getLoopEndSample(): number {
    return this.loopEndSample;
  }

  public getLoopBeatCount(): number {
    return this.loopBeatCount;
  }

  public isMusicalLoopConfigured(): boolean {
    return this.loopEndSample > this.loopStartSample;
  }

  private wrapIntoLoop(sample: number): number {
    if (!this.isMusicalLoopConfigured()) {
      return sample;
    }

    const length = this.loopEndSample - this.loopStartSample;
    let relative = sample - this.loopStartSample;
    relative = ((relative % length) + length) % length;

    return this.loopStartSample + relative;
  }

  /**
   * Prepares a pitch-preserved AudioBuffer copy of the loop at the target tempo
   * using WSOLA time-stretching with a 5ms click-free boundary crossfade.
   */
  public getOrPrepareLoopBuffer(tempoMultiplier: number): AudioBuffer | null {
    if (!this.track || !this.track.audioBuffer || !this.isMusicalLoopConfigured()) {
      return null;
    }

    const safeMultiplier =
      Number.isFinite(tempoMultiplier) && tempoMultiplier > 0.1 && tempoMultiplier < 4.0
        ? tempoMultiplier
        : 1.0;

    if (
      this.cachedPreparedBuffer &&
      this.cachedStartSample === this.loopStartSample &&
      this.cachedEndSample === this.loopEndSample &&
      Math.abs(this.cachedTempoMultiplier - safeMultiplier) < 0.001
    ) {
      return this.cachedPreparedBuffer;
    }

    const prepared = timeStretchWsola(
      this.audioCtx,
      this.track.audioBuffer,
      this.loopStartSample,
      this.loopEndSample,
      safeMultiplier,
      { boundarySmoothMs: 5 }
    );

    this.cachedPreparedBuffer = prepared;
    this.cachedStartSample = this.loopStartSample;
    this.cachedEndSample = this.loopEndSample;
    this.cachedTempoMultiplier = safeMultiplier;

    return prepared;
  }

  /**
   * Plays the pitch-preserved prepared loop at playbackRate = 1.0, scheduled
   * at targetOutputTime with the phase mapped from plan.slaveSourceSample.
   */
  public playPrepared(
    targetOutputTime: number,
    slaveSourceSample: number,
    tempoMultiplier: number
  ): void {
    if (!this.track || !this.track.audioBuffer) {
      return;
    }

    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }

    const safeMultiplier =
      Number.isFinite(tempoMultiplier) && tempoMultiplier > 0.1 && tempoMultiplier < 4.0
        ? tempoMultiplier
        : 1.0;

    const preparedBuffer = this.getOrPrepareLoopBuffer(safeMultiplier);
    if (!preparedBuffer) {
      return;
    }

    const sourceSampleRate = this.track.sampleRate;

    // Map plan.slaveSourceSample into the prepared loop buffer (Section 9)
    const sourceRelativeSec =
      (slaveSourceSample - this.loopStartSample) / sourceSampleRate;
    let preparedRelativeSec = sourceRelativeSec / safeMultiplier;

    let when = targetOutputTime;

    const now = this.audioCtx.currentTime;
    if (targetOutputTime < now) {
      // If scheduled time was in the slight past due to execution delay,
      // we must compensate the start position inside the prepared buffer.
      const elapsedSec = now - targetOutputTime;
      // Since playback rate of the buffer is strictly 1.0, 
      // the missed time in the prepared buffer is exactly elapsedSec.
      preparedRelativeSec += elapsedSec;
      when = now;
    }

    const preparedDuration = preparedBuffer.duration;
    preparedRelativeSec =
      ((preparedRelativeSec % preparedDuration) + preparedDuration) %
      preparedDuration;

    // Calculate compensation for fractional sample rounding in WSOLA or truncation.
    // This allows the physical AudioBuffer to loop natively without drifting out of sync
    // with the mathematical time grid of the master deck.
    const trueSourceSamples = this.loopBeatCount * this.track.beatGrid.samplesPerBeat;
    const exactTargetSamples = trueSourceSamples / safeMultiplier;
    const actualSamples = preparedBuffer.length;
    this.bufferRoundingCompensation = actualSamples > 0 ? actualSamples / exactTargetSamples : 1.0;

    // Stop active source cleanly
    if (this.sourceNode) {
      try {
        if (when > now + 0.005) {
          this.sourceNode.stop(when);
        } else {
          this.sourceNode.stop();
        }
      } catch {
        // ignore
      }
      this.sourceNode = null;
    }

    // Create fresh BufferSource
    const nextSource = this.audioCtx.createBufferSource();
    nextSource.buffer = preparedBuffer;
    nextSource.loop = true;
    nextSource.loopStart = 0;
    nextSource.loopEnd = preparedDuration;

    // STRICT LOOPER RULE: Apply compensation invisibly to the Web Audio node so it loops perfectly in time
    nextSource.playbackRate.setValueAtTime(this.bufferRoundingCompensation, when);
    nextSource.connect(this.eqLowNode);

    try {
      nextSource.start(when, preparedRelativeSec);
    } catch (err) {
      console.warn('Beat loop start error:', err);
      return;
    }

    this.sourceNode = nextSource;
    this.playStartTime = when;
    this.playStartPreparedSec = preparedRelativeSec;
    this.currentTempoMultiplier = safeMultiplier;
    this.baseTempoMultiplier = safeMultiplier;
    this.currentSourceSample = slaveSourceSample;
    this.dynamicRate = 1.0;

    this.isPlaying = true;
    this.isPaused = false;
  }

  public override play(
    scheduledTime?: number,
    offsetSample?: number
  ): void {
    if (!this.track || !this.track.audioBuffer) {
      return;
    }

    if (!this.isMusicalLoopConfigured()) {
      super.play(scheduledTime, offsetSample);
      return;
    }

    const startTime = scheduledTime ?? this.audioCtx.currentTime;
    const requestedSample = offsetSample ?? this.currentSourceSample;
    const safeSample = this.wrapIntoLoop(requestedSample);

    this.playPrepared(startTime, safeSample, this.baseTempoMultiplier);
  }

  public override syncAlignToMaster(
    targetOutputTime: number,
    slaveSourceSample: number,
    baseTempoMultiplier: number
  ): void {
    this.playPrepared(targetOutputTime, slaveSourceSample, baseTempoMultiplier);
  }

  public override stop(): void {
    this.stopSource();
    this.isPlaying = false;
    this.isPaused = true;
    this.currentSourceSample = this.loopStartSample;
    this.playStartSample = this.loopStartSample;
  }

  public override pause(): void {
    this.updateCurrentPosition();
    this.stopSource();
    this.isPlaying = false;
    this.isPaused = true;
  }

  public override updateCurrentPosition(): void {
    if (!this.isPlaying || !this.track || !this.cachedPreparedBuffer) {
      return;
    }

    const now = this.audioCtx.currentTime;

    if (now < this.playStartTime) {
      return;
    }

    const elapsedSeconds = now - this.playStartTime;
    const loopDuration = this.cachedPreparedBuffer.duration;
    if (loopDuration <= 0) return;

    const currentPreparedSec =
      ((this.playStartPreparedSec + elapsedSeconds * this.dynamicRate) %
        loopDuration +
        loopDuration) %
      loopDuration;

    // Map back to source coordinates for telemetry & sync calculations
    const sourceRelativeSec = currentPreparedSec * this.currentTempoMultiplier;
    
    const sourceSample =
      this.loopStartSample +
      (sourceRelativeSec * this.track.sampleRate);

    this.currentSourceSample = this.wrapIntoLoop(sourceSample);
  }

  public setDynamicPlaybackRate(rate: number): void {
    if (!this.isPlaying || !this.sourceNode || !this.cachedPreparedBuffer) return;
    if (Math.abs(this.dynamicRate - rate) < 0.0001) return;

    const now = this.audioCtx.currentTime;
    
    // Save exactly where we are in the prepared buffer right now
    const elapsedSeconds = Math.max(0, now - this.playStartTime);
    const loopDuration = this.cachedPreparedBuffer.duration;
    
    if (loopDuration > 0) {
      this.playStartPreparedSec =
        ((this.playStartPreparedSec +
          elapsedSeconds * this.dynamicRate * this.bufferRoundingCompensation) %
          loopDuration +
          loopDuration) %
        loopDuration;
    }

    this.dynamicRate = rate;
    this.playStartTime = now;
    
    try {
      this.sourceNode.playbackRate.setValueAtTime(rate, now);
    } catch {
      // guard
    }
  }

  public getDynamicRate(): number {
    return this.dynamicRate;
  }
}
