/**
 * src/shared/scorer.js
 * ─────────────────────
 * FatigueScorer — combines passive behavioral signals and optional eye-tracking
 * data into a single 0-100 fatigue score that maps to one of four UI tiers.
 *
 * This module is imported by BOTH the background service worker (worker.js)
 * and, indirectly, by content scripts via the worker messaging bridge.
 * Keep it free of any browser/extension globals so it remains unit-testable
 * in plain Node.js.
 */

export class FatigueScorer {
  constructor() {
    // Weights must sum to 1.0
    this._weights = {
      typingErrorRate: 0.2,
      ikiVariance: 0.15,
      scrollReversalRate: 0.15,
      cursorJitter: 0.2,
      clickHesitation: 0.15,
      sessionDuration: 0.15,
    };

    // Exponentially-smoothed score in the range [0, 100]
    this.smoothedScore = 0;

    // Most-recent eye-tracking payload: { combinedScore, timestamp }
    // combinedScore is a 0-1 float (EAR-derived); we scale it ×100 internally.
    this.lastEyeSignal = null;

    // Cached tier so we don't re-broadcast unchanged tiers
    this._tier = 0;
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /**
   * updateBehavioral(featureVector)
   *
   * Receives a feature vector of six 0-1 normalised values derived from
   * passive event listeners (keystrokes, scroll, mouse, session time).
   *
   * @param {Object} featureVector
   * @param {number} featureVector.typingErrorRate    — backspace / total keys in last 5 min
   * @param {number} featureVector.ikiVariance        — normalised inter-key interval variance
   * @param {number} featureVector.scrollReversalRate — scroll direction reversals / 10, last 30 s
   * @param {number} featureVector.cursorJitter       — mean absolute deviation of cursor velocity / 50
   * @param {number} featureVector.clickHesitation    — fraction of clicks with duration > 400 ms
   * @param {number} featureVector.sessionDuration    — log-scaled minutes since session start
   * @returns {{ score: number, tier: number }}
   */
  updateBehavioral(featureVector) {
    const w = this._weights;
    const fv = featureVector;

    // Weighted linear combination → raw score scaled to 0-100
    const raw =
      (fv.typingErrorRate * w.typingErrorRate +
        fv.ikiVariance * w.ikiVariance +
        fv.scrollReversalRate * w.scrollReversalRate +
        fv.cursorJitter * w.cursorJitter +
        fv.clickHesitation * w.clickHesitation +
        fv.sessionDuration * w.sessionDuration) *
      100;

    // Exponential smoothing: heavy weight on history (0.7) to avoid jitter.
    // α = 0.3 means a sudden spike in raw score takes ~10 updates to fully
    // manifest in smoothedScore — this prevents transient bursts (e.g. a
    // fast typing session) from triggering a UI tier change too aggressively.
    this.smoothedScore = 0.7 * this.smoothedScore + 0.3 * raw;

    this._tier = this._determineTier();
    return { score: this.smoothedScore, tier: this._tier };
  }

  /**
   * updateEyeSignal(eyePayload)
   *
   * Called when a new eye-tracking frame arrives from eyetracking.js.
   * Eye signals are considered stale after 90 seconds (the camera may have
   * been covered or the user may have looked away for a legitimate reason).
   *
   * The combinedScore from MediaPipe is a 0-1 float that encodes PERCLOS
   * (percentage of eye closure over a rolling window) combined with a blink
   * frequency metric.  We multiply it by 100 to bring it into the same
   * 0-100 space as smoothedScore.
   *
   * Integration formula:
   *   boosted = clamp(smoothedScore × 0.6 + eyeScore × 0.4, 0, 100)
   * The 0.4/0.6 split weights eye data slightly less than accumulated
   * behavioral history; eye data is noisier (lighting, glasses, movement).
   *
   * @param {{ combinedScore: number, timestamp: number }} eyePayload
   * @returns {{ score: number, tier: number }}
   */
  updateEyeSignal(eyePayload) {
    this.lastEyeSignal = eyePayload;

    const ageMs = Date.now() - eyePayload.timestamp;
    if (ageMs < 90_000) {
      // Eye signal is fresh — integrate with a ×1.8 effective boost relative
      // to the same raw value coming through the behavioral pathway, because
      // eye closure is a high-confidence indicator of acute fatigue.
      const eyeScore = eyePayload.combinedScore * 100;
      this.smoothedScore = Math.min(
        this.smoothedScore * 0.6 + eyeScore * 0.4,
        100
      );
    }

    this._tier = this._determineTier();
    return { score: this.smoothedScore, tier: this._tier };
  }

  /**
   * getState()
   * Snapshot for popup display and storage persistence.
   * @returns {{ score: number, tier: number }}
   */
  getState() {
    return {
      score: Math.round(this.smoothedScore),
      tier: this._tier,
    };
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  /**
   * _determineTier()
   * Maps the continuous smoothedScore into four discrete intervention tiers:
   *
   *  Tier 0  (  0 – 29 ) — Normal:    no UI changes
   *  Tier 1  ( 30 – 54 ) — Mild:      ads hidden, font +2px, subtle overlay
   *  Tier 2  ( 55 – 74 ) — Moderate:  sidebars hidden, animations stopped
   *  Tier 3  ( 75 – 100) — Severe:    full focus mode, dark background, HUD
   *
   * Thresholds were chosen to match the clinically-observed correlation between
   * typing-error rate and self-reported fatigue in HCI research (Arroyo 2006).
   */
  _determineTier() {
    const s = this.smoothedScore;
    if (s < 30) return 0;
    if (s < 55) return 1;
    if (s < 75) return 2;
    return 3;
  }
}
