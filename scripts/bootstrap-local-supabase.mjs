#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const defaults = {
  container: process.env.KAVERO_LOCAL_SUPABASE_DB_CONTAINER || "supabase_db_kavero",
  database: process.env.KAVERO_LOCAL_SUPABASE_DB || "postgres",
  user: process.env.KAVERO_LOCAL_SUPABASE_DB_USER || "postgres",
  schema: path.join(repoRoot, "supabase", "schema.sql"),
  foundation: path.join(repoRoot, "supabase", "local-foundation.sql"),
};

function printHelp() {
  console.log(`Kavero local Supabase bootstrap

Applies the guarded app schema and the local foundation SQL to a running
Supabase CLI Postgres container.

Usage:
  node scripts/bootstrap-local-supabase.mjs [options]

Options:
  --container <name>    Docker DB container name. Default: ${defaults.container}
  --database <name>     Postgres database name. Default: ${defaults.database}
  --user <name>         Postgres user. Default: ${defaults.user}
  --schema <path>       App schema SQL. Default: supabase/schema.sql
  --foundation <path>   Local foundation SQL. Default: supabase/local-foundation.sql
  -h, --help            Show this help.

Environment overrides:
  KAVERO_LOCAL_SUPABASE_DB_CONTAINER
  KAVERO_LOCAL_SUPABASE_DB
  KAVERO_LOCAL_SUPABASE_DB_USER

Expected order:
  1. supabase start
  2. node scripts/bootstrap-local-supabase.mjs
`);
}

function parseArgs(argv) {
  const options = { ...defaults };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") return { help: true, options };

    const value = argv[i + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${arg} requires a value.`);
    }

    if (arg === "--container") options.container = value;
    else if (arg === "--database") options.database = value;
    else if (arg === "--user") options.user = value;
    else if (arg === "--schema") options.schema = path.resolve(repoRoot, value);
    else if (arg === "--foundation") options.foundation = path.resolve(repoRoot, value);
    else throw new Error(`Unknown option: ${arg}`);

    i += 1;
  }

  return { help: false, options };
}

function applySql({ label, filePath, options }) {
  if (!existsSync(filePath)) {
    throw new Error(`${label} SQL file does not exist: ${filePath}`);
  }

  const sql = readFileSync(filePath, "utf8");
  const result = spawnSync(
    "docker",
    [
      "exec",
      "-i",
      options.container,
      "psql",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      options.user,
      "-d",
      options.database,
      "-f",
      "-",
    ],
    {
      input: sql,
      encoding: "utf8",
      stdio: ["pipe", "inherit", "inherit"],
    },
  );

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${label} SQL failed with exit code ${result.status}.`);
  }
}

try {
  const { help, options } = parseArgs(process.argv.slice(2));
  if (help) {
    printHelp();
    process.exit(0);
  }

  console.log(`Applying supabase/schema.sql to ${options.container}...`);
  applySql({ label: "schema", filePath: options.schema, options });

  console.log(`Applying supabase/local-foundation.sql to ${options.container}...`);
  applySql({ label: "local foundation", filePath: options.foundation, options });

  console.log("Local Supabase foundation bootstrap completed.");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
