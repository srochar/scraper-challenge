import AdmZip from "adm-zip";
import { basename, dirname, join } from "path";
import { ensureDir } from "../utils/fs";

function toFolderName(zipPath: string): string {
  const base = basename(zipPath);
  return base.toLowerCase().endsWith(".zip") ? base.slice(0, -4) : `${base}-unzipped`;
}

export async function extractZipToSiblingFolder(zipPath: string): Promise<string> {
  const outputDir = join(dirname(zipPath), toFolderName(zipPath));
  await ensureDir(outputDir);
  const zip = new AdmZip(zipPath);
  zip.extractAllTo(outputDir, true);
  return outputDir;
}
