import { mkdir, readFile, writeFile, appendFile, stat } from "fs/promises";
import { dirname } from "path";

export async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

export async function ensureParentDir(path: string): Promise<void> {
  await ensureDir(dirname(path));
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await ensureParentDir(path);
  await writeFile(path, JSON.stringify(value, null, 2), "utf8");
}

export async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    const content = await readFile(path, "utf8");
    return JSON.parse(content) as T;
  } catch {
    return undefined;
  }
}

export async function appendJsonLine(path: string, value: unknown): Promise<void> {
  await ensureParentDir(path);
  await appendFile(path, `${JSON.stringify(value)}\n`, "utf8");
}

export async function readJsonLines<T>(path: string): Promise<T[]> {
  try {
    const content = await readFile(path, "utf8");
    return content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as T);
  } catch {
    return [];
  }
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
