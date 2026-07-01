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
