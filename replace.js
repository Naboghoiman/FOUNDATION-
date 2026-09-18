const fs = require('fs');
let code = fs.readFileSync('src/audio/djMasterController.ts', 'utf8');
const search = `  public override triggerBeatPerfectSlaveStart(
    quantizeMode: 'beat' | 'bar' = 'beat'
  ): SlaveStartPlan | null {`;

const endSearch = `    this.vdj8LastSlaveStartPlan = plan;
    return plan;
  }`;

const startIndex = code.indexOf(search);
const endIndex = code.indexOf(endSearch, startIndex) + endSearch.length;

if (startIndex === -1 || endIndex < search.length) {
    console.log("Could not find the function block");
    process.exit(1);
}

const replacement = `  public override triggerBeatPerfectSlaveStart(
    quantizeMode: 'beat' | 'bar' = 'beat'
  ): SlaveStartPlan | null {
    const masterDeck = this.getMasterDeckId() === 'A' ? this.deckA : this.deckB;
    const slaveDeck = this.getMasterDeckId() === 'A' ? this.deckB : this.deckA;

    const masterTrack = masterDeck.getTrack();
    const slaveTrack = slaveDeck.getTrack();
    if (!masterTrack || !slaveTrack) return null;

    masterDeck.updateCurrentPosition();
    slaveDeck.updateCurrentPosition();
    const masterTelemetry = masterDeck.getTelemetry();

    if (!masterTelemetry.isPlaying) {
      slaveDeck.setTempoFamilyLock(null);
      const fallback = super.triggerBeatPerfectSlaveStart(quantizeMode);
      this.vdj8LastSlaveStartPlan = null;
      return fallback;
    }

    const wrapperMaster = new DiscDjDeckWrapper(masterDeck as DjDeck);
    const wrapperSlave = new DiscDjDeckWrapper(slaveDeck as DjDeck);

    const audioBufferFrames = (this.audioCtx.baseLatency || (128 / this.audioCtx.sampleRate)) * this.audioCtx.sampleRate;
    
    discDjStyleSync(0, wrapperSlave, wrapperMaster, audioBufferFrames, this.audioCtx.sampleRate);

    const targetMultiplier = slaveDeck.getBaseTempoMultiplier();
    const effectiveRange = slaveDeck.getPitchRange();
    if (Number.isFinite(effectiveRange) && Math.abs(effectiveRange) > 1e-6) {
      const pitchPct = (targetMultiplier - 1.0) / effectiveRange;
      slaveDeck.setPitchPercentage(Math.max(-1.0, Math.min(1.0, pitchPct)));
    }

    slaveDeck.setSync(true);
    this.syncEngine.resetController();
    this.masavuPhaseController.reset();
    this.vdj8LastSlaveStartPlan = null;
    return null;
  }`;

code = code.slice(0, startIndex) + replacement + code.slice(endIndex);
fs.writeFileSync('src/audio/djMasterController.ts', code);
console.log("Replaced successfully");
