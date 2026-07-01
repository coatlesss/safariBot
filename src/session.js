const fs = require("fs");
const path = require("path");
const readline = require("readline/promises");
const { chromium } = require("playwright");

async function login(config, options = {}) {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  await page.goto(config.loginUrl, { waitUntil: "domcontentloaded" });

  if (options.waitForClose) {
    await page.waitForEvent("close").catch(() => {});
  } else {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    await rl.question("Log in in the browser, then press Enter here to save the session...");
    rl.close();
  }

  const storagePath = path.resolve(config.storageStatePath);
  fs.mkdirSync(path.dirname(storagePath), { recursive: true });
  await browser.contexts()[0].storageState({ path: storagePath });
  await browser.close();

  return storagePath;
}

module.exports = {
  login
};
