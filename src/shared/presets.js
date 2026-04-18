/**
 * src/shared/presets.js
 * ──────────────────────
 * TIERS — static configuration for each fatigue level.
 *
 * adapter.js reads this object to know:
 *   1. Which CSS to inject into the page's #focuslens-styles <style> tag.
 *   2. Which elements to hide by setting display:none.
 *   3. What human-readable description to show in the popup.
 *
 * Design decisions:
 * - CSS is injected via a <style> tag rather than chrome.scripting.insertCSS so
 *   that it can be removed cleanly (just clear innerHTML) without needing a
 *   matching remove call that requires storing a handle.
 * - hideSelectors uses display:none + a data attribute rather than CSS selectors
 *   so elements added by SPAs after initial load can be caught by the
 *   MutationObserver in observer.js and re-hidden.
 * - The amber overlay tint is applied via JS in adapter.js (rgba alpha only) to
 *   avoid needing a separate CSS rule for each tier.
 */

// ─── Tier 1 selectors (ads, cookie banners, popups) ─────────────────────────
const ADS_SELECTORS = [
  "[data-ad]",
  "[data-advertisement]",
  ".advertisement",
  ".ad-container",
  ".ad-wrapper",
  ".ad-slot",
  ".ad-unit",
  '[class*="advert"]',
  '[class*="AdSlot"]',
  '[class*="ad-slot"]',
  ".sponsored",
  '[aria-label*="advertisement" i]',
  '[aria-label*="sponsored" i]',
  '[id*="google_ads"]',
  '[id*="carbonads"]',
  '[id*="ad-"]',
  ".cookie-banner",
  '[class*="cookie-notice"]',
  '[class*="cookie-bar"]',
  '[class*="cookie-consent"]',
  '[id*="cookie"]',
  '[role="dialog"][aria-label*="cookie" i]',
  '[class*="popup"]:not([role="main"])',
  '[class*="modal"]:not([role="main"])',
  '[class*="gdpr"]',
  '[class*="consent"]',
];

// ─── Tier 2 selectors (sidebars, social widgets) — extends Tier 1 ──────────
const SIDEBAR_SELECTORS = [
  ...ADS_SELECTORS,
  "aside",
  '[role="complementary"]',
  ".sidebar",
  '[class*="sidebar"]',
  '[id*="sidebar"]',
  ".widget-area",
  ".widget",
  '[class*="widget"]',
  ".related-posts",
  '[class*="related"]',
  '[class*="recommended"]',
  ".comments",
  "#comments",
  '[id*="comments"]',
  "#disqus_thread",
  ".social-share",
  '[class*="social-share"]',
  '[class*="share-btn"]',
  '[class*="social-buttons"]',
  '[class*="share-bar"]',
  '[class*="newsletter"]',
  '[class*="subscribe"]',
  '[class*="signup"]',
  '[id*="newsletter"]',
  '[class*="notification"]',
  '[class*="toast"]',
  '[class*="alert-bar"]',
  '[class*="announcement"]',
];

// ─── Tier 3 selectors (structural chrome) — extends Tier 2 ─────────────────
const CHROME_SELECTORS = [
  ...SIDEBAR_SELECTORS,
  "nav",
  'header:not([role="main"])',
  "footer",
  '[role="banner"]',
  '[role="navigation"]',
  '[class*="sticky"]',
  '[class*="fixed-top"]',
  '[class*="fixed-header"]',
  '[class*="pinned"]',
  'iframe:not([title*="content" i]):not([id="focuslens-eye-frame"])',
  '[class*="chat"]',
  '[class*="live-chat"]',
  '[class*="support-widget"]',
  '[id*="intercom"]',
  '[id*="zendesk"]',
  '[class*="helpscout"]',
  'video:not([title*="content" i])',
  '[class*="autoplay"]',
  '[class*="autoplaying"]',
];

export const TIERS = {
  // ── Tier 0 ─ Normal ────────────────────────────────────────────────────────
  0: {
    label: "Normal",
    description: "No changes — your fatigue score is within normal range.",
    styles: "", // No injected CSS
    hideSelectors: [], // Nothing hidden
  },

  // ── Tier 1 ─ Mild (score 30-54) ───────────────────────────────────────────
  // Goals: reduce visual noise from ads/banners, nudge readability slightly.
  // Amber overlay is applied programmatically in adapter.js at opacity 0.04.
  1: {
    label: "Mild",
    description:
      "Advertisements, popups, and cookie banners hidden. Motion reduced with minimal readability tweaks.",
    styles: `
      /* FocusLens Tier 1 — Mild fatigue */
      :where(p, li, td, blockquote) {
        line-height: 1.72 !important;
        letter-spacing: 0.01em !important;
      }

      * {
        animation-duration: 0.01ms !important;
        animation-iteration-count: 1 !important;
        scroll-behavior: auto !important;
      }
    `,
    hideSelectors: ADS_SELECTORS,
  },

  // ── Tier 2 ─ Moderate (score 55-74) ───────────────────────────────────────
  // Goals: enforce a calm single-column reading environment, load dyslexia-
  // friendly font, halt distracting animations without breaking transitions.
  2: {
    label: "Moderate",
    description:
      "Ad-block + sidebars/comments removed. Main reading area is prioritized with dark mode and calmer typography.",
    styles: `
      /* FocusLens Tier 2 — Moderate fatigue */
      @import url('https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&display=swap');

      :root {
        color-scheme: dark !important;
      }

      html, body {
        background: #23211e !important;
        color: #ece8df !important;
      }

      body.focuslens-main-mode [data-focuslens-main] {
        max-width: 72ch !important;
        margin: 0 auto !important;
        padding: 20px 18px !important;
        background: #2b2825 !important;
        border-radius: 10px !important;
        box-shadow: 0 6px 28px rgba(0, 0, 0, 0.32) !important;
      }

      body.focuslens-main-mode [data-focuslens-main] :where(p, li, td, blockquote) {
        font-family: 'Atkinson Hyperlegible', Arial, sans-serif !important;
        font-size: 17px !important;
        line-height: 1.78 !important;
        letter-spacing: 0.015em !important;
      }

      body.focuslens-main-mode [data-focuslens-main] :where(h1, h2, h3, h4) {
        color: #f5d27a !important;
      }

      body.focuslens-main-mode [data-focuslens-main] a {
        color: #82d5ff !important;
      }

      body.focuslens-main-mode > :not([data-focuslens-main-chain="true"]):not(#focuslens-overlay):not(#focuslens-hud):not(script):not(style) {
        opacity: 0.25 !important;
        filter: saturate(0.55) !important;
        pointer-events: none !important;
      }

      * {
        animation-duration: 0.01ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.12s !important;
      }

      ::-webkit-scrollbar { width: 6px; }
      ::-webkit-scrollbar-track { background: #2b2825; }
      ::-webkit-scrollbar-thumb { background: #8f8268; border-radius: 3px; }
    `,
    hideSelectors: SIDEBAR_SELECTORS,
  },

  // ── Tier 3 ─ Severe (score 75-100) ────────────────────────────────────────
  // Goals: full focus mode. Dark background reduces glare. Single column forces
  // the eye to track a predictable path. High-contrast focus ring aids keyboard
  // navigation when motor precision is impaired.
  3: {
    label: "Severe",
    description:
      "Full focus mode. Non-essential chrome hidden, main content isolated, dark mode strengthened, and media muted.",
    styles: `
      /* FocusLens Tier 3 — Severe fatigue */
      @import url('https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&display=swap');

      :root {
        color-scheme: dark !important;
        --fl-bg: #161513;
        --fl-surface: #201d1a;
        --fl-text: #efe9de;
        --fl-heading: #fde68a;
        --fl-link: #5eead4;
      }

      html, body {
        background: var(--fl-bg) !important;
        color: var(--fl-text) !important;
      }

      body.focuslens-main-mode [data-focuslens-main] {
        max-width: 70ch !important;
        margin: 0 auto !important;
        padding: 22px 20px !important;
        border-radius: 12px !important;
        background: var(--fl-surface) !important;
        box-shadow: 0 8px 30px rgba(0, 0, 0, 0.42) !important;
      }

      body.focuslens-main-mode [data-focuslens-main] :where(p, li, td, blockquote) {
        font-family: 'Atkinson Hyperlegible', Arial, sans-serif !important;
        font-size: 18px !important;
        line-height: 1.82 !important;
        letter-spacing: 0.02em !important;
        color: var(--fl-text) !important;
      }

      body.focuslens-main-mode [data-focuslens-main] :where(h1, h2, h3, h4) {
        color: var(--fl-heading) !important;
      }

      body.focuslens-main-mode [data-focuslens-main] a {
        color: var(--fl-link) !important;
      }

      body.focuslens-main-mode > :not([data-focuslens-main-chain="true"]):not(#focuslens-overlay):not(#focuslens-hud):not(script):not(style) {
        display: none !important;
      }

      img:not([role="presentation"]):not([alt=""]) {
        opacity: 0.82 !important;
        filter: grayscale(25%) brightness(0.86) !important;
      }

      * {
        animation-duration: 0.01ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.1s !important;
      }

      :focus {
        outline: 3px solid #fcd34d !important;
        outline-offset: 3px !important;
      }

      ::selection { background: #78350f; color: #fef3c7; }
    `,
    hideSelectors: CHROME_SELECTORS,
  },
};
