const fs = require("fs");
const { parseItinerary } = require("./parseItinerary");
const { loadConfig } = require("./config");

function parseArgs(argv) {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      args._.push(token);
      continue;
    }

    const key = token.slice(2);
    if (["dry-run", "submit", "stdin"].includes(key)) {
      args[key] = true;
    } else {
      args[key] = argv[index + 1];
      index += 1;
    }
  }
  return args;
}

function readItinerary(args) {
  if (args.stdin) return fs.readFileSync(0, "utf8");
  const file = args._[0];
  if (!file) throw new Error("Missing itinerary file. Pass a path or use --stdin.");
  return fs.readFileSync(file, "utf8");
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);

  if (!command || ["help", "-h", "--help"].includes(command)) {
    printHelp();
    return;
  }

  if (command === "login") {
    const { login } = require("./session");
    const config = loadConfig(args.config);
    const storagePath = await login(config);
    console.log(`Saved login session to ${storagePath}`);
    return;
  }

  if (command === "parse") {
    const itinerary = parseItinerary(readItinerary(args));
    console.log(JSON.stringify(itinerary, null, 2));
    return;
  }

  if (command === "build") {
    const itinerary = parseItinerary(readItinerary(args));
    if (args["dry-run"]) {
      console.log(JSON.stringify(itinerary, null, 2));
      return;
    }

    const config = loadConfig(args.config);
    const { buildPortalDraft } = require("./portalBuilder");
    await buildPortalDraft(config, itinerary, { submit: Boolean(args.submit) });
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

function printHelp() {
  console.log(`Safari Bot

Usage:
  npm run login -- --config config/portal.json
  npm run parse -- itinerary.txt
  npm run build -- itinerary.txt --config config/portal.json [--dry-run] [--submit]

Options:
  --config <path>  Portal config path. Defaults to config/portal.json.
  --stdin          Read itinerary text from stdin.
  --dry-run        Parse only; do not open the browser.
  --submit         Click config.submitButton after filling the draft.
`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
