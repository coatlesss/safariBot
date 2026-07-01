const fs = require("fs");
const http = require("http");
const path = require("path");
const { parseHotelItinerary, parseItinerary } = require("./parseItinerary");
const { loadConfig } = require("./config");
const { login } = require("./session");
const { buildPortalDraft } = require("./portalBuilder");

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

    if (req.method === "GET" && url.pathname === "/api/status") {
      return sendJson(res, getStatus());
    }

    if (req.method === "POST" && url.pathname === "/api/parse") {
      const body = await readJson(req);
      return sendJson(res, { itinerary: parseByMode(bodyText(body), body.mode) });
    }

    if (req.method === "POST" && url.pathname === "/api/login") {
      const config = loadConfig("config/portal.json");
      const storagePath = await login(config, { waitForClose: true });
      return sendJson(res, { ok: true, storagePath });
    }

    if (req.method === "POST" && url.pathname === "/api/build") {
      const body = await readJson(req);
      const itinerary = body.itinerary || parseByMode(bodyText(body), body.mode);
      const config = loadConfig("config/portal.json");
      await buildPortalDraft(config, itinerary, { submit: Boolean(body.submit) });
      return sendJson(res, { ok: true });
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

function parseByMode(text, mode) {
  if (mode === "hotels") return parseHotelItinerary(text);
  return parseItinerary(text);
}

function getStatus() {
  const configPath = path.resolve("config/portal.json");
  const storagePath = path.resolve(".auth/safari-portal.json");
  return {
    hasConfig: fs.existsSync(configPath),
    hasLoginSession: fs.existsSync(storagePath),
    configPath,
    storagePath
  };
}

function serveStatic(requestPath, res) {
  const normalizedPath = requestPath === "/" ? "/index.html" : requestPath;
  const decodedPath = decodeURIComponent(normalizedPath);
  const filePath = path.resolve(PUBLIC_DIR, `.${decodedPath}`);

  if (!filePath.startsWith(PUBLIC_DIR)) {
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
  startServer
};
