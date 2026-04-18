/**
 * src/background/worker.js
 * ─────────────────────────
 * FocusLens MV3 service worker.
 *
 * ─── WHY SERVICE WORKERS CAN DIE ─────────────────────────────────────────────
 * Chrome MV3 service workers are event-driven and are terminated by the browser
 * after ~30 seconds of inactivity to save resources. This means ALL module-level
 * JavaScript state (including the FatigueScorer instance) is wiped between idle
 * periods. The worker is transparently re-started the next time an event fires.
 *
 * Solution: chrome.storage.session persists data for the lifetime of the browser
 * session (i.e., until Chrome is closed) and survives individual service worker
 * restarts. On every score update we write {score, tier} to storage.session.
 * On startup we read back the last saved state and seed the scorer with it so
 * the score doesn't reset to 0 after an idle period.
 *
 * chrome.storage.session vs chrome.storage.local:
 *   - session: cleared when Chrome closes, no quota concerns, synchronous-ish
 *   - local:   persists across Chrome restarts, 10 MB quota
 * We use session because fatigue is a within-session metric; yesterday's score
 * is irrelevant to today's cognitive state.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { FatigueScorer } from "../shared/scorer.js";

// One scorer instance per service worker lifetime.
// On restart, _restoreScoreFromStorage() seeds it with the last known score.
const scorer = new FatigueScorer();

// ─── Startup: restore persisted score so worker restarts are seamless ────────
(async function _restoreScoreFromStorage() {
  try {
    const data = await chrome.storage.session.get([
      "focuslens_score",
      "focuslens_tier",
    ]);
    if (typeof data.focuslens_score === "number") {
      // Seed the internal smoothed score without triggering a broadcast —
      // the tabs haven't sent a new signal yet so there's nothing new to relay.
      scorer.smoothedScore = data.focuslens_score;
      scorer._tier = data.focuslens_tier ?? scorer._determineTier();
    }
  } catch (e) {
    // Storage may be unavailable in some edge cases; silently continue.
    console.warn("[FocusLens worker] Could not restore score from storage:", e);
  }
})();

// ─── Message handler ─────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { type, payload } = message;

  switch (type) {
    // ── BEHAVIORAL_SIGNALS ────────────────────────────────────────────────────
    // Sent every 30 seconds by signals.js with a computed feature vector.
    case "BEHAVIORAL_SIGNALS": {
      const result = scorer.updateBehavioral(payload);
      _persistAndBroadcast(result.score, result.tier);
      sendResponse({ ok: true });
      break;
    }

    // ── EYE_FATIGUE_SIGNAL ────────────────────────────────────────────────────
    // Sent per-frame (throttled to ~1 Hz) by eyetracking.js when camera is on.
    // payload: { combinedScore: 0-1 float, timestamp: epoch ms }
    case "EYE_FATIGUE_SIGNAL": {
      const result = scorer.updateEyeSignal(payload);
      _persistAndBroadcast(result.score, result.tier);
      sendResponse({ ok: true });
      break;
    }

    // ── GET_STATE ─────────────────────────────────────────────────────────────
    // Popup requests current score/tier on open.
    case "GET_STATE": {
      sendResponse(scorer.getState());
      break;
    }

    // ── TAB_ACTIVATED ─────────────────────────────────────────────────────────
    // Fired by the tabs.onActivated listener below (self-message).
    // Records which tab is active so session duration can be tracked
    // per-tab if needed in future.
    case "TAB_ACTIVATED": {
      chrome.storage.session.set({
        focuslens_active_tab: payload.tabId,
        focuslens_tab_activated_at: payload.timestamp,
      });
      sendResponse({ ok: true });
      break;
    }

    default:
      // Unknown message type — ignore but don't throw.
      break;
  }

  // Return true to indicate we will (or may) call sendResponse asynchronously.
  // Required for async branches; harmless on synchronous ones.
  return true;
});

// ─── Tab activation tracking ─────────────────────────────────────────────────
// We send a message to ourselves rather than writing storage inline so that
// the storage write goes through the same async queue as all other updates.
chrome.tabs.onActivated.addListener((activeInfo) => {
  chrome.runtime
    .sendMessage({
      type: "TAB_ACTIVATED",
      payload: { tabId: activeInfo.tabId, timestamp: Date.now() },
    })
    .catch(() => {
      // Suppress "receiving end does not exist" errors that can occur during
      // service worker startup before the listener is registered.
    });
});

// ─── Helper: persist score and broadcast tier change to all tabs ─────────────
/**
 * _persistAndBroadcast(score, tier)
 *
 * 1. Writes {score, tier} to chrome.storage.session for popup reads and
 *    worker-restart recovery.
 * 2. Queries all tabs and sends a TIER_CHANGE message to each content script.
 *    Tabs with no content script (e.g. chrome:// pages) will silently reject
 *    the message — we catch those errors to avoid unhandled promise rejections.
 *
 * @param {number} score - 0-100 fatigue score
 * @param {number} tier  - 0-3 intervention tier
 */
async function _persistAndBroadcast(score, tier) {
  // Persist for popup display and worker-restart recovery
  await chrome.storage.session
    .set({
      focuslens_score: score,
      focuslens_tier: tier,
    })
    .catch(console.warn);

  // Broadcast to all eligible http/https tabs only.
  // Skipping chrome://, chrome-extension://, about: pages avoids a flood of
  // suppressed errors that would delay delivery to real content-script tabs.
  const tabs = await chrome.tabs.query({}).catch(() => []);
  for (const tab of tabs) {
    if (!tab.id || !tab.url) continue;
    if (!tab.url.startsWith("http://") && !tab.url.startsWith("https://"))
      continue;
    chrome.tabs
      .sendMessage(tab.id, {
        type: "TIER_CHANGE",
        tier, // top-level for easy destructuring in content script
        score,
      })
      .catch(() => {});
  }
}
