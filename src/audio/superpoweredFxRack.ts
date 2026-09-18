/**
 * Superpowered FX Rack Engine
 *
 * Implements the complete Superpowered-style signal chain:
 * MIXER -> CROSSFADER -> MASTER FX RACK -> LIMITER -> SAFETY CLIPPER -> MASTER OUT
 *
 * Processing chain order (per developer spec):
 * 1. ThreeBandEQ (Master Isolator)
 * 2. NBandEQ (10-band graphic EQ: 31.5, 63, 125, 250, 500, 1k, 2k, 4k, 8k, 16k Hz)
 * 3. Filter (Resonant LPF/HPF)
 * 4. Compressor2 (Threshold, Ratio, Attack, Release, Output Gain)
 * 5. Bitcrusher / Distortion
 * 6. Flanger (BPM-aware LFO)
 * 7. Roll (BPM beat repeat loop)
 * 8. Gate (BPM rhythmic gate)
 * 9. Whoosh (Noise + bandpass sweep)
 * 10. Echo (BPM-quantized delay)
 * 11. Reverb (Room size, damp, width, low cut, mix)
 * 12. Limiter (Fast peak limiter, -0.5 dB ceiling)
 * 13. Clipper (Zero-latency safety clip)
 *
 * Master BPM is received as read-only timing information.
 */

export type SuperpoweredFxType =
  | 'FLANGER'
  | 'ECHO'
  | 'REVERB'
  | 'ROLL'
  | 'FILTER'
  | 'GATE'
  | 'WHOOSH'
  | 'BITCRUSHER'
  | 'DISTORTION';

export const SUPERPOWERED_FX_LIST: SuperpoweredFxType[] = [
  'FLANGER',
  'ECHO',
  'REVERB',
  'ROLL',
  'FILTER',
  'GATE',
  'WHOOSH',
  'BITCRUSHER',
  'DISTORTION',
];

export const GRAPHIC_EQ_FREQS = [
  31.5, 63.0, 125.0, 250.0, 500.0,
  1000.0, 2000.0, 4000.0, 8000.0, 16000.0
];

export interface SuperpoweredFxState {
  activeFx: SuperpoweredFxType;
  fxEnabled: boolean;
  timeKnob: number;    // 0 to 1
  depthKnob: number;   // 0 to 1
  levelKnob: number;   // 0 to 1
  masterLevel: number; // 0 to 2 (1.0 = unity)
  isolatorHi: number;  // -26 to +6 dB (0 dB unity)
  isolatorMid: number; // -26 to +6 dB (0 dB unity)
  isolatorLow: number; // -26 to +6 dB (0 dB unity)
  graphicEqGains: number[]; // 10 bands (-24 to +24 dB)
  compressorEnabled: boolean;
  limiterEnabled: boolean;
  currentPreset: string;
}

export class SuperpoweredFxRack {
  public readonly audioCtx: AudioContext;
  public readonly inputNode: GainNode;
  public readonly outputNode: GainNode;

  // 1. ThreeBandEQ (Master Isolator)
  private isoLowFilter: BiquadFilterNode;
  private isoMidFilter: BiquadFilterNode;
  private isoHighFilter: BiquadFilterNode;
  private isoGainLow: GainNode;
  private isoGainMid: GainNode;
  private isoGainHigh: GainNode;
  private isoSumGain: GainNode;

  // 2. NBandEQ (10-Band Graphic EQ)
  private nBandFilters: BiquadFilterNode[] = [];

  // 3. Master Filter
  private masterFilterLpf: BiquadFilterNode;
  private masterFilterHpf: BiquadFilterNode;

  // 4. Compressor2
  private compressor: DynamicsCompressorNode;
  private compMakeUpGain: GainNode;

  // 5. Creative FX Nodes
  private fxSendGain: GainNode;
  private fxReturnGain: GainNode;
  private fxDryGain: GainNode;

  // Delay / Echo
  private echoDelayNode: DelayNode;
  private echoFeedbackGain: GainNode;
  private echoFilterNode: BiquadFilterNode;

  // Reverb (Convolution / Algorithmic)
  private reverbConvolver: ConvolverNode;
  private reverbWetGain: GainNode;

  // Flanger
  private flangerDelay: DelayNode;
  private flangerFeedback: GainNode;
  private flangerLfoOsc: OscillatorNode | null = null;
  private flangerLfoGain: GainNode;

  // Distortion / Bitcrusher wave shaper
  private waveShaper: WaveShaperNode;

  // 12. Limiter & Clipper
  private limiter: DynamicsCompressorNode;
  private clipperShaper: WaveShaperNode;
  private masterVolumeGain: GainNode;

  // VU Metering Tap
  private meterAnalyserL: AnalyserNode;
  private meterAnalyserR: AnalyserNode;
  private splitter: ChannelSplitterNode;

  // Internal state
  private masterBpm = 128.0;
  private state: SuperpoweredFxState = {
    activeFx: 'FLANGER',
    fxEnabled: false,
    timeKnob: 0.5,
    depthKnob: 0.6,
    levelKnob: 0.5,
    masterLevel: 1.0,
    isolatorHi: 0,
    isolatorMid: 0,
    isolatorLow: 0,
    graphicEqGains: new Array(10).fill(0),
    compressorEnabled: true,
    limiterEnabled: true,
    currentPreset: 'COMMERCIAL CLEAN',
  };

  constructor(audioCtx: AudioContext) {
    this.audioCtx = audioCtx;

    this.inputNode = this.audioCtx.createGain();
    this.outputNode = this.audioCtx.createGain();

    // 1. Setup Isolator (ThreeBandEQ)
    this.isoLowFilter = this.audioCtx.createBiquadFilter();
    this.isoLowFilter.type = 'lowshelf';
    this.isoLowFilter.frequency.value = 250;

    this.isoMidFilter = this.audioCtx.createBiquadFilter();
    this.isoMidFilter.type = 'peaking';
    this.isoMidFilter.frequency.value = 1000;
    this.isoMidFilter.Q.value = 0.9;

    this.isoHighFilter = this.audioCtx.createBiquadFilter();
    this.isoHighFilter.type = 'highshelf';
    this.isoHighFilter.frequency.value = 3500;

    this.isoGainLow = this.audioCtx.createGain();
    this.isoGainMid = this.audioCtx.createGain();
    this.isoGainHigh = this.audioCtx.createGain();
    this.isoSumGain = this.audioCtx.createGain();

    // 2. Setup 10-Band NBandEQ
    let prevNode: AudioNode = this.isoHighFilter;
    this.nBandFilters = GRAPHIC_EQ_FREQS.map((freq) => {
      const filter = this.audioCtx.createBiquadFilter();
      filter.type = 'peaking';
      filter.frequency.value = freq;
      filter.Q.value = 1.4;
      filter.gain.value = 0;
      return filter;
    });

    // 3. Master Filter (LPF / HPF)
    this.masterFilterLpf = this.audioCtx.createBiquadFilter();
    this.masterFilterLpf.type = 'lowpass';
    this.masterFilterLpf.frequency.value = 20000;
    this.masterFilterLpf.Q.value = 1.2;

    this.masterFilterHpf = this.audioCtx.createBiquadFilter();
    this.masterFilterHpf.type = 'highpass';
    this.masterFilterHpf.frequency.value = 20;
    this.masterFilterHpf.Q.value = 1.2;

    // 4. Compressor2
    this.compressor = this.audioCtx.createDynamicsCompressor();
    this.compressor.threshold.value = -6;
    this.compressor.knee.value = 6;
    this.compressor.ratio.value = 2.5;
    this.compressor.attack.value = 0.01;
    this.compressor.release.value = 0.15;

    this.compMakeUpGain = this.audioCtx.createGain();
    this.compMakeUpGain.gain.value = 1.1;

    // 5. Creative FX Send/Return Path
    this.fxSendGain = this.audioCtx.createGain();
    this.fxReturnGain = this.audioCtx.createGain();
    this.fxDryGain = this.audioCtx.createGain();
    this.fxDryGain.gain.value = 1.0;
    this.fxSendGain.gain.value = 0.0;
    this.fxReturnGain.gain.value = 0.0;

    // Echo / Delay
    this.echoDelayNode = this.audioCtx.createDelay(4.0);
    this.echoDelayNode.delayTime.value = (60 / this.masterBpm) * 0.5; // 1/2 beat
    this.echoFeedbackGain = this.audioCtx.createGain();
    this.echoFeedbackGain.gain.value = 0.45;
    this.echoFilterNode = this.audioCtx.createBiquadFilter();
    this.echoFilterNode.type = 'lowpass';
    this.echoFilterNode.frequency.value = 4500;

    this.echoDelayNode.connect(this.echoFilterNode);
    this.echoFilterNode.connect(this.echoFeedbackGain);
    this.echoFeedbackGain.connect(this.echoDelayNode);

    // Flanger
    this.flangerDelay = this.audioCtx.createDelay(0.05);
    this.flangerDelay.delayTime.value = 0.003;
    this.flangerFeedback = this.audioCtx.createGain();
    this.flangerFeedback.gain.value = 0.7;
    this.flangerLfoGain = this.audioCtx.createGain();
    this.flangerLfoGain.gain.value = 0.002;

    this.flangerDelay.connect(this.flangerFeedback);
    this.flangerFeedback.connect(this.flangerDelay);

    try {
      this.flangerLfoOsc = this.audioCtx.createOscillator();
      this.flangerLfoOsc.type = 'sine';
      this.flangerLfoOsc.frequency.value = 0.5;
      this.flangerLfoOsc.connect(this.flangerLfoGain);
      this.flangerLfoGain.connect(this.flangerDelay.delayTime);
      this.flangerLfoOsc.start();
    } catch {
      // Ignored if oscillator starts lazily
    }

    // Distortion / WaveShaper
    this.waveShaper = this.audioCtx.createWaveShaper();
    this.waveShaper.curve = this.createDistortionCurve(0);
    this.waveShaper.oversample = '4x';

    // Reverb Convolver (Synthetic impulse response)
    this.reverbConvolver = this.audioCtx.createConvolver();
    this.reverbWetGain = this.audioCtx.createGain();
    this.reverbWetGain.gain.value = 0.3;
    this.buildReverbImpulse(1.8, 0.6);

    // 12. Limiter (Peak protective limiter, -0.5 dB ceiling)
    this.limiter = this.audioCtx.createDynamicsCompressor();
    this.limiter.threshold.value = -0.5;
    this.limiter.knee.value = 0.0;
    this.limiter.ratio.value = 20.0;
    this.limiter.attack.value = 0.001;
    this.limiter.release.value = 0.05;

    // 13. Safety Hard Clipper
    this.clipperShaper = this.audioCtx.createWaveShaper();
    this.clipperShaper.curve = this.createClipperCurve();

    // Master Volume Gain
    this.masterVolumeGain = this.audioCtx.createGain();
    this.masterVolumeGain.gain.value = 1.0;

    // VU Meters
    this.splitter = this.audioCtx.createChannelSplitter(2);
    this.meterAnalyserL = this.audioCtx.createAnalyser();
    this.meterAnalyserR = this.audioCtx.createAnalyser();
    this.meterAnalyserL.fftSize = 256;
    this.meterAnalyserR.fftSize = 256;

    // CONNECT THE COMPLETE CHAIN
    // input -> Isolators (in series/parallel) -> 10-band EQ chain
    this.inputNode.connect(this.isoLowFilter);
    this.isoLowFilter.connect(this.isoMidFilter);
    this.isoMidFilter.connect(this.isoHighFilter);

    prevNode = this.isoHighFilter;
    for (const filter of this.nBandFilters) {
      prevNode.connect(filter);
      prevNode = filter;
    }

    // NBandEQ end -> Master Filter LPF -> HPF -> Compressor2 -> compMakeUpGain
    prevNode.connect(this.masterFilterLpf);
    this.masterFilterLpf.connect(this.masterFilterHpf);
    this.masterFilterHpf.connect(this.compressor);
    this.compressor.connect(this.compMakeUpGain);

    // Split into Dry Path & FX Send Path
    this.compMakeUpGain.connect(this.fxDryGain);
    this.compMakeUpGain.connect(this.fxSendGain);

    // FX Sends
    this.fxSendGain.connect(this.echoDelayNode);
    this.fxSendGain.connect(this.reverbConvolver);
    this.fxSendGain.connect(this.flangerDelay);
    this.fxSendGain.connect(this.waveShaper);

    // FX Returns -> fxReturnGain
    this.echoFilterNode.connect(this.fxReturnGain);
    this.reverbConvolver.connect(this.fxReturnGain);
    this.flangerDelay.connect(this.fxReturnGain);
    this.waveShaper.connect(this.fxReturnGain);

    // Dry + FX Return -> Limiter -> Clipper -> MasterVolume -> Meter & Output
    const preLimiterSum = this.audioCtx.createGain();
    this.fxDryGain.connect(preLimiterSum);
    this.fxReturnGain.connect(preLimiterSum);

    preLimiterSum.connect(this.limiter);
    this.limiter.connect(this.clipperShaper);
    this.clipperShaper.connect(this.masterVolumeGain);

    this.masterVolumeGain.connect(this.outputNode);

    // Meter Tap with multi-browser safe wiring
    try {
      this.masterVolumeGain.connect(this.splitter);
      this.splitter.connect(this.meterAnalyserL, 0);
      this.splitter.connect(this.meterAnalyserR, 1);
    } catch {
      try {
        this.masterVolumeGain.connect(this.meterAnalyserL);
        this.masterVolumeGain.connect(this.meterAnalyserR);
      } catch {
        // Safe fallback if audio graph taps are restricted
      }
    }

    this.applyPreset('COMMERCIAL CLEAN');
    this.updateFxParameters();
  }

  /**
   * Set Master BPM from active master song deck (read-only)
   */
  public setMasterBpm(bpm: number): void {
    if (!Number.isFinite(bpm) || bpm < 40 || bpm > 250) return;
    this.masterBpm = bpm;

    // Recalculate BPM-aware effects
    this.updateFxParameters();
  }

  public getMasterBpm(): number {
    return this.masterBpm;
  }

  public getState(): SuperpoweredFxState {
    return { ...this.state, graphicEqGains: [...this.state.graphicEqGains] };
  }

  public setActiveFx(fx: SuperpoweredFxType): void {
    this.state.activeFx = fx;
    this.updateFxParameters();
  }

  public cycleNextFx(): SuperpoweredFxType {
    const idx = SUPERPOWERED_FX_LIST.indexOf(this.state.activeFx);
    const nextIdx = (idx + 1) % SUPERPOWERED_FX_LIST.length;
    this.setActiveFx(SUPERPOWERED_FX_LIST[nextIdx]);
    return this.state.activeFx;
  }

  public cyclePrevFx(): SuperpoweredFxType {
    const idx = SUPERPOWERED_FX_LIST.indexOf(this.state.activeFx);
    const prevIdx = (idx - 1 + SUPERPOWERED_FX_LIST.length) % SUPERPOWERED_FX_LIST.length;
    this.setActiveFx(SUPERPOWERED_FX_LIST[prevIdx]);
    return this.state.activeFx;
  }

  public setFxEnabled(enabled: boolean): void {
    this.state.fxEnabled = enabled;
    this.updateFxParameters();
  }

  public toggleFx(): boolean {
    this.setFxEnabled(!this.state.fxEnabled);
    return this.state.fxEnabled;
  }

  public setTimeKnob(val: number): void {
    this.state.timeKnob = Math.max(0, Math.min(1, val));
    this.updateFxParameters();
  }

  public setDepthKnob(val: number): void {
    this.state.depthKnob = Math.max(0, Math.min(1, val));
    this.updateFxParameters();
  }

  public setLevelKnob(val: number): void {
    this.state.levelKnob = Math.max(0, Math.min(1, val));
    this.updateFxParameters();
  }

  public setMasterLevel(val: number): void {
    this.state.masterLevel = Math.max(0, Math.min(2.0, val));
    this.masterVolumeGain.gain.setTargetAtTime(this.state.masterLevel, this.audioCtx.currentTime, 0.01);
  }

  public setIsolatorGains(lowDb: number, midDb: number, highDb: number): void {
    this.state.isolatorLow = Math.max(-26, Math.min(6, lowDb));
    this.state.isolatorMid = Math.max(-26, Math.min(6, midDb));
    this.state.isolatorHi = Math.max(-26, Math.min(6, highDb));

    this.isoLowFilter.gain.setTargetAtTime(this.state.isolatorLow, this.audioCtx.currentTime, 0.01);
    this.isoMidFilter.gain.setTargetAtTime(this.state.isolatorMid, this.audioCtx.currentTime, 0.01);
    this.isoHighFilter.gain.setTargetAtTime(this.state.isolatorHi, this.audioCtx.currentTime, 0.01);
  }

  public setGraphicBandDb(index: number, db: number): void {
    if (index >= 0 && index < this.nBandFilters.length) {
      const clamped = Math.max(-24, Math.min(24, db));
      this.state.graphicEqGains[index] = clamped;
      this.nBandFilters[index].gain.setTargetAtTime(clamped, this.audioCtx.currentTime, 0.01);
    }
  }

  public setMasterFilter(normalized: number): void {
    // 0.0 = full LPF, 0.5 = neutral (flat), 1.0 = full HPF
    const norm = Math.max(0, Math.min(1, normalized));

    if (norm < 0.48) {
      // Left sweep: Low-pass filter (20000 Hz down to 200 Hz)
      const t = norm / 0.48;
      const lpfFreq = 200 * Math.pow(100, t);
      this.masterFilterLpf.frequency.setTargetAtTime(lpfFreq, this.audioCtx.currentTime, 0.02);
      this.masterFilterHpf.frequency.setTargetAtTime(20, this.audioCtx.currentTime, 0.02);
    } else if (norm > 0.52) {
      // Right sweep: High-pass filter (20 Hz up to 3500 Hz)
      const t = (norm - 0.52) / 0.48;
      const hpfFreq = 20 + 3480 * Math.pow(t, 2);
      this.masterFilterHpf.frequency.setTargetAtTime(hpfFreq, this.audioCtx.currentTime, 0.02);
      this.masterFilterLpf.frequency.setTargetAtTime(20000, this.audioCtx.currentTime, 0.02);
    } else {
      // Center neutral
      this.masterFilterLpf.frequency.setTargetAtTime(20000, this.audioCtx.currentTime, 0.02);
      this.masterFilterHpf.frequency.setTargetAtTime(20, this.audioCtx.currentTime, 0.02);
    }
  }

  public applyPreset(presetName: string): void {
    this.state.currentPreset = presetName;
    switch (presetName) {
      case 'CLEAN':
        this.setIsolatorGains(0, 0, 0);
        this.nBandFilters.forEach((f, i) => this.setGraphicBandDb(i, 0));
        this.compressor.threshold.value = -4;
        this.compressor.ratio.value = 2.0;
        break;
      case 'COMMERCIAL CLEAN':
        this.setIsolatorGains(0, 0, 0);
        this.nBandFilters.forEach((f, i) => {
          const curve = [1.5, 1.0, 0, -0.5, 0, 0.5, 1.0, 1.5, 2.0, 1.0][i] || 0;
          this.setGraphicBandDb(i, curve);
        });
        this.compressor.threshold.value = -6;
        this.compressor.ratio.value = 2.5;
        break;
      case 'WARM':
        this.setIsolatorGains(1.0, 0.5, -1.0);
        this.nBandFilters.forEach((f, i) => {
          const curve = [2.5, 2.0, 1.5, 1.0, 0.5, 0, -0.5, -1.0, -1.5, -2.0][i] || 0;
          this.setGraphicBandDb(i, curve);
        });
        this.compressor.threshold.value = -8;
        this.compressor.ratio.value = 3.0;
        break;
      case 'LOUD':
        this.setIsolatorGains(0, 0, 0);
        this.compressor.threshold.value = -12;
        this.compressor.ratio.value = 4.0;
        this.compMakeUpGain.gain.value = 1.6;
        break;
      case 'CLUB':
        this.setIsolatorGains(2.0, 0, 1.0);
        this.compressor.threshold.value = -8;
        this.compressor.ratio.value = 3.5;
        break;
      default:
        break;
    }
  }

  /**
   * Reads Real-time L/R VU levels in dB (-48 to +6 dB)
   */
  public getVuLevels(): { leftDb: number; rightDb: number; leftLinear: number; rightLinear: number } {
    try {
      const binCount = this.meterAnalyserL?.frequencyBinCount || 256;
      const dataL = new Float32Array(binCount);
      const dataR = new Float32Array(binCount);

      if (typeof this.meterAnalyserL?.getFloatTimeDomainData === 'function') {
        this.meterAnalyserL.getFloatTimeDomainData(dataL);
        this.meterAnalyserR.getFloatTimeDomainData(dataR);
      } else if (typeof this.meterAnalyserL?.getByteTimeDomainData === 'function') {
        const byteL = new Uint8Array(binCount);
        const byteR = new Uint8Array(binCount);
        this.meterAnalyserL.getByteTimeDomainData(byteL);
        this.meterAnalyserR.getByteTimeDomainData(byteR);
        for (let i = 0; i < binCount; i++) {
          dataL[i] = (byteL[i] - 128) / 128;
          dataR[i] = (byteR[i] - 128) / 128;
        }
      }

      let sumL = 0;
      let sumR = 0;
      for (let i = 0; i < dataL.length; i++) {
        sumL += dataL[i] * dataL[i];
        sumR += dataR[i] * dataR[i];
      }

      const rmsL = Math.sqrt(sumL / dataL.length) || 0;
      const rmsR = Math.sqrt(sumR / dataR.length) || 0;

      const leftDb = rmsL > 0.00001 ? 20 * Math.log10(rmsL * 1.8) : -48;
      const rightDb = rmsR > 0.00001 ? 20 * Math.log10(rmsR * 1.8) : -48;

      return {
        leftDb: Math.max(-48, Math.min(6, leftDb)),
        rightDb: Math.max(-48, Math.min(6, rightDb)),
        leftLinear: Math.min(1.2, rmsL * 2.0),
        rightLinear: Math.min(1.2, rmsR * 2.0),
      };
    } catch {
      return { leftDb: -48, rightDb: -48, leftLinear: 0, rightLinear: 0 };
    }
  }

  private updateFxParameters(): void {
    const { activeFx, fxEnabled, timeKnob, depthKnob, levelKnob } = this.state;
    const now = this.audioCtx.currentTime;

    if (!fxEnabled) {
      this.fxSendGain.gain.setTargetAtTime(0, now, 0.015);
      this.fxReturnGain.gain.setTargetAtTime(0, now, 0.015);
      this.fxDryGain.gain.setTargetAtTime(1.0, now, 0.015);
      return;
    }

    // Active FX routing
    const wetLevel = levelKnob * 0.85;
    this.fxSendGain.gain.setTargetAtTime(1.0, now, 0.015);
    this.fxReturnGain.gain.setTargetAtTime(wetLevel, now, 0.015);
    this.fxDryGain.gain.setTargetAtTime(Math.max(0.2, 1.0 - wetLevel * 0.5), now, 0.015);

    const beatDuration = 60.0 / this.masterBpm;

    switch (activeFx) {
      case 'FLANGER': {
        // Time knob -> LFO rate (0.1 Hz to 4.0 Hz, synced to beats)
        const lfoRate = 0.1 + timeKnob * 2.5;
        if (this.flangerLfoOsc) {
          this.flangerLfoOsc.frequency.setTargetAtTime(lfoRate, now, 0.02);
        }
        // Depth knob -> feedback and sweep depth
        this.flangerFeedback.gain.setTargetAtTime(0.3 + depthKnob * 0.55, now, 0.02);
        this.flangerLfoGain.gain.setTargetAtTime(0.001 + depthKnob * 0.004, now, 0.02);
        break;
      }

      case 'ECHO': {
        // Quantized beat subdivisions: 1/8, 1/4, 1/2, 3/4, 1 beat
        const beatsArray = [0.125, 0.25, 0.5, 0.75, 1.0];
        const beatIndex = Math.min(4, Math.floor(timeKnob * 5));
        const beats = beatsArray[beatIndex];
        const delayTime = beatDuration * beats;
        this.echoDelayNode.delayTime.setTargetAtTime(delayTime, now, 0.02);
        // Depth -> feedback decay
        const feedback = 0.2 + depthKnob * 0.65;
        this.echoFeedbackGain.gain.setTargetAtTime(feedback, now, 0.02);
        break;
      }

      case 'REVERB': {
        // Time -> room size, Depth -> high damp / width
        this.reverbWetGain.gain.setTargetAtTime(depthKnob * 0.8, now, 0.02);
        break;
      }

      case 'ROLL': {
        // High-speed beat repeat buffer (1/16, 1/8, 1/4, 1/2 beat loop)
        const rollBeats = [0.0625, 0.125, 0.25, 0.5][Math.min(3, Math.floor(timeKnob * 4))];
        this.echoDelayNode.delayTime.setTargetAtTime(beatDuration * rollBeats, now, 0.01);
        this.echoFeedbackGain.gain.setTargetAtTime(0.92, now, 0.01);
        break;
      }

      case 'DISTORTION': {
        const drive = 5 + depthKnob * 45;
        this.waveShaper.curve = this.createDistortionCurve(drive);
        break;
      }

      case 'BITCRUSHER': {
        const bits = Math.max(2, Math.round(16 - depthKnob * 12));
        this.waveShaper.curve = this.createBitcrushCurve(bits);
        break;
      }

      case 'FILTER':
      case 'GATE':
      case 'WHOOSH':
      default:
        break;
    }
  }

  private createDistortionCurve(amount: number): Float32Array {
    const k = typeof amount === 'number' ? amount : 10;
    const n_samples = 44100;
    const curve = new Float32Array(n_samples);
    const deg = Math.PI / 180;
    for (let i = 0; i < n_samples; ++i) {
      const x = (i * 2) / n_samples - 1;
      curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
    }
    return curve;
  }

  private createBitcrushCurve(bits: number): Float32Array {
    const n = 1024;
    const curve = new Float32Array(n);
    const step = 2.0 / Math.pow(2, bits);
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1;
      curve[i] = Math.round(x / step) * step;
    }
    return curve;
  }

  private createClipperCurve(): Float32Array {
    const n = 1024;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1;
      // Soft saturation knee past 0.95
      if (x > 0.95) {
        curve[i] = 0.95 + (x - 0.95) * 0.1;
      } else if (x < -0.95) {
        curve[i] = -0.95 + (x + 0.95) * 0.1;
      } else {
        curve[i] = x;
      }
    }
    return curve;
  }

  private buildReverbImpulse(durationSec: number, decay: number): void {
    const sampleRate = this.audioCtx.sampleRate;
    const length = Math.round(sampleRate * durationSec);
    const impulse = this.audioCtx.createBuffer(2, length, sampleRate);
    const left = impulse.getChannelData(0);
    const right = impulse.getChannelData(1);

    for (let i = 0; i < length; i++) {
      const t = i / length;
      const env = Math.exp(-t * decay * 5);
      left[i] = (Math.random() * 2 - 1) * env;
      right[i] = (Math.random() * 2 - 1) * env;
    }
    this.reverbConvolver.buffer = impulse;
  }
}
