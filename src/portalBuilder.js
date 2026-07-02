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

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December"
];

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

async function clickCalendarDate(page, hotelDatesConfig, dateValue) {
  if (!dateValue) return false;

  const exactSelector = `td[data-day="${dateValue}"] button, td[data-day="${dateValue}"]`;
  const exactDateLocator = page.locator(exactSelector).first();
  if ((await exactDateLocator.count()) > 0) {
    await exactDateLocator.click({ force: true });
    return true;
  }

  if (hotelDatesConfig.calendarDayCell?.selector) {
    const dayNumber = String(Number(dateValue.split("-")[2] || ""));
    const dayCells = page.locator(`${hotelDatesConfig.calendarDayCell.selector}:has-text("${dayNumber}")`).first();
    if ((await dayCells.count()) > 0) {
      await dayCells.click({ force: true });
      return true;
    }
  }

  const fallbackByDate = page.locator(`button[aria-label*="${dateValue}"]`).first();
  if ((await fallbackByDate.count()) > 0) {
    await fallbackByDate.click({ force: true });
    return true;
  }

  const fallbackByDay = page.locator(`button:has-text("${String(Number(dateValue.split("-")[2] || ""))}")`).first();
  if ((await fallbackByDay.count()) > 0) {
    await fallbackByDay.click({ force: true });
    return true;
  }

  return false;
}

async function selectSpec(page, spec, value, label) {
  const locator = await locatorFromSpec(page, spec);
  if (!locator) {
    console.warn(`[portalBuilder] Could not resolve selector for ${label}`);
    return false;
  }

  try {
    await locator.waitFor({ state: "visible", timeout: 5000 });
    await locator.scrollIntoViewIfNeeded();
    try {
      await locator.click({ force: true });
    } catch (clickError) {
      const wrapper = locator.locator('xpath=ancestor::div[contains(@class,"DatePicker_control__") or contains(@class,"control") or contains(@class,"css-")]').first();
      if ((await wrapper.count()) > 0) {
        await wrapper.click({ force: true });
      } else {
        throw clickError;
      }
    }
  } catch (error) {
    console.warn(`[portalBuilder] Could not open selector for ${label}: ${error.message}`);
    return false;
  }

  await page.waitForTimeout(600);

  const optionByRole = page.locator('[role="option"]', { hasText: value }).first();
  if ((await optionByRole.count()) > 0) {
    await optionByRole.click();
    return true;
  }

  const optionByText = page.getByText(value, { exact: true }).first();
  if ((await optionByText.count()) > 0) {
    await optionByText.click();
    return true;
  }

  const optionContains = page.getByText(value, { exact: false }).first();
  if ((await optionContains.count()) > 0) {
    await optionContains.click();
    return true;
  }

  const fallback = page.locator(`div:has-text("${value}")`).first();
  if ((await fallback.count()) > 0) {
    await fallback.click();
    return true;
  }

  console.warn(`[portalBuilder] Could not select option ${value} for ${label}`);
  return false;
}

async function clickCalendarDate(page, hotelDatesConfig, dateValue) {
  if (!dateValue) return false;

  const exactSelector = `td[data-day="${dateValue}"] button, td[data-day="${dateValue}"]`;
  const exactDateLocator = page.locator(exactSelector).first();
  if ((await exactDateLocator.count()) > 0) {
    await exactDateLocator.click({ force: true });
    return true;
  }

  if (hotelDatesConfig.calendarDayCell?.selector) {
    const dayNumber = String(Number(dateValue.split("-")[2] || ""));
    const dayCells = page.locator(`${hotelDatesConfig.calendarDayCell.selector}:has-text("${dayNumber}")`).first();
    if ((await dayCells.count()) > 0) {
      await dayCells.click({ force: true });
      return true;
    }
  }

  const fallbackByDate = page.locator(`button[aria-label*="${dateValue}"]`).first();
  if ((await fallbackByDate.count()) > 0) {
    await fallbackByDate.click({ force: true });
    return true;
  }

  const fallbackByDay = page.locator(`button:has-text("${String(Number(dateValue.split("-")[2] || ""))}")`).first();
  if ((await fallbackByDay.count()) > 0) {
    await fallbackByDay.click({ force: true });
    return true;
  }

  return false;
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

function getHotelStayRange(days, hotelIndex = 0) {
  if (!Array.isArray(days) || !days.length || hotelIndex >= days.length) return { startDate: null, endDate: null };
  const current = days[hotelIndex];
  if (!current?.date) return { startDate: null, endDate: null };

  const targetAccommodation = current.accommodation?.trim() || "";
  const targetLocation = current.location?.trim() || "";
  let startDate = current.date;
  let endDate = current.date;

  for (let i = hotelIndex + 1; i < days.length; i += 1) {
    const nextDay = days[i];
    if (
      nextDay?.date &&
      nextDay.accommodation?.trim() === targetAccommodation &&
      nextDay.location?.trim() === targetLocation
    ) {
      endDate = nextDay.date;
    } else {
      break;
    }
  }

  return { startDate, endDate };
}

async function fillFields(page, fields, itinerary) {
  for (const [key, spec] of Object.entries(fields || {})) {
    const value = getFieldValue(itinerary, key);
    await fillSpec(page, spec, value, key);
  }
}

async function fillHotelDateSelection(page, hotelDatesConfig, itinerary) {
  if (!hotelDatesConfig || !itinerary.days?.length) return;
  const firstHotel = itinerary.days[0];
  if (!firstHotel) return;

  let clicked = false;
  if (hotelDatesConfig.firstHotelBox) {
    clicked = await clickSpec(page, hotelDatesConfig.firstHotelBox, "first hotel box");
    if (!clicked) {
      console.warn("Warning: hotelDates.firstHotelBox did not resolve, trying fallback selector.");
      clicked = await clickSpec(page, { selector: "div[class*='Table_activeMenuWrapper']" }, "first hotel box fallback");
    }
    await page.waitForTimeout(300);
  }

  if (hotelDatesConfig.accommodation && firstHotel.accommodation) {
    const accommodationValue = firstHotel.accommodation;
    const accommodationLocator = await locatorFromSpec(page, hotelDatesConfig.accommodation);
    if (accommodationLocator) {
      const info = await accommodationLocator.evaluate((el) => ({ tagName: el.tagName.toLowerCase(), role: el.getAttribute("role") || "" }));
      if (info.tagName === "button" || info.role.toLowerCase() === "button") {
        await clickSpec(page, hotelDatesConfig.accommodation, "first hotel accommodation button");
        await page.waitForTimeout(300);
        const filled = await fillSpec(page, hotelDatesConfig.accommodationInput || hotelDatesConfig.accommodation, accommodationValue, "first hotel accommodation");
        if (!filled) {
          console.warn("Warning: accommodation button clicked but accommodation value could not be filled.");
        }
      } else {
        await fillSpec(page, hotelDatesConfig.accommodation, accommodationValue, "first hotel accommodation");
      }
    } else {
      await fillSpec(page, hotelDatesConfig.accommodation, accommodationValue, "first hotel accommodation");
    }
    await page.waitForTimeout(300);
  }

  clicked = false;
  if (hotelDatesConfig.calendarTrigger) {
    clicked = await clickSpec(page, hotelDatesConfig.calendarTrigger, "hotel calendar trigger");
  }
  if (!clicked) {
    console.warn("Warning: hotelDates.calendarTrigger did not resolve, trying fallback Date control.");
    clicked = await clickSpec(page, { text: "Date" }, "hotel calendar trigger fallback");
    if (!clicked) {
      clicked = await clickSpec(page, { selector: "input[placeholder*='Date'], button[aria-label*='Date']" }, "hotel calendar trigger fallback input/button");
    }
  }
  await page.waitForTimeout(300);

  const [year, month, day] = firstHotel.date ? firstHotel.date.split("-") : [];
  const monthName = month ? MONTH_NAMES[Number(month) - 1] : "";

  if (monthName && hotelDatesConfig.calendarMonth) {
    const selectedMonth = await selectSpec(page, hotelDatesConfig.calendarMonth, monthName, "hotel calendar month");
    if (!selectedMonth) {
      console.warn("Warning: hotelDates.calendarMonth did not resolve or could not be selected.");
    }
    await page.waitForTimeout(250);
  }

  if (year && hotelDatesConfig.calendarYear) {
    const selectedYear = await selectSpec(page, hotelDatesConfig.calendarYear, year, "hotel calendar year");
    if (!selectedYear) {
      console.warn("Warning: hotelDates.calendarYear did not resolve or could not be selected.");
    }
    await page.waitForTimeout(250);
  }

  clicked = false;
  const { startDate, endDate } = getHotelStayRange(itinerary.days, 0);

  if (hotelDatesConfig.calendarDayCell && startDate) {
    clicked = await clickCalendarDate(page, hotelDatesConfig, startDate);
    if (clicked && endDate && endDate !== startDate) {
      await page.waitForTimeout(200);
      await clickCalendarDate(page, hotelDatesConfig, endDate);
    }
  }

  if (!clicked && hotelDatesConfig.calendarDayCell) {
    const dayValue = day ? String(Number(day)) : "";
    if (dayValue && hotelDatesConfig.calendarDayCell.selector) {
      const dayCells = page.locator(`${hotelDatesConfig.calendarDayCell.selector}:has-text("${dayValue}")`);
      if ((await dayCells.count()) > 0) {
        await dayCells.first().click();
        clicked = true;
      }
    }
    if (!clicked) {
      clicked = await clickSpec(page, hotelDatesConfig.calendarDayCell, "hotel calendar day cell");
      if (!clicked) {
        console.warn("Warning: hotelDates.calendarDayCell selector did not resolve.");
      }
    }
  }
  if (!clicked && hotelDatesConfig.calendarGrid) {
    const grid = await locatorFromSpec(page, hotelDatesConfig.calendarGrid);
    if (grid) {
      const cell = grid.locator("td[role='gridcell'], button[role='gridcell'], td").first();
      if ((await cell.count()) > 0) {
        await cell.click();
        clicked = true;
      } else {
        console.warn("Warning: no calendar day cell found inside hotelDates.calendarGrid.");
      }
    } else {
      console.warn("Warning: hotelDates.calendarGrid selector did not resolve.");
    }
  }
  if (!clicked) {
    const fallbackCell = page.locator("table[role='grid'] td[role='gridcell'], table[role='grid'] button[role='gridcell'], table[role='grid'] td").first();
    if ((await fallbackCell.count()) > 0) {
      await fallbackCell.click();
      clicked = true;
    } else {
      console.warn("Warning: no calendar day cell could be clicked by fallback selector.");
    }
  }
  await page.waitForTimeout(300);

  if (hotelDatesConfig.calendarClose) {
    const closed = await clickSpec(page, hotelDatesConfig.calendarClose, "hotel calendar close");
    if (!closed) {
      console.warn("Warning: hotelDates.calendarClose did not resolve, using fallback close.");
      await commitCalendarSelection(page, hotelDatesConfig);
    }
  } else {
    await commitCalendarSelection(page, hotelDatesConfig);
  }
}

async function commitCalendarSelection(page, hotelDatesConfig) {
  if (hotelDatesConfig.calendarApply) {
    const applied = await clickSpec(page, hotelDatesConfig.calendarApply, "hotel calendar apply");
    if (applied) {
      await page.waitForTimeout(300);
      return true;
    }
  }

  if (hotelDatesConfig.calendarClose) {
    const closed = await clickSpec(page, hotelDatesConfig.calendarClose, "hotel calendar close");
    if (closed) {
      await page.waitForTimeout(300);
      return true;
    }
  }

  const buttons = ["Done", "Apply", "OK", "Confirm", "Close"];
  for (const label of buttons) {
    const button = page.getByRole("button", { name: label, exact: true }).first();
    if ((await button.count()) > 0) {
      await button.click({ force: true });
      await page.waitForTimeout(300);
      return true;
    }
  }

  try {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);
  } catch (_) {}

  try {
    await page.click("body", { force: true, position: { x: 10, y: 10 } });
    await page.waitForTimeout(250);
    return true;
  } catch (_) {
    return false;
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

  // Accept cookie banner if configured (some portals block controls)
  if (config.cookieButton) {
    try {
      const clicked = await clickSpec(page, config.cookieButton, "accept cookies");
      if (clicked) await page.waitForTimeout(500);
    } catch (err) {
      console.warn(`Warning: accept cookies click failed: ${err.message}`);
    }
  }

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

  // Click the configured "next" button if present (advance the form)
  if (config.nextButton) {
    try {
      const clicked = await clickSpec(page, config.nextButton, "next button");
      if (!clicked) {
        console.warn("Warning: next button not found or not clickable.");
      } else {
        // wait for UI to advance
        await page.waitForTimeout(750);
      }
    } catch (error) {
      console.warn(`Warning: clicking next button failed: ${error.message}`);
    }
  }

  // If configured, select the Classic builder option after Next
  if (config.builderSwitch) {
    try {
      // give the panel a moment to render
      await page.waitForTimeout(500);
      const clicked = await clickSpec(page, config.builderSwitch, "builder switch");
      if (!clicked) console.warn("Warning: builder switch not found or not clickable.");
      else await page.waitForTimeout(500);
    } catch (error) {
      console.warn(`Warning: clicking builder switch failed: ${error.message}`);
    }
  }

  // If configured, open the hotel date selection UI and pick the first hotel/date block
  if (config.hotelDates) {
    try {
      await fillHotelDateSelection(page, config.hotelDates, itinerary);
    } catch (error) {
      console.warn(`Warning: hotel date selection flow failed: ${error.message}`);
    }
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
