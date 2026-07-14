# Safari Bot

A local Playwright assistant that logs into your Safari Portal account, parses a pasted itinerary, and starts building a draft itinerary for you.

The first version is intentionally local and supervised:

- credentials stay in your browser session, not in source code
- the bot saves a reusable login session in `.auth/safari-portal.json`
- the Safari Portal field/button selectors live in `config/portal.json`
- actual submission is off unless you pass `--submit`

## Installation

Download the latest build from the [Releases page](https://github.com/coatlesss/safariBot/releases/latest) - no need to clone this repo or install Node/Playwright yourself:

- **Windows**: download `Safari-Bot-Setup-<version>.exe` and run it. It's unsigned, so Windows SmartScreen will warn you the first time - click **More info** -> **Run anyway**. It installs per-user (no admin rights needed) with Start Menu / Desktop shortcuts.
- **Mac (Apple Silicon)**: download `Safari-Bot-<version>-arm64.dmg`, open it, and drag **Safari Bot** into the **Applications** shortcut shown. It's unsigned, so right-click the app -> **Open** the first time instead of double-clicking (or allow it via System Settings -> Privacy & Security) to get past Gatekeeper.

Both come pre-loaded with `config/portal.json` and the `data/*.csv` reference sheets, so they should work right after install with no extra setup - just launch and go.

If you'd rather run it from source (for development, or to build your own installer), continue with the sections below.

## Setup

Playwright is already installed in this folder. If you ever need to reinstall dependencies:

```powershell
npm install
```

Create your private config:

```powershell
Copy-Item config\portal.example.json config\portal.json
```

Edit `config/portal.json` with the real Safari Portal URLs and labels/selectors you see in your account.

## Local App

For easier testing in a browser, start the local UI:

```powershell
npm run app
```

Open:

```text
http://localhost:3131
```

From there you can paste an itinerary, parse it, copy the JSON, open the login browser, and start the draft builder.

Use the customer fields above the itinerary text for draft metadata: last name, B2C/B2B, and agency name for B2B bookings. These values are included in the parsed JSON and can be mapped to Safari Portal fields later.

Below that are two tabs for getting itinerary text into the box:

- **Paste Text** - paste a full itinerary (see [Itinerary Format](#itinerary-format) below), or a simpler hotel list such as:

  ```text
  Client: Jane Smith
  Trip: Kenya Hotels
  Hotel: Hemingways Nairobi
  Lodge: Tortilis Camp
  Serengeti Safari Camp
  ```

  `Load Template` fills in a blank starting point and `Load Sample` fills in a complete worked example, both landing in this tab.

- **Build Itinerary** - a form instead of raw text: set a client name and trip title, then add one row per stay with a location, a night count, and one or more hotel options (use `+ Add alternate hotel` for backup choices, each with optional room notes, so the draft builder can try them in order on Safari Portal). `Generate Itinerary` turns this into itinerary text and switches to the Paste Text tab so you can review it before parsing.

Use `Trip starts` to assign dates automatically. For example, if `Trip starts` is `2026-04-10`, then `Day 1` is `2026-04-10`, `Day 2` is `2026-04-11`, and a row like `Day 1-5 Heda-Ito` expands into five placeholder hotel nights.

The login button opens a browser. Log in normally - once Safari Portal redirects you away from the login page, the browser closes itself and the session saves automatically. You can also close the window manually at any point as a fallback.

`Build Draft` opens Safari Portal with your saved login session and tries to fill the fields listed in `config/portal.json`. Keep this as a supervised step until the real Safari Portal hotel fields and buttons are mapped. `Close Draft Browser` closes any draft browser windows left open from a previous build.

If a hotel name can't be matched against `data/pages_property.csv`, a `+ New Property Page` button appears in the top bar as a shortcut to Safari Portal's "add property" page (set by `newPropertyPageUrl` in `config/portal.json`).

## Data Files

Editable CSV data lives in `data/`:

- `data/pages_area.csv` powers the area/RI dropdowns.
- `data/pages_property.csv` powers automatic hotel/property matching.
- `data/pages_transfer.csv` powers transfer segment matching between areas.

Use the `Manage Data` button in the app to upload a fresh CSV export for any of the three datasets. Uploads are merged, not replaced: rows are matched by name (or by From/To Area + Segment for transfers), matching rows have their non-blank fields refreshed, new rows are appended, and anything missing from the upload is left untouched. You can still replace a file on disk directly with the same filename and click `Reload` instead.

## Desktop App

To launch Safari Bot as a desktop app:

```powershell
npm run desktop
```

This opens the same UI in its own application window and starts the local backend automatically.

## Building The Installers

For producing new builds (as opposed to just installing one from the Releases page above). Standalone Windows and Mac apps with Chromium bundled in (no separate Playwright install needed on the machine running them):

- **Windows**: `npm run dist` builds an NSIS installer at `dist/Safari-Bot-Setup-<version>.exe`. Unsigned, so Windows SmartScreen will flag it on first run ("More info" -> "Run anyway"). Config and data live in the app's own install folder (typically `%LOCALAPPDATA%\Programs\safari-bot\`).
- **Mac**: `npm run dist:mac` (needs a macOS runner - this project can't build it directly) produces an ad-hoc-signed arm64 `.dmg` at `dist/Safari-Bot-<version>-arm64.dmg`. Gatekeeper still blocks it as from an unidentified developer on first run (right-click the app -> Open), but ad-hoc signing keeps it from being flagged as outright "damaged" the way a fully unsigned arm64 app is. Config and data live in `~/Library/Application Support/Safari Bot/`.

Both builds bundle whatever `config/portal.json` exists locally at build time (Windows) or is provided via the `PORTAL_JSON` repository secret (Mac CI, since `config/portal.json` is gitignored and this repo is public) and seed it - along with the `data/*.csv` files - into place on first launch, so a fresh install comes pre-configured instead of starting empty.

### Cutting a release

`npm run release -- patch` (or `minor`/`major`) bumps the version in `package.json`, commits it, tags it (`vX.Y.Z`), and pushes both - this is just `npm version` under the hood. The pushed tag triggers the `Release` GitHub Actions workflow, which builds the Windows and Mac installers in parallel and publishes them as assets on a new GitHub Release for that tag automatically. No manual `gh release` commands needed.

The `Build macOS App` workflow still exists separately for one-off Mac-only rebuilds (e.g. testing a fix) without cutting a full versioned release.

## One-time login

```powershell
npm run login -- --config config/portal.json
```

A browser opens. Log in normally, then return to the terminal and press Enter. The bot saves the browser session locally under `.auth/`.

## Parse an itinerary

```powershell
npm run parse -- examples/sample-itinerary.txt
```

## Build a draft

Dry run first:

```powershell
npm run build -- examples/sample-itinerary.txt --config config/portal.json --dry-run
```

Then open Safari Portal and fill the draft:

```powershell
npm run build -- examples/sample-itinerary.txt --config config/portal.json
```

The browser stays open at the end so you can review and save/submit manually. To let the bot click the configured submit button:

```powershell
npm run build -- examples/sample-itinerary.txt --config config/portal.json --submit
```

## Itinerary Format

The parser accepts loose pasted text. It does best with headings like:

```text
Client: Jane Smith
Trip: Kenya Family Safari
Start: 2026-08-12
End: 2026-08-19

Day 1 - Aug 12 - Nairobi
Accommodation: Hemingways Nairobi
Transfer: Airport meet and greet, private transfer to hotel
Activity: Evening at leisure
Notes: VIP welcome amenities
```

It also recognizes lines beginning with `Hotel:`, `Lodge:`, `Flight:`, `Transfer:`, `Activity:`, `Meal:`, and `Notes:`.

## Teaching The Bot Safari Portal

Start with human-readable labels in `config/portal.json`, for example:

```json
"tripTitle": { "label": "Trip Name" }
```

If a field is hard to find by label, use a CSS selector from the browser inspector:

```json
"tripTitle": { "selector": "input[name='trip_name']" }
```

Keep `submitButton` unset until the draft flow is reliable.
