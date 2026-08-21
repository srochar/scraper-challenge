import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { PortalClient } from "../src/portalClient";
import { PdfDownloadService } from "../src/pdfDownloadService";
import { RunStore } from "../src/runStore";
import { ScrapeOrchestrator } from "../src/scrapeOrchestrator";
import { ScraperConfig } from "../src/types";
import { readFileSync } from "fs";
import { parseDocumentsFromPanelHtml } from "../src/resultParser";
import { readJsonLines } from "../src/utils/fs";

describe("scrape orchestrator", () => {
  it("continues processing when one document fails", async () => {
    const panel =
      '<div id="formBuscador:panel"><div class="row">Doc A | Civil <a href="https://example.com/a.pdf">PDF</a></div><div class="row">Doc B | Penal <a href="https://example.com/b.pdf">PDF</a></div></div>';

    const fakePortal = {
      initialize: async () => ({ raw: "", state: { formId: "formBuscador", viewState: "1:1" }, isPartial: false }),
      search: async () => ({
        raw: "",
        state: { formId: "formBuscador", viewState: "2:2" },
        isPartial: true,
        updates: { "formBuscador:panel": panel },
      }),
    } as unknown as PortalClient;

    let count = 0;
    const fakeAxios = {
      get: async (url: string) => {
        count += 1;
        if (url.endsWith("a.pdf")) {
          const error = new Error("fail") as Error & { status?: number };
          error.status = 429;
          throw error;
        }
        return { status: 200, data: Buffer.from("PDF") };
      },
    } as never;

    const temp = mkdtempSync(join(tmpdir(), "scraper-orch-"));
    const downloader = new PdfDownloadService(
      {
        outputDir: join(temp, "pdfs"),
        retryConfig: { maxRetries: 1, initialDelayMs: 1, backoffMultiplier: 2, maxDelayMs: 10, jitterRatio: 0 },
        retryDeps: { wait: async () => undefined, random: () => 0 },
      },
      fakeAxios,
    );
    const runStore = new RunStore(join(temp, "data"));

    const config: ScraperConfig = {
      baseUrl: "https://example.com",
      searchTerm: "civil",
      outputDir: join(temp, "pdfs"),
      dataDir: join(temp, "data"),
      resume: false,
      failedOnly: false,
    };

    const orchestrator = new ScrapeOrchestrator(fakePortal, downloader, runStore, config);
    const summary = await orchestrator.run();

    expect(summary.processed).toBe(2);
    expect(summary.failed).toBe(1);
    expect(summary.downloaded).toBe(1);
    expect(count).toBeGreaterThanOrEqual(3);

    const failures = await readJsonLines(join(temp, "data", "failed.jsonl"));
    expect(failures.length).toBeGreaterThanOrEqual(1);
  });

  it("resumes from progress by skipping processed ids", async () => {
    const panel =
      '<div id="formBuscador:panel"><div class="row">Doc A | Civil <a href="https://example.com/a.pdf">PDF</a></div><div class="row">Doc B | Penal <a href="https://example.com/b.pdf">PDF</a></div></div>';

    const fakePortal = {
      initialize: async () => ({ raw: "", state: { formId: "formBuscador", viewState: "1:1" }, isPartial: false }),
      search: async () => ({
        raw: "",
        state: { formId: "formBuscador", viewState: "2:2" },
        isPartial: true,
        updates: { "formBuscador:panel": panel },
      }),
    } as unknown as PortalClient;

    const fakeAxios = {
      get: async () => ({ status: 200, data: Buffer.from("PDF") }),
    } as never;

    const temp = mkdtempSync(join(tmpdir(), "scraper-orch-resume-"));
    const runStore = new RunStore(join(temp, "data"));
    await runStore.initialize();

    const progressPath = runStore.getPaths().progressPath;
    const firstId = parseDocumentsFromPanelHtml(panel, 1)[0].id;
    await runStore.writeProgress({
      page: 1,
      processedIds: [firstId],
      updatedAt: new Date().toISOString(),
    });

    const downloader = new PdfDownloadService(
      {
        outputDir: join(temp, "pdfs"),
        retryConfig: { maxRetries: 1, initialDelayMs: 1, backoffMultiplier: 2, maxDelayMs: 10, jitterRatio: 0 },
        retryDeps: { wait: async () => undefined, random: () => 0 },
      },
      fakeAxios,
    );

    const config: ScraperConfig = {
      baseUrl: "https://example.com",
      searchTerm: "civil",
      outputDir: join(temp, "pdfs"),
      dataDir: join(temp, "data"),
      resume: true,
      failedOnly: false,
    };

    const orchestrator = new ScrapeOrchestrator(fakePortal, downloader, runStore, config);
    const summary = await orchestrator.run();

    expect(summary.processed).toBe(1);
    const finalProgress = JSON.parse(readFileSync(progressPath, "utf8"));
    expect(finalProgress.processedIds.length).toBeGreaterThanOrEqual(2);
  });

  it("processes only failed records in failed-only mode", async () => {
    const fakePortal = {
      initialize: async () => ({ raw: "", state: { formId: "formBuscador", viewState: "1:1" }, isPartial: false }),
      search: async () => ({ raw: "", state: { formId: "formBuscador", viewState: "2:2" }, isPartial: true, updates: {} }),
    } as unknown as PortalClient;

    const temp = mkdtempSync(join(tmpdir(), "scraper-orch-failed-only-"));
    const runStore = new RunStore(join(temp, "data"));
    await runStore.initialize();
    await runStore.appendFailure({
      id: "x1",
      reason: "http_429",
      attempts: 3,
      pdfUrl: "https://example.com/a.pdf",
      timestamp: new Date().toISOString(),
    });

    let calls = 0;
    const fakeDownloader = {
      download: async () => {
        calls += 1;
        return { result: { status: "downloaded", attempts: 1, pdfPath: "x.pdf" } };
      },
    } as unknown as PdfDownloadService;

    const config: ScraperConfig = {
      baseUrl: "https://example.com",
      searchTerm: "civil",
      outputDir: join(temp, "pdfs"),
      dataDir: join(temp, "data"),
      resume: false,
      failedOnly: true,
    };

    const orchestrator = new ScrapeOrchestrator(fakePortal, fakeDownloader, runStore, config);
    const summary = await orchestrator.run();

    expect(summary.processed).toBe(1);
    expect(summary.downloaded).toBe(1);
    expect(calls).toBe(1);
  });
});
