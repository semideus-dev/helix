// rollup.config.js — FocusLens build configuration
//
// WHY THREE SEPARATE TARGETS?
// ───────────────────────────
// Chrome MV3 has strict content script sandboxing. Content scripts run in an
// isolated world and share no JS context with the page or each other unless
// explicitly bridged. We need three separate IIFE bundles because:
//
//   1. content.bundle.js  — injected by the browser as a content script.
//      signals.js is the entry point; it imports adapter.js and observer.js
//      so that all three modules initialise in a single execution context,
//      sharing module-level state (currentTier, buffers, etc.).
//
//   2. eyetracking.bundle.js — kept separate because it pulls in the MediaPipe
//      WASM pipeline (~8 MB of JS). Bundling it into content.bundle.js would
//      make EVERY page load that cost even when the user hasn't enabled the
//      camera. It is injected on-demand by the background worker via
//      chrome.scripting.executeScript only after the user grants camera
//      permission, so the heavy payload is always opt-in.
//
//   3. worker.bundle.js — the MV3 service worker. Service workers run in their
//      own global scope and cannot share code with content scripts at runtime,
//      so they require their own bundle entry. Rollup's 'iife' format is fine
//      here because service workers execute as classic scripts (not ES modules)
//      in Chrome MV3 today (importScripts support is present but 'iife' avoids
//      any "module" keyword that might confuse older Chrome versions in the
//      field).
//
// WHY rollup-plugin-copy RUNS ONLY ON TARGET 1?
// ───────────────────────────────────────────────
// Rollup processes each target sequentially. If copy() is listed in every
// target's plugins array it would run three times, producing duplicate file
// operations, occasional EEXIST errors on large binary .wasm/.data assets,
// and slower builds. Attaching it exclusively to Target 1 (content scripts)
// ensures assets are copied exactly once per build.

import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import copy from "rollup-plugin-copy";

const MEDIAPIPE_SRC = "node_modules/@mediapipe/face_mesh";
const MEDIAPIPE_DST = "dist/assets/mediapipe";

export default [
  // ─── TARGET 1: Content-script main bundle ────────────────────────────────
  // Entry: signals.js, which imports adapter.js and observer.js at the top.
  // All three content modules share module-level state in this single IIFE.
  {
    input: "src/content/signals.js",
    output: {
      file: "dist/content.bundle.js",
      format: "iife",
      name: "FocusLensContent",
      // sourcemap: true  ← enable during development for easier debugging
    },
    plugins: [
      resolve(),
      commonjs(),

      // copy() runs ONLY here — see explanation at top of file.
      copy({
        targets: [
          // MediaPipe runtime assets — actual filenames from @mediapipe/face_mesh npm package.
          // NOTE: the npm package uses *_wasm_bin naming, NOT face_mesh_solution.*
          {
            src: `${MEDIAPIPE_SRC}/face_mesh_solution_packed_assets_loader.js`,
            dest: MEDIAPIPE_DST,
          },
          {
            src: `${MEDIAPIPE_SRC}/face_mesh_solution_packed_assets.data`,
            dest: MEDIAPIPE_DST,
          },
          {
            src: `${MEDIAPIPE_SRC}/face_mesh_solution_simd_wasm_bin.js`,
            dest: MEDIAPIPE_DST,
          },
          {
            src: `${MEDIAPIPE_SRC}/face_mesh_solution_simd_wasm_bin.wasm`,
            dest: MEDIAPIPE_DST,
          },
          {
            src: `${MEDIAPIPE_SRC}/face_mesh_solution_simd_wasm_bin.data`,
            dest: MEDIAPIPE_DST,
          },
          {
            src: `${MEDIAPIPE_SRC}/face_mesh_solution_wasm_bin.js`,
            dest: MEDIAPIPE_DST,
          },
          {
            src: `${MEDIAPIPE_SRC}/face_mesh_solution_wasm_bin.wasm`,
            dest: MEDIAPIPE_DST,
          },
          // face_mesh.js is the main entry point (defines window.FaceMesh)
          { src: `${MEDIAPIPE_SRC}/face_mesh.js`, dest: MEDIAPIPE_DST },
          { src: `${MEDIAPIPE_SRC}/face_mesh.binarypb`, dest: MEDIAPIPE_DST },

          // Extension manifest — Chrome loads this from the root of the
          // unpacked extension folder, which is dist/ after building.
          {
            src: "manifest.json",
            dest: "dist",
          },

          // Popup HTML + JS — copied as-is; popup.js does not need bundling
          // because it only uses chrome.* APIs (globally available in extension
          // pages) and does not import any node_modules.
          {
            src: "src/popup",
            dest: "dist",
          },

          // eyetracking.html — the extension iframe page that hosts MediaPipe.
          // Runs in chrome-extension:// origin so getUserMedia works.
          {
            src: "src/eyetracking.html",
            dest: "dist",
          },
        ],
        // hook: 'writeBundle' ensures files exist before Chrome tries to load them
        hook: "writeBundle",
        // Overwrite on every build so stale assets don't linger
        overwrite: true,
      }),
    ],
  },

  // ─── TARGET 2: Eye-tracking bundle (opt-in, heavy) ───────────────────────
  // Loaded on-demand via chrome.scripting.executeScript after camera permission
  // is granted. Keeping it separate avoids the ~8 MB MediaPipe payload on
  // every page load for users who never enable eye tracking.
  {
    input: "src/content/eyetracking.js",
    output: {
      file: "dist/eyetracking.bundle.js",
      format: "iife",
      name: "FocusLensEye",
    },
    plugins: [
      resolve(),
      commonjs(),
      // No copy() here — would duplicate asset copies (see top comment).
    ],
  },

  // ─── TARGET 3: Background service worker ─────────────────────────────────
  // MV3 service workers run as classic scripts in their own global scope.
  // They cannot share runtime state with content scripts; communication is
  // exclusively through chrome.runtime.sendMessage / chrome.storage.
  {
    input: "src/background/worker.js",
    output: {
      file: "dist/worker.bundle.js",
      format: "iife",
      name: "FocusLensWorker",
    },
    plugins: [
      resolve(),
      commonjs(),
      // No copy() here — would duplicate asset copies (see top comment).
    ],
  },
];
