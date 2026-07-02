const input = document.querySelector("#itineraryInput");
const message = document.querySelector("#message");
const summary = document.querySelector("#summary");
const days = document.querySelector("#days");
const parseButton = document.querySelector("#parseButton");
const sampleButton = document.querySelector("#sampleButton");
const clearButton = document.querySelector("#clearButton");
const copyJsonButton = document.querySelector("#copyJsonButton");
const loginButton = document.querySelector("#loginButton");
const buildButton = document.querySelector("#buildButton");
const configStatus = document.querySelector("#configStatus");
const sessionStatus = document.querySelector("#sessionStatus");
const hotelsOnlyToggle = document.querySelector("#hotelsOnlyToggle");
const startDateInput = document.querySelector("#startDateInput");
const areaSelect = document.querySelector("#areaSelect");
const reloadAreasButton = document.querySelector("#reloadAreasButton");
const lastNameInput = document.querySelector("#lastNameInput");

let areasCache = [];
const hotelAreasContainer = document.querySelector("#hotelAreas");
let hotelAreaMap = {};
const clientTypeSelect = document.querySelector("#clientTypeSelect");
const agencySelect = document.querySelector("#agencySelect");
const agencySelectWrap = document.querySelector("#agencySelectWrap");
const agencyCustomWrap = document.querySelector("#agencyCustomWrap");
const agencyNameInput = document.querySelector("#agencyNameInput");

let parsedItinerary = null;

parseButton.addEventListener("click", parseCurrentText);
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
clientTypeSelect.addEventListener("change", updateAgencyControls);
agencySelect.addEventListener("change", updateAgencyControls);
if (areaSelect) areaSelect.addEventListener('change', () => { if (parsedItinerary) renderItinerary(parsedItinerary); });

refreshStatus();
updateAgencyControls();
loadAreas();
// Auto-refresh areas every 30 seconds so dropping a CSV updates the UI automatically
setInterval(loadAreas, 30 * 1000);
if (reloadAreasButton) reloadAreasButton.addEventListener('click', loadAreas);
renderItinerary(null);

async function loadSample() {
  setBusy(true);
  try {
    const data = await request("/api/sample");
    input.value = data.text;
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
    const list = data.areas || [];
    areasCache = list;
    populateAreas(list);
    // re-render hotel controls so selects show up-to-date options
    if (parsedItinerary) renderHotelAreaControls(parsedItinerary);
  } catch (err) {
    console.warn('Could not load areas:', err.message);
  }
}

function populateAreas(list) {
  if (!areaSelect) return;
  areasCache = list || [];
  // keep the default option
  areaSelect.innerHTML = `<option value="">(Select area)</option>` +
    areasCache.map((a) => `<option value="${escapeHtml(a.tag)}">${escapeHtml(a.name)}</option>`).join('');
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
  const perDayAreas = computePerDayAreaTags(itinerary);
  days.innerHTML = itinerary.days.map((d, i) => renderDay(d, i, perDayAreas[i])).join("");
  // attach listeners for hotel area selects
  bindHotelAreaControls(itinerary);
}

function renderDay(day, index, areaTag) {
  const detailFields = hotelsOnlyToggle.checked
    ? ""
    : `
        ${field("Meals", day.meals)}
        ${field("Activities", day.activities, true)}
        ${field("Transfers", day.transfers, true)}
        ${field("Flights", day.flights, true)}
        ${field("Notes", day.notes, true)}
      `;

  const areaDisplay = areaTag ? `<div class="area-label">Area: ${escapeHtml(areaTag)}</div>` : "";

  return `
    <article class="day-card">
      <div class="day-title">
        <span>Day ${day.number || index + 1}</span>
        <span class="muted">${escapeHtml([day.date, day.location].filter(Boolean).join(" | "))}</span>
      </div>
      <div class="day-grid">
        ${field("Accommodation", day.accommodation)}
        ${detailFields}
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

function field(label, value, full = false) {
  const text = Array.isArray(value) ? value.join("\n") : value;
  return `
    <div class="field ${full ? "full" : ""}">
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
  for (const button of [parseButton, sampleButton, clearButton, copyJsonButton, loginButton, buildButton]) {
    button.disabled = isBusy;
  }
}

function setMessage(text, isError = false) {
  message.textContent = text;
  message.style.color = isError ? "var(--bad)" : "var(--muted)";
}

function currentMode() {
  return hotelsOnlyToggle.checked ? "hotels" : "full";
}

function currentStartDate() {
  return startDateInput.value || "";
}

function currentAgencyName() {
  if (clientTypeSelect.value !== "b2b") return "";
  return agencySelect.value === "custom" ? agencyNameInput.value.trim() : agencySelect.value;
}

function currentMetadata() {
  return {
    lastName: lastNameInput.value.trim(),
    customerType: clientTypeSelect.value,
    agencyName: currentAgencyName(),
    areaTag: areaSelect ? areaSelect.value : ""
  };
}

function withCurrentMetadata(itinerary) {
  const meta = currentMetadata();
  const perDayAreas = computePerDayAreaTags(itinerary);
  return {
    ...itinerary,
    ...meta,
    days: itinerary.days.map((d, i) => ({ ...d, areaTag: perDayAreas[i] || meta.areaTag || "" }))
  };
}

// Render controls for each unique hotel (in order of appearance)
function renderHotelAreaControls(itinerary) {
  if (!hotelAreasContainer) return;
  const hotels = [];
  for (const day of itinerary.days) {
    const acc = (day.accommodation || "").trim();
    if (!acc) continue;
    if (!hotels.includes(acc)) hotels.push(acc);
  }

  if (!hotels.length) {
    hotelAreasContainer.innerHTML = "";
    return;
  }

  const options = (areasCache || []).map(a => `<option value="${escapeHtml(a.tag)}">${escapeHtml(a.name)}</option>`).join('');

  hotelAreasContainer.innerHTML = `
    <div class="hotel-areas-header"><strong>Hotel Areas</strong></div>
    ${hotels.map((h, idx) => `
      <label class="hotel-area-row">
        <span>${escapeHtml(h)}</span>
        <select class="hotel-area-select" data-hotel-index="${idx}" data-hotel="${escapeHtml(h)}">
          <option value="">(inherit)</option>
          ${options}
        </select>
      </label>
    `).join('')}
  `;
}

function bindHotelAreaControls(itinerary) {
  if (!hotelAreasContainer) return;
  // build hotels array in same order as renderHotelAreaControls
  const hotels = [];
  for (const day of itinerary.days) {
    const acc = (day.accommodation || '').trim();
    if (!acc) continue;
    if (!hotels.includes(acc)) hotels.push(acc);
  }
  const selects = hotelAreasContainer.querySelectorAll('.hotel-area-select');
  selects.forEach(select => {
    const idx = Number(select.getAttribute('data-hotel-index') || -1);
    const hotel = hotels[idx] || '';
    if (hotelAreaMap[hotel]) select.value = hotelAreaMap[hotel];
    select.addEventListener('change', () => {
      const val = select.value || '';
      if (val) hotelAreaMap[hotel] = val; else delete hotelAreaMap[hotel];
      // re-render days to reflect changes
      const perDayAreas = computePerDayAreaTags(itinerary);
      days.innerHTML = itinerary.days.map((d, i) => renderDay(d, i, perDayAreas[i])).join('');
    });
  });
}

// Compute effective area tag for each day using hotelAreaMap, falling back to global area select and inheriting previous day's tag
function computePerDayAreaTags(itinerary) {
  const areas = [];
  let last = areaSelect ? areaSelect.value : "";
  for (const day of (itinerary.days || [])) {
    const acc = (day.accommodation || "").trim();
    let tag = '';
    if (acc) {
      if (hotelAreaMap[acc]) {
        tag = hotelAreaMap[acc];
        last = tag || last;
      } else {
        tag = last;
      }
    } else {
      tag = last;
    }
    areas.push(tag || '');
  }
  return areas;
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
