import { describe, expect, it } from "vitest";
import { tmpdir } from "os";
import { join } from "path";
import { mkdtempSync } from "fs";
import { buildPdfFileName, PdfDownloadService } from "../src/pdfDownloadService";
import { DocumentRecord } from "../src/types";

function record(pdfHref?: string): DocumentRecord {
  return {
    id: "abc123",
    title: "Resolucion de prueba",
    metadata: { expediente: "X-1" },
    pdfHref,
    sourcePage: 1,
  };
}

describe("pdf downloader", () => {
  it("builds deterministic descriptive filenames", () => {
    const name1 = buildPdfFileName(record("https://example.com/doc.pdf"));
    const name2 = buildPdfFileName(record("https://example.com/doc.pdf"));
    expect(name1).toBe(name2);
    expect(name1).toContain("resolucion-de-prueba");
    expect(name1.endsWith(".pdf")).toBe(true);
  });

  it("returns missing_pdf when record has no link", async () => {
    const service = new PdfDownloadService(
      {
        outputDir: mkdtempSync(join(tmpdir(), "scraper-test-")),
        retryConfig: { maxRetries: 2, initialDelayMs: 1, backoffMultiplier: 2, maxDelayMs: 20, jitterRatio: 0 },
      },
      undefined,
    );

    const result = await service.download(record(undefined));
    expect(result.result.status).toBe("missing_pdf");
  });

  it("retries and eventually fails on persistent 429", async () => {
    let calls = 0;
    const fakeAxios = {
      get: async () => {
        calls += 1;
        const error = new Error("Too many requests") as Error & { status?: number };
        error.status = 429;
        throw error;
      },
    } as unknown as { get: (url: string) => Promise<unknown> };

    const service = new PdfDownloadService(
      {
        outputDir: mkdtempSync(join(tmpdir(), "scraper-test-")),
        retryConfig: { maxRetries: 2, initialDelayMs: 1, backoffMultiplier: 2, maxDelayMs: 20, jitterRatio: 0 },
        retryDeps: { wait: async () => undefined, random: () => 0 },
      },
      fakeAxios as never,
    );

    const result = await service.download(record("https://example.com/doc.pdf"));
    expect(result.result.status).toBe("failed");
    expect(result.failure?.reason).toBe("http_429");
    expect(calls).toBe(3);
  });
});
