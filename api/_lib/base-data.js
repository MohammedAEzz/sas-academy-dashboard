import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const FILES = ["instructors", "courses", "activities", "sessions", "feedback", "events"];
let cache = null;

function resolveDataDir() {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [join(here, "../../data"), join(process.cwd(), "data")];
  return candidates.find((dir) => existsSync(join(dir, "instructors.json"))) || candidates[0];
}

export function loadBaseData() {
  if (cache) return cache;
  const dir = resolveDataDir();
  cache = {};
  for (const name of FILES) {
    cache[name] = JSON.parse(readFileSync(join(dir, `${name}.json`), "utf8"));
  }
  return cache;
}

export function clearBaseDataCache() {
  cache = null;
}
