const input = document.querySelector("#itineraryInput");
const message = document.querySelector("#message");
const summary = document.querySelector("#summary");
const days = document.querySelector("#days");
const parseButton = document.querySelector("#parseButton");
const templateButton = document.querySelector("#templateButton");
const sampleButton = document.querySelector("#sampleButton");
const clearButton = document.querySelector("#clearButton");
const copyJsonButton = document.querySelector("#copyJsonButton");
const loginButton = document.querySelector("#loginButton");
const buildButton = document.querySelector("#buildButton");
const closeDraftsButton = document.querySelector("#closeDraftsButton");
const configStatus = document.querySelector("#configStatus");
const sessionStatus = document.querySelector("#sessionStatus");
const startDateInput = document.querySelector("#startDateInput");
const lastNameInput = document.querySelector("#lastNameInput");
const tabPasteButton = document.querySelector("#tabPasteButton");
const tabBuilderButton = document.querySelector("#tabBuilderButton");
const pasteTab = document.querySelector("#pasteTab");
const builderTab = document.querySelector("#builderTab");
const builderClientNameInput = document.querySelector("#builderClientNameInput");
const builderTripTitleInput = document.querySelector("#builderTripTitleInput");
const stayRowsContainer = document.querySelector("#stayRows");
const addStayButton = document.querySelector("#addStayButton");
const returnFlightToggle = document.querySelector("#returnFlightToggle");
const returnFlightLabelInput = document.querySelector("#returnFlightLabelInput");
const generateItineraryButton = document.querySelector("#generateItineraryButton");

let areasCache = [];
let propertiesCache = [];
let transfersCache = [];
const hotelAreasContainer = document.querySelector("#hotelAreas");
let hotelAreaMap = {};
let hotelPropertyMap = {};
let transferSegmentMap = {};
const clientTypeSelect = document.querySelector("#clientTypeSelect");
const agencySelect = document.querySelector("#agencySelect");
const agencySelectWrap = document.querySelector("#agencySelectWrap");
const agencyCustomWrap = document.querySelector("#agencyCustomWrap");
const agencyNameInput = document.querySelector("#agencyNameInput");

let parsedItinerary = null;
let stayRows = [{ location: "", hotel: "", nights: 1 }];

parseButton.addEventListener("click", parseCurrentText);
templateButton.addEventListener("click", loadTemplate);
sampleButton.addEventListener("click", loadSample);
clearButton.addEventListener("click", () => {
  input.value = "";
  parsedItinerary = null;
  renderItinerary(null);
  setMessage("");
});
copyJsonButton.addEventListener("click", copyJson);
loginButton.addEventListener("click", login);
buildButton.addEventListener("click", buildDraft);
closeDraftsButton.addEventListener("click", closeDraftBrowsers);
clientTypeSelect.addEventListener("change", updateAgencyControls);
agencySelect.addEventListener("change", updateAgencyControls);
tabPasteButton.addEventListener("click", () => showTab("paste"));
tabBuilderButton.addEventListener("click", () => showTab("builder"));
addStayButton.addEventListener("click", () => {
  stayRows.push({ location: "", hotel: "", nights: 1 });
  renderStayRows();
});
generateItineraryButton.addEventListener("click", generateItinerary);
renderStayRows();

refreshStatus();
updateAgencyControls();
loadAreas();
loadProperties();
loadTransfers();
// Auto-refresh areas every 30 seconds so dropping a CSV updates the UI automatically
setInterval(loadAreas, 30 * 1000);
setInterval(loadProperties, 30 * 1000);
setInterval(loadTransfers, 30 * 1000);
renderItinerary(null);

async function loadTemplate() {
  setBusy(true);
  try {
    const data = await request("/api/template");
    input.value = data.text;
    showTab("paste");
    setMessage("Blank template loaded. Replace the placeholders with real trip details.");
  } catch (error) {
    setMessage(error.message, true);
  } finally {
    setBusy(false);
  }
}

async function loadSample() {
  setBusy(true);
  try {
    const data = await request("/api/sample");
    input.value = data.text;
    showTab("paste");
    setMessage("Sample itinerary loaded.");
  } catch (error) {
    setMessage(error.message, true);
  } finally {
    setBusy(false);
  }
}

async function parseCurrentText() {
  setBusy(true);
  try {
    const data = await request("/api/parse", parseRequestBody());
    parsedItinerary = data.itinerary;
    renderItinerary(parsedItinerary);
    const dayCount = parsedItinerary.days.length;
    setMessage(`Parsed ${dayCount} day${dayCount === 1 ? "" : "s"}.`);
  } catch (error) {
    setMessage(error.message, true);
  } finally {
    setBusy(false);
  }
}

async function loadAreas() {
  try {
    const data = await request('/api/areas');
    areasCache = data.areas || [];
    if (parsedItinerary) renderItinerary(parsedItinerary);
  } catch (err) {
    console.warn('Could not load areas:', err.message);
  }
}

async function loadProperties() {
  try {
    const data = await request("/api/properties");
    propertiesCache = data.properties || [];
    if (parsedItinerary) renderItinerary(parsedItinerary);
  } catch (err) {
    console.warn("Could not load properties:", err.message);
  }
}

async function loadTransfers() {
  try {
    const data = await request("/api/transfers");
    transfersCache = data.transfers || [];
    if (parsedItinerary) renderItinerary(parsedItinerary);
  } catch (err) {
    console.warn("Could not load transfers:", err.message);
  }
}

function showTab(tab) {
  const isBuilder = tab === "builder";
  builderTab.classList.toggle("hidden", !isBuilder);
  pasteTab.classList.toggle("hidden", isBuilder);
  tabBuilderButton.classList.toggle("active", isBuilder);
  tabPasteButton.classList.toggle("active", !isBuilder);
  tabBuilderButton.setAttribute("aria-selected", String(isBuilder));
  tabPasteButton.setAttribute("aria-selected", String(!isBuilder));
}

function renderStayRows() {
  stayRowsContainer.innerHTML = stayRows.map((row, index) => `
    <div class="stay-row" data-index="${index}">
      <label class="text-control">
        <span>Location</span>
        <div class="autocomplete">
          <input type="text" class="stay-location" autocomplete="off" placeholder="Osaka" value="${escapeHtml(row.location)}">
          <div class="autocomplete-list hidden"></div>
        </div>
      </label>
      <label class="text-control">
        <span>Hotel</span>
        <div class="autocomplete">
          <input type="text" class="stay-hotel" autocomplete="off" placeholder="Zentis Osaka" value="${escapeHtml(row.hotel)}">
          <div class="autocomplete-list hidden"></div>
        </div>
      </label>
      <label class="text-control nights-control">
        <span>Nights</span>
        <input type="number" class="stay-nights" min="1" value="${row.nights}">
      </label>
      <button type="button" class="stay-remove small" aria-label="Remove stay" ${stayRows.length <= 1 ? "disabled" : ""}>Remove</button>
    </div>
  `).join("");

  stayRowsContainer.querySelectorAll(".stay-row").forEach((rowEl) => {
    const index = Number(rowEl.getAttribute("data-index"));
    const locationInput = rowEl.querySelector(".stay-location");
    const hotelInput = rowEl.querySelector(".stay-hotel");

    locationInput.addEventListener("input", (e) => {
      stayRows[index].location = e.target.value;
    });

    hotelInput.addEventListener("input", (e) => {
      stayRows[index].hotel = e.target.value;
      const matched = propertiesCache.find((p) => p.name === e.target.value.trim());
      if (matched?.area && !stayRows[index].location) {
        stayRows[index].location = matched.area;
        renderStayRows();
      }
    });

    attachAutocomplete(
      locationInput,
      locationInput.closest(".autocomplete").querySelector(".autocomplete-list"),
      () => areasCache.map((a) => a.name),
      (value) => {
        stayRows[index].location = value;
        renderStayRows();
      }
    );

    attachAutocomplete(
      hotelInput,
      hotelInput.closest(".autocomplete").querySelector(".autocomplete-list"),
      () => propertiesCache.map((p) => p.name),
      (value) => {
        stayRows[index].hotel = value;
        const matched = propertiesCache.find((p) => p.name === value);
        if (matched?.area) stayRows[index].location = matched.area;
        renderStayRows();
      }
    );

    rowEl.querySelector(".stay-nights").addEventListener("input", (e) => {
      stayRows[index].nights = Math.max(1, Number(e.target.value) || 1);
    });

    rowEl.querySelector(".stay-remove").addEventListener("click", () => {
      if (stayRows.length <= 1) return;
      stayRows.splice(index, 1);
      renderStayRows();
    });
  });
}

// A minimal, scrollable dropdown to replace native <datalist> (which has
// inconsistent, often non-scrollable rendering across browsers).
function attachAutocomplete(inputEl, listEl, getOptions, onSelect) {
  function showSuggestions() {
    const query = inputEl.value.trim().toLowerCase();
    const matches = getOptions().filter((name) => name.toLowerCase().includes(query)).slice(0, 50);
    if (!matches.length) {
      listEl.classList.add("hidden");
      listEl.innerHTML = "";
      return;
    }
    listEl.innerHTML = matches.map((name) => `<div class="autocomplete-option">${escapeHtml(name)}</div>`).join("");
    listEl.classList.remove("hidden");
  }

  inputEl.addEventListener("input", showSuggestions);
  inputEl.addEventListener("focus", showSuggestions);
  inputEl.addEventListener("blur", () => {
    setTimeout(() => listEl.classList.add("hidden"), 150);
  });
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Escape") listEl.classList.add("hidden");
  });

  listEl.addEventListener("mousedown", (e) => {
    const option = e.target.closest(".autocomplete-option");
    if (!option) return;
    e.preventDefault();
    listEl.classList.add("hidden");
    onSelect(option.textContent);
  });
}

function generateItinerary() {
  const clientName = builderClientNameInput.value.trim();
  const tripTitle = builderTripTitleInput.value.trim();
  const validStays = stayRows.filter((row) => row.location.trim() || row.hotel.trim());

  if (!validStays.length) {
    setMessage("Add at least one stay with a location or hotel before generating.", true);
    return;
  }

  const lines = [];
  if (clientName) lines.push(`Client: ${clientName}`);
  if (tripTitle) lines.push(`Trip: ${tripTitle}`);
  if (startDateInput.value) lines.push(`Start: ${startDateInput.value}`);
  lines.push("");

  let dayNumber = 1;
  for (const stay of validStays) {
    const nights = Math.max(1, Number(stay.nights) || 1);
    const dayStart = dayNumber;
    const dayEnd = dayNumber + nights - 1;
    const dayLabel = dayStart === dayEnd ? `Day ${dayStart}` : `Day ${dayStart}-${dayEnd}`;
    const location = stay.location.trim();
    lines.push(location ? `${dayLabel}: ${location}` : dayLabel);
    if (stay.hotel.trim()) lines.push(`Accommodation: ${stay.hotel.trim()}`);
    lines.push("");
    dayNumber = dayEnd + 1;
  }

  if (returnFlightToggle.checked) {
    const label = returnFlightLabelInput.value.trim() || "Flight back";
    lines.push(`Day ${dayNumber}: ${label}`);
  }

  input.value = lines.join("\n").trim() + "\n";
  parseCurrentText();
}

async function login() {
  setBusy(true);
    setMessage("Opening Safari Portal login. Close the login browser when you are done.");
  try {
    const data = await request("/api/login", {});
    setMessage(`Login browser closed. Saved session: ${data.storagePath}`);
    await refreshStatus();
  } catch (error) {
    setMessage(error.message, true);
  } finally {
    setBusy(false);
  }
}

async function buildDraft() {
  if (!parsedItinerary) {
    await parseCurrentText();
  }
  if (!parsedItinerary) return;
  parsedItinerary = withCurrentMetadata(parsedItinerary);
  renderItinerary(parsedItinerary);

  setBusy(true);
  setMessage("Opening Safari Portal draft builder. Review the browser when it appears.");
  try {
    await request("/api/build", { itinerary: parsedItinerary, mode: currentMode(), startDate: currentStartDate(), submit: false });
    setMessage("Draft builder opened. Review and save in Safari Portal.");
  } catch (error) {
    setMessage(error.message, true);
  } finally {
    setBusy(false);
  }
}

async function closeDraftBrowsers() {
  setBusy(true);
  try {
    await request("/api/close-drafts", {});
    setMessage("Closed draft browser windows opened by Safari Bot.");
  } catch (error) {
    setMessage(error.message, true);
  } finally {
    setBusy(false);
  }
}

async function copyJson() {
  if (!parsedItinerary) {
    setMessage("Parse an itinerary first.", true);
    return;
  }

  parsedItinerary = withCurrentMetadata(parsedItinerary);
  renderItinerary(parsedItinerary);
  await navigator.clipboard.writeText(JSON.stringify(parsedItinerary, null, 2));
  setMessage("Parsed JSON copied.");
}

async function refreshStatus() {
  try {
    const status = await request("/api/status");
    configStatus.textContent = status.hasConfig ? "Config ready" : "Config missing";
    configStatus.className = `pill ${status.hasConfig ? "ok" : "warn"}`;
    sessionStatus.textContent = status.hasLoginSession ? "Logged in" : "Login needed";
    sessionStatus.className = `pill ${status.hasLoginSession ? "ok" : "warn"}`;
  } catch {
    configStatus.textContent = "Status unavailable";
    sessionStatus.textContent = "Status unavailable";
  }
}

function renderItinerary(itinerary) {
  if (!itinerary) {
    summary.innerHTML = "";
    days.innerHTML = `<div class="empty-state">Parse an itinerary to preview the trip structure.</div>`;
    if (hotelAreasContainer) hotelAreasContainer.innerHTML = "";
    return;
  }

  summary.innerHTML = [
    summaryItem("Last Name", itinerary.lastName),
    summaryItem("Type", itinerary.customerType ? itinerary.customerType.toUpperCase() : ""),
    summaryItem("Agency", itinerary.agencyName),
    summaryItem("Client", itinerary.clientName),
    summaryItem("Trip", itinerary.tripTitle),
    summaryItem("Start", itinerary.startDate),
    summaryItem("End", itinerary.endDate)
  ].join("");

  if (!itinerary.days.length) {
    days.innerHTML = `<div class="empty-state">No days were detected. Try headings like Day 1, Day 2, and so on.</div>`;
    if (hotelAreasContainer) hotelAreasContainer.innerHTML = "";
    return;
  }

  // render per-hotel area selectors
  renderHotelAreaControls(itinerary);
  // compute effective area tag for each day (inheritance)
  const perDayAreas = computePerDayAreas(itinerary);
  days.innerHTML = itinerary.days.map((d, i) => renderDay(d, i, perDayAreas[i])).join("");
  // attach listeners for hotel area selects
  bindHotelAreaControls(itinerary);
}

function renderDay(day, index, area) {
  const areaText = area?.tag ? [area.name, area.tag].filter(Boolean).join(" ") : "";
  const areaDisplay = areaText ? `<div class="area-label">Area: ${escapeHtml(areaText)}</div>` : "";

  return `
    <article class="day-card">
      <div class="day-title">
        <span>Day ${day.number || index + 1}</span>
        <span class="muted">${escapeHtml([day.date, day.location].filter(Boolean).join(" | "))}</span>
      </div>
      <div class="day-grid">
        ${field("Accommodation", day.accommodation)}
      </div>
      ${areaDisplay}
    </article>
  `;
}

function summaryItem(label, value) {
  return `
    <div class="summary-item">
      <span class="label">${escapeHtml(label)}</span>
      <div class="value">${escapeHtml(value || "Not found")}</div>
    </div>
  `;
}

function field(label, value) {
  const text = Array.isArray(value) ? value.join("\n") : value;
  return `
    <div class="field">
      <span class="label">${escapeHtml(label)}</span>
      <div class="value">${escapeHtml(text || "None")}</div>
    </div>
  `;
}

async function request(url, body) {
  const options = body === undefined
    ? {}
    : {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      };
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}

function setBusy(isBusy) {
  for (const button of [parseButton, templateButton, sampleButton, clearButton, copyJsonButton, loginButton, buildButton, closeDraftsButton]) {
    button.disabled = isBusy;
  }
}

function setMessage(text, isError = false) {
  message.textContent = text;
  message.style.color = isError ? "var(--bad)" : "var(--muted)";
}

function currentMode() {
  return "hotels";
}

function currentStartDate() {
  return startDateInput.value || "";
}

function currentAgencyName() {
  if (clientTypeSelect.value !== "b2b") return "";
  return agencySelect.value === "custom" ? agencyNameInput.value.trim() : agencySelect.value;
}

function currentMetadata() {
  const globalArea = areaFromTag("");
  return {
    lastName: lastNameInput.value.trim(),
    customerType: clientTypeSelect.value,
    agencyName: currentAgencyName(),
    areaName: globalArea.name,
    areaTag: globalArea.tag
  };
}

function withCurrentMetadata(itinerary) {
  const meta = currentMetadata();
  const perDayAreas = computePerDayAreas(itinerary);
  const stays = getHotelStays(itinerary);
  const transferByStartIndex = new Map();

  for (let index = 0; index < stays.length - 1; index += 1) {
    const stay = stays[index];
    const nextStay = stays[index + 1];
    const segment = transferSegmentMap[transferKey(stay, nextStay)] || "Normal";
    const fromLocation = transferAreaForStay(stay, perDayAreas);
    const toLocation = transferAreaForStay(nextStay, perDayAreas);
    const transfer = transferForRoute(
      fromLocation,
      toLocation,
      segment
    );
    if (transfer) {
      transferByStartIndex.set(stay.startIndex, {
        ...transfer,
        segment,
        fromLocation: transfer.fromArea || fromLocation,
        toLocation: transfer.toArea || toLocation
      });
    }
  }

  return {
    ...itinerary,
    ...meta,
    days: itinerary.days.map((d, i) => ({
      ...d,
      areaName: perDayAreas[i]?.name || meta.areaName || "",
      areaTag: perDayAreas[i]?.tag || meta.areaTag || "",
      transferAfter: transferByStartIndex.get(i) || null,
      ...propertyForDay(d, i, itinerary)
    }))
  };
}

// Render controls for each unique hotel (in order of appearance)
function renderHotelAreaControls(itinerary) {
  if (!hotelAreasContainer) return;
  const stays = getHotelStays(itinerary);

  if (!stays.length) {
    hotelAreasContainer.innerHTML = "";
    return;
  }

  const areaOptions = (areasCache || []).map(a => `<option value="${escapeHtml(a.tag)}">${escapeHtml(a.name)}</option>`).join('');
  const propertyOptions = (propertiesCache || []).map((property) => (
    `<option value="${escapeHtml(property.name)}">${escapeHtml(property.name)}</option>`
  )).join("");

  hotelAreasContainer.innerHTML = `
    <div class="hotel-areas-header"><strong>Hotel Setup</strong></div>
    ${stays.map((stay) => `
      <label class="hotel-area-row">
        <span>${escapeHtml(stay.label)}</span>
        <span class="hotel-select-group">
          <select class="hotel-property-select" data-stay-key="${escapeHtml(stay.key)}">
            <option value="">Match property</option>
            ${propertyOptions}
          </select>
          <select class="hotel-area-select" data-stay-key="${escapeHtml(stay.key)}">
            <option value="">Inherit area</option>
            ${areaOptions}
          </select>
        </span>
      </label>
    `).join('')}
    ${renderTransferControls(stays, computePerDayAreas(itinerary))}
  `;
}

function renderTransferControls(stays, perDayAreas) {
  const rows = [];
  for (let index = 0; index < stays.length - 1; index += 1) {
    const stay = stays[index];
    const nextStay = stays[index + 1];
    const key = transferKey(stay, nextStay);
    const segment = transferSegmentMap[key] || "Normal";
    const fromArea = transferAreaForStay(stay, perDayAreas);
    const toArea = transferAreaForStay(nextStay, perDayAreas);
    const matched = transferForRoute(fromArea, toArea, segment);
    const matchText = matched
      ? `${matched.generated ? "Generated" : "CSV"}: ${matched.name}`
      : "No transfer route";

    rows.push(`
      <label class="hotel-area-row transfer-row">
        <span>
          ${escapeHtml(fromArea || stay.accommodation)} to ${escapeHtml(toArea || nextStay.accommodation)}
          <small>${escapeHtml(stay.endDate || stay.startDate || "")}</small>
        </span>
        <span class="hotel-select-group">
          <select class="transfer-segment-select" data-transfer-key="${escapeHtml(key)}">
            <option value="Normal"${segment === "Normal" ? " selected" : ""}>Normal</option>
            <option value="High"${segment === "High" ? " selected" : ""}>High quality</option>
          </select>
          <span class="transfer-match ${matched && !matched.generated ? "ok" : "warn"}">${escapeHtml(matchText)}</span>
        </span>
      </label>
    `);
  }

  if (!rows.length) return "";
  return `
    <div class="hotel-areas-header transfer-header"><strong>Transfers Between Hotels</strong></div>
    ${rows.join("")}
  `;
}

function bindHotelAreaControls(itinerary) {
  if (!hotelAreasContainer) return;
  const selects = hotelAreasContainer.querySelectorAll('.hotel-area-select');
  selects.forEach(select => {
    const stayKey = select.getAttribute('data-stay-key') || "";
    if (hotelAreaMap[stayKey]) select.value = hotelAreaMap[stayKey];
    select.addEventListener('change', () => {
      const val = select.value || '';
      if (val) hotelAreaMap[stayKey] = val; else delete hotelAreaMap[stayKey];
      parsedItinerary = withCurrentMetadata(itinerary);
      renderItinerary(parsedItinerary);
    });
  });

  const propertySelects = hotelAreasContainer.querySelectorAll(".hotel-property-select");
  propertySelects.forEach((select) => {
    const stayKey = select.getAttribute("data-stay-key") || "";
    const stay = getHotelStays(itinerary).find((candidate) => candidate.key === stayKey);
    const matched = hotelPropertyMap[stayKey] || autoMatchPropertyName(stay?.accommodation || "");
    if (matched) {
      select.value = matched;
      hotelPropertyMap[stayKey] = matched;
    }

    select.addEventListener("change", () => {
      const val = select.value || "";
      if (val) hotelPropertyMap[stayKey] = val; else delete hotelPropertyMap[stayKey];
      parsedItinerary = withCurrentMetadata(itinerary);
      renderItinerary(parsedItinerary);
    });
  });

  const transferSelects = hotelAreasContainer.querySelectorAll(".transfer-segment-select");
  transferSelects.forEach((select) => {
    const key = select.getAttribute("data-transfer-key") || "";
    if (transferSegmentMap[key]) select.value = transferSegmentMap[key];
    select.addEventListener("change", () => {
      transferSegmentMap[key] = select.value || "Normal";
      parsedItinerary = withCurrentMetadata(itinerary);
      renderItinerary(parsedItinerary);
    });
  });
}

// Compute effective area for each day. Priority: explicit per-hotel override,
// then the area matched from the hotel's own property/location, then inheriting
// the last successfully-resolved stay's area (only when this stay has no
// location of its own to go on - otherwise a data gap would silently mislabel
// this stay with an unrelated area).
function computePerDayAreas(itinerary) {
  const areas = new Array((itinerary.days || []).length).fill(null);
  let last = areaFromTag("");
  const stays = getHotelStays(itinerary);

  for (const stay of stays) {
    const selected = hotelAreaMap[stay.key] || "";
    let area;
    if (selected) {
      area = areaFromTag(selected);
    } else {
      area = resolveStayArea(stay) || (stay.location ? { name: "", tag: "" } : last);
    }
    if (area.tag) last = area;

    for (let index = stay.startIndex; index <= stay.endIndex; index += 1) {
      areas[index] = area;
    }
  }

  return areas;
}

// Look up the area for a stay via its matched property's "Area" column, falling
// back to the stay's own parsed location if the property doesn't resolve one.
function resolveStayArea(stay) {
  const propertyName = hotelPropertyMap[stay.key] || autoMatchPropertyName(stay.accommodation);
  const property = propertyName ? propertiesCache.find((candidate) => candidate.name === propertyName) : null;
  const candidateNames = [property?.area, stay.location].filter(Boolean);

  for (const name of candidateNames) {
    const matchedArea = areasCache.find((candidate) => normalizeMatchText(candidate.name) === normalizeMatchText(name));
    if (matchedArea) return { name: matchedArea.name, tag: matchedArea.tag };
  }

  return null;
}

function areaFromTag(tag) {
  const normalizedTag = String(tag || "").trim();
  if (!normalizedTag) return { name: "", tag: "" };
  const area = areasCache.find((candidate) => candidate.tag === normalizedTag);
  return {
    name: area?.name || "",
    tag: normalizedTag
  };
}

function getHotelStays(itinerary) {
  const stays = [];
  const tripDays = itinerary.days || [];

  for (let index = 0; index < tripDays.length; index += 1) {
    const day = tripDays[index];
    const accommodation = (day.accommodation || "").trim();
    if (!accommodation) continue;

    const location = (day.location || "").trim();
    let endIndex = index;
    while (
      endIndex + 1 < tripDays.length &&
      (tripDays[endIndex + 1].accommodation || "").trim() === accommodation &&
      (tripDays[endIndex + 1].location || "").trim() === location
    ) {
      endIndex += 1;
    }

    const startDay = day.number || index + 1;
    const endDay = tripDays[endIndex].number || endIndex + 1;
    const dates = [day.date, tripDays[endIndex].date].filter(Boolean);
    const dateLabel = dates.length === 2 && dates[0] !== dates[1] ? `${dates[0]} to ${dates[1]}` : dates[0] || `Day ${startDay}`;
    const key = `${startDay}-${endDay}|${accommodation}|${location}`;

    stays.push({
      key,
      startIndex: index,
      endIndex,
      accommodation,
      location,
      startDate: day.date || "",
      endDate: tripDays[endIndex].date || day.date || "",
      label: `${accommodation} (${dateLabel})`
    });

    index = endIndex;
  }

  return stays;
}

function transferKey(stay, nextStay) {
  return `${stay.key}->${nextStay.key}`;
}

function transferAreaForStay(stay, perDayAreas) {
  const area = perDayAreas?.[stay.startIndex];
  return area?.name || stay.location || "";
}

function matchTransfer(fromLocation, toLocation, segment) {
  const from = normalizeMatchText(fromLocation);
  const to = normalizeMatchText(toLocation);
  const normalizedSegment = normalizeTransferSegment(segment);
  if (!from || !to || !normalizedSegment) return null;

  return transfersCache.find((transfer) => (
    areaMatches(from, normalizeMatchText(transfer.fromArea)) &&
    areaMatches(to, normalizeMatchText(transfer.toArea)) &&
    normalizeTransferSegment(transfer.segment) === normalizedSegment
  )) || null;
}

function transferForRoute(fromLocation, toLocation, segment) {
  const matched = matchTransfer(fromLocation, toLocation, segment);
  if (matched) return matched;

  const fromArea = transferAreaLabel(fromLocation);
  const toArea = transferAreaLabel(toLocation);
  const segmentLabel = transferSegmentLabel(segment);
  if (!fromArea || !toArea || !segmentLabel) return null;

  const name = `Transfer ${fromArea} to ${toArea}`;
  return {
    fromArea,
    toArea,
    segment: segmentLabel,
    name,
    tag: `@${compactTagPart(name)}${compactTagPart(fromArea)}${compactTagPart(toArea)}${compactTagPart(segmentLabel)}`,
    generated: true
  };
}

function areaMatches(inputArea, csvArea) {
  if (!inputArea || !csvArea) return false;
  return inputArea === csvArea || inputArea.includes(csvArea) || csvArea.includes(inputArea);
}

function transferAreaLabel(value) {
  return String(value || "").trim();
}

function transferSegmentLabel(value) {
  return normalizeTransferSegment(value) === "high" ? "High" : "Normal";
}

function compactTagPart(value) {
  return String(value || "").trim().replace(/\s+/g, "");
}

function normalizeTransferSegment(value) {
  const normalized = String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (normalized.startsWith("high")) return "high";
  if (normalized.startsWith("normal")) return "normal";
  return normalized;
}

function propertyForDay(day, index, itinerary) {
  const stay = getHotelStays(itinerary).find((candidate) => index >= candidate.startIndex && index <= candidate.endIndex);
  const propertyName = hotelPropertyMap[stay?.key] || autoMatchPropertyName(day.accommodation);
  if (!propertyName) return { propertyName: "", propertyTag: "" };
  const property = propertiesCache.find((candidate) => candidate.name === propertyName);
  return {
    propertyName,
    propertyTag: property?.tag || ""
  };
}

function autoMatchPropertyName(accommodation) {
  const normalizedAccommodation = normalizeMatchText(accommodation);
  if (!normalizedAccommodation || normalizedAccommodation.startsWith("hoteltbd")) return "";

  const exact = propertiesCache.find((property) => normalizeMatchText(property.name) === normalizedAccommodation);
  if (exact) return exact.name;

  const contains = propertiesCache.find((property) => {
    const normalizedName = normalizeMatchText(property.name);
    return normalizedName && (
      normalizedAccommodation.includes(normalizedName) ||
      normalizedName.includes(normalizedAccommodation)
    );
  });

  return contains?.name || "";
}

function normalizeMatchText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\b(hotel|resort|ryokan|the)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function parseRequestBody() {
  return {
    text: input.value,
    mode: currentMode(),
    startDate: currentStartDate(),
    metadata: currentMetadata()
  };
}

function updateAgencyControls() {
  const isB2b = clientTypeSelect.value === "b2b";
  agencySelectWrap.classList.toggle("hidden", !isB2b);
  agencyCustomWrap.classList.toggle("hidden", !isB2b || agencySelect.value !== "custom");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
