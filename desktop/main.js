const { app, BrowserWindow, dialog, shell } = require("electron");
const fs = require("fs");
const path = require("path");

// A packaged build's cwd is not guaranteed to be a stable, writable place -
// config/portal.json, data/*.csv, and .auth/ session files need to resolve
// somewhere that persists across launches. A portable .exe re-extracts to a
// fresh temp folder every run (electron-builder sets PORTABLE_EXECUTABLE_DIR
// to the real folder the .exe lives in for exactly this reason); an
// installed Windows build's process.execPath already points at its real,
// stable install directory, so anchor cwd there instead. On macOS,
// process.execPath sits inside the read-only .app bundle (Contents/MacOS/),
// which isn't writable and isn't where Mac apps are expected to keep data -
// use the standard per-user app-data directory there instead.
if (process.env.PORTABLE_EXECUTABLE_DIR) {
  process.chdir(process.env.PORTABLE_EXECUTABLE_DIR);
} else if (app.isPackaged) {
  process.chdir(process.platform === "darwin" ? app.getPath("userData") : path.dirname(process.execPath));
}

const { closeOpenDraftBrowsers, startServer } = require("../src/server");

let serverHandle = null;
let mainWindow = null;
let isQuitting = false;

// data/*.csv ships bundled inside the packaged app (it's checked into the
// repo), but dataCsvPath() in src/server.js reads from the writable cwd
// above, not the bundled resources - so a fresh install would otherwise
// show empty Areas/Properties/Transfers lists until someone used "Manage
// Data" or copied files in by hand. Seed the writable folder from the
// bundled copy once, without ever overwriting a file the user already has.
function seedDefaultData() {
  if (!app.isPackaged) return;
  const bundledDataDir = path.resolve(__dirname, "../data");
  if (!fs.existsSync(bundledDataDir)) return;

  const targetDataDir = path.resolve("data");
  for (const fileName of fs.readdirSync(bundledDataDir)) {
    if (!fileName.endsWith(".csv")) continue;
    const targetPath = path.resolve(targetDataDir, fileName);
    if (fs.existsSync(targetPath)) continue;
    fs.mkdirSync(targetDataDir, { recursive: true });
    fs.copyFileSync(path.resolve(bundledDataDir, fileName), targetPath);
  }
}

// Startup failures here would otherwise be a silently-swallowed rejection
// (app.whenReady().then(createWindow) had no .catch) or an invisible native
// crash - the app would just vanish with no window and no clue why. Log to
// a file next to the exe and surface a dialog so failures are never silent.
function logFatal(label, error) {
  const message = `[${new Date().toISOString()}] ${label}: ${error?.stack || error}\n`;
  try {
    fs.appendFileSync(path.resolve("safari-bot-crash.log"), message);
  } catch (_) {}
  console.error(message);
  try {
    dialog.showErrorBox("Safari Bot failed to start", `${label}\n\n${error?.message || error}`);
  } catch (_) {}
}

async function createWindow() {
  seedDefaultData();
  serverHandle = await startServer({ port: 0, host: "127.0.0.1" });

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 980,
    minHeight: 680,
    title: "Safari Bot",
    backgroundColor: "#f4f7f5",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    logFatal("Renderer process gone", new Error(JSON.stringify(details)));
  });

  await mainWindow.loadURL(serverHandle.url);
}

process.on("uncaughtException", (error) => logFatal("Uncaught exception", error));
process.on("unhandledRejection", (error) => logFatal("Unhandled rejection", error));

app.whenReady().then(createWindow).catch((error) => logFatal("Failed during startup", error));

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", async (event) => {
  if (!isQuitting) {
    event.preventDefault();
    isQuitting = true;
    await closeOpenDraftBrowsers();
    app.quit();
    return;
  }

  if (serverHandle?.server) {
    serverHandle.server.close();
  }
});
