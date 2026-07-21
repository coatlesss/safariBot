const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { ensureChromiumInstalled } = require("./browserSetup");

const openDraftBrowsers = new Set();
let _debugLastPage = null;
let currentWarnings = null;

// Every soft-failure warning in this file also records into the in-flight
// build's warnings array (if any), so a locator that silently couldn't be
// resolved surfaces to the UI as "check this before you submit" instead of
// only ever reaching a console nobody's watching. A module-level slot is
// enough here (no need to thread a param through every helper) because the
// UI disables the Build button for the duration of a build, so only one
// buildPortalDraft() run is ever collecting warnings at a time.
function warn(message) {
  console["warn"](message);
  if (currentWarnings) currentWarnings.push(message);
}

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
  if (spec.selector) return indexedLocator(scope.locator(spec.selector), spec);

  if (spec.label) {
    const locator = indexedLocator(scope.getByLabel(spec.label, { exact: false }), spec);
    if ((await locator.count()) > 0) return locator;
  }

  if (spec.placeholder) {
    const placeholderLocator = indexedLocator(scope.getByPlaceholder(spec.placeholder, { exact: false }), spec);
    if ((await placeholderLocator.count()) > 0) return placeholderLocator;

    const attrSelector = `input[placeholder*="${escapeAttribute(spec.placeholder)}"], textarea[placeholder*="${escapeAttribute(spec.placeholder)}"]`;
    const attrLocator = indexedLocator(scope.locator(attrSelector), spec);
    if ((await attrLocator.count()) > 0) return attrLocator;

    const ariaLocator = indexedLocator(scope.getByRole("textbox", { name: new RegExp(escapeRegex(spec.placeholder), "i") }), spec);
    if ((await ariaLocator.count()) > 0) return ariaLocator;
  }

  if (spec.testId) return indexedLocator(scope.getByTestId(spec.testId), spec);

  if (spec.role && spec.name) {
    const roleLocator = indexedLocator(scope.getByRole(spec.role, { name: new RegExp(escapeRegex(spec.name), "i") }), spec);
    if ((await roleLocator.count()) > 0) return roleLocator;

    const textRoleLocator = indexedLocator(scope.getByText(spec.name, { exact: false }), spec);
    if ((await textRoleLocator.count()) > 0) return textRoleLocator;
  }

  if (spec.text) {
    const textLocator = indexedLocator(scope.getByText(spec.text, { exact: false }), spec);
    if ((await textLocator.count()) > 0) return textLocator;
  }

  return null;
}

function indexedLocator(locator, spec) {
  if (spec?.last) return locator.last();
  return Number.isInteger(spec?.nth) ? locator.nth(spec.nth) : locator.first();
}

async function fillSpec(scope, spec, value, label) {
  const text = asText(value);
  if (!text) return false;

  const locator = await locatorFromSpec(scope, spec);
  if (!locator) {
    if (spec) warn(`[portalBuilder] Could not resolve locator for ${label}`);
    return false;
  }

  // A selector-based spec always yields a truthy (lazy) locator even when
  // nothing matches, so a selector that resolves to zero elements would
  // otherwise hang here for the full timeout and then throw uncaught,
  // aborting the whole build instead of warning and moving on like every
  // other soft failure in this file.
  try {
    await locator.waitFor({ state: "visible", timeout: 5000 });
  } catch (error) {
    warn(`[portalBuilder] Could not resolve locator for ${label}: ${error.message}`);
    return false;
  }

  try {
    await locator.fill(text);
    await confirmComboboxSelection(locator, spec);
    return true;
  } catch (error) {
    try {
      await locator.click({ force: true });
      await locator.fill(text);
      await confirmComboboxSelection(locator, spec);
      return true;
    } catch (_) {
      try {
        await locator.click({ force: true });
        await locator.type(text, { delay: 50 });
        await confirmComboboxSelection(locator, spec);
        return true;
      } catch (typeError) {
        throw new Error(`Could not fill ${label}: ${error.message}; fallback type failed: ${typeError.message}`);
      }
    }
  }
}

// A react-select input (or any combobox) needs its typed text confirmed
// with Enter to actually select/create the option - fill() alone just
// leaves it sitting in the box. A remote/async-backed select (e.g. a
// content-library page picker) can take noticeably longer than a small
// local list to populate its suggestion dropdown, so pressing Enter
// immediately can fire before a matching option ever appears, in which
// case the value never gets confirmed even though it looks "typed".
async function confirmComboboxSelection(locator, spec) {
  try {
    const info = await locator.evaluate((el) => ({ id: el.id || "", role: el.getAttribute("role") || "" }));
    if ((info.id && info.id.startsWith("react-select")) || (info.role && info.role.toLowerCase() === "combobox")) {
      await locator.page().waitForTimeout(spec?.commitDelayMs ?? 2000);
      await locator.press("Enter");
    }
  } catch (_) {}
}

async function clickSpec(scope, spec, label) {
  const locator = await locatorFromSpec(scope, spec);
  if (!locator) {
    warn(`[portalBuilder] Could not resolve locator for ${label}`);
    return false;
  }
  const page = typeof scope?.mouse?.click === "function"
    ? scope
    : (typeof scope?.page === "function" ? scope.page() : null);

  const clickOptions = {};
  if (Number.isFinite(spec?.x) || Number.isFinite(spec?.y)) {
    clickOptions.position = {
      x: Number.isFinite(spec?.x) ? spec.x : 0,
      y: Number.isFinite(spec?.y) ? spec.y : 0
    };
  }

  try {
    await locator.waitFor({ state: "visible", timeout: 5000 });
    await locator.scrollIntoViewIfNeeded();
    await locator.click(clickOptions);
    return true;
  } catch (error) {
    if (page) {
      try {
        const box = await locator.boundingBox();
        if (box) {
          const x = box.x + (clickOptions.position?.x ?? Math.min(24, Math.max(1, box.width / 2)));
          const y = box.y + (clickOptions.position?.y ?? Math.min(24, Math.max(1, box.height / 2)));
          await page.mouse.click(x, y);
          return true;
        }
      } catch (_) {}
    }

    try {
      await locator.scrollIntoViewIfNeeded();
      await locator.click({ ...clickOptions, force: true });
      return true;
    } catch (forceError) {
      warn(`[portalBuilder] Click fallback failed for ${label}: ${forceError.message}`);
      return false;
    }
  }
}

async function selectSpec(page, spec, value, label) {
  const locator = await locatorFromSpec(page, spec);
  if (!locator) {
    warn(`[portalBuilder] Could not resolve selector for ${label}`);
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
    warn(`[portalBuilder] Could not open selector for ${label}: ${error.message}`);
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

  warn(`[portalBuilder] Could not select option ${value} for ${label}`);
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

function getHotelStays(days) {
  const stays = [];
  if (!Array.isArray(days)) return stays;

  for (let index = 0; index < days.length; index += 1) {
    const day = days[index];
    const accommodation = String(day?.accommodation || "").trim();
    const propertyName = String(day?.propertyName || "").trim();
    if (!accommodation && !propertyName) continue;

    const location = String(day?.location || "").trim();
    let endIndex = index;
    while (
      endIndex + 1 < days.length &&
      String(days[endIndex + 1]?.accommodation || "").trim() === accommodation &&
      String(days[endIndex + 1]?.propertyName || "").trim() === propertyName &&
      String(days[endIndex + 1]?.location || "").trim() === location
    ) {
      endIndex += 1;
    }

    stays.push({
      startIndex: index,
      endIndex,
      firstDay: day,
      startDate: day.date || "",
      endDate: days[endIndex]?.date || day.date || ""
    });
    index = endIndex;
  }

  return stays;
}

function getHotelLocationMention(hotel) {
  const areaName = compactMentionPart(hotel?.areaName || "");
  const areaTag = compactMentionPart(hotel?.areaTag || "");
  if (areaName && areaTag) return `@${areaName}${areaTag}`;
  if (areaTag) return areaTag.startsWith("@") ? areaTag : `@${areaTag}`;
  if (areaName) return `@${areaName}`;
  return "";
}

function getHotelNameMention(hotel) {
  const propertyName = String(hotel?.propertyName || "").trim();
  if (propertyName) return propertyName.startsWith("@") ? propertyName : `@${propertyName}`;

  const accommodation = String(hotel?.accommodation || "").trim();
  if (!accommodation || /^hotel\s+tbd\b/i.test(accommodation)) return "";
  return accommodation.startsWith("@") ? accommodation : `@${accommodation}`;
}

function getTransferMention(hotel) {
  const tag = String(hotel?.transferAfter?.tag || "").trim();
  if (!tag) return "";
  return tag.startsWith("@") ? tag : `@${tag}`;
}

function ensureTransferAfterForStays(stays) {
  for (let index = 0; index < stays.length - 1; index += 1) {
    const stay = stays[index];
    const nextStay = stays[index + 1];
    if (stay.firstDay?.transferAfter?.tag) continue;

    const fromArea = routeAreaForStay(stay);
    const toArea = routeAreaForStay(nextStay);
    if (!fromArea || !toArea) continue;

    const segment = "Normal";
    const name = `Transfer ${fromArea} to ${toArea}`;
    stay.firstDay.transferAfter = {
      fromArea,
      toArea,
      fromLocation: fromArea,
      toLocation: toArea,
      segment,
      name,
      tag: `@${compactMentionPart(name)}${compactMentionPart(fromArea)}${compactMentionPart(toArea)}${segment}`
    };
  }
}

// The raw "Day N" heading for the next stay is often written as the day
// after checkout (e.g. "Day 1-2: Aug 12" then "Day 3-4: Aug 14" for the next
// hotel), but the transfer itself is dated the checkout day (Aug 13 here) -
// arriving at the next hotel happens the same day as the transfer, not the
// day after. Shift each stay's start (and end, to preserve its night count)
// to line up with the previous stay's transfer/checkout date.
function alignStayStartDatesToTransfers(stays) {
  for (let index = 1; index < stays.length; index += 1) {
    const previousStay = stays[index - 1];
    const stay = stays[index];
    if (!previousStay.firstDay?.transferAfter?.tag) continue;

    const transferDate = transferDateForStay(previousStay);
    if (!transferDate || !stay.startDate || transferDate === stay.startDate) continue;

    const delta = dayDiff(stay.startDate, transferDate);
    if (!delta) continue;
    stay.startDate = transferDate;
    if (stay.endDate) stay.endDate = addDays(stay.endDate, delta);
  }
}

function dayDiff(fromDate, toDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) return 0;
  const [fy, fm, fd] = fromDate.split("-").map(Number);
  const [ty, tm, td] = toDate.split("-").map(Number);
  const fromUTC = Date.UTC(fy, fm - 1, fd);
  const toUTC = Date.UTC(ty, tm - 1, td);
  return Math.round((toUTC - fromUTC) / 86400000);
}

function routeAreaForStay(stay) {
  const firstDay = stay?.firstDay || {};
  return String(firstDay.areaName || firstDay.location || "").trim();
}

function compactMentionPart(value) {
  return String(value || "").trim().replace(/\s+/g, "");
}

async function fillFields(page, fields, itinerary) {
  for (const [key, spec] of Object.entries(fields || {})) {
    // A field can pin its value directly in config (spec.constantValue)
    // instead of deriving it from the itinerary - for fields that should
    // always get the same fixed value on every draft (e.g. a standing
    // "Info Page" selection), rather than something itinerary-specific.
    const value = spec?.constantValue ?? getFieldValue(itinerary, key);
    const filled = await fillSpec(page, spec, value, key);
    // asText(), not a raw truthiness check on value - an empty array (e.g.
    // no summaryNotes parsed) is truthy in JS but has nothing worth filling,
    // and is not a real failure worth a debug snapshot.
    if (!filled && asText(value)) {
      await saveDebugSnapshot(page, `general-info-${key}-fill-failed`);
    }
  }
}

function specForIndex(spec, index) {
  if (!spec || Number.isInteger(spec.nth) || spec.last) return spec;
  return { ...spec, nth: index };
}

function specWithIndex(spec, index) {
  if (!spec || spec.last) return spec;
  return { ...spec, nth: index };
}

function specForTableCell(spec, rowIndex) {
  if (!spec || !Number.isInteger(rowIndex)) return spec;
  const cellsPerRow = Number.isInteger(spec.cellsPerRow) ? spec.cellsPerRow : 3;
  const columnIndex = Number.isInteger(spec.columnIndex) ? spec.columnIndex : 0;
  return {
    ...spec,
    nth: (rowIndex * cellsPerRow) + columnIndex
  };
}

async function ensureIndexedTarget(page, targetSpec, index, addSpec, label) {
  if (!targetSpec?.selector || !Number.isInteger(index)) return true;
  const requiredIndex = Number.isInteger(targetSpec.cellsPerRow)
    ? (index * targetSpec.cellsPerRow) + (Number.isInteger(targetSpec.columnIndex) ? targetSpec.columnIndex : 0)
    : index;

  const maxAttempts = Math.max(4, requiredIndex + 2);
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const count = await page.locator(targetSpec.selector).count();
    if (count > requiredIndex) return true;
    if (!addSpec) return false;

    warn(`[portalBuilder] ${label}: need index ${requiredIndex}, found ${count}; adding row attempt ${attempt + 1}.`);
    const clicked = await clickTimelineAddButton(page, addSpec, `${label} add row`, targetSpec, requiredIndex);
    if (!clicked) return false;
    await page.waitForTimeout(700);
  }

  return (await page.locator(targetSpec.selector).count()) > requiredIndex;
}

async function ensureRowByRetry(page, attemptClick, addSpec, label, maxAttempts = 3, attemptClickAfterAdd = null) {
  let clicked = await attemptClick();
  for (let attempt = 0; attempt < maxAttempts && !clicked && addSpec; attempt += 1) {
    warn(`[portalBuilder] ${label}: row not found, clicking add row (attempt ${attempt + 1}).`);
    const added = await clickTimelineAddButton(page, addSpec, `${label} add row`);
    if (!added) break;
    await page.waitForTimeout(700);
    clicked = attemptClickAfterAdd ? await attemptClickAfterAdd() : await attemptClick();
    if (!clicked) clicked = await attemptClick();
  }
  return clicked;
}

async function clickTimelineAddButton(page, addSpec, label, targetSpec = null, requiredIndex = null) {
  if (!addSpec) return false;
  const beforeCount = targetSpec?.selector ? await page.locator(targetSpec.selector).count().catch(() => null) : null;

  if (addSpec.selector) {
    const locator = indexedLocator(page.locator(addSpec.selector), addSpec);
    try {
      if ((await locator.count()) > 0) {
        const box = await locator.boundingBox();
        if (box) {
          await page.mouse.click(box.x + (box.width / 2), box.y + (box.height / 2));
          await page.waitForTimeout(Number.isFinite(addSpec.waitMs) ? addSpec.waitMs : 500);
          if (await rowWasAdded(page, targetSpec, beforeCount, requiredIndex)) return true;
        }
      }
    } catch (error) {
      warn(`[portalBuilder] Visible-position add row click failed for ${label}: ${error.message}`);
    }
  }

  const clickedBySpec = await clickSpec(page, addSpec, label);
  if (clickedBySpec && await rowWasAdded(page, targetSpec, beforeCount, requiredIndex)) return true;

  try {
    const viewport = page.viewportSize() || { width: 1280, height: 720 };
    const points = [
      { x: Math.round(viewport.width / 2), y: Math.round(viewport.height * 0.62) },
      { x: Math.round(viewport.width / 2), y: Math.round(viewport.height * 0.72) },
      { x: Math.round(viewport.width / 2), y: Math.max(40, viewport.height - 72) }
    ];
    for (const point of points) {
      await page.mouse.click(point.x, point.y);
      await page.waitForTimeout(Number.isFinite(addSpec.waitMs) ? addSpec.waitMs : 500);
      warn(`[portalBuilder] Clicked fallback add row point ${point.x},${point.y} for ${label}`);
      if (await rowWasAdded(page, targetSpec, beforeCount, requiredIndex)) return true;
    }
  } catch (error) {
    warn(`[portalBuilder] Bottom-center add row click failed for ${label}: ${error.message}`);
  }

  warn(`[portalBuilder] Add row click did not increase count for ${label}.`);
  return false;
}

async function rowWasAdded(page, targetSpec, beforeCount, requiredIndex) {
  if (!targetSpec?.selector) return true;
  const afterCount = await page.locator(targetSpec.selector).count().catch(() => null);
  if (afterCount == null) return false;
  if (Number.isInteger(requiredIndex) && afterCount > requiredIndex) return true;
  return beforeCount == null ? false : afterCount > beforeCount;
}

const ARRIVAL_TAG = "@ArrivalInJapan";
const DEPARTURE_TAG = "@DepartureDay";

function buildHotelTimelinePlan(days, options = {}) {
  const stays = getHotelStays(days);
  ensureTransferAfterForStays(stays);
  alignStayStartDatesToTransfers(stays);
  const includeArrival = options.includeArrival !== false;
  const includeDeparture = options.includeDeparture !== false;

  let cellIndex = includeArrival && stays.length ? 1 : 0;
  const plan = stays.map((stay, stayIndex) => {
    const transferTag = getTransferMention(stay.firstDay);
    const item = {
      stay,
      stayIndex,
      hotelRowIndex: cellIndex,
      locationEditorIndex: cellIndex + stayIndex,
      hotelEditorIndex: cellIndex + stayIndex + 1,
      transferRowIndex: transferTag ? cellIndex + 1 : null,
      transferTag
    };
    cellIndex += transferTag ? 2 : 1;
    return item;
  });

  if (stays.length) {
    if (includeDeparture) {
      const departureDate = hotelEndDateForStay(stays[stays.length - 1]);
      plan.push({ isBoundary: true, kind: "departure", rowIndex: cellIndex, tag: DEPARTURE_TAG, date: departureDate });
    }
    if (includeArrival) {
      plan.unshift({ isBoundary: true, kind: "arrival", rowIndex: 0, tag: ARRIVAL_TAG });
    }
  }

  return plan;
}

async function clickTableColumnAtRow(page, rowSpec, rowIndex, columnSpec, label) {
  if (!rowSpec?.selector || !Number.isInteger(rowIndex) || !columnSpec?.text) return false;

  const row = await locatorFromSpec(page, specWithIndex(rowSpec, rowIndex));
  if (!row || (await row.count()) === 0) return false;

  const header = page.getByText(columnSpec.text, { exact: false }).first();
  if ((await header.count()) === 0) return false;

  try {
    await row.scrollIntoViewIfNeeded();
    const rowBox = await row.boundingBox();
    const headerBox = await header.boundingBox();
    if (!rowBox || !headerBox) return false;

    const xOffset = Number.isFinite(columnSpec.xOffset) ? columnSpec.xOffset : 48;
    const yRatio = Number.isFinite(columnSpec.yRatio) ? columnSpec.yRatio : 0.5;
    const x = headerBox.x + xOffset;
    const y = rowBox.y + (rowBox.height * yRatio);
    await page.mouse.click(x, y);
    await page.waitForTimeout(Number.isFinite(columnSpec.waitMs) ? columnSpec.waitMs : 300);
    return true;
  } catch (error) {
    warn(`[portalBuilder] Could not click ${label} by header/row geometry: ${error.message}`);
    return false;
  }
}

async function clickSpecCenter(scope, spec, label) {
  const locator = await locatorFromSpec(scope, spec);
  if (!locator) {
    warn(`[portalBuilder] Could not resolve locator for ${label}`);
    return false;
  }

  const page = typeof scope?.mouse?.click === "function"
    ? scope
    : (typeof scope?.page === "function" ? scope.page() : null);
  if (!page) return clickSpec(scope, spec, label);

  try {
    await locator.waitFor({ state: "visible", timeout: 5000 });
    await locator.scrollIntoViewIfNeeded();
    const box = await locator.boundingBox();
    if (!box) return false;
    await page.mouse.click(box.x + (box.width / 2), box.y + (box.height / 2));
    await page.waitForTimeout(Number.isFinite(spec?.waitMs) ? spec.waitMs : 500);
    return true;
  } catch (error) {
    warn(`[portalBuilder] Could not center-click ${label}: ${error.message}`);
    return false;
  }
}

async function clickNestedSpecCenter(page, parentSpec, parentIndex, childSpec, label) {
  if (!parentSpec?.selector || !childSpec?.selector || !Number.isInteger(parentIndex)) return false;

  const parent = await locatorFromSpec(page, specWithIndex(parentSpec, parentIndex));
  if (!parent || (await parent.count()) === 0) {
    warn(`[portalBuilder] Could not resolve parent locator for ${label}`);
    return false;
  }

  const child = parent.locator(childSpec.selector).first();
  if ((await child.count()) === 0) {
    warn(`[portalBuilder] Could not resolve nested locator for ${label}`);
    return false;
  }

  return clickSpecCenter(parent, { ...childSpec, nth: undefined, last: undefined }, label);
}

async function clickClosestSpecToReferenceY(page, referenceSpec, targetSpec, label) {
  if (!referenceSpec?.selector || !targetSpec?.selector) return false;

  const reference = await locatorFromSpec(page, referenceSpec);
  if (!reference || (await reference.count()) === 0) {
    warn(`[portalBuilder] Could not resolve reference locator for ${label}`);
    return false;
  }

  try {
    await reference.scrollIntoViewIfNeeded();
    const referenceBox = await reference.boundingBox();
    if (!referenceBox) return false;
    const referenceY = referenceBox.y + (referenceBox.height / 2);

    const candidates = page.locator(targetSpec.selector);
    const count = await candidates.count();
    let best = null;
    for (let index = 0; index < count; index += 1) {
      const candidate = candidates.nth(index);
      const box = await candidate.boundingBox().catch(() => null);
      if (!box) continue;
      const distance = Math.abs((box.y + (box.height / 2)) - referenceY);
      if (!best || distance < best.distance) best = { box, distance, index };
    }

    if (!best) return false;
    await page.mouse.click(best.box.x + (best.box.width / 2), best.box.y + (best.box.height / 2));
    await page.waitForTimeout(Number.isFinite(targetSpec.waitMs) ? targetSpec.waitMs : 500);
    warn(`[portalBuilder] Clicked ${label} candidate ${best.index} at distance ${Math.round(best.distance)}px`);
    return true;
  } catch (error) {
    warn(`[portalBuilder] Could not click closest locator for ${label}: ${error.message}`);
    return false;
  }
}

async function clickTransferActivityOption(page, hotelDatesConfig, label) {
  const attempts = [
    hotelDatesConfig.transferActivity,
    hotelDatesConfig.transferActivityText ? { text: hotelDatesConfig.transferActivityText } : null,
    { selector: "button:has-text('Activity'), [role='button']:has-text('Activity')" },
    { selector: "[data-tip*='Activity'], [title*='Activity'], [aria-label*='Activity']" },
    { selector: "span:has-text('Activity'), div:has-text('Activity')" }
  ].filter(Boolean);

  for (const spec of attempts) {
    if (await clickSpec(page, spec, label)) return true;
  }

  await saveDebugSnapshot(page, `missing-activity-${label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`);
  return false;
}

async function saveDebugSnapshot(page, name) {
  const dir = path.resolve("debug");
  try {
    fs.mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: true });
    fs.writeFileSync(path.join(dir, `${name}.html`), await page.content(), "utf8");
    warn(`[portalBuilder] Saved debug snapshot: debug/${name}.png and debug/${name}.html`);
  } catch (error) {
    warn(`[portalBuilder] Could not save debug snapshot ${name}: ${error.message}`);
  }
}

function addDays(startDate, offset) {
  if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return "";
  const [year, month, day] = startDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + offset));
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0")
  ].join("-");
}

function transferDateForStay(stay) {
  const startDate = stay.startDate || "";
  if (!startDate) return "";
  return hotelEndDateForStay(stay);
}

function hotelEndDateForStay(stay) {
  const startDate = stay.startDate || "";
  const endDate = stay.endDate || startDate;
  if (!startDate) return "";
  return addDays(endDate, 1);
}

async function fillHotelDateSelection(page, hotelDatesConfig, itinerary) {
  if (!hotelDatesConfig || !itinerary.days?.length) return;
  let timelinePlan = buildHotelTimelinePlan(itinerary.days, {
    includeArrival: itinerary.includeArrival !== false,
    includeDeparture: itinerary.includeDeparture !== false
  });
  if (process.env.SAFARI_BOT_DEBUG_ONE_HOTEL) timelinePlan = timelinePlan.slice(0, 2);
  if (!timelinePlan.length) return;

  warn(`[portalBuilder] Hotel timeline plan: ${timelinePlan.map(describeTimelineItem).join(", ")}`);
  for (const item of timelinePlan) {
    try {
      if (item.isBoundary) {
        await fillBoundaryRow(page, hotelDatesConfig, item, itinerary);
      } else {
        await fillHotelStay(page, hotelDatesConfig, item.stay, item.stayIndex, item.hotelRowIndex);
      }
    } catch (error) {
      const label = item.isBoundary ? item.kind : `Hotel ${item.stayIndex + 1}`;
      warn(`[portalBuilder] ${label} failed, continuing with remaining rows: ${error.message}`);
      await saveDebugSnapshot(page, item.isBoundary ? `${item.kind}-failed` : `hotel-${item.stayIndex + 1}-failed`);
    }
  }
}

function describeTimelineItem(item) {
  if (item.isBoundary) return `${item.kind}@${item.rowIndex}`;
  return `hotel${item.stayIndex + 1}@${item.hotelRowIndex}${item.transferRowIndex == null ? "" : ` transfer@${item.transferRowIndex}`}`;
}

// Arrival/departure are transfer-only rows at the very start/end of the
// timeline. Arrival reuses the same index-based logic as transfers between
// hotels (row 0 is reliable). Departure cannot trust any precomputed index,
// though - earlier hotel rows can silently drift past an unused template
// placeholder, so a computed "last row" number can be wrong by the time we
// get there. Instead, force-add one more row and operate purely on "last
// matching element" selectors, with no numeric position involved at all.
async function fillBoundaryRow(page, hotelDatesConfig, item, itinerary) {
  if (item.kind === "arrival") {
    return fillTransferRow(page, hotelDatesConfig, item.rowIndex, item.tag, itinerary.startDate, item.kind);
  }
  return fillLastTransferRow(page, hotelDatesConfig, item.tag, item.date || itinerary.endDate, item.kind);
}

// Opens and fills whatever the newest ("last") transfer-only row is, without
// relying on any numeric row index. Used for departure, where a precomputed
// index can't be trusted.
async function fillLastTransferRow(page, hotelDatesConfig, transferMention, transferDate, label) {
  await clickTimelineAddButton(page, hotelDatesConfig.timelineAddButton, `${label} row`);
  await page.waitForTimeout(700);

  const lastTransferBox = { ...hotelDatesConfig.transferBox, nth: undefined, last: true };
  const lastTransferSquare = hotelDatesConfig.transferSquare
    ? { ...hotelDatesConfig.transferSquare, nth: undefined, last: true }
    : null;

  let opened = await clickSpec(page, lastTransferBox, `${label} box (last)`);
  if (!opened && lastTransferSquare) {
    opened = await clickSpec(page, lastTransferSquare, `${label} square (last)`);
  }
  if (!opened) {
    await saveDebugSnapshot(page, `${label}-open-failed`.replace(/[^a-z0-9]+/gi, "-").toLowerCase());
    warn(`Warning: could not open ${label} row.`);
    return false;
  }

  await page.waitForTimeout(500);
  const selected = await clickTransferActivityOption(page, hotelDatesConfig, `${label} option`);
  if (!selected) {
    await saveDebugSnapshot(page, `${label}-activity-not-found`.replace(/[^a-z0-9]+/gi, "-").toLowerCase());
    warn(`Warning: ${label} activity did not resolve or could not be clicked.`);
    return false;
  }

  if (transferDate && hotelDatesConfig.transferCalendarTrigger) {
    const lastTriggerConfig = {
      ...hotelDatesConfig,
      transferCalendarTrigger: { ...hotelDatesConfig.transferCalendarTrigger, nth: undefined, last: true }
    };
    const dated = await fillTransferActivityDate(page, lastTriggerConfig, transferDate, 0);
    if (!dated) {
      warn(`Warning: ${label} date could not be selected.`);
    }
  }

  if (transferMention && hotelDatesConfig.transferName) {
    const transferScope = await locatorFromSpec(page, lastTransferBox);
    // Departure's exact tag (e.g. "@DepartureDay") is often the first/only
    // real suggestion; pressing ArrowDown here skips past it onto an
    // unrelated entry (e.g. a longer demo/library item with a similar
    // prefix), so commit directly on Enter instead.
    const nameSpec = { ...hotelDatesConfig.transferName, arrowDownBeforeEnter: false };
    const filled = await fillDraftEditorMention(page, nameSpec, transferMention, `${label} name`, transferScope, nameSpec);
    if (!filled) {
      warn(`Warning: ${label} name did not resolve or could not be filled.`);
    }
  }

  return true;
}

async function fillHotelStay(page, hotelDatesConfig, stay, stayIndex, cellIndex) {
  const firstHotel = stay.firstDay;
  if (!firstHotel) return { filledTransfer: false };
  warn(`[portalBuilder] Filling hotel ${stayIndex + 1} at row ${cellIndex}: ${firstHotel.location || ""} / ${firstHotel.propertyName || firstHotel.accommodation || ""}`);
  const locationEditorIndex = cellIndex + stayIndex;
  const hotelEditorIndex = locationEditorIndex + 1;

  let clicked = false;
  let hotelScope = null;
  if (hotelDatesConfig.firstHotelBox) {
    const hotelBoxSpec = specForIndex(hotelDatesConfig.firstHotelBox, cellIndex);
    const hotelBoxLastSpec = { ...hotelDatesConfig.firstHotelBox, nth: undefined, last: true };
    clicked = await ensureRowByRetry(
      page,
      async () => {
        const probe = await locatorFromSpec(page, hotelBoxSpec);
        if (!probe || (await probe.count()) === 0) return false;
        return clickSpec(page, hotelBoxSpec, `hotel ${stayIndex + 1} box`);
      },
      hotelDatesConfig.timelineAddButton,
      `hotel ${stayIndex + 1} row`,
      3,
      () => clickSpec(page, hotelBoxLastSpec, `hotel ${stayIndex + 1} box (newly added)`)
    );
    if (!clicked) {
      warn("Warning: hotelDates.firstHotelBox did not resolve, trying fallback selector.");
      const fallbackSpec = { selector: "div[class*='Table_activeMenuWrapper']", nth: cellIndex };
      clicked = await clickSpec(page, fallbackSpec, `hotel ${stayIndex + 1} box fallback`);
      if (clicked) hotelScope = await locatorFromSpec(page, fallbackSpec);
    } else {
      hotelScope = await locatorFromSpec(page, hotelBoxSpec);
    }
    await page.waitForTimeout(300);
  }

  if (hotelDatesConfig.accommodation && firstHotel.accommodation) {
    const accommodationValue = firstHotel.propertyName || firstHotel.accommodation;
    const accommodationLocator = await locatorFromSpec(page, hotelDatesConfig.accommodation);
    if (accommodationLocator) {
      const info = await accommodationLocator.evaluate((el) => ({ tagName: el.tagName.toLowerCase(), role: el.getAttribute("role") || "" }));
      if (info.tagName === "button" || info.role.toLowerCase() === "button") {
        await clickSpec(page, hotelDatesConfig.accommodation, "first hotel accommodation button");
        await page.waitForTimeout(300);
        const filled = await fillSpec(page, hotelDatesConfig.accommodationInput || hotelDatesConfig.accommodation, accommodationValue, "first hotel accommodation");
        if (!filled) {
          warn("Warning: accommodation button clicked but accommodation value could not be filled.");
        }
      } else {
        await fillSpec(page, hotelDatesConfig.accommodation, accommodationValue, "first hotel accommodation");
      }
    } else {
      await fillSpec(page, hotelDatesConfig.accommodation, accommodationValue, "first hotel accommodation");
    }
    await page.waitForTimeout(300);
  }

  clicked = hotelDatesConfig.calendarMonth
    ? (await page.locator(hotelDatesConfig.calendarMonth.selector).count()) > 0
    : false;
  if (clicked) {
    warn(`[portalBuilder] hotel ${stayIndex + 1}: calendar already open (from accommodation menu), skipping trigger click.`);
  }
  if (!clicked && hotelDatesConfig.calendarTrigger) {
    clicked = await clickSpec(page, specForIndex(hotelDatesConfig.calendarTrigger, cellIndex), `hotel ${stayIndex + 1} calendar trigger`);
  }
  if (!clicked) {
    warn("Warning: hotelDates.calendarTrigger did not resolve, trying fallback Date control.");
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
      warn("Warning: hotelDates.calendarMonth did not resolve or could not be selected.");
    }
    await page.waitForTimeout(250);
  }

  if (year && hotelDatesConfig.calendarYear) {
    const selectedYear = await selectSpec(page, hotelDatesConfig.calendarYear, year, "hotel calendar year");
    if (!selectedYear) {
      warn("Warning: hotelDates.calendarYear did not resolve or could not be selected.");
    }
    await page.waitForTimeout(250);
  }

  clicked = false;
  const stayRange = stay.startDate
    ? { startDate: stay.startDate, endDate: hotelEndDateForStay(stay) }
    : getHotelStayRange([firstHotel], 0);
  const { startDate, endDate } = stayRange.startDate && stayRange.endDate === stayRange.startDate
    ? { startDate: stayRange.startDate, endDate: addDays(stayRange.startDate, 1) }
    : stayRange;

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
        warn("Warning: hotelDates.calendarDayCell selector did not resolve.");
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
        warn("Warning: no calendar day cell found inside hotelDates.calendarGrid.");
      }
    } else {
      warn("Warning: hotelDates.calendarGrid selector did not resolve.");
    }
  }
  if (!clicked) {
    const fallbackCell = page.locator("table[role='grid'] td[role='gridcell'], table[role='grid'] button[role='gridcell'], table[role='grid'] td").first();
    if ((await fallbackCell.count()) > 0) {
      await fallbackCell.click();
      clicked = true;
    } else {
      warn("Warning: no calendar day cell could be clicked by fallback selector.");
      await saveDebugSnapshot(page, `hotel-${stayIndex + 1}-calendar-not-found`);
    }
  }
  await page.waitForTimeout(300);

  if (hotelDatesConfig.calendarClose) {
    const closed = await clickSpec(page, hotelDatesConfig.calendarClose, "hotel calendar close");
    if (!closed) {
      warn("Warning: hotelDates.calendarClose did not resolve, using fallback close.");
      await commitCalendarSelection(page, hotelDatesConfig);
    }
  } else {
    await commitCalendarSelection(page, hotelDatesConfig);
  }

  if (hotelDatesConfig.location) {
    const locationMention = getHotelLocationMention(firstHotel);
    if (locationMention) {
      const hasAreaTag = Boolean(compactMentionPart(firstHotel?.areaTag || ""));
      const locationSpec = specWithIndex(hotelDatesConfig.location, locationEditorIndex);
      const filled = await fillDraftEditorMention(
        page,
        hasAreaTag ? locationSpec : { ...locationSpec, arrowDownBeforeEnter: true },
        locationMention,
        `hotel ${stayIndex + 1} location details`,
        page
      );
      if (!filled) {
        warn("Warning: hotelDates.location did not resolve or could not be filled.");
      }
    }
  }

  if (hotelDatesConfig.hotelName) {
    const accommodationOptions = firstHotel.accommodationOptions?.length ? firstHotel.accommodationOptions : null;
    const hotelMention = getHotelNameMention(firstHotel);
    const label = `hotel ${stayIndex + 1} name details`;

    if (accommodationOptions || hotelMention) {
      const filled = accommodationOptions
        ? await fillHotelNameOptions(
            page,
            hotelDatesConfig.hotelName,
            accommodationOptions,
            label,
            hotelScope,
            specWithIndex(hotelDatesConfig.hotelName, hotelEditorIndex)
          )
        : await fillDraftEditorMention(
            page,
            hotelDatesConfig.hotelName,
            hotelMention,
            label,
            hotelScope,
            specWithIndex(hotelDatesConfig.hotelName, hotelEditorIndex)
          );

      if (!filled) {
        warn("Warning: hotelDates.hotelName did not resolve or could not be filled.");
      } else if (!accommodationOptions) {
        // The multi-option path already dismisses these per option; a plain
        // single-hotel mention can trigger the same "which room(s)?" and
        // "include the area page?" prompts, and left open they block every
        // click after them (including a later transfer row's type-picker).
        await selectRoomsIfPrompted(page, firstHotel.rooms, label);
        await confirmAreaPageIfPrompted(page, label);
      }
    }
  }

  if (hotelDatesConfig.transferBox && hotelDatesConfig.transferActivity && firstHotel.transferAfter?.tag) {
    const transferColumnIndex = cellIndex + 1;
    const transferMention = getTransferMention(firstHotel);
    const transferDate = transferDateForStay(stay);
    await fillTransferRow(page, hotelDatesConfig, transferColumnIndex, transferMention, transferDate, `transfer activity ${stayIndex + 1}`);
    return { filledTransfer: true };
  }

  return { filledTransfer: false };
}

// Opens and fills a transfer-only row (no accommodation) in the hotel
// timeline: transfers between hotel stays, and the arrival/departure boundary
// rows, both go through this same logic.
async function fillTransferRow(page, hotelDatesConfig, transferColumnIndex, transferMention, transferDate, label) {
  await page.waitForTimeout(300);
  await ensureIndexedTarget(
    page,
    hotelDatesConfig.transferCell || hotelDatesConfig.transferBox,
    transferColumnIndex,
    hotelDatesConfig.timelineAddButton,
    `${label} row`
  );
  let transferBoxSpec = specWithIndex(hotelDatesConfig.transferBox, transferColumnIndex);
  if (hotelDatesConfig.debugTransfers) {
    await saveDebugSnapshot(page, `${label}-before-open`.replace(/[^a-z0-9]+/gi, "-").toLowerCase());
  }
  const transferOpenAttempts = [
    {
      label: "closest square by row",
      run: () => clickClosestSpecToReferenceY(
        page,
        specForTableCell(hotelDatesConfig.transferCell, transferColumnIndex),
        hotelDatesConfig.transferSquare,
        `${label} closest square`
      )
    },
    {
      label: "square in row",
      run: () => clickNestedSpecCenter(page, hotelDatesConfig.transferBox, transferColumnIndex, hotelDatesConfig.transferSquare, `${label} square`)
    },
    {
      label: "cell center",
      run: () => clickSpecCenter(page, specForTableCell(hotelDatesConfig.transferCell, transferColumnIndex), `${label} cell center`)
    },
    {
      label: "cell offset",
      run: () => clickSpec(page, specForTableCell(hotelDatesConfig.transferCell, transferColumnIndex), `${label} cell`)
    },
    {
      label: "column geometry",
      run: () => clickTableColumnAtRow(page, hotelDatesConfig.transferBox, transferColumnIndex, hotelDatesConfig.transferColumn, `${label} column`)
    },
    {
      label: "menu icon",
      run: () => clickSpec(page, specWithIndex(hotelDatesConfig.transferMenuIcon, transferColumnIndex), `${label} menu icon`)
    },
    {
      label: "box",
      run: () => clickSpec(page, transferBoxSpec, `${label} box`)
    },
    {
      label: "box fallback",
      run: () => {
        transferBoxSpec = specWithIndex(hotelDatesConfig.transferBoxFallback, transferColumnIndex);
        return clickSpec(page, transferBoxSpec, `${label} box fallback`);
      }
    }
  ];

  let selected = false;
  for (const attempt of transferOpenAttempts) {
    warn(`[portalBuilder] Trying ${label} opener: ${attempt.label}`);
    const opened = await attempt.run();
    if (!opened) continue;
    await page.waitForTimeout(500);
    if (hotelDatesConfig.debugTransfers) {
      await saveDebugSnapshot(page, `${label}-after-${attempt.label}`.replace(/[^a-z0-9]+/gi, "-").toLowerCase());
    }
    selected = await clickTransferActivityOption(page, hotelDatesConfig, `${label} option ${attempt.label}`);
    if (selected) break;
  }

  const transferScope = await locatorFromSpec(page, transferBoxSpec);
  if (!selected) {
    await saveDebugSnapshot(page, `${label}-activity-not-found`.replace(/[^a-z0-9]+/gi, "-").toLowerCase());
    warn(`Warning: ${label} activity did not resolve or could not be clicked.`);
    return false;
  }

  if (transferDate) {
    const dated = await fillTransferActivityDate(page, hotelDatesConfig, transferDate, transferColumnIndex);
    if (!dated) {
      warn(`Warning: ${label} date could not be selected.`);
    }
  }

  if (transferMention && hotelDatesConfig.transferName) {
    const filled = await fillDraftEditorMention(
      page,
      hotelDatesConfig.transferName,
      transferMention,
      `${label} name`,
      transferScope,
      specWithIndex(hotelDatesConfig.transferName, transferColumnIndex)
    );
    if (!filled) {
      warn(`Warning: ${label} name did not resolve or could not be filled.`);
    }
  }

  return true;
}

async function fillTransferActivityDate(page, hotelDatesConfig, dateValue, stayIndex) {
  const triggerSpec = hotelDatesConfig.transferCalendarTrigger || hotelDatesConfig.calendarTrigger;
  if (!triggerSpec) return false;

  await page.waitForTimeout(300);
  let clicked = await clickSpec(page, specForIndex(triggerSpec, stayIndex), `transfer activity date trigger ${stayIndex + 1}`);
  if (!clicked && hotelDatesConfig.transferCalendarTriggerFallback) {
    clicked = await clickSpec(page, hotelDatesConfig.transferCalendarTriggerFallback, `transfer activity date trigger fallback ${stayIndex + 1}`);
  }
  if (!clicked) return false;

  await page.waitForTimeout(300);
  const selected = await selectCalendarDate(page, hotelDatesConfig, dateValue, `transfer activity date ${stayIndex + 1}`);
  if (!selected) return false;

  if (hotelDatesConfig.transferCalendarClose) {
    const closed = await clickSpec(page, hotelDatesConfig.transferCalendarClose, `transfer activity calendar close ${stayIndex + 1}`);
    if (closed) return true;
  }

  return commitCalendarSelection(page, hotelDatesConfig);
}

async function selectCalendarDate(page, hotelDatesConfig, dateValue, label) {
  const [year, month] = dateValue ? dateValue.split("-") : [];
  const monthName = month ? MONTH_NAMES[Number(month) - 1] : "";

  if (monthName && hotelDatesConfig.calendarMonth) {
    const selectedMonth = await selectSpec(page, hotelDatesConfig.calendarMonth, monthName, `${label} month`);
    if (!selectedMonth) {
      warn(`Warning: month selector did not resolve for ${label}.`);
    }
    await page.waitForTimeout(250);
  }

  if (year && hotelDatesConfig.calendarYear) {
    const selectedYear = await selectSpec(page, hotelDatesConfig.calendarYear, year, `${label} year`);
    if (!selectedYear) {
      warn(`Warning: year selector did not resolve for ${label}.`);
    }
    await page.waitForTimeout(250);
  }

  return clickCalendarDate(page, hotelDatesConfig, dateValue);
}

// The mention autocomplete ranks suggestions by its own fuzzy-match rules, not
// exact equality - typing "@DepartureDay" can surface an unrelated entry
// (e.g. a longer demo/library item that happens to start with the same text)
// ahead of the exact match. Before falling back to blind ArrowDown+Enter,
// look for a suggestion entry whose text is an exact match (ignoring a
// leading "@") and click it directly.
async function selectExactMentionSuggestion(page, exactValue) {
  const target = exactValue.replace(/^@/, "").trim().toLowerCase();
  if (!target) return false;

  const candidateSelectors = [
    "[role='option']",
    "div[class*='mentionSuggestions'] div[class*='mentionSuggestionsEntry']",
    "div[class*='Suggestion'] li",
    "div[class*='Suggestion'] [class*='option'], div[class*='Suggestion'] [class*='Option']",
    "ul[class*='uggestion'] li"
  ];

  const debugMention = process.env.SAFARI_BOT_DEBUG_MENTION;

  for (const selector of candidateSelectors) {
    let items;
    let count = 0;
    try {
      items = page.locator(selector);
      count = await items.count();
    } catch (_) {
      continue;
    }
    if (debugMention) warn(`[portalBuilder][debug-mention] selector "${selector}" matched ${count} element(s)`);
    if (!count) continue;

    for (let i = 0; i < count; i += 1) {
      const item = items.nth(i);
      let text = "";
      try {
        text = (await item.innerText()).trim();
      } catch (_) {
        continue;
      }
      if (debugMention) warn(`[portalBuilder][debug-mention]   [${i}] "${text}"`);
      const normalized = text.replace(/^@/, "").trim().toLowerCase();
      if (normalized === target) {
        try {
          await item.click({ timeout: 1000 });
          return true;
        } catch (_) {
          continue;
        }
      }
    }
  }
  return false;
}

async function fillDraftEditorMention(page, spec, value, label, scope = page, fallbackSpec = null) {
  let locator = await locatorFromSpec(scope || page, spec);
  if (locator && (await locator.count()) === 0) locator = null;
  if (!locator && fallbackSpec) locator = await locatorFromSpec(page, fallbackSpec);
  if (!locator) {
    warn(`[portalBuilder] Could not resolve locator for ${label}`);
    return false;
  }

  try {
    await locator.waitFor({ state: "visible", timeout: 5000 });
    await locator.scrollIntoViewIfNeeded();
    await locator.click({ force: true });
    await page.waitForTimeout(150);
    if (spec.clearBeforeType !== false) {
      await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
      await page.keyboard.press("Backspace");
      await page.waitForTimeout(100);
    }
    await placeCaretAtEnd(locator);
    await page.keyboard.type(value, { delay: 35 });
    await page.waitForTimeout(spec.commitDelayMs || 1000);
    if (process.env.SAFARI_BOT_DEBUG_MENTION) {
      await saveDebugSnapshot(page, `mention-popup-${label}`.replace(/[^a-z0-9]+/gi, "-").toLowerCase());
    }
    const exactPicked = spec.exactMatch === false ? false : await selectExactMentionSuggestion(page, value);
    if (!exactPicked) {
      if (spec.arrowDownBeforeEnter) {
        await page.keyboard.press("ArrowDown");
        await page.waitForTimeout(150);
      }
      await page.keyboard.press("Enter");
    }
    await page.waitForTimeout(300);
    return true;
  } catch (error) {
    warn(`[portalBuilder] Could not type ${label}: ${error.message}`);
    return false;
  }
}

function optionLetter(index) {
  return String.fromCharCode(65 + index); // 0 -> A, 1 -> B, 2 -> C, ...
}

// Types multiple accommodation options into one mention field as
// "@Hotel [A] @Hotel [B]", labeling each choice for the client. Each option
// can trigger a "which room(s)?" modal (handled per option) and the whole
// entry can trigger a final "include the area page?" prompt (handled once,
// after all options are committed).
async function fillHotelNameOptions(page, spec, options, label, scope = page, fallbackSpec = null) {
  let locator = await locatorFromSpec(scope || page, spec);
  if (locator && (await locator.count()) === 0) locator = null;
  if (!locator && fallbackSpec) locator = await locatorFromSpec(page, fallbackSpec);
  if (!locator) {
    warn(`[portalBuilder] Could not resolve locator for ${label}`);
    return false;
  }

  try {
    await locator.waitFor({ state: "visible", timeout: 5000 });
    await locator.scrollIntoViewIfNeeded();
    await locator.click({ force: true });
    await page.waitForTimeout(150);
    if (spec.clearBeforeType !== false) {
      await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
      await page.keyboard.press("Backspace");
      await page.waitForTimeout(100);
    }
    await placeCaretAtEnd(locator);

    // Re-clicking and re-anchoring the caret before every typed segment (not
    // just after a modal) guards against DraftJS snapping the caret to an
    // unexpected spot around the mention entity's boundary - without this,
    // labels and subsequent mentions can land out of order.
    async function typeAtEnd(text) {
      await locator.click({ force: true });
      await placeCaretAtEnd(locator);
      await page.keyboard.type(text, { delay: 35 });
    }

    const debugMulti = process.env.SAFARI_BOT_DEBUG_MULTIOPTION;
    if (debugMulti) await saveDebugSnapshot(page, `multioption-${label}-before-loop`.replace(/[^a-z0-9]+/gi, "-").toLowerCase());

    for (let index = 0; index < options.length; index += 1) {
      const option = options[index];
      const mention = option.name.startsWith("@") ? option.name : `@${option.name}`;
      const prefix = index === 0 ? "" : " ";
      await typeAtEnd(`${prefix}${mention}`);
      await page.waitForTimeout(spec.commitDelayMs || 1000);
      const exactPicked = spec.exactMatch === false ? false : await selectExactMentionSuggestion(page, mention);
      if (!exactPicked) {
        if (spec.arrowDownBeforeEnter) {
          await page.keyboard.press("ArrowDown");
          await page.waitForTimeout(150);
        }
        await page.keyboard.press("Enter");
      }
      await page.waitForTimeout(300);
      if (debugMulti) await saveDebugSnapshot(page, `multioption-${label}-option-${index}-after-enter`.replace(/[^a-z0-9]+/gi, "-").toLowerCase());

      if (options.length > 1) {
        await typeAtEnd(` [${optionLetter(index)}]`);
        await page.waitForTimeout(200);
      }

      await selectRoomsIfPrompted(page, option.rooms, `${label} (${option.name})`);
      if (debugMulti) await saveDebugSnapshot(page, `multioption-${label}-option-${index}-after-rooms`.replace(/[^a-z0-9]+/gi, "-").toLowerCase());
    }

    await confirmAreaPageIfPrompted(page, label);
    if (debugMulti) await saveDebugSnapshot(page, `multioption-${label}-after-area-confirm`.replace(/[^a-z0-9]+/gi, "-").toLowerCase());
    return true;
  } catch (error) {
    warn(`[portalBuilder] Could not type ${label}: ${error.message}`);
    return false;
  }
}

async function selectRoomsIfPrompted(page, rooms, label) {
  const modal = page.locator(".Rooms_container__1syeg").first();
  try {
    await modal.waitFor({ state: "visible", timeout: 3000 });
  } catch (_) {
    return; // no room-selection modal appeared for this option
  }

  for (const room of rooms || []) {
    const roomOption = modal.locator("label.CheckBox_checkboxWrapper__1kMod", { hasText: room }).first();
    if ((await roomOption.count()) > 0) {
      await roomOption.click();
      await page.waitForTimeout(150);
    } else {
      warn(`[portalBuilder] Room "${room}" not found in selection modal for ${label}.`);
    }
  }

  const nextButton = modal.getByRole("button", { name: "Next" }).first();
  if ((await nextButton.count()) > 0) {
    await nextButton.click();
    await page.waitForTimeout(400);
  } else {
    warn(`[portalBuilder] Could not find Next button in room selection modal for ${label}.`);
  }
}

// Declines the "include the area page?" prompt - the location column is
// already filled with its own area mention (see getHotelLocationMention),
// so confirming "Yes" here just appends a redundant second area mention
// straight into the hotel name field.
async function confirmAreaPageIfPrompted(page, label) {
  const modal = page.locator(".AreaSelect_container__1d4aZ").first();
  try {
    await modal.waitFor({ state: "visible", timeout: 3000 });
  } catch (_) {
    return; // no "include the area page?" prompt appeared
  }

  const noButton = modal.getByRole("button", { name: "No", exact: true }).first();
  if ((await noButton.count()) > 0) {
    await noButton.click();
    await page.waitForTimeout(600);
    return;
  }

  warn(`[portalBuilder] Could not find No button on area-page prompt for ${label}, dismissing without confirming.`);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
}

async function placeCaretAtEnd(locator) {
  try {
    await locator.evaluate((element) => {
      const range = document.createRange();
      const selection = window.getSelection();
      range.selectNodeContents(element);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    });
  } catch (_) {}
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

  await ensureChromiumInstalled();
  const browser = await chromium.launch({ headless: Boolean(config.headless) });
  browser.on("disconnected", () => openDraftBrowsers.delete(browser));
  // Track the browser as soon as it launches, not just once the whole build
  // finishes - the fill/click sequence below can run long or get stuck, and
  // it needs to be killable via closeOpenDraftBrowsers() the entire time,
  // not just after it successfully completes.
  openDraftBrowsers.add(browser);
  const context = await browser.newContext({ storageState: storagePath });
  const page = await context.newPage();
  page.on("dialog", async (dialog) => {
    warn(`[portalBuilder] Unexpected dialog appeared (${dialog.type()}): ${dialog.message()}`);
    try {
      await dialog.dismiss();
    } catch (_) {}
  });

  const warnings = [];
  currentWarnings = warnings;

  try {
    await page.goto(config.newItineraryUrl, { waitUntil: "domcontentloaded" });

    // Accept cookie banner if configured (some portals block controls)
    if (config.cookieButton) {
      try {
        const clicked = await clickSpec(page, config.cookieButton, "accept cookies");
        if (clicked) await page.waitForTimeout(500);
      } catch (err) {
        warn(`Warning: accept cookies click failed: ${err.message}`);
      }
    }

    await fillFields(page, config.fields, itinerary);

    for (let index = 0; index < itinerary.days.length; index += 1) {
      if (index > 0 && config.days?.addDayButton) {
        const clicked = await clickSpec(page, config.days.addDayButton, "add day button");
        if (!clicked) {
          warn(`Warning: add day button not found for day ${index + 1}, continuing without clicking.`);
        }
      }

      const day = itinerary.days[index];
      const scope = await dayScope(page, config, index);
      const dayFields = config.days?.fields || {};
      await fillSpec(scope, dayFields.date, day.date, `day ${index + 1} date`);
      await fillSpec(scope, dayFields.location, day.location, `day ${index + 1} location`);
      await fillSpec(scope, dayFields.accommodation, day.propertyName || day.accommodation, `day ${index + 1} accommodation`);
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
          warn("Warning: next button not found or not clickable.");
        } else {
          // wait for UI to advance
          await page.waitForTimeout(750);
        }
      } catch (error) {
        warn(`Warning: clicking next button failed: ${error.message}`);
      }
    }

    // If configured, select the Classic builder option after Next
    if (config.builderSwitch) {
      try {
        // give the panel a moment to render
        await page.waitForTimeout(500);
        const clicked = await clickSpec(page, config.builderSwitch, "builder switch");
        if (!clicked) warn("Warning: builder switch not found or not clickable.");
        else await page.waitForTimeout(500);
      } catch (error) {
        warn(`Warning: clicking builder switch failed: ${error.message}`);
      }
    }

    // If configured, open the hotel date selection UI and pick the first hotel/date block
    if (config.hotelDates) {
      try {
        await fillHotelDateSelection(page, config.hotelDates, itinerary);
      } catch (error) {
        warn(`Warning: hotel date selection flow failed: ${error.message}`);
      }
    }

    if (options.submit && config.submitButton) {
      await clickSpec(page, config.submitButton, "submit button");
      await browser.close();
      return { warnings };
    }

    if (options.keepOpen) {
      _debugLastPage = page;
      return { warnings };
    }

    await browser.close();
    return { warnings };
  } catch (error) {
    if (browser.isConnected()) {
      await browser.close();
    }
    throw error;
  } finally {
    currentWarnings = null;
  }
}

// Opens a portal URL in a browser signed in with the saved session (same
// storageState as buildPortalDraft/login), so employees don't have to log in
// again just to add a reference page. Left open like a draft browser -
// closeOpenDraftBrowsers() also closes these.
async function openPortalPage(config, url) {
  const storagePath = path.resolve(config.storageStatePath);
  if (!fs.existsSync(storagePath)) {
    throw new Error(`Login session not found at ${storagePath}. Run npm run login first.`);
  }

  await ensureChromiumInstalled();
  const browser = await chromium.launch({ headless: false });
  browser.on("disconnected", () => openDraftBrowsers.delete(browser));
  openDraftBrowsers.add(browser);
  const context = await browser.newContext({ storageState: storagePath });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded" });
}

async function closeOpenDraftBrowsers() {
  const browsers = [...openDraftBrowsers];
  openDraftBrowsers.clear();

  await Promise.allSettled(browsers.map((browser) => killBrowser(browser)));
}

// A browser stuck mid-automation (a hung click, an unresolved wait) can make
// browser.close() itself hang - falling back to killing the underlying
// Chrome process directly is what makes this a real "kill" rather than a
// polite request the automation can ignore.
async function killBrowser(browser) {
  if (!browser.isConnected()) return;

  const closedGracefully = await Promise.race([
    browser.close().then(() => true).catch(() => false),
    new Promise((resolve) => setTimeout(() => resolve(false), 5000))
  ]);

  if (!closedGracefully && browser.isConnected()) {
    browser.process()?.kill("SIGKILL");
  }
}

module.exports = {
  buildPortalDraft,
  buildHotelTimelinePlan,
  getHotelStays,
  closeOpenDraftBrowsers,
  openPortalPage,
  _getDebugLastPage: () => _debugLastPage
};
