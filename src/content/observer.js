/**
 * src/content/observer.js
 * ────────────────────────
 * SPA-aware DOM observer.
 *
 * Two problems it solves:
 *
 * 1. DYNAMIC DOM INJECTION
 *    React, Vue, Next.js, and other SPA frameworks continuously add new nodes
 *    to the DOM after the initial render (lazy routes, infinite scroll, ads
 *    injected client-side, etc.).  adapter.js hides elements at tier-change
 *    time, but newly-inserted nodes bypass that.  A MutationObserver watching
 *    document.body with subtree:true catches these insertions and re-applies
 *    the current tier's hide selectors.  The callback is debounced 500ms to
 *    avoid triggering on every individual node insertion during a batch render.
 *
 * 2. SPA NAVIGATION (pushState / popstate)
 *    SPAs don't trigger a full page reload on navigation — they update the DOM
 *    in-place and push a new URL via history.pushState.  The content script
 *    therefore keeps running across "page changes".  We intercept pushState,
 *    fire a custom event, and re-apply the current tier after 800ms to let
 *    the framework finish rendering its next page.
 */

import { applyTier, currentTier } from "./adapter.js";

// ─────────────────────────────────────────────────────────────────────────────
// MutationObserver — re-hide freshly injected nodes
// ─────────────────────────────────────────────────────────────────────────────

let _mutationTimer = null;

const observer = new MutationObserver(() => {
  // Debounce: wait 500ms after the last mutation before acting.
  // SPA frameworks often perform hundreds of DOM mutations in a single JS tick
  // (virtual DOM reconciliation). Debouncing avoids thrashing the DOM with
  // repeated querySelectorAll calls during that burst.
  clearTimeout(_mutationTimer);
  _mutationTimer = setTimeout(() => {
    const tier = currentTier();
    if (tier > 0) {
      // Re-apply to catch any newly-injected elements that match hide selectors
      applyTier(tier);
    }
  }, 500);
});

// Start observing once the body is available
function _startObserver() {
  if (document.body) {
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      // We don't need attribute or character-data mutations — only structural changes
    });
  } else {
    // Body not ready yet (script ran very early) — wait for DOMContentLoaded
    document.addEventListener("DOMContentLoaded", () => {
      observer.observe(document.body, { childList: true, subtree: true });
    });
  }
}

_startObserver();

// ─────────────────────────────────────────────────────────────────────────────
// SPA navigation detection
// ─────────────────────────────────────────────────────────────────────────────

let _navTimer = null;

/**
 * _onNavigate()
 * Called whenever a SPA navigation is detected (pushState or popstate).
 * Waits 800ms for the framework to finish rendering, then re-applies the
 * current tier.  The 800ms delay is intentionally generous — on slow machines
 * or heavy pages a 500ms delay can miss late-rendering components.
 */
function _onNavigate() {
  clearTimeout(_navTimer);
  _navTimer = setTimeout(() => {
    const tier = currentTier();
    if (tier > 0) {
      applyTier(tier);
    }
  }, 800);
}

// ── Intercept history.pushState ───────────────────────────────────────────────
// pushState does NOT fire a 'popstate' event, so we must wrap it.
// We save and restore the original to be a good citizen in case other
// scripts (analytics, etc.) have also wrapped it.
const _originalPushState = history.pushState.bind(history);
history.pushState = function (...args) {
  _originalPushState(...args);
  // Fire a custom event so multiple listeners can react without needing
  // to keep wrapping the function
  window.dispatchEvent(new CustomEvent("focuslens:navigate"));
};

// ── popstate fires on back/forward navigation ─────────────────────────────────
window.addEventListener("popstate", _onNavigate);

// ── Our custom event fires on pushState navigation ────────────────────────────
window.addEventListener("focuslens:navigate", _onNavigate);
