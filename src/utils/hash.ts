import { createHash } from "crypto";

export function stableHash(input: string): string {
  return createHash("sha1").update(input).digest("hex");
}

export function stableRecordId(fields: Record<string, string>, fallback: string): string {
  const ordered = Object.keys(fields)
    .sort()
    .map((key) => `${key}=${fields[key]}`)
    .join("|");
  return stableHash(`${ordered}|${fallback}`).slice(0, 16);
}
