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
  // Goals: Reader Mode — extract main article content, apply soft dark theme,
  // remove all distractions. Uses Mozilla Readability for content extraction.
  3: {
    label: "Severe",
    description:
      "Reader Mode: extracts main article, removes all distractions, applies soft dark theme.",
    styles: `
      /* FocusLens Tier 3 — Reader Mode */
      :root {
        color-scheme: dark !important;
      }

      html, body {
        background: #1A1A1A !important;
        color: #E6E1CF !important;
        margin: 0 !important;
        padding: 0 !important;
      }

      body.focuslens-reader-mode {
        display: flex !important;
        justify-content: center !important;
        padding: 40px 20px !important;
        min-height: 100vh !important;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif !important;
      }

      #focuslens-reader-root {
        max-width: 720px !important;
        width: 100% !important;
      }

      .focuslens-reader-article {
        background: #1A1A1A !important;
        color: #E6E1CF !important;
      }

      .reader-byline {
        font-size: 14px !important;
        color: #A8A096 !important;
        margin-bottom: 12px !important;
        font-style: italic !important;
      }

      .reader-title {
        font-size: 36px !important;
        font-weight: 700 !important;
        color: #F5E6D3 !important;
        line-height: 1.25 !important;
        margin: 0 0 32px 0 !important;
        letter-spacing: -0.02em !important;
      }

      .reader-content {
        font-size: 19px !important;
        line-height: 1.7 !important;
        color: #E6E1CF !important;
      }

      .reader-content p {
        margin: 0 0 24px 0 !important;
        line-height: 1.7 !important;
      }

      .reader-content h2 {
        font-size: 28px !important;
        color: #F5E6D3 !important;
        margin: 48px 0 20px 0 !important;
        font-weight: 600 !important;
        letter-spacing: -0.01em !important;
      }

      .reader-content h3 {
        font-size: 22px !important;
        color: #F5E6D3 !important;
        margin: 36px 0 16px 0 !important;
        font-weight: 600 !important;
      }

      .reader-content h4 {
        font-size: 19px !important;
        color: #E6E1CF !important;
        margin: 28px 0 14px 0 !important;
        font-weight: 600 !important;
      }

      .reader-content a {
        color: #7AB8FF !important;
        text-decoration: underline !important;
      }

      .reader-content a:hover {
        color: #A0CEFF !important;
      }

      .reader-content img {
        max-width: 100% !important;
        height: auto !important;
        border-radius: 8px !important;
        margin: 32px 0 !important;
        display: block !important;
      }

      .reader-content blockquote {
        background: #2A2A2A !important;
        border-left: 4px solid #7AB8FF !important;
        padding: 16px 20px !important;
        margin: 24px 0 !important;
        font-style: italic !important;
        color: #D4CFBD !important;
      }

      .reader-content pre {
        background: #252525 !important;
        padding: 16px !important;
        border-radius: 6px !important;
        overflow-x: auto !important;
        margin: 24px 0 !important;
        border: 1px solid #333 !important;
      }

      .reader-content code {
        background: #252525 !important;
        padding: 3px 6px !important;
        border-radius: 3px !important;
        font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Courier New', monospace !important;
        font-size: 16px !important;
        color: #E6E1CF !important;
      }

      .reader-content pre code {
        background: transparent !important;
        padding: 0 !important;
      }

      .reader-content ul, .reader-content ol {
        margin: 24px 0 !important;
        padding-left: 32px !important;
      }

      .reader-content li {
        margin-bottom: 12px !important;
        line-height: 1.7 !important;
      }

      .reader-content strong, .reader-content b {
        color: #F5E6D3 !important;
        font-weight: 600 !important;
      }

      .reader-content em, .reader-content i {
        color: #D4CFBD !important;
      }

      .reader-content hr {
        border: none !important;
        border-top: 1px solid #3A3A3A !important;
        margin: 48px 0 !important;
      }

      .reader-content figure {
        margin: 32px 0 !important;
      }

      .reader-content figcaption {
        font-size: 15px !important;
        color: #A8A096 !important;
        text-align: center !important;
        margin-top: 12px !important;
        font-style: italic !important;
      }

      .reader-content table {
        width: 100% !important;
        border-collapse: collapse !important;
        margin: 24px 0 !important;
      }

      .reader-content th, .reader-content td {
        padding: 10px 12px !important;
        border: 1px solid #3A3A3A !important;
        text-align: left !important;
      }

      .reader-content th {
        background: #252525 !important;
        font-weight: 600 !important;
        color: #F5E6D3 !important;
      }

      * {
        animation-duration: 0.01ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.1s !important;
      }

      ::selection {
        background: #4A4A4A !important;
        color: #F5E6D3 !important;
      }

      /* Ensure overlay and HUD remain visible in reader mode */
      #focuslens-overlay, #focuslens-hud {
        display: block !important;
      }
    `,
    hideSelectors: CHROME_SELECTORS,
  },
};
