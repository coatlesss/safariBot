# Maintaining Safari Bot (no coding experience required)

This guide is for whoever ends up owning this tool after the person who built
it moves on. You do not need to know how to write code. The realistic way to
maintain and improve this program is to **describe what you want in plain
English to an AI coding assistant** (like Claude Code) and let it make the change for you. This document explains
how that actually works day-to-day, plus the handful of things worth knowing
yourself.

## What this program actually does

Safari Bot is a desktop app used to:

1. Take a pasted (or manually built) trip itinerary and parse it into a
   structured format.
2. Automatically fill that itinerary into the Safari Portal's draft builder,
   so an employee doesn't have to type it all in by hand.
3. Copy a simplified day-by-day table (dates, hotels, transport) to the
   clipboard, ready to paste into the company's quotation spreadsheet.

It runs as an installed Windows/Mac app (built from this same source code)
that employees download from the project's GitHub Releases page.

## The golden rule: you talk, the AI types

You do not need to open any code file yourself for the vast majority of
changes. Instead:

1. Open this project's folder in Claude Code (or whichever AI coding tool is
   available to you).
2. Type what you want, the same way you'd explain it to a person. Examples of
   real requests that shaped this app:
   - *"Make the last name field mandatory before building a draft."*
   - *"There's a button that doesn't actually close the browser - fix it."*
   - *"I want a button that copies the itinerary as a table I can paste into
     Excel."*
   - *"The button should say 'Copied!' when it works."*
3. The assistant will read the relevant files, ask you clarifying questions
   if something is genuinely your call (not a coding detail), make the
   change, and **test it before telling you it's done** - it should actually
   run the app and click through the feature, not just say "this should
   work."
4. If something looks wrong once you try it yourself, just say so - "that's
   not quite right, the date should also show on the last row" is a
   perfectly good thing to say. Iterating like this is normal and expected.

You almost never need to know *why* something is broken - just *what* is
broken, described from your point of view as a user.

## Where things live (a map, not homework)

You don't need to memorize this, but it helps to know these exist so you can
mention them if relevant:

| Location | What it is |
|---|---|
| `config/portal.json` | The settings this app uses to find buttons on the safari portal website. If the website changes at all this needs to be updated. |
| `data/*.csv` | The reference spreadsheets (areas, properties, transfer routes) the app uses for autocomplete and matching. **You can update these yourself** through the app's "Manage Data" button - no AI/code needed, just upload a CSV export with the same columns. |
| `web/` | Everything about what you see on screen - the layout, buttons, and behavior of the app window. |
| `src/` | The behind-the-scenes logic: parsing itineraries, driving the browser automation, the local server. |
| `debug/` | Screenshots and page snapshots the app saves automatically whenever the Safari Portal automation can't find something it expected. Useful to hand to the AI assistant when diagnosing a broken field ("here's what debug/xyz.png shows"). |
| `README.md` | Setup and build instructions, written for a developer audience. |

## Testing a change before it ships

Ask the assistant to run the app so you (or it) can click through the actual
feature - don't just take "the code looks right" as good enough. In practice
this means it will run something like `npm run app` or `npm run desktop` and
either drive it automatically or ask you to try it. If you're testing
something that touches the real Safari Portal (logging in, building a real
draft), say so explicitly - that's a live system, not a sandbox, and it's
worth being careful there.

## Shipping an update once it works

Once a change is tested and you're happy with it, ask the assistant to
**commit, push, and cut a new release** (or just say "push it and make a new
version"). Here's what actually happens when it does:

1. It records the change (a "commit").
2. It runs `npm run release -- patch` (for a small fix) or
   `npm run release -- minor` (for a new feature) - this bumps the version
   number, e.g. 0.4.0 → 0.4.1, and pushes it.
3. That automatically triggers GitHub to build **both** a new Windows
   installer and a new Mac installer, and publish them to the project's
   [Releases page](https://github.com/coatlesss/safariBot/releases) - usually
   within about 5 minutes, no manual steps required.
4. Employees download the new installer from that same Releases page
   whenever they want the update - it's not automatically pushed to their
   machines.

You can ask the assistant "is the new version ready yet?" and it can check
for you rather than you needing to watch GitHub yourself.

**Patch vs. minor vs. major**, in plain terms:
- **Patch** (0.4.0 → 0.4.1): a fix - something was broken and now it isn't.
- **Minor** (0.4.0 → 0.5.0): something new was added that wasn't there
  before.
- **Major** (0.4.0 → 1.0.0): a big enough change that old habits/behavior
  might need to be relearned. Rare - don't worry about this one.

If you're not sure which, just ask the assistant to recommend one - it did
exactly that throughout this project's history.

## Common situations and what to say

- **"A field isn't filling in anymore on the real Safari Portal."** This
  usually means the Portal's own website changed something. Say what field,
  and if possible what you saw happen (or didn't happen). The assistant can
  often diagnose this from the `debug/` folder without needing you to know
  any technical details.
- **"We added a new hotel/area/transfer route and it's not showing up as an
  option."** You likely just need to update the relevant CSV via "Manage
  Data" in the app - no code change needed at all.
- **"I want the tool to do something new."** Just describe the end result
  you want, the way you would to a person, with an example if you have one
  (a screenshot of a spreadsheet you want to match, like was done for the
  quotation table feature, works great).
- **"Something feels off but I can't explain exactly why."** Describe the
  symptom as best you can - "this used to take 2 seconds and now it hangs
  for a minute" is enough of a starting point.

## A few things worth knowing yourself (safety notes)

- **Never paste the contents of `config/portal.json` into a public place**
  (a public GitHub issue, a public chat, etc.) - it contains real internal
  URLs and selectors for the company's Safari Portal account.
- **If an AI assistant ever asks to force-push, delete a branch, or rewrite
  git history** - pause and ask a developer first, or at least ask the
  assistant to explain exactly what that would undo. These are the rare
  operations that are hard to reverse.
- **The `debug/` folder is safe to delete** if it gets too large - it's just
  auto-generated troubleshooting screenshots, nothing the app depends on to
  run.
- **The `.auth/` folder holds the saved login session** for the Safari
  Portal. If the app ever says "Login needed," use the "Open Login" button
  in the app rather than deleting this folder yourself.

## A short glossary

- **Repo (repository)**: the project's folder, tracked by git.
- **Commit**: a saved snapshot of a change, with a short description.
- **Push**: sending your commits to GitHub, where everyone (and the release
  process) can see them.
- **Release / version / tag**: a specific, numbered snapshot of the app that
  gets built into installers (e.g. "v0.4.0").
- **`npm run <something>`**: a named shortcut command for this project (e.g.
  `npm run app` starts the app, `npm run release -- patch` ships an update).
  You'll rarely type these yourself - the assistant runs them for you.
- **Selector**: a technical description of "which button/field on the
  webpage" the automation should interact with, stored in
  `config/portal.json`. Only meaningful if you're debugging why the
  automation clicked the wrong thing.

If in doubt about any of this, just ask the assistant to explain a term or a
step in more detail - "what does that actually mean?" is always a fine thing
to say.
