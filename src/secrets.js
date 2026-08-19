import { readFileSync } from "node:fs";

export function readSecret({ value, file, name }) {
  if (file) {
    const secret = readFileSync(file, "utf8").trim();
    if (!secret) throw new Error(`${name} secret file is empty`);
    return secret;
  }
  if (value) return value;
  throw new Error(`${name} is required`);
}

export function createConnectionUrl({
  protocol,
  username,
  password,
  hostname,
  port,
  database,
}) {
  const credentials = `${encodeURIComponent(username)}:${encodeURIComponent(password)}`;
  const path = database ? `/${encodeURIComponent(database)}` : "";
  return `${protocol}://${credentials}@${hostname}:${port}${path}`;
}
