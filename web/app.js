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

refreshStatus();
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
    const data = await request("/api/parse", { text: input.value });
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

async function login() {
  setBusy(true);
  setMessage("Opening Safari Portal login. Finish login in the browser, then return here.");
  try {
    const data = await request("/api/login", {});
    setMessage(`Saved login session: ${data.storagePath}`);
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

  setBusy(true);
  setMessage("Opening Safari Portal draft builder. Review the browser when it appears.");
  try {
    await request("/api/build", { itinerary: parsedItinerary, submit: false });
    setMessage("Draft builder finished.");
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
    return;
  }

  summary.innerHTML = [
    summaryItem("Client", itinerary.clientName),
    summaryItem("Trip", itinerary.tripTitle),
    summaryItem("Start", itinerary.startDate),
    summaryItem("End", itinerary.endDate)
  ].join("");

  if (!itinerary.days.length) {
    days.innerHTML = `<div class="empty-state">No days were detected. Try headings like Day 1, Day 2, and so on.</div>`;
    return;
  }

  days.innerHTML = itinerary.days.map(renderDay).join("");
}

function renderDay(day, index) {
  return `
    <article class="day-card">
      <div class="day-title">
        <span>Day ${day.number || index + 1}</span>
        <span class="muted">${escapeHtml([day.date, day.location].filter(Boolean).join(" | "))}</span>
      </div>
      <div class="day-grid">
        ${field("Accommodation", day.accommodation)}
        ${field("Meals", day.meals)}
        ${field("Activities", day.activities, true)}
        ${field("Transfers", day.transfers, true)}
        ${field("Flights", day.flights, true)}
        ${field("Notes", day.notes, true)}
      </div>
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

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
