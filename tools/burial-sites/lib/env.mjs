import { existsSync, readFileSync } from 'node:fs';

// Reads a .env file the way Next.js does for the simple cases: KEY=VALUE, optional double quotes, # comments.
// Variables already set in the process win, so CI or a shell export can override the file.
export function loadEnvLocal(filePath) {
  if (!existsSync(filePath)) return {};
  const parsed = {};
  for (const rawLine of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    parsed[key] = value;
    if (process.env[key] === undefined) process.env[key] = value;
  }
  return parsed;
}
