/**
 * src/popup/popup.js
 * ───────────────────
 * Popup controller — reads fatigue state from the background worker,
 * animates the gauge, and handles camera + per-site toggles.
 *
 * Runs in the extension popup context (chrome-extension:// URL), so all
 * chrome.* APIs are available without any bundling.  This file is NOT
 * processed by Rollup — it is copied as-is by rollup-plugin-copy.
 */

"use strict";

// ─── DOM references ───────────────────────────────────────────────────────────
const gaugeNumber = document.getElementById("gauge-number");
const gaugeFill = document.getElementById("gauge-fill");
const tierBadge = document.getElementById("tier-badge");
const tierDescription = document.getElementById("tier-description");
const cameraBtnEl = document.getElementById("camera-btn");
const cameraIndicator = document.getElementById("camera-indicator");
const errorMsg = document.getElementById("error-msg");
const siteToggle = document.getElementById("site-toggle");

// ─── Gauge geometry ───────────────────────────────────────────────────────────
const RADIUS = 50;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

// Initialise stroke-dasharray once (constant)
gaugeFill.style.strokeDasharray = `${CIRCUMFERENCE}`;

// ─── Tier metadata (mirrors presets.js — no import available in popup) ────────
const TIER_META = {
  0: {
    label: "Normal",
    cls: "",
    description: "No changes — your fatigue score is within normal range.",
  },
  1: {
    label: "Mild",
    cls: "tier-1",
    description:
      "Ads, cookie notices, and popups hidden. Motion reduced with minimal readability tweaks.",
  },
  2: {
    label: "Moderate",
    cls: "tier-2",
    description:
      "Ad-block + sidebars/comments removed. Main content is prioritized with dark mode.",
  },
  3: {
    label: "Severe",
    cls: "tier-3",
    description:
      "Full focus mode: non-essential chrome hidden, main content isolated, stronger dark theme.",
  },
};

// ─── Camera state ─────────────────────────────────────────────────────────────
let _cameraActive = false;

// ─────────────────────────────────────────────────────────────────────────────
// updateGauge(score)
// Animates the SVG ring to represent the score and sets the fill colour.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {number} score — 0-100
 */
function updateGauge(score) {
  const clamped = Math.max(0, Math.min(100, score));

  // Update number label
  gaugeNumber.textContent = Math.round(clamped);

  // Stroke-dashoffset: 0 = full circle, circumference = empty circle
  const offset = CIRCUMFERENCE - (clamped / 100) * CIRCUMFERENCE;
  gaugeFill.style.strokeDashoffset = offset;

  // Colour ramp
  let colour;
  if (clamped < 30) colour = "#22c55e"; // Green
  else if (clamped < 55) colour = "#f59e0b"; // Amber
  else if (clamped < 75) colour = "#f97316"; // Orange
  else colour = "#ef4444"; // Red

  gaugeFill.style.stroke = colour;
}

// ─────────────────────────────────────────────────────────────────────────────
// updateTierLabel(tier)
// ─────────────────────────────────────────────────────────────────────────────
function updateTierLabel(tier) {
  const meta = TIER_META[tier] ?? TIER_META[0];

  // Remove all tier-N classes then add the current one
  tierBadge.className = "tier-badge";
  if (meta.cls) tierBadge.classList.add(meta.cls);
  tierBadge.textContent = meta.label;

  tierDescription.textContent = meta.description;
}

// ─────────────────────────────────────────────────────────────────────────────
// updateFromStorage(changes)
// Called by storage.session.onChanged — live-updates the popup while open.
// ─────────────────────────────────────────────────────────────────────────────
function updateFromStorage(changes) {
  if (changes.focuslens_score) {
    updateGauge(changes.focuslens_score.newValue);
  }
  if (changes.focuslens_tier) {
    updateTierLabel(changes.focuslens_tier.newValue);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Camera toggle
// ─────────────────────────────────────────────────────────────────────────────

function showCameraActiveIndicator() {
  cameraIndicator.classList.add("visible");
  cameraBtnEl.textContent = "Disable eye tracking";
  cameraBtnEl.classList.add("btn-danger");
  cameraBtnEl.classList.remove("btn-primary");
  _cameraActive = true;
}

function hideCameraActiveIndicator() {
  cameraIndicator.classList.remove("visible");
  cameraBtnEl.textContent = "Enable eye tracking";
  cameraBtnEl.classList.add("btn-primary");
  cameraBtnEl.classList.remove("btn-danger");
  _cameraActive = false;
}

function showError(msg) {
  errorMsg.style.display = "block";
  errorMsg.textContent = msg;
  setTimeout(() => {
    errorMsg.style.display = "none";
  }, 4000);
}

// Camera is now declared in manifest permissions — no runtime request needed.
cameraBtnEl.addEventListener("click", () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tabId = tabs[0]?.id;
    if (!tabId) {
      showError("Could not find the active tab.");
      return;
    }

    if (!_cameraActive) {
      chrome.tabs.sendMessage(tabId, { type: "START_EYE_TRACKING" }, () => {
        if (chrome.runtime.lastError) {
          showError("Could not reach the page. Try refreshing.");
          return;
        }
        showCameraActiveIndicator();
        chrome.storage.session.set({ eyeTrackingActive: true });
      });
    } else {
      chrome.tabs
        .sendMessage(tabId, { type: "STOP_EYE_TRACKING" })
        .catch(() => {});
      hideCameraActiveIndicator();
      chrome.storage.session.set({ eyeTrackingActive: false });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Per-site disable toggle
// ─────────────────────────────────────────────────────────────────────────────

let _currentHostname = "";

function _loadSiteToggle() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab || !tab.url) return;

    try {
      _currentHostname = new URL(tab.url).hostname;
    } catch (_) {
      return;
    }

    chrome.storage.sync.get(["focuslens_disabled_sites"], (data) => {
      const disabled = data.focuslens_disabled_sites ?? [];
      siteToggle.checked = disabled.includes(_currentHostname);
    });
  });
}

siteToggle.addEventListener("change", () => {
  if (!_currentHostname) return;

  chrome.storage.sync.get(["focuslens_disabled_sites"], (data) => {
    let disabled = data.focuslens_disabled_sites ?? [];

    if (siteToggle.checked) {
      // Add to disabled list
      if (!disabled.includes(_currentHostname)) {
        disabled.push(_currentHostname);
      }
    } else {
      // Remove from disabled list
      disabled = disabled.filter((h) => h !== _currentHostname);
    }

    chrome.storage.sync.set({ focuslens_disabled_sites: disabled }, () => {
      // Notify the content script to re-evaluate
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs[0]) return;
        chrome.tabs
          .sendMessage(tabs[0].id, {
            type: "RELOAD_ADAPTER",
            payload: { disabled: siteToggle.checked },
          })
          .catch(() => {});
      });
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Initialisation — runs when the popup opens
// ─────────────────────────────────────────────────────────────────────────────

// Initial state from background worker
chrome.runtime.sendMessage({ type: "GET_STATE" }, (state) => {
  if (chrome.runtime.lastError || !state) {
    // Worker not yet ready — show defaults
    updateGauge(0);
    updateTierLabel(0);
    return;
  }
  updateGauge(state.score);
  updateTierLabel(state.tier);
});

// Live updates while popup is open
chrome.storage.session.onChanged.addListener(updateFromStorage);

// Load per-site toggle state
_loadSiteToggle();

// Restore camera indicator state from session storage
chrome.storage.session.get(["eyeTrackingActive"], (data) => {
  if (data.eyeTrackingActive) {
    showCameraActiveIndicator();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Debug tier buttons — force a tier directly into the active tab
// ─────────────────────────────────────────────────────────────────────────────
const debugStatus = document.getElementById("debug-status");
const tierBtns = document.querySelectorAll(".tier-btn");

function _setActiveTierBtn(tier) {
  tierBtns.forEach((btn) => {
    btn.classList.toggle("active", Number(btn.dataset.tier) === tier);
  });
}

tierBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    const tier = Number(btn.dataset.tier);
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0]?.id;
      const tabUrl = tabs[0]?.url ?? "";
      if (!tabId || !tabUrl.startsWith("http")) {
        debugStatus.textContent = "⚠ Only works on http/https pages.";
        return;
      }
      // Dispatch the same custom event adapter.js listens for
      chrome.scripting.executeScript(
        {
          target: { tabId },
          world: "MAIN",
          func: (t) => {
            document.dispatchEvent(
              new CustomEvent("focuslens:tier", { detail: { tier: t } })
            );
          },
          args: [tier],
        },
        (results) => {
          if (chrome.runtime.lastError) {
            debugStatus.textContent = "✗ " + chrome.runtime.lastError.message;
          } else {
            debugStatus.textContent = `✓ Tier ${tier} applied to page.`;
            updateTierLabel(tier);
            _setActiveTierBtn(tier);
          }
        }
      );
    });
  });
});
