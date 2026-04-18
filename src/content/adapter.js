/**
 * src/content/adapter.js
 * ───────────────────────
 * DOM adapter — applies visual tier changes to the host page.
 *
 * Responsibility:
 *   - Inject the <style> tag and amber overlay div once on load.
 *   - Listen for 'focuslens:tier' custom events from signals.js.
 *   - On tier change: update styles, hide elements, adjust overlay, manage HUD.
 *
 * Design principles:
 *   - All DOM writes are batched inside requestAnimationFrame so we touch the
 *     layout tree at most once per frame, avoiding multiple forced reflows.
 *   - Elements are hidden via display:none + data-focuslens-hidden="true" so
 *     observer.js can re-hide elements added by SPAs after navigation.
 *   - The overlay is a single fixed-position div with pointer-events:none so
 *     it never intercepts user interaction.
 */

import { TIERS } from "../shared/presets.js";
import { extractArticle, buildReaderView } from "./reader.js";

// ─── Module state ─────────────────────────────────────────────────────────────

/**
 * Currently active tier index (-1 means unset / not yet received from worker).
 * Exported as a getter so observer.js can read it without creating a circular
 * dependency on this module's internals.
 */
let _currentTier = -1;

/** @returns {number} The active tier (0-3), or -1 if not yet initialised. */
export function currentTier() {
  return _currentTier;
}

/**
 * applyTier(tier)
 * Public API — called by observer.js after SPA navigation to re-apply hiding
 * on freshly-injected DOM nodes.
 *
 * @param {number} tier - 0-3
 */
export function applyTier(tier) {
  _doApply(tier, /* force= */ false);
}

// ─── DOM element references (injected once) ───────────────────────────────────
let _styleEl = null; // <style id="focuslens-styles">
let _overlayEl = null; // amber tint overlay
let _hudEl = null; // tier-3 floating HUD

// ─── Reader mode state ─────────────────────────────────────────────────────────
let _readerModeActive = false;
let _originalBodyHTML = null;
let _originalBodyClasses = null;

// ─── Reader mode activation/deactivation ──────────────────────────────────────
function _activateReaderMode() {
  if (_readerModeActive) return;

  // Store original body for restoration
  _originalBodyHTML = document.body.innerHTML;
  _originalBodyClasses = document.body.className;

  const article = extractArticle();
  if (!article) {
    console.warn(
      "[FocusLens] Could not extract article — skipping reader mode"
    );
    // Fallback: use current tier 3 behavior (we'll still apply dark mode CSS)
    return;
  }

  const readerView = buildReaderView(article);
  if (!readerView) return;

  // Replace body content with reader view
  document.body.innerHTML = "";
  document.body.appendChild(_overlayEl); // Re-inject overlay
  if (_hudEl) document.body.appendChild(_hudEl); // Re-inject HUD if exists
  document.body.appendChild(readerView);
  document.body.className = "focuslens-reader-mode";
  _readerModeActive = true;

  console.log("[FocusLens] Reader mode activated");
}

function _deactivateReaderMode() {
  if (!_readerModeActive || !_originalBodyHTML) return;

  document.body.innerHTML = _originalBodyHTML;
  document.body.className = _originalBodyClasses || "";
  _readerModeActive = false;
  _originalBodyHTML = null;
  _originalBodyClasses = null;

  // Re-inject overlay and HUD after restoration
  _injectShell();

  console.log("[FocusLens] Reader mode deactivated");
}

// ─── Main-content detection helpers ──────────────────────────────────────────
function _clearMainContentMarkers() {
  document
    .querySelectorAll("[data-focuslens-main], [data-focuslens-main-chain]")
    .forEach((el) => {
      el.removeAttribute("data-focuslens-main");
      el.removeAttribute("data-focuslens-main-chain");
    });

  if (document.body) {
    document.body.classList.remove("focuslens-main-mode");
  }
}

function _scoreMainCandidate(el) {
  if (!el) return -1;
  if (el.id && el.id.startsWith("focuslens")) return -1;
  const textLen = (el.innerText || "").trim().length;
  if (textLen < 380) return -1;

  const paragraphs = el.querySelectorAll("p").length;
  const links = el.querySelectorAll("a").length;
  const headings = el.querySelectorAll("h1, h2, h3").length;
  const linkPenalty = links > 0 ? Math.min(links * 20, textLen * 0.5) : 0;

  return textLen + paragraphs * 140 + headings * 80 - linkPenalty;
}

function _findMainContentNode() {
  const preferred = [
    "main",
    "article",
    '[role="main"]',
    ".post-content",
    ".article-body",
    ".entry-content",
    ".content-body",
    "#content",
    "#main",
  ];

  const candidates = [];
  const seen = new Set();

  preferred.forEach((selector) => {
    document.querySelectorAll(selector).forEach((el) => {
      if (!seen.has(el)) {
        seen.add(el);
        candidates.push(el);
      }
    });
  });

  if (candidates.length === 0) {
    document.querySelectorAll("section, div").forEach((el) => {
      if (seen.has(el)) return;
      if ((el.childElementCount || 0) < 5) return;
      const cls = (el.className || "").toString().toLowerCase();
      const id = (el.id || "").toLowerCase();
      if (
        cls.includes("footer") ||
        cls.includes("sidebar") ||
        cls.includes("nav") ||
        id.includes("footer") ||
        id.includes("sidebar") ||
        id.includes("nav")
      ) {
        return;
      }

      seen.add(el);
      candidates.push(el);
    });
  }

  let best = null;
  let bestScore = -1;
  for (const candidate of candidates) {
    const score = _scoreMainCandidate(candidate);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  return best;
}

function _markMainContent(tier) {
  _clearMainContentMarkers();
  if (tier < 2 || !document.body) return;

  const mainNode = _findMainContentNode();
  if (!mainNode) return;

  mainNode.setAttribute("data-focuslens-main", "true");

  let cursor = mainNode;
  while (cursor && cursor !== document.body) {
    cursor.setAttribute("data-focuslens-main-chain", "true");
    cursor = cursor.parentElement;
  }

  document.body.classList.add("focuslens-main-mode");
}

// ─── One-time DOM injection ───────────────────────────────────────────────────
function _injectShell() {
  // ── <style> tag ──────────────────────────────────────────────────────────
  _styleEl = document.getElementById("focuslens-styles");
  if (!_styleEl) {
    _styleEl = document.createElement("style");
    _styleEl.id = "focuslens-styles";
    document.head.appendChild(_styleEl);
  }

  // ── Amber overlay ─────────────────────────────────────────────────────────
  _overlayEl = document.getElementById("focuslens-overlay");
  if (!_overlayEl) {
    _overlayEl = document.createElement("div");
    _overlayEl.id = "focuslens-overlay";
    Object.assign(_overlayEl.style, {
      position: "fixed",
      top: "0",
      left: "0",
      width: "100%",
      height: "100%",
      pointerEvents: "none",
      background: "rgba(255, 180, 50, 0)", // Alpha starts at 0
      mixBlendMode: "multiply",
      zIndex: "2147483646",
      transition: "background 0.4s ease",
    });
    document.body.appendChild(_overlayEl);
  }
}

// Inject as soon as possible — DOMContentLoaded if not already fired,
// otherwise immediately.
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", _injectShell);
} else {
  _injectShell();
}

// ─── Tier-change event listener ───────────────────────────────────────────────
document.addEventListener("focuslens:tier", (e) => {
  const newTier = e.detail?.tier;
  if (typeof newTier !== "number") return;
  _doApply(newTier, /* force= */ false);
});

// ─────────────────────────────────────────────────────────────────────────────
// Core apply logic
// ─────────────────────────────────────────────────────────────────────────────

/**
 * _doApply(tier, force)
 *
 * @param {number}  tier  - Target tier (0-3)
 * @param {boolean} force - If true, re-apply even if tier hasn't changed
 *                          (used by observer.js after SPA navigation)
 */
function _doApply(tier, force) {
  if (!force && tier === _currentTier) return; // No-op if tier unchanged
  _currentTier = tier;

  const config = TIERS[tier];
  if (!config) {
    console.warn("[FocusLens] Unknown tier:", tier);
    return;
  }

  // Batch all DOM writes in a single rAF to avoid multiple layout flushes
  requestAnimationFrame(() => {
    // Ensure shell elements exist (can be null if called before DOMContentLoaded)
    if (!_styleEl || !_overlayEl) _injectShell();

    // ── 1. Restore previously hidden elements ────────────────────────────────
    document.querySelectorAll("[data-focuslens-hidden]").forEach((el) => {
      el.style.removeProperty("display");
      el.removeAttribute("data-focuslens-hidden");
    });
    _clearMainContentMarkers();

    // ── 1a. Handle reader mode (tier 3 only) ─────────────────────────────────
    if (tier === 3) {
      _activateReaderMode();
    } else if (_readerModeActive) {
      _deactivateReaderMode();
    }

    // ── 2. Inject tier CSS ───────────────────────────────────────────────────
    _styleEl.innerHTML = config.styles;

    // Mark the most likely article/content block for selective rendering tiers
    _markMainContent(tier);

    // ── 3. Apply hide selectors ──────────────────────────────────────────────
    for (const selector of config.hideSelectors) {
      try {
        document.querySelectorAll(selector).forEach((el) => {
          // Skip extension-injected elements
          if (el.id && el.id.startsWith("focuslens")) return;
          el.style.setProperty("display", "none", "important");
          el.setAttribute("data-focuslens-hidden", "true");
        });
      } catch (err) {
        // Malformed selector (e.g. :has() unsupported in older Chrome) — skip
        // silent
      }
    }

    // ── 4. Update amber overlay opacity ──────────────────────────────────────
    const overlayAlphas = [0, 0.04, 0.07, 0.1];
    const alpha = overlayAlphas[tier] ?? 0;
    _overlayEl.style.background = `rgba(255, 180, 50, ${alpha})`;

    // Reinforce root-level paint and color-scheme (sites often override body)
    const root = document.documentElement;
    if (tier >= 3) {
      root.style.setProperty("background-color", "#161513", "important");
      root.style.setProperty("color-scheme", "dark");
    } else if (tier >= 2) {
      root.style.setProperty("background-color", "#23211e", "important");
      root.style.setProperty("color-scheme", "dark");
    } else {
      root.style.removeProperty("background-color");
      root.style.removeProperty("color-scheme");
    }

    // ── 5. Pause all media at tier 2+ ────────────────────────────────────────
    if (tier >= 2) {
      document.querySelectorAll("video, audio").forEach((m) => {
        try {
          m.pause();
        } catch (_) {
          /* ignore cross-origin frames */
        }
      });
    }

    // ── 6. Manage floating HUD (tier 3 only) ──────────────────────────────────
    _updateHud(tier);
  });
}

// ── DevTools / demo global ────────────────────────────────────────────────────
// Open any page's DevTools console and run:
//   __focuslens.setTier(3)  → severe dark mode instantly
//   __focuslens.reset()     → full restore
window.__focuslens = {
  setTier: (t) => {
    _currentTier = -1;
    _doApply(t, true);
  },
  getTier: () => _currentTier,
  reset: () => {
    _currentTier = -1;
    _doApply(0, true);
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Floating HUD
// ─────────────────────────────────────────────────────────────────────────────

const HUD_DISMISSED_KEY = "focuslens_hud_dismissed";

function _updateHud(tier) {
  if (tier < 3) {
    // Hide the HUD for non-severe tiers
    if (_hudEl) _hudEl.style.display = "none";
    return;
  }

  // Don't show HUD if the user dismissed it this session
  if (sessionStorage.getItem(HUD_DISMISSED_KEY) === "1") return;

  if (!_hudEl) {
    _hudEl = document.createElement("div");
    _hudEl.id = "focuslens-hud";
    Object.assign(_hudEl.style, {
      position: "fixed",
      bottom: "20px",
      right: "20px",
      zIndex: "2147483647",
      background: "#f0c040",
      color: "#1a1a1a",
      padding: "14px 16px",
      borderRadius: "10px",
      fontFamily: "system-ui, sans-serif",
      fontSize: "14px",
      lineHeight: "1.5",
      maxWidth: "260px",
      boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
      transition: "opacity 0.3s ease",
    });

    // ── Message ────────────────────────────────────────────────────────────
    const msg = document.createElement("p");
    msg.style.cssText = "margin:0 0 10px 0; font-weight:600;";
    msg.textContent = "⚠ High fatigue detected — display simplified";
    _hudEl.appendChild(msg);

    const sub = document.createElement("p");
    sub.style.cssText = "margin:0 0 10px 0; font-size:12px; opacity:0.75;";
    sub.textContent =
      "FocusLens has reduced visual complexity to help you focus.";
    _hudEl.appendChild(sub);

    // ── Dismiss button ─────────────────────────────────────────────────────
    const btn = document.createElement("button");
    Object.assign(btn.style, {
      display: "block",
      width: "100%",
      padding: "6px",
      border: "2px solid #1a1a1a",
      borderRadius: "6px",
      background: "transparent",
      cursor: "pointer",
      fontSize: "13px",
      fontWeight: "600",
    });
    btn.textContent = "Dismiss";
    btn.addEventListener("click", () => {
      sessionStorage.setItem(HUD_DISMISSED_KEY, "1");
      _hudEl.style.opacity = "0";
      setTimeout(() => {
        if (_hudEl) _hudEl.style.display = "none";
      }, 300);
    });
    _hudEl.appendChild(btn);

    document.body.appendChild(_hudEl);
  }

  _hudEl.style.display = "block";
  _hudEl.style.opacity = "1";
}
