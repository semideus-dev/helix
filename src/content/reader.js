/**
 * src/content/reader.js
 * ─────────────────────
 * Reader Mode extraction and view builder using Mozilla Readability.
 *
 * Responsibility:
 *   - Extract clean article content from current page DOM
 *   - Build reader-optimized view with extracted content
 *   - Handle fallback when content extraction fails
 */

import { Readability } from "@mozilla/readability";

/**
 * extractArticle()
 * Attempts to parse the current document and extract article content.
 * Returns null if extraction fails or content is too short.
 *
 * @returns {Object|null} - { title, byline, content, textContent, excerpt, length } or null
 */
export function extractArticle() {
  try {
    // Readability mutates the DOM, so we must pass a clone
    const documentClone = document.cloneNode(true);

    const reader = new Readability(documentClone, {
      charThreshold: 500, // Minimum text length to consider it an article
      nbTopCandidates: 5, // Number of candidates to consider
      keepClasses: false, // Strip all classes for clean output
    });

    const article = reader.parse();

    if (!article) {
      console.warn("[FocusLens Reader] No article content found");
      return null;
    }

    // Skip very short content (likely not a real article)
    if (article.length < 500) {
      console.warn(
        "[FocusLens Reader] Content too short:",
        article.length,
        "chars"
      );
      return null;
    }

    console.log("[FocusLens Reader] Extracted:", {
      title: article.title,
      length: article.length,
      hasImages: (article.content.match(/<img/g) || []).length,
    });

    return article;
  } catch (err) {
    console.error("[FocusLens Reader] Extraction failed:", err);
    return null;
  }
}

/**
 * buildReaderView(article)
 * Constructs a clean, reader-optimized DOM tree from extracted article.
 *
 * @param {Object} article - Result from extractArticle()
 * @returns {HTMLElement|null} - Reader root element or null
 */
export function buildReaderView(article) {
  if (!article) return null;

  const wrapper = document.createElement("div");
  wrapper.id = "focuslens-reader-root";

  // Build article HTML with semantic structure
  const bylineHTML = article.byline
    ? `<p class="reader-byline">${escapeHTML(article.byline)}</p>`
    : "";

  const titleHTML = `<h1 class="reader-title">${escapeHTML(
    article.title || "Article"
  )}</h1>`;

  // article.content is already sanitized HTML from Readability
  const contentHTML = `<div class="reader-content">${article.content}</div>`;

  wrapper.innerHTML = `
    <article class="focuslens-reader-article">
      ${bylineHTML}
      ${titleHTML}
      ${contentHTML}
    </article>
  `;

  return wrapper;
}

/**
 * escapeHTML(str)
 * Basic HTML escape for user-supplied metadata (title, byline).
 * Content HTML is already sanitized by Readability.
 */
function escapeHTML(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
