class ImanScratchProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    this.left = null;
    this.right = null;
    this.length = 0;

    this.cursor = 0;
    this.normalRate = 1.0;
    this.scratchRate = 0.0;

    this.playing = false;
    this.scratchActive = false;
    this.loop = true;

    this.port.onmessage = (event) => {
      const m = event.data;

      if (m.type === 'load') {
        this.left = new Float32Array(m.left);
        this.right = m.right
          ? new Float32Array(m.right)
          : this.left;

        this.length = this.left.length;
        this.cursor = Math.max(
          0,
          Math.min(
            this.length - 1,
            m.startFrame || 0
          )
        );
        this.port.postMessage({ type: 'cursor', cursor: this.cursor });
      }

      if (m.type === 'play') {
        this.playing = true;
      }

      if (m.type === 'pause') {
        this.playing = false;
        this.port.postMessage({ type: 'cursor', cursor: this.cursor });
      }

      if (m.type === 'seek') {
        this.cursor = Math.max(
          0,
          Math.min(
            this.length - 1,
            Number(m.frame) || 0
          )
        );
        this.port.postMessage({ type: 'cursor', cursor: this.cursor });
      }

      if (m.type === 'normalRate') {
        const r = Number(m.rate);
        if (Number.isFinite(r)) {
          this.normalRate = r;
        }
      }

      if (m.type === 'scratch') {
        this.scratchActive = !!m.active;

        const r = Number(m.rate);
        this.scratchRate =
          Number.isFinite(r)
            ? r
            : 0;

        this.port.postMessage({ type: 'cursor', cursor: this.cursor });
      }

      if (m.type === 'loop') {
        this.loop = !!m.enabled;
      }

      if (m.type === 'getCursor') {
        this.port.postMessage({ type: 'cursor', cursor: this.cursor });
      }
    };
  }

  readInterpolated(buffer, position) {
    if (!buffer || this.length <= 1) {
      return 0;
    }

    let p = position;

    if (this.loop) {
      p =
        ((p % this.length) + this.length) %
        this.length;
    } else {
      p = Math.max(
        0,
        Math.min(
          this.length - 1,
          p
        )
      );
    }

    const i0 = Math.floor(p);
    const i1 =
      this.loop
        ? (i0 + 1) % this.length
        : Math.min(
            this.length - 1,
            i0 + 1
          );

    const frac = p - i0;

    return (
      buffer[i0] * (1 - frac) +
      buffer[i1] * frac
    );
  }

  process(_inputs, outputs) {
    const out = outputs[0];

    if (
      !out ||
      out.length === 0
    ) {
      return true;
    }

    const leftOut = out[0];
    const rightOut =
      out.length > 1
        ? out[1]
        : leftOut;

    for (
      let i = 0;
      i < leftOut.length;
      i++
    ) {
      if (
        !this.playing ||
        !this.left ||
        this.length <= 1
      ) {
        leftOut[i] = 0;
        rightOut[i] = 0;
        continue;
      }

      const rate =
        this.scratchActive
          ? this.scratchRate
          : this.normalRate;

      const l =
        this.readInterpolated(
          this.left,
          this.cursor
        );

      const r =
        this.readInterpolated(
          this.right,
          this.cursor
        );

      leftOut[i] = l;
      rightOut[i] = r;

      this.cursor += rate;

      if (this.loop) {
        while (this.cursor < 0) {
          this.cursor += this.length;
        }

        while (this.cursor >= this.length) {
          this.cursor -= this.length;
        }
      } else {
        if (this.cursor < 0) {
          this.cursor = 0;
          this.playing = false;
        }

        if (this.cursor >= this.length) {
          this.cursor = this.length - 1;
          this.playing = false;
        }
      }
    }

    return true;
  }
}

registerProcessor(
  'iman-scratch-processor',
  ImanScratchProcessor
);
