import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isPlaceholderValue, sensitiveEnvKeys } from "./config.mjs";

const envLinePattern = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;

export function parseEnvContent(content) {
  const lines = content.length > 0 ? content.split(/\r?\n/) : [];
  if (lines.at(-1) === "") lines.pop();
  const values = {};
  const entries = [];

  for (const line of lines) {
    const match = line.match(envLinePattern);
    if (!match || line.trimStart().startsWith("#")) {
      entries.push({ type: "raw", raw: line });
      continue;
    }

    const [, key, value] = match;
    values[key] = value;
    entries.push({ type: "entry", key, value, raw: line });
  }

  return { entries, values };
}

export function serializeEnv(entries) {
  let content = entries
    .map((entry) => (entry.type === "entry" ? `${entry.key}=${entry.value}` : entry.raw))
    .join("\n");

  if (!content.endsWith("\n")) content += "\n";
  return content;
}

export function timestampForBackup(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
}

export async function buildUpdatedEnvEntries({
  existingContent = "",
  values,
  confirmOverwrite = async () => false,
  overwriteNonSensitive = false,
  sensitiveKeys = sensitiveEnvKeys,
}) {
  const parsed = parseEnvContent(existingContent);
  const entries = parsed.entries.map((entry) => ({ ...entry }));
  const indexByKey = new Map();

  entries.forEach((entry, index) => {
    if (entry.type === "entry") indexByKey.set(entry.key, index);
  });

  const changed = [];
  const preserved = [];
  const added = [];
  const skipped = [];

  for (const [key, nextValueRaw] of Object.entries(values)) {
    const nextValue = String(nextValueRaw ?? "");
    const index = indexByKey.get(key);

    if (index === undefined) {
      entries.push({ type: "entry", key, value: nextValue });
      indexByKey.set(key, entries.length - 1);
      added.push(key);
      continue;
    }

    const entry = entries[index];
    const currentValue = entry.value ?? "";
    if (currentValue === nextValue) {
      skipped.push(key);
      continue;
    }

    const hasProtectedValue = currentValue.trim() !== "" && !isPlaceholderValue(currentValue);
    if (hasProtectedValue) {
      if (sensitiveKeys.has(key)) {
        const confirmed = await confirmOverwrite(key);
        if (!confirmed) {
          preserved.push(key);
          continue;
        }
      } else if (!overwriteNonSensitive) {
        preserved.push(key);
        continue;
      }
    }

    entries[index] = { type: "entry", key, value: nextValue };
    changed.push(key);
  }

  return {
    content: serializeEnv(entries),
    added,
    changed,
    preserved,
    skipped,
  };
}

export async function writeEnvFileSafely({
  filePath,
  values,
  confirmOverwrite,
  overwriteNonSensitive = false,
  now = new Date(),
}) {
  const absolutePath = path.resolve(filePath);
  const exists = existsSync(absolutePath);
  const existingContent = exists ? readFileSync(absolutePath, "utf8") : "";
  const result = await buildUpdatedEnvEntries({
    existingContent,
    values,
    confirmOverwrite,
    overwriteNonSensitive,
  });

  if (result.content === existingContent) {
    return { ...result, filePath: absolutePath, backupPath: null, wrote: false };
  }

  mkdirSync(path.dirname(absolutePath), { recursive: true });

  let backupPath = null;
  if (exists) {
    backupPath = `${absolutePath}.backup-${timestampForBackup(now)}`;
    copyFileSync(absolutePath, backupPath);
  }

  const tempPath = `${absolutePath}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tempPath, result.content, "utf8");
  renameSync(tempPath, absolutePath);

  return { ...result, filePath: absolutePath, backupPath, wrote: true };
}

export function readEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  return parseEnvContent(readFileSync(filePath, "utf8")).values;
}
