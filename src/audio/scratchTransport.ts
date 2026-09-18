/**
 * OMWELU Scratch Transport Controller
 *
 * Implements a dedicated AudioWorklet-based scratch transport capable of
 * continuous forward, reverse, hold, and variable velocity scratching
 * without recreating AudioBufferSourceNode or causing audio dropouts.
 */

let moduleLoadPromise: Promise<void> | null = null;

function loadWorkletModule(ctx: AudioContext): Promise<void> {
  if (!moduleLoadPromise) {
    moduleLoadPromise = ctx.audioWorklet.addModule('/audio/iman-scratch-processor.js');
  }
  return moduleLoadPromise;
}

export class ScratchTransport {
  private audioCtx: AudioContext;
  private destinationNode: AudioNode;
  private workletNode: AudioWorkletNode | null = null;
  private rampGainNode: GainNode;
  private ready = false;
  private playing = false;
  private scratchActive = false;
  private normalRate = 1.0;
  private scratchRate = 0.0;
  private currentCursor = 0;
  private bufferLength = 0;

  // Stored in case loadTrack is called before initialize finishes
  private pendingBuffer: AudioBuffer | null = null;
  private pendingStartFrame = 0;

  constructor(audioCtx: AudioContext, destinationNode: AudioNode) {
    this.audioCtx = audioCtx;
    this.destinationNode = destinationNode;
    this.rampGainNode = this.audioCtx.createGain();
    this.rampGainNode.gain.value = 1.0;
    this.rampGainNode.connect(this.destinationNode);
  }

  public async initialize(): Promise<void> {
    try {
      await loadWorkletModule(this.audioCtx);
      this.workletNode = new AudioWorkletNode(this.audioCtx, 'iman-scratch-processor', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });

      this.workletNode.port.onmessage = (event) => {
        if (event.data?.type === 'cursor') {
          const c = Number(event.data.cursor);
          if (Number.isFinite(c)) {
            this.currentCursor = c;
          }
        }
      };

      this.workletNode.connect(this.rampGainNode);
      this.ready = true;

      // If a track was queued before worklet loaded, load it now
      if (this.pendingBuffer) {
        this.loadTrack(this.pendingBuffer, this.pendingStartFrame);
        this.pendingBuffer = null;
      }
    } catch (err) {
      console.warn('Failed to initialize AudioWorklet scratch processor:', err);
      this.ready = false;
    }
  }

  public isReady(): boolean {
    return this.ready && this.workletNode !== null;
  }

  public loadTrack(audioBuffer: AudioBuffer, startFrame = 0): void {
    this.bufferLength = audioBuffer.length;
    this.currentCursor = Math.max(0, Math.min(this.bufferLength - 1, startFrame));

    if (!this.workletNode) {
      this.pendingBuffer = audioBuffer;
      this.pendingStartFrame = startFrame;
      return;
    }

    const left = audioBuffer.getChannelData(0);
    const right = audioBuffer.numberOfChannels > 1
      ? audioBuffer.getChannelData(1)
      : left;

    // Slice buffer to prevent detached buffer conflicts
    this.workletNode.port.postMessage({
      type: 'load',
      left: left.slice().buffer,
      right: right !== left ? right.slice().buffer : undefined,
      startFrame: this.currentCursor,
    });
  }

  public play(): void {
    this.playing = true;
    if (this.workletNode) {
      this.workletNode.port.postMessage({ type: 'play' });
    }
  }

  public pause(): void {
    this.playing = false;
    if (this.workletNode) {
      this.workletNode.port.postMessage({ type: 'pause' });
    }
  }

  public seek(frame: number): void {
    const safeFrame = Math.max(0, Math.min(this.bufferLength > 0 ? this.bufferLength - 1 : frame, frame));
    this.currentCursor = safeFrame;
    if (this.workletNode) {
      this.workletNode.port.postMessage({ type: 'seek', frame: safeFrame });
    }
  }

  public setNormalRate(rate: number): void {
    const safeRate = Number.isFinite(rate) ? rate : 1.0;
    this.normalRate = safeRate;
    if (this.workletNode) {
      this.workletNode.port.postMessage({ type: 'normalRate', rate: safeRate });
    }
  }

  public beginScratch(): void {
    this.scratchActive = true;
    this.scratchRate = 0.0;

    // Click/pop protection: 5ms ramp
    const now = this.audioCtx.currentTime;
    try {
      this.rampGainNode.gain.cancelScheduledValues(now);
      this.rampGainNode.gain.setValueAtTime(this.rampGainNode.gain.value, now);
      this.rampGainNode.gain.linearRampToValueAtTime(1.0, now + 0.005);
    } catch {}

    if (this.workletNode) {
      this.workletNode.port.postMessage({
        type: 'scratch',
        active: true,
        rate: 0.0,
      });
    }
  }

  public setScratchRate(rate: number): void {
    const safeRate = Number.isFinite(rate) ? Math.max(-4.0, Math.min(4.0, rate)) : 0.0;
    this.scratchRate = safeRate;
    if (this.workletNode) {
      this.workletNode.port.postMessage({
        type: 'scratch',
        active: true,
        rate: safeRate,
      });
    }
  }

  public endScratch(): void {
    this.scratchActive = false;
    this.scratchRate = 0.0;

    // Click/pop protection: 5ms smooth ramp back to normal
    const now = this.audioCtx.currentTime;
    try {
      this.rampGainNode.gain.cancelScheduledValues(now);
      this.rampGainNode.gain.setValueAtTime(this.rampGainNode.gain.value, now);
      this.rampGainNode.gain.linearRampToValueAtTime(1.0, now + 0.005);
    } catch {}

    if (this.workletNode) {
      this.workletNode.port.postMessage({
        type: 'scratch',
        active: false,
        rate: 0.0,
      });
      this.workletNode.port.postMessage({
        type: 'normalRate',
        rate: this.normalRate,
      });
      this.workletNode.port.postMessage({ type: 'getCursor' });
    }
  }

  public getNode(): AudioWorkletNode | null {
    return this.workletNode;
  }

  public getCursor(): number {
    return this.currentCursor;
  }

  public isScratching(): boolean {
    return this.scratchActive;
  }
}
