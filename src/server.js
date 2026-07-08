const fs = require("fs");
const http = require("http");
const path = require("path");
const { parseHotelItinerary, parseItinerary } = require("./parseItinerary");
const { loadConfig } = require("./config");
const { login } = require("./session");
const { buildPortalDraft, closeOpenDraftBrowsers, openPortalPage } = require("./portalBuilder");

const DEFAULT_PORT = Number(process.env.PORT || 3131);
const PUBLIC_DIR = path.resolve(__dirname, "../web");
const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8"
};

function createServer() {
  return http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/api/sample") {
      return sendJson(res, { text: fs.readFileSync(path.resolve("examples/sample-itinerary.txt"), "utf8") });
    }

    if (req.method === "GET" && url.pathname === "/api/template") {
      return sendJson(res, { text: fs.readFileSync(path.resolve("examples/template.txt"), "utf8") });
    }

    if (req.method === "GET" && url.pathname === "/api/status") {
      return sendJson(res, getStatus());
    }

    if (req.method === "POST" && url.pathname === "/api/parse") {
      const body = await readJson(req);
      return sendJson(res, { itinerary: parseByMode(bodyText(body), body.mode, parseOptions(body)) });
    }

    if (req.method === "GET" && url.pathname === "/api/areas") {
      try {
        const csvPath = dataCsvPath("pages_area.csv", process.env.PAGES_CSV);
        if (!fs.existsSync(csvPath)) return sendJson(res, { areas: [] });
        const raw = fs.readFileSync(csvPath, "utf8");
        const rows = parseCsv(raw);
        const list = [];
        for (let i = 1; i < rows.length; i += 1) {
          const row = rows[i];
          if (!row || row.length < 9) continue;
          const tag = (row[8] || "").trim();
          if (tag.endsWith("_RI")) {
            const name = row[0] || row[2] || tag;
            list.push({ name: name.trim(), tag });
          }
        }
        return sendJson(res, { areas: list });
      } catch (err) {
        return sendJson(res, { areas: [] });
      }
    }

    if (req.method === "GET" && url.pathname === "/api/properties") {
      try {
        const csvPath = dataCsvPath("pages_property.csv", process.env.PROPERTIES_CSV);
        if (!fs.existsSync(csvPath)) return sendJson(res, { properties: [] });
        const rows = parseCsv(fs.readFileSync(csvPath, "utf8"));
        const header = rows[0] || [];
        const nameIndex = columnIndex(header, "Property Name", 0);
        const countryIndex = columnIndex(header, "Country", 1);
        const areaIndex = columnIndex(header, "Area", 2);
        const locationIndex = columnIndex(header, "Location", 3);
        const tagsIndex = columnIndex(header, "Tags", 9);
        const properties = [];

        for (let i = 1; i < rows.length; i += 1) {
          const row = rows[i];
          const name = (row[nameIndex] || "").trim();
          if (!name) continue;
          properties.push({
            name,
            country: (row[countryIndex] || "").trim(),
            area: (row[areaIndex] || "").trim(),
            location: (row[locationIndex] || "").trim(),
            tag: (row[tagsIndex] || "").trim()
          });
        }

        return sendJson(res, { properties });
      } catch (err) {
        return sendJson(res, { properties: [] });
      }
    }

    if (req.method === "GET" && url.pathname === "/api/transfers") {
      try {
        const csvPath = dataCsvPath("pages_transfer.csv", process.env.TRANSFERS_CSV);
        if (!fs.existsSync(csvPath)) return sendJson(res, { transfers: [] });
        const rows = parseCsv(fs.readFileSync(csvPath, "utf8"));
        const headerIndex = rows.findIndex((row) => row.some((value) => String(value || "").trim().toLowerCase() === "from area"));
        if (headerIndex < 0) return sendJson(res, { transfers: [] });

        const header = rows[headerIndex] || [];
        const fromIndex = columnIndex(header, "From Area", 1);
        const toIndex = columnIndex(header, "To Area", 2);
        const segmentIndex = columnIndex(header, "Segment", 3);
        const nameIndex = columnIndex(header, "Name (RI_AreaStart_AreaEnd_Segment)", 5);
        const transfers = [];

        for (let i = headerIndex + 1; i < rows.length; i += 1) {
          const row = rows[i];
          const fromArea = (row[fromIndex] || "").trim();
          const toArea = (row[toIndex] || "").trim();
          const segment = (row[segmentIndex] || "").trim();
          const name = (row[nameIndex] || "").trim();
          if (!fromArea || !toArea || !segment || !name) continue;
          transfers.push({
            fromArea,
            toArea,
            segment,
            name,
            tag: `@${compactTagPart(name)}${compactTagPart(fromArea)}${compactTagPart(toArea)}${compactTagPart(segment)}`
          });
        }

        return sendJson(res, { transfers });
      } catch (err) {
        return sendJson(res, { transfers: [] });
      }
    }

    if (req.method === "POST" && url.pathname === "/api/login") {
      const config = loadConfig("config/portal.json");
      const storagePath = await login(config, { waitForClose: true });
      return sendJson(res, { ok: true, storagePath });
    }

    if (req.method === "POST" && url.pathname === "/api/build") {
      const body = await readJson(req);
      const itinerary = body.itinerary || parseByMode(bodyText(body), body.mode, parseOptions(body));
      const config = loadConfig("config/portal.json");
      await buildPortalDraft(config, itinerary, { keepOpen: true, submit: Boolean(body.submit) });
      return sendJson(res, { ok: true });
    }

    if (req.method === "POST" && url.pathname === "/api/open-new-property-page") {
      const config = loadConfig("config/portal.json");
      if (!config.newPropertyPageUrl) return sendJson(res, { error: "newPropertyPageUrl is not set in config/portal.json." }, 400);
      await openPortalPage(config, config.newPropertyPageUrl);
      return sendJson(res, { ok: true });
    }

    if (req.method === "POST" && url.pathname === "/api/close-drafts") {
      await closeOpenDraftBrowsers();
      return sendJson(res, { ok: true });
    }

    if (req.method === "POST" && url.pathname === "/api/data/import") {
      const body = await readJson(req);
      const kind = body.kind;
      const csvText = typeof body.csvText === "string" ? body.csvText : "";
      const DATA_KINDS = {
        areas: { fileName: "pages_area.csv", envVar: "PAGES_CSV" },
        properties: { fileName: "pages_property.csv", envVar: "PROPERTIES_CSV" },
        transfers: { fileName: "pages_transfer.csv", envVar: "TRANSFERS_CSV" }
      };
      if (!DATA_KINDS[kind]) return sendJson(res, { error: "Unknown data kind." }, 400);
      if (!csvText.trim()) return sendJson(res, { error: "No CSV content received." }, 400);

      const { fileName, envVar } = DATA_KINDS[kind];
      const csvPath = dataCsvPath(fileName, process.env[envVar]);
      const currentRows = fs.existsSync(csvPath) ? parseCsv(fs.readFileSync(csvPath, "utf8")) : [];
      const newRows = parseCsv(csvText);

      const result = mergeDataSheet(kind, currentRows, newRows);
      fs.writeFileSync(csvPath, rowsToCsv(result.mergedRows), "utf8");
      return sendJson(res, { ok: true, updated: result.updated, added: result.added, skipped: result.skipped, total: result.total });
    }

    if (req.method === "GET") {
      return serveStatic(url.pathname, res);
    }

    sendJson(res, { error: "Not found" }, 404);
  } catch (error) {
    sendJson(res, { error: error.message }, 500);
  }
  });
}

function startServer(options = {}) {
  const port = options.port ?? DEFAULT_PORT;
  const host = options.host || "127.0.0.1";
  const server = createServer();

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      const address = server.address();
      const actualPort = typeof address === "object" && address ? address.port : port;
      resolve({
        server,
        port: actualPort,
        host,
        url: `http://${host}:${actualPort}`
      });
    });
  });
}

function bodyText(body) {
  if (typeof body.text === "string") return body.text;
  if (Array.isArray(body.text)) return body.text.join("\n");
  if (body.text == null) return "";
  return JSON.stringify(body.text, null, 2);
}

function parseOptions(body) {
  return {
    startDate: typeof body.startDate === "string" ? body.startDate : "",
    metadata: normalizeMetadata(body.metadata)
  };
}

function dataCsvPath(fileName, overridePath) {
  const localPath = path.resolve(process.cwd(), "data", fileName);
  if (fs.existsSync(localPath)) return localPath;
  return path.resolve(overridePath || path.resolve(process.env.USERPROFILE || process.env.HOME || ".", "Downloads", fileName));
}

// Merges an uploaded reference sheet (areas/properties/transfers export) into
// the current data CSV: rows are matched by a dataset-specific key, matching
// rows get their non-blank fields refreshed (a blank cell in the upload never
// erases existing data), unmatched keys are appended, and any current row not
// present in the upload is left untouched - this is a merge, not a replace.
function mergeDataSheet(kind, currentRows, newRows) {
  if (kind === "transfers") return mergeTransferSheet(currentRows, newRows);
  return mergeSimpleSheet(kind === "areas" ? "Area Name" : "Property Name", currentRows, newRows);
}

function mergeSimpleSheet(keyColumn, currentRows, newRows) {
  const headerRowIndex = 0;
  const header = currentRows[headerRowIndex] || newRows[0] || [];
  const currentRecords = rowsToRecords(currentRows, headerRowIndex);
  const newRecords = rowsToRecords(newRows, 0);

  const { updated, added, skipped } = applyMerge(currentRecords, newRecords, (record) => {
    const key = String(record[keyColumn] || "").trim().toLowerCase();
    return key || null;
  });

  const mergedRows = [
    ...currentRows.slice(0, headerRowIndex + 1),
    ...currentRecords.map((record) => recordToRow(record, header))
  ];
  return { mergedRows, updated, added, skipped, total: currentRecords.length };
}

function mergeTransferSheet(currentRows, newRows) {
  const headerRowIndex = findTransferHeaderRowIndex(currentRows);
  if (headerRowIndex < 0) throw new Error("Could not find the 'From Area' header row in the current transfers data.");
  const newHeaderRowIndex = findTransferHeaderRowIndex(newRows);
  if (newHeaderRowIndex < 0) throw new Error("Could not find a 'From Area' column header in the uploaded sheet.");

  const header = currentRows[headerRowIndex];
  const currentRecords = rowsToRecords(currentRows, headerRowIndex);
  const newRecords = rowsToRecords(newRows, newHeaderRowIndex);

  const transferKey = (record) => {
    const fromArea = String(record["From Area"] || "").trim().toLowerCase();
    const toArea = String(record["To Area"] || "").trim().toLowerCase();
    const segment = String(record["Segment"] || "").trim().toLowerCase();
    if (!fromArea || !toArea || !segment) return null;
    return `${fromArea}|${toArea}|${segment}`;
  };

  const { updated, added, skipped } = applyMerge(currentRecords, newRecords, transferKey);

  const mergedRows = [
    ...currentRows.slice(0, headerRowIndex + 1),
    ...currentRecords.map((record) => recordToRow(record, header))
  ];
  return { mergedRows, updated, added, skipped, total: currentRecords.length };
}

// Mutates currentRecords in place: matching keys get filled in with any
// non-blank new values, new keys are pushed on the end, and null/blank keys
// are skipped rather than merged (avoids appending junk rows from a sheet
// with stray blank lines).
function applyMerge(currentRecords, newRecords, keyFn) {
  const indexByKey = new Map();
  currentRecords.forEach((record, index) => {
    const key = keyFn(record);
    if (key) indexByKey.set(key, index);
  });

  let updated = 0;
  let added = 0;
  let skipped = 0;
  for (const newRecord of newRecords) {
    const key = keyFn(newRecord);
    if (!key) {
      skipped += 1;
      continue;
    }
    if (indexByKey.has(key)) {
      const index = indexByKey.get(key);
      currentRecords[index] = mergeRecord(currentRecords[index], newRecord);
      updated += 1;
    } else {
      currentRecords.push(newRecord);
      indexByKey.set(key, currentRecords.length - 1);
      added += 1;
    }
  }
  return { updated, added, skipped };
}

function mergeRecord(currentRecord, newRecord) {
  const merged = { ...currentRecord };
  for (const [name, value] of Object.entries(newRecord)) {
    if (String(value || "").trim() !== "") merged[name] = value;
  }
  return merged;
}

function rowsToRecords(rows, headerRowIndex) {
  const header = rows[headerRowIndex] || [];
  return rows.slice(headerRowIndex + 1)
    .filter((row) => row.some((value) => String(value || "").trim() !== ""))
    .map((row) => {
      const record = {};
      header.forEach((col, i) => { record[String(col || "").trim()] = row[i] || ""; });
      return record;
    });
}

function recordToRow(record, header) {
  return header.map((col) => record[String(col || "").trim()] || "");
}

function findTransferHeaderRowIndex(rows) {
  return rows.findIndex((row) => row.some((value) => String(value || "").trim().toLowerCase() === "from area"));
}

function csvField(value) {
  const str = String(value ?? "");
  return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function rowsToCsv(rows) {
  return rows.map((row) => row.map(csvField).join(",")).join("\r\n") + "\r\n";
}

function columnIndex(header, columnName, fallback) {
  const index = header.findIndex((value) => String(value || "").trim().toLowerCase() === columnName.toLowerCase());
  return index >= 0 ? index : fallback;
}

function compactTagPart(value) {
  return String(value || "").trim().replace(/\s+/g, "");
}

function parseByMode(text, mode, options = {}) {
  const itinerary = mode === "hotels" ? parseHotelItinerary(text, options) : parseItinerary(text);
  return applyMetadata(itinerary, options.metadata);
}

function normalizeMetadata(metadata) {
  const raw = metadata && typeof metadata === "object" ? metadata : {};
  const customerType = raw.customerType === "b2b" ? "b2b" : "b2c";
  return {
    lastName: typeof raw.lastName === "string" ? raw.lastName.trim() : "",
    customerType,
    agencyName: customerType === "b2b" && typeof raw.agencyName === "string" ? raw.agencyName.trim() : "",
    areaName: typeof raw.areaName === "string" ? raw.areaName.trim() : "",
    areaTag: typeof raw.areaTag === "string" ? raw.areaTag.trim() : ""
  };
}

function applyMetadata(itinerary, metadata = {}) {
  return {
    ...itinerary,
    lastName: metadata.lastName || "",
    customerType: metadata.customerType || "b2c",
    agencyName: metadata.customerType === "b2b" ? metadata.agencyName || "" : "",
    areaName: metadata.areaName || "",
    areaTag: metadata.areaTag || ""
  };
}

// Simple CSV parser that handles quoted fields and commas inside quotes
function parseCsv(text) {
  const rows = [];
  let cur = [];
  let curField = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          curField += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        curField += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        cur.push(curField);
        curField = "";
      } else if (ch === '\n' || ch === '\r') {
        // handle CRLF or LF
        if (ch === '\r' && text[i + 1] === '\n') continue;
        cur.push(curField);
        rows.push(cur);
        cur = [];
        curField = "";
      } else {
        curField += ch;
      }
    }
  }
  // push remaining
  if (curField !== "" || cur.length) {
    cur.push(curField);
    rows.push(cur);
  }
  return rows;
}

function getStatus() {
  const configPath = path.resolve("config/portal.json");
  const storagePath = path.resolve(".auth/safari-portal.json");
  const hasConfig = fs.existsSync(configPath);
  let newPropertyPageUrl = "";
  if (hasConfig) {
    try {
      newPropertyPageUrl = JSON.parse(fs.readFileSync(configPath, "utf8")).newPropertyPageUrl || "";
    } catch (_) {}
  }
  return {
    hasConfig,
    hasLoginSession: fs.existsSync(storagePath),
    configPath,
    storagePath,
    newPropertyPageUrl
  };
}

function serveStatic(requestPath, res) {
  const normalizedPath = requestPath === "/" ? "/index.html" : requestPath;
  const decodedPath = decodeURIComponent(normalizedPath);
  const filePath = path.resolve(PUBLIC_DIR, `.${decodedPath}`);
  const relativePath = path.relative(PUBLIC_DIR, filePath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return sendText(res, "Forbidden", 403);
  }

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return sendText(res, "Not found", 404);
  }

  const ext = path.extname(filePath);
  res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" });
  fs.createReadStream(filePath).pipe(res);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 2_000_000) {
        reject(new Error("Request body is too large."));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("Invalid JSON request."));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, value, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(value, null, 2));
}

function sendText(res, value, status = 200) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(value);
}

if (require.main === module) {
  startServer({ port: DEFAULT_PORT, host: "127.0.0.1" })
    .then(({ url }) => {
      console.log(`Safari Bot app running at ${url}`);
    })
    .catch((error) => {
      if (["EADDRINUSE", "EACCES"].includes(error.code)) {
        startServer({ port: 0, host: "127.0.0.1" })
          .then(({ url }) => {
            console.log(`Port ${DEFAULT_PORT} was unavailable. Safari Bot app running at ${url}`);
          })
          .catch((fallbackError) => {
            console.error(fallbackError.message);
            process.exitCode = 1;
          });
        return;
      }

      console.error(error.message);
      process.exitCode = 1;
    });
}

module.exports = {
  createServer,
  closeOpenDraftBrowsers,
  startServer
};
