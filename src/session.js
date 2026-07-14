const fs = require("fs");
const path = require("path");
const readline = require("readline/promises");
const { chromium } = require("playwright");
const { ensureChromiumInstalled } = require("./browserSetup");

async function login(config, options = {}) {
  await ensureChromiumInstalled();
  const browser = await chromium.launch({ headless: false });
  // browser.newPage() creates an implicit context that closes along with
  // the page - fine normally, but this flow closes the page itself (either
  // by the user or automatically once login redirects away) before saving
  // its storage state, so the context needs to outlive the page.
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(config.loginUrl, { waitUntil: "domcontentloaded" });

  if (options.waitForClose) {
    // Logging in normally redirects away from loginUrl - close the window
    // for the user at that point instead of making them do it by hand.
    // Manually closing still works too (e.g. if login doesn't redirect for
    // some reason), whichever happens first wins.
    let userClosed = false;
    page.once("close", () => { userClosed = true; });
    await Promise.race([
      page.waitForEvent("close", { timeout: 0 }),
      page.waitForURL((url) => url.toString() !== config.loginUrl, { timeout: 0 })
    ]).catch(() => {});

    if (!userClosed) {
      await page.close().catch(() => {});
    }
  } else {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    await rl.question("Log in in the browser, then press Enter here to save the session...");
    rl.close();
  }

  const storagePath = path.resolve(config.storageStatePath);
  fs.mkdirSync(path.dirname(storagePath), { recursive: true });
  await context.storageState({ path: storagePath });
  await browser.close();

  return storagePath;
}

module.exports = {
  login
};
