import { mkdtempSync, existsSync, statSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";
import AdmZip from "adm-zip";
import { extractZipToSiblingFolder } from "../src/download/zipExtractor";

describe("zip extractor", () => {
  it("extracts zip into sibling folder", async () => {
    const temp = mkdtempSync(join(tmpdir(), "zip-extractor-"));
    const zipPath = join(temp, "caso-1.zip");

    const zip = new AdmZip();
    zip.addFile("doc.txt", Buffer.from("hola", "utf8"));
    zip.writeZip(zipPath);

    const out = await extractZipToSiblingFolder(zipPath);
    const extractedFile = join(out, "doc.txt");

    expect(existsSync(extractedFile)).toBe(true);
    expect(statSync(extractedFile).isFile()).toBe(true);
  });
});
