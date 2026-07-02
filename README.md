# Safari Bot

A local Playwright assistant that logs into your Safari Portal account, parses a pasted itinerary, and starts building a draft itinerary for you.

The first version is intentionally local and supervised:

- credentials stay in your browser session, not in source code
- the bot saves a reusable login session in `.auth/safari-portal.json`
- the Safari Portal field/button selectors live in `config/portal.json`
- actual submission is off unless you pass `--submit`

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

The app starts in `Hotels only` mode. In this mode, you can paste a simple hotel list such as:

```text
Client: Jane Smith
Trip: Kenya Hotels
Hotel: Hemingways Nairobi
Lodge: Tortilis Camp
Serengeti Safari Camp
```

The login button opens a browser. Log in normally, then close that browser window; Safari Bot saves the session when the login window closes.

Use `Trip starts` to assign dates automatically. For example, if `Trip starts` is `2026-04-10`, then `Day 1` is `2026-04-10`, `Day 2` is `2026-04-11`, and a row like `Day 1-5 Heda-Ito` expands into five placeholder hotel nights.

`Build Draft` opens Safari Portal with your saved login session and tries to fill the fields listed in `config/portal.json`. Keep this as a supervised step until the real Safari Portal hotel fields and buttons are mapped.

Use the customer fields above the itinerary text for draft metadata: last name, B2C/B2B, and agency name for B2B bookings. These values are included in the parsed JSON and can be mapped to Safari Portal fields later.

## Data Files

Editable CSV data lives in `data/`:

- `data/pages_area.csv` powers the area/RI dropdowns.
- `data/pages_property.csv` powers automatic hotel/property matching.

Replace those files with fresh Safari Portal exports using the same filenames, then click `Reload` or wait for the app to auto-refresh.

## Desktop App

To launch Safari Bot as a desktop app:

```powershell
npm run desktop
```

This opens the same UI in its own application window and starts the local backend automatically.

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
