/**
 * Clean-room reconstruction of verified DiscDJ native sync algorithm.
 *
 * Implements:
 * - Tempo family matching via multiplicativeDistance
 * - 4-beat bar boundary projection via nextFourBeatBoundary
 * - 0.3-cycle target thresholding rule
 * - Direction 0 (deckC master, deckT follower) and Direction 1 (deckT master, deckC follower)
 * - Zero buffer latency compensation in Web Audio (hardware clock parity)
 */

export interface DiscDjDeck {
  originalBpm: number;
  beatPeriod: number;
  beatStart: number;
  getSpeed: () => number;
  setSpeed: (speed: number) => void;
  getCurrentPosition: () => number;
  seekTo: (positionSeconds: number) => void;
  isPlaying: () => boolean;
  start: () => void;
  setResetSpeedFlag: (enabled: boolean) => void;
}

export function multiplicativeDistance(a: number, b: number): number {
  if (a <= 0.0 || b <= 0.0) return Infinity;
  return a > b ? a / b : b / a;
}

export function nextFourBeatBoundary(
  currentPosition: number,
  beatStart: number,
  sourceCycle: number
): number {
  if (sourceCycle <= 0.0) return currentPosition;

  const relative = currentPosition - beatStart;
  let remainder = relative % sourceCycle;

  // Normalise negative remainder if ever required
  if (remainder < 0.0) remainder += sourceCycle;

  // Reconstruct explicitly from the anchor
  const cycles = Math.floor((currentPosition - beatStart) / sourceCycle);
  let boundary = beatStart + cycles * sourceCycle;

  while (boundary < currentPosition) {
    boundary += sourceCycle;
  }

  return boundary;
}

export function chooseTempoFamily(
  referenceEffectiveBpm: number,
  followerEffectiveBpm: number
): number {
  const candidates = [
    referenceEffectiveBpm * 0.5,
    referenceEffectiveBpm,
    referenceEffectiveBpm * 2.0
  ];

  let selected = candidates[0];
  let bestDistance = multiplicativeDistance(selected, followerEffectiveBpm);

  for (let i = 1; i < 3; ++i) {
    const distance = multiplicativeDistance(candidates[i], followerEffectiveBpm);
    if (distance < bestDistance) {
      bestDistance = distance;
      selected = candidates[i];
    }
  }

  return selected;
}

export function foldFollowerSpeed(speed: number): number {
  let s = speed;
  if (s < 0.5) s *= 2.0;
  if (s > 2.0) s /= 2.0;
  return s;
}

/**
 * discDjStyleSync
 *
 * direction == 0:
 *   deckC = master/reference
 *   deckT = follower
 *
 * direction == 1:
 *   deckT = master/reference
 *   deckC = follower
 */
export function discDjStyleSync(
  direction: number,
  deckT: DiscDjDeck,
  deckC: DiscDjDeck,
  audioBufferFrames: number,
  sampleRate: number
): boolean {
  if (deckT.originalBpm <= 0.0 || deckC.originalBpm <= 0.0) {
    return false;
  }

  // DiscDJ resetSpeedNative(..., false)
  deckT.setResetSpeedFlag(false);
  deckC.setResetSpeedFlag(false);

  let master: DiscDjDeck;
  let follower: DiscDjDeck;

  if (direction === 0) {
    master = deckC;
    follower = deckT;
  } else {
    master = deckT;
    follower = deckC;
  }

  const masterEffective = master.originalBpm * master.getSpeed();
  const followerEffective = follower.originalBpm * follower.getSpeed();

  const selectedEffectiveTempo = chooseTempoFamily(
    masterEffective,
    followerEffective
  );

  let targetFollowerSpeed = selectedEffectiveTempo / follower.originalBpm;
  targetFollowerSpeed = foldFollowerSpeed(targetFollowerSpeed);
  follower.setSpeed(targetFollowerSpeed);

  if (deckT.beatPeriod <= 0.0 || deckC.beatPeriod <= 0.0) {
    return true;
  }

  const speedT = deckT.getSpeed();
  const speedC = deckC.getSpeed();

  const realCycleT = (4.0 * deckT.beatPeriod) / speedT;
  const realCycleC = (4.0 * deckC.beatPeriod) / speedC;

  const commonRealCycle = Math.max(realCycleT, realCycleC);

  const cycleTSource = commonRealCycle * speedT;
  const cycleCSource = commonRealCycle * speedC;

  const posT = deckT.getCurrentPosition();
  const posC = deckC.getCurrentPosition();

  const nextT = nextFourBeatBoundary(posT, deckT.beatStart, cycleTSource);
  const nextC = nextFourBeatBoundary(posC, deckC.beatStart, cycleCSource);

  const deltaT = nextT - posT;
  const deltaC = nextC - posC;

  if (sampleRate <= 0.0) {
    throw new Error('sampleRate must be > 0');
  }

  const bufferTerm = audioBufferFrames / sampleRate;

  if (direction === 0) {
    // deckT is follower, deckC is master
    const followerRealRemaining = (deltaT + bufferTerm) / speedT;
    const masterRealRemaining = deltaC / speedC;

    const realTimingDifference = followerRealRemaining - masterRealRemaining;
    let targetT = posT + realTimingDifference * speedT;

    // Verified DiscDJ 0.3-cycle rule
    if (targetT < posT && targetT < posT - 0.3 * cycleTSource) {
      targetT += cycleTSource;
    }

    if (targetT < 0.0) {
      targetT += cycleTSource;
    }

    deckT.seekTo(targetT);

    if (deckC.isPlaying() && !deckT.isPlaying()) {
      deckT.start();
    }
  } else {
    // deckC is follower, deckT is master
    const followerRealRemaining = (deltaC + bufferTerm) / speedC;
    const masterRealRemaining = deltaT / speedT;

    const realTimingDifference = followerRealRemaining - masterRealRemaining;
    let targetC = posC + realTimingDifference * speedC;

    // Verified DiscDJ 0.3-cycle rule
    if (targetC < posC && targetC < posC - 0.3 * cycleCSource) {
      targetC += cycleCSource;
    }

    if (targetC < 0.0) {
      targetC += cycleCSource;
    }

    deckC.seekTo(targetC);

    if (deckT.isPlaying() && !deckC.isPlaying()) {
      deckC.start();
    }
  }

  return true;
}
