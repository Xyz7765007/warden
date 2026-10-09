import type { NextConfig } from "next";

const OCR_FILES = [
  "./data/tessdata/**/*",
  "./node_modules/tesseract.js-core/**/*",
  "./node_modules/tesseract.js/src/**/*",
  ...["is-url", "node-fetch", "whatwg-url", "tr46", "webidl-conversions", "regenerator-runtime", "wasm-feature-detect", "bmp-js", "zlibjs"].map((p) => `./node_modules/${p}/**/*`),
];

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // OCR runs in a worker thread and loads its WASM core and language data from disk; keep
  // these packages as plain Node requires and ship the files with the scan function.
  serverExternalPackages: ["tesseract.js", "tesseract.js-core", "sharp", "unpdf"],
  // The OCR worker thread is started from a file path, so the bundler cannot see what it
  // requires: list its packages here or the worker dies on start in production.
  outputFileTracingIncludes: {
    "/api/scan": OCR_FILES,
    // The agent scenarios also read their sample attachments from disk on the server.
    "/api/agent": [...OCR_FILES, "./public/samples/**/*"],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
