const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

function asText(value) {
  if (!value) return "";
  if (Array.isArray(value)) return value.filter(Boolean).join("\n");
  return String(value);
}

function escapeAttribute(value) {
  return value.replace(/"/g, '\\"').replace(/\[/g, '\\[').replace(/\]/g, '\\]');
}

function escapeAttribute(value) {
  return value.replace(/"/g, '\\"').replace(/\[/g, '\\[').replace(/\]/g, '\\]');
}

async function locatorFromSpec(scope, spec) {
  if (!spec) return null;
  if (spec.selector) return scope.locator(spec.selector).first();

  if (spec.label) {
    const locator = scope.getByLabel(spec.label, { exact: false }).first();
    if ((await locator.count()) > 0) return locator;
  }

  if (spec.placeholder) {
    const placeholderLocator = scope.getByPlaceholder(spec.placeholder, { exact: false }).first();
    if ((await placeholderLocator.count()) > 0) return placeholderLocator;

    const attrSelector = `input[placeholder*="${escapeAttribute(spec.placeholder)}"], textarea[placeholder*="${escapeAttribute(spec.placeholder)}"]`;
    const attrLocator = scope.locator(attrSelector).first();
    if ((await attrLocator.count()) > 0) return attrLocator;

    const ariaLocator = scope.getByRole("textbox", { name: new RegExp(escapeRegex(spec.placeholder), "i") }).first();
    if ((await ariaLocator.count()) > 0) return ariaLocator;
  }

  if (spec.testId) return scope.getByTestId(spec.testId).first();

  if (spec.role && spec.name) {
    const roleLocator = scope.getByRole(spec.role, { name: new RegExp(escapeRegex(spec.name), "i") }).first();
    if ((await roleLocator.count()) > 0) return roleLocator;

    const textRoleLocator = scope.getByText(spec.name, { exact: false }).first();
    if ((await textRoleLocator.count()) > 0) return textRoleLocator;
  }

  if (spec.text) {
    const textLocator = scope.getByText(spec.text, { exact: false }).first();
    if ((await textLocator.count()) > 0) return textLocator;
  }

  return null;
}

async function fillSpec(scope, spec, value, label) {
  const text = asText(value);
  if (!text) return false;

  const locator = await locatorFromSpec(scope, spec);
  if (!locator) return false;

  await locator.waitFor({ state: "visible", timeout: 5000 });

  try {
    await locator.fill(text);
    // If this is a react-select or combobox, press Enter to create/select the option
    try {
      const info = await locator.evaluate((el) => ({ id: el.id || "", role: el.getAttribute("role") || "" }));
      if ((info.id && info.id.startsWith("react-select")) || (info.role && info.role.toLowerCase() === "combobox")) {
        await locator.press("Enter");
      }
    } catch (_) {}
    return true;
  } catch (error) {
    try {
      await locator.click({ force: true });
      await locator.fill(text);
      try {
        const info = await locator.evaluate((el) => ({ id: el.id || "", role: el.getAttribute("role") || "" }));
        if ((info.id && info.id.startsWith("react-select")) || (info.role && info.role.toLowerCase() === "combobox")) {
          await locator.press("Enter");
        }
      } catch (_) {}
      return true;
    } catch (_) {
      try {
        await locator.click({ force: true });
        await locator.type(text, { delay: 50 });
        try {
          const info = await locator.evaluate((el) => ({ id: el.id || "", role: el.getAttribute("role") || "" }));
          if ((info.id && info.id.startsWith("react-select")) || (info.role && info.role.toLowerCase() === "combobox")) {
            await locator.press("Enter");
          }
        } catch (_) {}
        return true;
      } catch (typeError) {
        throw new Error(`Could not fill ${label}: ${error.message}; fallback type failed: ${typeError.message}`);
      }
    }
  }
}

async function clickSpec(scope, spec, label) {
  const locator = await locatorFromSpec(scope, spec);
  if (!locator) {
    console.warn(`[portalBuilder] Could not resolve locator for ${label}`);
    return false;
  }

  try {
    await locator.waitFor({ state: "visible", timeout: 5000 });
    await locator.scrollIntoViewIfNeeded();
    await locator.click();
    return true;
  } catch (error) {
    try {
      await locator.scrollIntoViewIfNeeded();
      await locator.click({ force: true });
      return true;
    } catch (forceError) {
      console.warn(`[portalBuilder] Click fallback failed for ${label}: ${forceError.message}`);
      return false;
    }
  }
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getFieldValue(itinerary, key) {
  if (key === "tripTitle") {
    return "Route Itinerary";
  }
  if (key === "fileName") {
    if (itinerary.fileName) return itinerary.fileName;
    const customerType = (itinerary.customerType || "b2c").toLowerCase();
    const client = itinerary.lastName || itinerary.clientName || "";
    const agency = itinerary.agencyName || "";

    if (customerType === "b2b") {
      // Format: JTG <agency> <client>
      const parts = ["JTG"];
      if (agency) parts.push(agency);
      if (client) parts.push(client);
      return parts.join(" ").trim();
    }

    // Default (b2c): Format: WT - <client>
    const parts = ["WT"];
    if (client) parts.push(client);
    return parts.join(" - ").trim();
  }

  if (key === "travelDates") {
    if (itinerary.startDate && itinerary.endDate) {
      return itinerary.startDate === itinerary.endDate
        ? itinerary.startDate
        : `${itinerary.startDate} - ${itinerary.endDate}`;
    }
    return itinerary.startDate || itinerary.endDate || "";
  }

  return itinerary[key];
}

async function fillFields(page, fields, itinerary) {
  for (const [key, spec] of Object.entries(fields || {})) {
    const value = getFieldValue(itinerary, key);
    await fillSpec(page, spec, value, key);
  }
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

  await fillFields(page, config.fields, itinerary);

  for (let index = 0; index < itinerary.days.length; index += 1) {
    if (index > 0 && config.days?.addDayButton) {
      const clicked = await clickSpec(page, config.days.addDayButton, "add day button");
      if (!clicked) {
        console.warn(`Warning: add day button not found for day ${index + 1}, continuing without clicking.`);
      }
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

  if (options.keepOpen) {
    return;
  }

  await browser.close();
}

module.exports = {
  buildPortalDraft
};
