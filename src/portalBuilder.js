const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

function asText(value) {
  if (!value) return "";
  if (Array.isArray(value)) return value.filter(Boolean).join("\n");
  return String(value);
}

async function locatorFromSpec(scope, spec) {
  if (!spec) return null;
  if (spec.selector) return scope.locator(spec.selector).first();
  if (spec.label) return scope.getByLabel(spec.label, { exact: false }).first();
  if (spec.placeholder) return scope.getByPlaceholder(spec.placeholder, { exact: false }).first();
  if (spec.testId) return scope.getByTestId(spec.testId).first();
  if (spec.role && spec.name) return scope.getByRole(spec.role, { name: new RegExp(escapeRegex(spec.name), "i") }).first();
  if (spec.text) return scope.getByText(spec.text, { exact: false }).first();
  return null;
}

async function fillSpec(scope, spec, value, label) {
  const text = asText(value);
  if (!text) return false;

  const locator = await locatorFromSpec(scope, spec);
  if (!locator) return false;

  try {
    await locator.waitFor({ state: "visible", timeout: 5000 });
    await locator.fill(text);
    return true;
  } catch (error) {
    throw new Error(`Could not fill ${label}: ${error.message}`);
  }
}

async function clickSpec(scope, spec, label) {
  const locator = await locatorFromSpec(scope, spec);
  if (!locator) return false;

  try {
    await locator.waitFor({ state: "visible", timeout: 5000 });
    await locator.click();
    return true;
  } catch (error) {
    throw new Error(`Could not click ${label}: ${error.message}`);
  }
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function dayScope(page, config, index) {
  const selector = config.days?.containerSelector;
  if (!selector) return page;
  return page.locator(selector.replace("{index}", String(index))).first();
}

async function buildPortalDraft(config, itinerary, options = {}) {
  const storagePath = path.resolve(config.storageStatePath);
  if (!fs.existsSync(storagePath)) {
    throw new Error(`Login session not found at ${storagePath}. Run npm run login first.`);
  }

  const browser = await chromium.launch({ headless: Boolean(config.headless) });
  const context = await browser.newContext({ storageState: storagePath });
  const page = await context.newPage();

  await page.goto(config.newItineraryUrl, { waitUntil: "domcontentloaded" });

  const fields = config.fields || {};
  await fillSpec(page, fields.tripTitle, itinerary.tripTitle, "trip title");
  await fillSpec(page, fields.clientName, itinerary.clientName, "client name");
  await fillSpec(page, fields.startDate, itinerary.startDate, "start date");
  await fillSpec(page, fields.endDate, itinerary.endDate, "end date");
  await fillSpec(page, fields.summaryNotes, itinerary.summaryNotes, "summary notes");

  for (let index = 0; index < itinerary.days.length; index += 1) {
    if (index > 0 && config.days?.addDayButton) {
      await clickSpec(page, config.days.addDayButton, "add day button");
    }

    const day = itinerary.days[index];
    const scope = await dayScope(page, config, index);
    const dayFields = config.days?.fields || {};
    await fillSpec(scope, dayFields.date, day.date, `day ${index + 1} date`);
    await fillSpec(scope, dayFields.location, day.location, `day ${index + 1} location`);
    await fillSpec(scope, dayFields.accommodation, day.accommodation, `day ${index + 1} accommodation`);
    await fillSpec(scope, dayFields.activities, day.activities, `day ${index + 1} activities`);
    await fillSpec(scope, dayFields.transfers, day.transfers, `day ${index + 1} transfers`);
    await fillSpec(scope, dayFields.flights, day.flights, `day ${index + 1} flights`);
    await fillSpec(scope, dayFields.meals, day.meals, `day ${index + 1} meals`);
    await fillSpec(scope, dayFields.notes, day.notes, `day ${index + 1} notes`);
  }

  if (options.submit && config.submitButton) {
    await clickSpec(page, config.submitButton, "submit button");
    await browser.close();
    return;
  }

  await page.pause();
  await browser.close();
}

module.exports = {
  buildPortalDraft
};
