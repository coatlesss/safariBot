const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { chromium } = require("playwright");

let ensureInstalledPromise = null;

// `npm install` only downloads Chromium via playwright's own postinstall
// hook, which is easy to lose (--ignore-scripts, a CI cache restore, a
// packaged build whose bundling step didn't run) - and once it's missing,
// chromium.launch() fails with a cryptic "Executable doesn't exist" error
// with no way to recover short of a manual `npx playwright install`. Check
// for it before every launch and install on the spot if it's absent, so a
// missing browser fixes itself on first run instead of crashing.
function ensureChromiumInstalled() {
  if (!ensureInstalledPromise) {
    ensureInstalledPromise = (async () => {
      const executablePath = chromium.executablePath();
      if (executablePath && fs.existsSync(executablePath)) return;

      console.warn("[browserSetup] Chromium not found, installing now (first run) - this can take a minute...");
      const cliPath = path.join(path.dirname(require.resolve("playwright/package.json")), "cli.js");
      execFileSync(process.execPath, [cliPath, "install", "chromium"], { stdio: "inherit" });

      const installedPath = chromium.executablePath();
      if (!installedPath || !fs.existsSync(installedPath)) {
        throw new Error("Chromium install did not complete - check your network connection and try again.");
      }
    })().catch((error) => {
      ensureInstalledPromise = null; // let the next attempt retry instead of replaying a cached failure
      throw error;
    });
  }
  return ensureInstalledPromise;
}

module.exports = { ensureChromiumInstalled };
