// StundTransfer: one-time import of a config.yaml into the database, so that
// every setting becomes editable in Admin > Configuration (Pingvin locks the
// admin settings while a config.yaml is mounted).
//
// Run it with the container STOPPED, then remove the config.yaml line from
// compose.yaml and start the container again:
//
//   node scripts/stundtransfer-import-config-yaml.cjs <config.yaml> <pingvin-share.db> [--dry-run] [--enable-public-deposit]
//
// --enable-public-deposit also turns on the StundTransfer public deposit, so the
// home page accepts files as soon as the container starts.
//
// Only settings known by the database are imported (the "internal" and
// "initUser" sections are skipped). Needs Node.js 22+ (node:sqlite).
const fs = require("fs");
const { DatabaseSync } = require("node:sqlite");
const { parse } = require("yaml");

const [yamlPath, dbPath, ...flags] = process.argv.slice(2);
if (!yamlPath || !dbPath) {
  console.error("Usage: node stundtransfer-import-config-yaml.cjs <config.yaml> <pingvin-share.db> [--dry-run] [--enable-public-deposit]");
  process.exit(1);
}
const dryRun = flags.includes("--dry-run");
const enablePublicDeposit = flags.includes("--enable-public-deposit");

const yaml = parse(fs.readFileSync(yamlPath, "utf8")) ?? {};
const db = new DatabaseSync(dbPath);
const rows = db.prepare("SELECT category, name, value, defaultValue FROM Config").all();
const known = new Map(rows.map((r) => [`${r.category}.${r.name}`, r]));
const update = db.prepare("UPDATE Config SET value = ?, updatedAt = ? WHERE category = ? AND name = ?");

let imported = 0;
const skipped = [];
db.exec("BEGIN");
try {
  for (const [category, values] of Object.entries(yaml)) {
    if (["internal", "initUser"].includes(category) || typeof values !== "object" || !values) continue;
    for (const [name, raw] of Object.entries(values)) {
      const key = `${category}.${name}`;
      const row = known.get(key);
      if (!row) {
        skipped.push(key);
        continue;
      }
      let value = raw === null || raw === undefined ? null : String(raw);
      // Same as the default: keep following the default
      if (value === row.defaultValue) value = null;
      if (value === row.value) continue;
      console.log(`${dryRun ? "[dry-run] " : ""}${key}: ${row.value ?? `(default ${row.defaultValue})`} -> ${value}`);
      if (!dryRun) update.run(value, Date.now(), category, name);
      imported++;
    }
  }
  if (enablePublicDeposit) {
    // Created with the same definition as prisma/seed/config.seed.ts; the seed keeps the value
    const exists = known.get("stundtransfer.publicDeposit");
    console.log(`${dryRun ? "[dry-run] " : ""}stundtransfer.publicDeposit -> true`);
    if (!dryRun) {
      if (exists)
        update.run("true", Date.now(), "stundtransfer", "publicDeposit");
      else
        db.prepare(
          'INSERT INTO Config (updatedAt, name, category, type, defaultValue, value, obscured, secret, locked, "order") VALUES (?, ?, ?, ?, ?, ?, 0, 1, 0, 0)',
        ).run(Date.now(), "publicDeposit", "stundtransfer", "boolean", "false", "true");
    }
    imported++;
  }
  db.exec(dryRun ? "ROLLBACK" : "COMMIT");
} catch (e) {
  db.exec("ROLLBACK");
  throw e;
}

console.log(`\n${imported} setting(s) ${dryRun ? "would be" : ""} imported.`);
if (skipped.length)
  console.log(`Ignored (unknown to this version): ${skipped.join(", ")}`);
