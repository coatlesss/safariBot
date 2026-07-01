const fs = require("fs");
const path = require("path");

function loadConfig(configPath) {
  const resolved = path.resolve(configPath || "config/portal.json");
  if (!fs.existsSync(resolved)) {
    throw new Error(`Config file not found: ${resolved}. Copy config/portal.example.json to config/portal.json first.`);
  }

  const config = JSON.parse(fs.readFileSync(resolved, "utf8"));
  if (!config.loginUrl) throw new Error("config.loginUrl is required.");
  if (!config.newItineraryUrl) throw new Error("config.newItineraryUrl is required.");
  config.storageStatePath = config.storageStatePath || ".auth/safari-portal.json";
  return config;
}

module.exports = {
  loadConfig
};
