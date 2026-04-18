/**
 * src/content/signals.js
 * ───────────────────────
 * FocusLens passive signal collector — entry point for content.bundle.js.
 *
 * Importing adapter.js and observer.js here ensures that both modules are
 * initialised in the same IIFE execution context as this file.  Rollup will
 * tree-shake them into a single bundle; their module-level side effects
 * (event listeners, DOM injection) run as soon as the bundle executes.
 */

// Side-effect imports — both modules self-initialise on import.
import "./adapter.js";
import "./observer.js";

console.log("[FocusLens] content loaded — signal collector initialising");

// ─────────────────────────────────────────────────────────────────────────────
// CircularBuffer
// ─────────────────────────────────────────────────────────────────────────────
/**
 * A fixed-size ring buffer that overwrites the oldest entry when full.
 * Using a ring buffer instead of a plain array + push/slice avoids GC pressure
 * from constantly creating new arrays — important on pages with high event rates.
 */
class CircularBuffer {
  /**
   * @param {number} size - Maximum number of items to retain
   */
  constructor(size) {
    this._size = size;
    this._buf = new Array(size);
    this._head = 0; // Points to the NEXT write position
    this._count = 0; // Number of valid entries (saturates at size)
  }

  /** Push an item, overwriting the oldest entry when the buffer is full. */
  push(item) {
    this._buf[this._head] = item;
    this._head = (this._head + 1) % this._size;
    if (this._count < this._size) this._count++;
  }

  /**
   * Returns all valid items in chronological order (oldest → newest).
   * Time complexity O(n) with at most one array allocation.
   */
  getAll() {
    if (this._count === 0) return [];
    if (this._count < this._size) {
      // Buffer not yet full — data lives in indices [0, _count)
      return this._buf.slice(0, this._count);
    }
    // Buffer full — oldest entry is at _head (the next write position)
    const tail = this._buf.slice(this._head);
    const head = this._buf.slice(0, this._head);
    return tail.concat(head);
  }

  /**
   * Returns items whose .timestamp field is within the last `ms` milliseconds.
   * @param {number} ms
   */
  getRecent(ms) {
    const cutoff = Date.now() - ms;
    return this.getAll().filter((item) => item.timestamp > cutoff);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Signal State
// ─────────────────────────────────────────────────────────────────────────────

/** @type {CircularBuffer<{timestamp:number, iki:number, dwell:number, isBackspace:boolean}>} */
const keyEvents = new CircularBuffer(500);

/** @type {CircularBuffer<{timestamp:number, velocity:number, direction:number, reversal:boolean}>} */
const scrollEvents = new CircularBuffer(200);

/** @type {CircularBuffer<{timestamp:number, velocity:number}>} */
const cursorSamples = new CircularBuffer(300);

/** @type {CircularBuffer<{timestamp:number, duration:number}>} */
const clickEvents = new CircularBuffer(100);

const sessionStart = Date.now();

// ─────────────────────────────────────────────────────────────────────────────
// Keyboard listeners
// ─────────────────────────────────────────────────────────────────────────────

/** Map of event.code → keydown timestamp for dwell-time calculation */
const _keydownTime = {};

/** Timestamp of the last keyup event (for IKI calculation) */
let _lastKeyupTime = 0;

document.addEventListener(
  "keydown",
  (e) => {
    _keydownTime[e.code] = Date.now();
  },
  { passive: true }
);

document.addEventListener(
  "keyup",
  (e) => {
    const now = Date.now();
    const downTime = _keydownTime[e.code] ?? now;
    const iki = _lastKeyupTime > 0 ? now - _lastKeyupTime : 0;
    const dwell = now - downTime;
    const isBackspace = e.code === "Backspace";

    keyEvents.push({ timestamp: now, iki, dwell, isBackspace });
    _lastKeyupTime = now;
    delete _keydownTime[e.code];
  },
  { passive: true }
);

// ─────────────────────────────────────────────────────────────────────────────
// Scroll listener (throttled, passive)
// ─────────────────────────────────────────────────────────────────────────────

let _lastScrollTime = 0;
let _lastScrollY = window.scrollY;
let _lastScrollDir = 0;

document.addEventListener(
  "scroll",
  () => {
    const now = Date.now();
    if (now - _lastScrollTime < 100) return; // Throttle to max 1 sample / 100ms

    const newY = window.scrollY;
    const deltaY = newY - _lastScrollY;
    const elapsed = Math.max(now - _lastScrollTime, 1);

    const velocity = Math.abs(deltaY) / elapsed; // px/ms
    const direction = Math.sign(deltaY); // -1, 0, +1
    const reversal =
      direction !== 0 && _lastScrollDir !== 0 && direction !== _lastScrollDir;

    scrollEvents.push({ timestamp: now, velocity, direction, reversal });

    _lastScrollTime = now;
    _lastScrollY = newY;
    if (direction !== 0) _lastScrollDir = direction;
  },
  { passive: true }
);

// ─────────────────────────────────────────────────────────────────────────────
// Mouse movement listener (sampled)
// ─────────────────────────────────────────────────────────────────────────────

let _lastMouseTime = 0;
let _lastMouseX = 0;
let _lastMouseY = 0;

document.addEventListener(
  "mousemove",
  (e) => {
    const now = Date.now();
    if (now - _lastMouseTime < 100) return; // Sample at most once per 100ms

    const dx = e.clientX - _lastMouseX;
    const dy = e.clientY - _lastMouseY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const elapsed = Math.max(now - _lastMouseTime, 1);
    const velocity = dist / elapsed; // px/ms

    cursorSamples.push({ timestamp: now, velocity });

    _lastMouseTime = now;
    _lastMouseX = e.clientX;
    _lastMouseY = e.clientY;
  },
  { passive: true }
);

// ─────────────────────────────────────────────────────────────────────────────
// Click listeners (mousedown/mouseup to measure hesitation / dwell)
// ─────────────────────────────────────────────────────────────────────────────

let _mousedownTime = 0;

document.addEventListener(
  "mousedown",
  () => {
    _mousedownTime = Date.now();
  },
  { passive: true }
);

document.addEventListener(
  "mouseup",
  () => {
    const duration = Date.now() - _mousedownTime;
    if (_mousedownTime > 0) {
      clickEvents.push({ timestamp: Date.now(), duration });
      _mousedownTime = 0;
    }
  },
  { passive: true }
);

// ─────────────────────────────────────────────────────────────────────────────
// Feature computation helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Computes variance of a numeric array. Returns 0 for arrays with < 2 items. */
function _variance(arr) {
  if (arr.length < 2) return 0;
  const mean = arr.reduce((s, v) => s + v, 0) / arr.length;
  return arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length;
}

/** Computes mean absolute deviation of a numeric array. Returns 0 if empty. */
function _mad(arr) {
  if (arr.length === 0) return 0;
  const mean = arr.reduce((s, v) => s + v, 0) / arr.length;
  return arr.reduce((s, v) => s + Math.abs(v - mean), 0) / arr.length;
}

// ─────────────────────────────────────────────────────────────────────────────
// Periodic feature extraction & reporting (every 30 seconds)
// ─────────────────────────────────────────────────────────────────────────────

function computeAndSend() {
  const FIVE_MIN = 5 * 60 * 1000;
  const THIRTY_S = 30 * 1000;

  // ── Typing error rate ─────────────────────────────────────────────────────
  const recentKeys = keyEvents.getRecent(FIVE_MIN);
  const totalKeys = recentKeys.length;
  const backspaces = recentKeys.filter((k) => k.isBackspace).length;
  const typingErrorRate = totalKeys > 0 ? backspaces / totalKeys : 0;

  // ── IKI variance ─────────────────────────────────────────────────────────
  // IKI = inter-key interval. High variance → erratic, hesitant typing.
  // Normalise: cap variance at 2000ms² (empirically chosen upper bound) → 0-1.
  const ikis = recentKeys.map((k) => k.iki).filter((v) => v > 0 && v < 5000);
  const ikiVar = _variance(ikis);
  const ikiVariance = Math.min(ikiVar / 2_000_000, 1.0); // 2000ms² cap

  // ── Scroll reversal rate ──────────────────────────────────────────────────
  // Reversals in the last 30 s, normalised by dividing by 10 (>10 reversals
  // in 30 s is considered a saturating level of disorientation).
  const recentScrolls = scrollEvents.getRecent(THIRTY_S);
  const reversals = recentScrolls.filter((s) => s.reversal).length;
  const scrollReversalRate = Math.min(reversals / 10, 1.0);

  // ── Cursor jitter ─────────────────────────────────────────────────────────
  // Mean absolute deviation of cursor velocity samples.
  // MAD > 50 px/ms is treated as saturation (frantic movement).
  const recentCursor = cursorSamples.getRecent(THIRTY_S);
  const velocities = recentCursor.map((s) => s.velocity);
  const cursorJitter = Math.min(_mad(velocities) / 50, 1.0);

  // ── Click hesitation ─────────────────────────────────────────────────────
  // Fraction of click events where mousedown was held > 400ms.
  // Long holds indicate the user is uncertain or re-reading before clicking.
  const recentClicks = clickEvents.getRecent(FIVE_MIN);
  const longClicks = recentClicks.filter((c) => c.duration > 400).length;
  const clickHesitation =
    recentClicks.length > 0 ? longClicks / recentClicks.length : 0;

  // ── Session duration ──────────────────────────────────────────────────────
  // Log-scaled: score reaches 1.0 at 90 minutes (log(91) ≈ 4.51).
  // Using log scale means the first 15 minutes barely contribute but the
  // score climbs steeply after 30-45 minutes, matching fatigue research.
  const minutesElapsed = (Date.now() - sessionStart) / 60_000;
  const sessionDuration = Math.min(
    Math.log(minutesElapsed + 1) / Math.log(91),
    1.0
  );

  const featureVector = {
    typingErrorRate,
    ikiVariance,
    scrollReversalRate,
    cursorJitter,
    clickHesitation,
    sessionDuration,
  };

  chrome.runtime
    .sendMessage({
      type: "BEHAVIORAL_SIGNALS",
      payload: featureVector,
    })
    .catch(() => {
      // Service worker may be temporarily inactive; message will be dropped.
      // The next 30-second tick will retry automatically.
    });
}

// Start reporting after an initial 30-second warm-up period so we have
// meaningful data before the first report.
setInterval(computeAndSend, 30_000);

// ─────────────────────────────────────────────────────────────────────────────
// Eye-tracking iframe management
// ─────────────────────────────────────────────────────────────────────────────
// The iframe loads eyetracking.html from the chrome-extension:// origin so
// getUserMedia() works. Results come back via postMessage.

let eyeFrame = null;

function injectEyetrackingFrame() {
  if (eyeFrame) return;
  eyeFrame = document.createElement("iframe");
  eyeFrame.src = chrome.runtime.getURL("eyetracking.html");
  eyeFrame.style.cssText = [
    "position:fixed",
    "top:-9999px",
    "left:-9999px",
    "width:1px",
    "height:1px",
    "border:none",
    "opacity:0",
    "pointer-events:none",
  ].join(";");
  eyeFrame.allow = "camera"; // ← critical: grants camera permission to the iframe
  eyeFrame.id = "focuslens-eye-frame";
  document.body.appendChild(eyeFrame);
}

function removeEyetrackingFrame() {
  if (eyeFrame) {
    eyeFrame.remove();
    eyeFrame = null;
  }
}

// ── Receive results from the iframe and forward to background worker ──────────
window.addEventListener("message", (event) => {
  // Only process messages from our own iframe
  if (event.data?.source !== "focuslens-eye") return;

  if (event.data.type === "EYE_FATIGUE_SIGNAL") {
    chrome.runtime
      .sendMessage({
        type: "EYE_FATIGUE_SIGNAL",
        payload: event.data.payload,
      })
      .catch(() => {
        // Worker temporarily inactive — next signal will retry
      });
  }

  if (event.data.type === "EYE_READY") {
    console.log("[FocusLens] Eye tracking active");
  }

  if (event.data.type === "EYE_ERROR") {
    console.error("[FocusLens] Eye tracking error:", event.data.message);
    removeEyetrackingFrame();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Incoming messages from background worker
// ─────────────────────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "TIER_CHANGE") {
    // Worker sends tier at top level: { type, tier, score }
    const tier = message.tier ?? message.payload?.tier;
    if (typeof tier === "number") {
      document.dispatchEvent(
        new CustomEvent("focuslens:tier", { detail: { tier } })
      );
    }
  }

  if (message.type === "START_EYE_TRACKING") {
    injectEyetrackingFrame();
  }

  if (message.type === "STOP_EYE_TRACKING") {
    removeEyetrackingFrame();
  }
});
