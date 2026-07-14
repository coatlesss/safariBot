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
const manageDataButton = document.querySelector("#manageDataButton");
const closeDataModalButton = document.querySelector("#closeDataModalButton");
const dataModalOverlay = document.querySelector("#dataModalOverlay");
const newPropertyPageButton = document.querySelector("#newPropertyPageButton");

let areasCache = [];
let propertiesCache = [];
let transfersCache = [];
const hotelAreasContainer = document.querySelector("#hotelAreas");
let hotelAreaMap = {};
let hotelOptionsMap = {};
let transferSegmentMap = {};
const clientTypeSelect = document.querySelector("#clientTypeSelect");
const agencySelect = document.querySelector("#agencySelect");
const agencySelectWrap = document.querySelector("#agencySelectWrap");
const agencyCustomWrap = document.querySelector("#agencyCustomWrap");
const agencyNameInput = document.querySelector("#agencyNameInput");

let parsedItinerary = null;
let stayRows = [{ location: "", nights: 1, hotels: [{ name: "", rooms: "" }] }];

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
lastNameInput.addEventListener("input", () => lastNameInput.classList.remove("field-invalid"));
clientTypeSelect.addEventListener("change", updateAgencyControls);
agencySelect.addEventListener("change", updateAgencyControls);
tabPasteButton.addEventListener("click", () => showTab("paste"));
tabBuilderButton.addEventListener("click", () => showTab("builder"));
addStayButton.addEventListener("click", () => {
  stayRows.push({ location: "", nights: 1, hotels: [{ name: "", rooms: "" }] });
  renderStayRows();
});
generateItineraryButton.addEventListener("click", generateItinerary);
newPropertyPageButton.addEventListener("click", openNewPropertyPage);
renderStayRows();

manageDataButton.addEventListener("click", () => dataModalOverlay.classList.remove("hidden"));
closeDataModalButton.addEventListener("click", () => dataModalOverlay.classList.add("hidden"));
dataModalOverlay.addEventListener("click", (event) => {
  if (event.target === dataModalOverlay) dataModalOverlay.classList.add("hidden");
});
for (const row of document.querySelectorAll(".data-import-row")) {
  const kind = row.dataset.kind;
  const fileInput = row.querySelector(".data-import-file");
  const button = row.querySelector(".data-import-button");
  const result = row.querySelector(".data-import-result");
  button.addEventListener("click", () => importDataSheet(kind, fileInput, result));
}

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

const RELOAD_BY_KIND = { areas: loadAreas, properties: loadProperties, transfers: loadTransfers };

async function importDataSheet(kind, fileInput, resultEl) {
  const file = fileInput.files?.[0];
  if (!file) {
    resultEl.textContent = "Choose a CSV file first.";
    resultEl.className = "data-import-result error";
    return;
  }

  resultEl.textContent = "Uploading...";
  resultEl.className = "data-import-result";
  try {
    const csvText = await file.text();
    const data = await request("/api/data/import", { kind, csvText });
    resultEl.textContent = `Updated ${data.updated}, added ${data.added}${data.skipped ? `, skipped ${data.skipped}` : ""} (${data.total} total).`;
    resultEl.className = "data-import-result ok";
    fileInput.value = "";
    await RELOAD_BY_KIND[kind]();
  } catch (error) {
    resultEl.textContent = error.message;
    resultEl.className = "data-import-result error";
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
  stayRowsContainer.innerHTML = stayRows.map((stay, index) => `
    <div class="stay-row" data-index="${index}">
      <div class="stay-row-top">
        <label class="text-control">
          <span>Location</span>
          <div class="autocomplete">
            <input type="text" class="stay-location" autocomplete="off" placeholder="Osaka" value="${escapeHtml(stay.location)}">
            <div class="autocomplete-list hidden"></div>
          </div>
        </label>
        <label class="text-control nights-control">
          <span>Nights</span>
          <input type="number" class="stay-nights" min="1" value="${stay.nights}">
        </label>
        <button type="button" class="stay-remove small" aria-label="Remove stay" ${stayRows.length <= 1 ? "disabled" : ""}>Remove Stay</button>
      </div>
      <div class="stay-hotel-options">
        ${stay.hotels.map((hotel, hotelIndex) => `
          <div class="stay-hotel-option" data-hotel-index="${hotelIndex}">
            <label class="text-control">
              <span>${hotelIndex === 0 ? "Hotel" : `Alternate hotel ${hotelIndex}`}</span>
              <div class="autocomplete">
                <input type="text" class="stay-hotel" autocomplete="off" placeholder="Zentis Osaka" value="${escapeHtml(hotel.name)}">
                <div class="autocomplete-list hidden"></div>
              </div>
            </label>
            <label class="text-control">
              <span>Rooms (optional)</span>
              <input type="text" class="stay-hotel-rooms" autocomplete="off" placeholder="Deluxe Room King, ..." value="${escapeHtml(hotel.rooms)}">
            </label>
            <button type="button" class="stay-hotel-remove small" aria-label="Remove hotel option" ${stay.hotels.length <= 1 ? "disabled" : ""}>Remove</button>
          </div>
        `).join("")}
      </div>
      <div class="button-row">
        <button type="button" class="stay-add-hotel small">+ Add alternate hotel</button>
      </div>
    </div>
  `).join("");

  stayRowsContainer.querySelectorAll(".stay-row").forEach((rowEl) => {
    const index = Number(rowEl.getAttribute("data-index"));
    const locationInput = rowEl.querySelector(".stay-location");

    locationInput.addEventListener("input", (e) => {
      stayRows[index].location = e.target.value;
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

    rowEl.querySelector(".stay-nights").addEventListener("input", (e) => {
      stayRows[index].nights = Math.max(1, Number(e.target.value) || 1);
    });

    rowEl.querySelector(".stay-remove").addEventListener("click", () => {
      if (stayRows.length <= 1) return;
      stayRows.splice(index, 1);
      renderStayRows();
    });

    rowEl.querySelectorAll(".stay-hotel-option").forEach((hotelEl) => {
      const hotelIndex = Number(hotelEl.getAttribute("data-hotel-index"));
      const hotelInput = hotelEl.querySelector(".stay-hotel");
      const roomsInput = hotelEl.querySelector(".stay-hotel-rooms");

      hotelInput.addEventListener("input", (e) => {
        stayRows[index].hotels[hotelIndex].name = e.target.value;
        if (hotelIndex === 0) {
          const matched = propertiesCache.find((p) => p.name === e.target.value.trim());
          if (matched?.area && !stayRows[index].location) {
            stayRows[index].location = matched.area;
            renderStayRows();
          }
        }
      });

      attachAutocomplete(
        hotelInput,
        hotelInput.closest(".autocomplete").querySelector(".autocomplete-list"),
        () => propertiesCache.map((p) => p.name),
        (value) => {
          stayRows[index].hotels[hotelIndex].name = value;
          if (hotelIndex === 0) {
            const matched = propertiesCache.find((p) => p.name === value);
            if (matched?.area) stayRows[index].location = matched.area;
          }
          renderStayRows();
        }
      );

      roomsInput.addEventListener("input", (e) => {
        stayRows[index].hotels[hotelIndex].rooms = e.target.value;
      });

      hotelEl.querySelector(".stay-hotel-remove").addEventListener("click", () => {
        if (stayRows[index].hotels.length <= 1) return;
        stayRows[index].hotels.splice(hotelIndex, 1);
        renderStayRows();
      });
    });

    rowEl.querySelector(".stay-add-hotel").addEventListener("click", () => {
      stayRows[index].hotels.push({ name: "", rooms: "" });
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
  const validStays = stayRows.filter((stay) => stay.location.trim() || stay.hotels.some((hotel) => hotel.name.trim()));

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

    const accommodationText = stay.hotels
      .filter((hotel) => hotel.name.trim())
      .map((hotel) => {
        const rooms = hotel.rooms.trim();
        return rooms ? `${hotel.name.trim()} [${rooms}]` : hotel.name.trim();
      })
      .join(" or ");
    if (accommodationText) lines.push(`Accommodation: ${accommodationText}`);

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
  if (!lastNameInput.value.trim()) {
    setMessage("Last name is required before building a draft.", true);
    lastNameInput.classList.add("field-invalid");
    lastNameInput.focus();
    return;
  }
  lastNameInput.classList.remove("field-invalid");

  if (!parsedItinerary) {
    await parseCurrentText();
  }
  if (!parsedItinerary) return;
  parsedItinerary = withCurrentMetadata(parsedItinerary);
  renderItinerary(parsedItinerary);

  setBusy(true);
  setMessage("Opening Safari Portal draft builder. Review the browser when it appears.");
  try {
    const data = await request("/api/build", { itinerary: parsedItinerary, mode: currentMode(), startDate: currentStartDate(), submit: false });
    if (data.warnings?.length) {
      const count = data.warnings.length;
      setMessage(
        `Draft builder opened, but ${count} step${count === 1 ? "" : "s"} may need a manual check before you submit:\n` +
        data.warnings.map((w) => `- ${w}`).join("\n"),
        "warn"
      );
    } else {
      setMessage("Draft builder opened. Review and save in Safari Portal.");
    }
  } catch (error) {
    setMessage(error.message, true);
  } finally {
    setBusy(false);
  }
}

async function closeDraftBrowsers() {
  closeDraftsButton.disabled = true;
  try {
    await request("/api/close-drafts", {});
    setMessage("Killed the Chrome browser process(es) opened by Safari Bot.");
  } catch (error) {
    setMessage(error.message, true);
  } finally {
    closeDraftsButton.disabled = false;
  }
}

async function openNewPropertyPage() {
  setBusy(true);
  setMessage("Opening the new property page in your logged-in Safari Portal session...");
  try {
    await request("/api/open-new-property-page", {});
    setMessage("New property page opened. Close it (or use Close Draft Browser) when you're done.");
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
    if (status.newPropertyPageUrl) newPropertyPageButton.classList.remove("hidden");
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
  // closeDraftsButton is deliberately excluded: it's the kill switch for a
  // stuck or long-running Chrome automation, so it must stay clickable for
  // the entire time a build request is in flight, not just before/after it.
  for (const button of [parseButton, templateButton, sampleButton, clearButton, copyJsonButton, loginButton, buildButton, newPropertyPageButton]) {
    button.disabled = isBusy;
  }
}

function setMessage(text, level = false) {
  message.textContent = text;
  message.style.color = level === "warn" ? "var(--warn)" : (level ? "var(--bad)" : "var(--muted)");
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
  const globalArea = areaByName("");
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
      ...propertyForDay(d, i, itinerary),
      ...accommodationOptionsForDay(d, i, itinerary)
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

  hotelAreasContainer.innerHTML = `
    <div class="hotel-areas-header"><strong>Hotel Setup</strong></div>
    ${stays.map((stay) => {
      const hotels = getStayHotelOptions(stay);
      const hasAlternates = hotels.length > 1;
      return `
      <div class="hotel-setup-row" data-stay-key="${escapeHtml(stay.key)}">
        <div class="hotel-setup-header">
          <span class="hotel-setup-label">${escapeHtml(stay.label)}</span>
          <div class="autocomplete hotel-setup-area">
            <input type="text" class="hotel-area-input" placeholder="Inherit area" autocomplete="off">
            <div class="autocomplete-list hidden"></div>
          </div>
        </div>
        <div class="stay-hotel-options">
          ${hotels.map((hotel, hotelIndex) => `
            <div class="stay-hotel-option ${hasAlternates ? "" : "stay-hotel-option-single"}" data-hotel-index="${hotelIndex}">
              <div class="autocomplete">
                <input type="text" class="hotel-property-input" placeholder="Match property" autocomplete="off" value="${escapeHtml(hotel.name)}">
                <div class="autocomplete-list hidden"></div>
              </div>
              <input type="text" class="hotel-option-rooms" placeholder="Rooms (optional)" autocomplete="off" value="${escapeHtml(hotel.rooms)}">
              ${hasAlternates ? `<button type="button" class="hotel-option-remove small" aria-label="Remove hotel option">Remove</button>` : ""}
            </div>
          `).join("")}
        </div>
        <button type="button" class="hotel-option-add link-button">+ Add alternate hotel</button>
      </div>
    `;
    }).join('')}
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
  const stays = getHotelStays(itinerary);

  hotelAreasContainer.querySelectorAll(".hotel-setup-row").forEach((rowEl) => {
    const stayKey = rowEl.getAttribute("data-stay-key") || "";
    const stay = stays.find((candidate) => candidate.key === stayKey);
    if (!stay) return;

    const areaInput = rowEl.querySelector(".hotel-area-input");
    areaInput.value = hotelAreaMap[stayKey] || "";

    function applyAreaValue(value) {
      const trimmed = value.trim();
      const matched = areasCache.find((a) => a.name.toLowerCase() === trimmed.toLowerCase());
      if (matched) {
        hotelAreaMap[stayKey] = matched.name;
        areaInput.value = matched.name;
      } else {
        delete hotelAreaMap[stayKey];
      }
      parsedItinerary = withCurrentMetadata(itinerary);
      renderItinerary(parsedItinerary);
    }

    areaInput.addEventListener("change", (e) => applyAreaValue(e.target.value));
    attachAutocomplete(
      areaInput,
      areaInput.closest(".autocomplete").querySelector(".autocomplete-list"),
      () => areasCache.map((a) => a.name),
      applyAreaValue
    );

    rowEl.querySelectorAll(".stay-hotel-option").forEach((hotelEl) => {
      const hotelIndex = Number(hotelEl.getAttribute("data-hotel-index"));
      const propertyInput = hotelEl.querySelector(".hotel-property-input");
      const roomsInput = hotelEl.querySelector(".hotel-option-rooms");

      function applyPropertyValue(value) {
        hotelOptionsMap[stayKey][hotelIndex].name = value.trim();
        parsedItinerary = withCurrentMetadata(itinerary);
        renderItinerary(parsedItinerary);
      }

      propertyInput.addEventListener("change", (e) => applyPropertyValue(e.target.value));
      attachAutocomplete(
        propertyInput,
        propertyInput.closest(".autocomplete").querySelector(".autocomplete-list"),
        () => propertiesCache.map((p) => p.name),
        applyPropertyValue
      );

      roomsInput.addEventListener("change", (e) => {
        hotelOptionsMap[stayKey][hotelIndex].rooms = e.target.value;
        parsedItinerary = withCurrentMetadata(itinerary);
        renderItinerary(parsedItinerary);
      });

      const removeButton = hotelEl.querySelector(".hotel-option-remove");
      if (removeButton) {
        removeButton.addEventListener("click", () => {
          if (hotelOptionsMap[stayKey].length <= 1) return;
          hotelOptionsMap[stayKey].splice(hotelIndex, 1);
          parsedItinerary = withCurrentMetadata(itinerary);
          renderItinerary(parsedItinerary);
        });
      }
    });

    rowEl.querySelector(".hotel-option-add").addEventListener("click", () => {
      hotelOptionsMap[stayKey].push({ name: "", rooms: "" });
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
  let last = { name: "", tag: "" };
  const stays = getHotelStays(itinerary);

  for (const stay of stays) {
    const selected = hotelAreaMap[stay.key] || "";
    let area;
    if (selected) {
      area = areaByName(selected);
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
  const propertyName = primaryPropertyName(stay);
  const property = propertyName ? propertiesCache.find((candidate) => candidate.name === propertyName) : null;
  const candidateNames = [property?.area, stay.location].filter(Boolean);

  for (const name of candidateNames) {
    const matchedArea = areasCache.find((candidate) => normalizeMatchText(candidate.name) === normalizeMatchText(name));
    if (matchedArea) return { name: matchedArea.name, tag: matchedArea.tag };
  }

  return null;
}

// The hotel-options list for a stay (primary hotel plus any alternates), lazily
// initialized from whatever was already parsed (e.g. text using "Hotel A or
// Hotel B [Rooms]") or, failing that, an auto-matched property. Both the Hotel
// Setup panel and the itinerary-building metadata read from this single map so
// they never drift out of sync with each other.
function getStayHotelOptions(stay) {
  if (!hotelOptionsMap[stay.key]) {
    if (stay.accommodationOptions?.length) {
      hotelOptionsMap[stay.key] = stay.accommodationOptions.map((option) => ({
        name: option.name,
        rooms: (option.rooms || []).join(", ")
      }));
    } else {
      const matched = autoMatchPropertyName(stay.accommodation) || stay.accommodation || "";
      hotelOptionsMap[stay.key] = [{ name: matched, rooms: "" }];
    }
  }
  return hotelOptionsMap[stay.key];
}

function primaryPropertyName(stay) {
  return getStayHotelOptions(stay)[0]?.name.trim() || "";
}

function areaByName(name) {
  const normalizedName = String(name || "").trim();
  if (!normalizedName) return { name: "", tag: "" };
  const area = areasCache.find((candidate) => candidate.name.toLowerCase() === normalizedName.toLowerCase());
  return area ? { name: area.name, tag: area.tag } : { name: normalizedName, tag: "" };
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
      accommodationOptions: day.accommodationOptions || null,
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
  const propertyName = stay ? primaryPropertyName(stay) : autoMatchPropertyName(day.accommodation);
  if (!propertyName) return { propertyName: "", propertyTag: "" };
  const property = propertiesCache.find((candidate) => candidate.name === propertyName);
  return {
    propertyName,
    propertyTag: property?.tag || ""
  };
}

// Builds the accommodationOptions override for a day from the Hotel Setup
// panel's per-stay hotel list, only when there's actually more than one option
// or a room selection - a single plain hotel with no rooms needs no override,
// since propertyForDay above already covers that common case.
function accommodationOptionsForDay(day, index, itinerary) {
  const stay = getHotelStays(itinerary).find((candidate) => index >= candidate.startIndex && index <= candidate.endIndex);
  if (!stay) return {};

  const cleaned = getStayHotelOptions(stay)
    .filter((option) => option.name.trim())
    .map((option) => ({
      name: option.name.trim(),
      rooms: option.rooms.split(",").map((room) => room.trim()).filter(Boolean)
    }));

  if (cleaned.length > 1 || cleaned.some((option) => option.rooms.length)) {
    return { accommodationOptions: cleaned };
  }
  return {};
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
