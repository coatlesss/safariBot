const fs = require("fs");
const path = require("path");
const readline = require("readline/promises");
const { chromium } = require("playwright");

async function login(config) {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  await page.goto(config.loginUrl, { waitUntil: "domcontentloaded" });

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await rl.question("Log in in the browser, then press Enter here to save the session...");
  rl.close();

  const storagePath = path.resolve(config.storageStatePath);
  fs.mkdirSync(path.dirname(storagePath), { recursive: true });
  await page.context().storageState({ path: storagePath });
  await browser.close();

  return storagePath;
}

module.exports = {
  login
};
