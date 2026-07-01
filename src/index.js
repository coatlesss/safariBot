const fs = require("fs");
const readline = require("readline/promises");
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

async function readItinerary(args, options = {}) {
  if (args.stdin) return fs.readFileSync(0, "utf8");
  const file = args._[0];
  if (!file && options.allowPaste) return readPastedItinerary();
  if (!file) throw new Error("Missing itinerary file. Pass a path, use --stdin, or run npm run parse and paste text.");
  return fs.readFileSync(file, "utf8");
}

async function readPastedItinerary() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const lines = [];

  console.log("Paste the itinerary below. Type END on its own line when finished.");
  while (true) {
    const line = await rl.question("");
    if (line.trim().toUpperCase() === "END") break;
    lines.push(line);
  }

  rl.close();
  return lines.join("\n");
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
    const itinerary = parseItinerary(await readItinerary(args, { allowPaste: true }));
    console.log(JSON.stringify(itinerary, null, 2));
    return;
  }

  if (command === "build") {
    const itinerary = parseItinerary(await readItinerary(args));
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
  npm run parse
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
