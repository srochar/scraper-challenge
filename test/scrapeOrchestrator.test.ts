import { mkdtempSync, readFileSync, readdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { PortalClient } from "../src/portalClient";
import { PdfDownloadService } from "../src/pdfDownloadService";
import { buildRunStorePaths, RunStore } from "../src/runStore";
import { ScrapeOrchestrator } from "../src/scrapeOrchestrator";
import { ScraperConfig } from "../src/types";
import { parseDocumentsFromPanelHtml } from "../src/resultParser";
import { readJsonLines } from "../src/utils/fs";

const fixturesDir = join(__dirname, "fixtures");

function createConfig(temp: string, overrides: Partial<ScraperConfig> = {}): ScraperConfig {
  return {
    baseUrl: "https://example.com",
    searchTerm: "civil",
    bot: "civil",
    runId: "run-test-001",
    runsDir: join(temp, "runs"),
    outputDir: join(temp, "pdfs"),
    bulkOutputDir: join(temp, "bulk"),
    dataDir: join(temp, "data"),
    resume: false,
    failedOnly: false,
    requestDelayMs: 0,
    requestJitterMs: 0,
    logLevel: "info",
    logFormat: "json",
    logFilePath: join(temp, "logs.jsonl"),
    downloadMode: "individual",
    ...overrides,
  };
}

describe("scrape orchestrator", () => {
  it("continues processing when one document fails", async () => {
    const panel =
      '<div id="formBuscador:panel"><div class="row">Doc A | Civil <a href="https://example.com/a.pdf">PDF</a></div><div class="row">Doc B | Penal <a href="https://example.com/b.pdf">PDF</a></div></div>';

    const fakePortal = {
      initialize: async () => ({ raw: "", state: { formId: "formBuscador", viewState: "1:1", formDefaults: {} }, isPartial: false }),
      submitSearchFromInicio: async () => ({ raw: "", state: { formId: "formBuscador", viewState: "1:1", formDefaults: {} }, isPartial: false }),
      search: async () => ({
        raw: "",
        state: { formId: "formBuscador", viewState: "2:2", formDefaults: {} },
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
    const runStore = new RunStore(buildRunStorePaths(join(temp, "data")));

    const config = createConfig(temp);

    const orchestrator = new ScrapeOrchestrator(fakePortal, downloader, runStore, config);
    const summary = await orchestrator.run();

    expect(summary.processed).toBe(2);
    expect(summary.failed).toBe(1);
    expect(summary.downloaded).toBe(1);
    expect(count).toBeGreaterThanOrEqual(3);

    const failures = await readJsonLines(join(temp, "data", "failed.jsonl"));
    expect(failures.length).toBeGreaterThanOrEqual(1);
    const errors = await readJsonLines(join(temp, "data", "errors.jsonl"));
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[0].stage).toBe("download");
  });

  it("resumes from progress by skipping processed ids", async () => {
    const panel =
      '<div id="formBuscador:panel"><div class="row">Doc A | Civil <a href="https://example.com/a.pdf">PDF</a></div><div class="row">Doc B | Penal <a href="https://example.com/b.pdf">PDF</a></div></div>';

    const fakePortal = {
      initialize: async () => ({ raw: "", state: { formId: "formBuscador", viewState: "1:1", formDefaults: {} }, isPartial: false }),
      submitSearchFromInicio: async () => ({ raw: "", state: { formId: "formBuscador", viewState: "1:1", formDefaults: {} }, isPartial: false }),
      search: async () => ({
        raw: "",
        state: { formId: "formBuscador", viewState: "2:2", formDefaults: {} },
        isPartial: true,
        updates: { "formBuscador:panel": panel },
      }),
    } as unknown as PortalClient;

    const fakeAxios = {
      get: async () => ({ status: 200, data: Buffer.from("PDF") }),
    } as never;

    const temp = mkdtempSync(join(tmpdir(), "scraper-orch-resume-"));
    const runStore = new RunStore(buildRunStorePaths(join(temp, "data")));
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

    const config = createConfig(temp, { resume: true });

    const orchestrator = new ScrapeOrchestrator(fakePortal, downloader, runStore, config);
    const summary = await orchestrator.run();

    expect(summary.processed).toBe(1);
    const finalProgress = JSON.parse(readFileSync(progressPath, "utf8"));
    expect(finalProgress.processedIds.length).toBeGreaterThanOrEqual(2);
  });

  it("processes only failed records in failed-only mode", async () => {
    const fakePortal = {
      initialize: async () => ({ raw: "", state: { formId: "formBuscador", viewState: "1:1", formDefaults: {} }, isPartial: false }),
      submitSearchFromInicio: async () => ({ raw: "", state: { formId: "formBuscador", viewState: "1:1", formDefaults: {} }, isPartial: false }),
      search: async () => ({ raw: "", state: { formId: "formBuscador", viewState: "2:2", formDefaults: {} }, isPartial: true, updates: {} }),
    } as unknown as PortalClient;

    const temp = mkdtempSync(join(tmpdir(), "scraper-orch-failed-only-"));
    const runStore = new RunStore(buildRunStorePaths(join(temp, "data")));
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

    const config = createConfig(temp, { failedOnly: true });

    const orchestrator = new ScrapeOrchestrator(fakePortal, fakeDownloader, runStore, config);
    const summary = await orchestrator.run();

    expect(summary.processed).toBe(1);
    expect(summary.downloaded).toBe(1);
    expect(calls).toBe(1);
  });

  it("traverses additional page until empty page is reached", async () => {
    const page1Xml = readFileSync(join(fixturesDir, "portal.partial.xml"), "utf8");
    const page2Xml = readFileSync(join(fixturesDir, "portal.pagination.partial.xml"), "utf8");
    const emptyXml = readFileSync(join(fixturesDir, "portal.page.empty.partial.xml"), "utf8");

    const fakePortal = {
      initialize: async () => ({
        raw: "",
        state: { formId: "formBuscador", viewState: "1:1", formDefaults: {} },
        isPartial: false,
      }),
      submitSearchFromInicio: async () => ({
        raw: "",
        state: { formId: "formBuscador", viewState: "1:1", formDefaults: {} },
        isPartial: false,
      }),
      search: async () => ({
        raw: page1Xml,
        state: { formId: "formBuscador", viewState: "2:2", formDefaults: {} },
        isPartial: true,
        updates: { "formBuscador:panel": '<div id="formBuscador:panel"><div class="row">Expediente 1 | Materia civil <a href="/jurisprudenciaweb/ServletDescarga?uuid=c67a9b8b-0f70-413c-919a-598091c08781">PDF</a></div></div>' },
      }),
      gotoPage: async (page: number) => {
        if (page === 2) {
          return {
            raw: page2Xml,
            state: { formId: "formBuscador", viewState: "3:3", formDefaults: {} },
            isPartial: true,
            updates: { "formBuscador:panel": '<div id="formBuscador:panel"><div class="row">Expediente P2 | Penal <a href="/jurisprudenciaweb/ServletDescarga?uuid=11111111-1111-1111-1111-111111111111">PDF</a></div></div>' },
          };
        }
        return {
          raw: emptyXml,
          state: { formId: "formBuscador", viewState: "4:4", formDefaults: {} },
          isPartial: true,
          updates: { "formBuscador:panel": '<div id="formBuscador:panel"></div>' },
        };
      },
    } as unknown as PortalClient;

    const fakeDownloader = {
      download: async () => ({ result: { status: "downloaded", attempts: 1, pdfPath: "x.pdf" } }),
    } as unknown as PdfDownloadService;

    const temp = mkdtempSync(join(tmpdir(), "scraper-orch-pages-"));
    const runStore = new RunStore(buildRunStorePaths(join(temp, "data")));
    const config = createConfig(temp, {
      baseUrl: "https://jurisprudencia.pj.gob.pe",
      searchTerm: "Mineria",
      maxPages: 3,
    });

    const orchestrator = new ScrapeOrchestrator(fakePortal, fakeDownloader, runStore, config);
    const summary = await orchestrator.run();

    expect(summary.processed).toBe(2);
    expect(summary.downloaded).toBe(2);
  });

  it("downloads bulk zip when mode is bulk", async () => {
    const panel =
      '<div id="formBuscador:panel"><table><tbody><tr><td>1</td><td>Doc A</td><td>Civil</td><td><a href="/jurisprudenciaweb/ServletDescarga?uuid=abc">PDF</a><input type="checkbox" name="formBuscador:repeat:0:j_idt457" /></td></tr></tbody></table></div>';

    let bulkCalls = 0;
    const fakePortal = {
      submitSearchFromInicio: async () => ({ raw: "", state: { formId: "formBuscador", viewState: "1:1", formDefaults: {}, bulkSubmitField: "formBuscador:j_idt422" }, isPartial: false }),
      search: async () => ({ raw: "", state: { formId: "formBuscador", viewState: "2:2", formDefaults: {}, bulkSubmitField: "formBuscador:j_idt422" }, isPartial: true, updates: { "formBuscador:panel": panel } }),
      gotoPage: async () => ({ raw: "", state: { formId: "formBuscador", viewState: "3:3", formDefaults: {}, bulkSubmitField: "formBuscador:j_idt422" }, isPartial: true, updates: { "formBuscador:panel": '<div id="formBuscador:panel"></div>' } }),
      downloadBulkZip: async () => {
        bulkCalls += 1;
        return Buffer.from("PK\u0003\u0004test");
      },
    } as unknown as PortalClient;

    const fakeDownloader = {
      download: async () => ({ result: { status: "downloaded", attempts: 1, pdfPath: "x.pdf" } }),
    } as unknown as PdfDownloadService;

    const temp = mkdtempSync(join(tmpdir(), "scraper-orch-bulk-"));
    const runStore = new RunStore(buildRunStorePaths(join(temp, "data")));
    const config = createConfig(temp, {
      baseUrl: "https://jurisprudencia.pj.gob.pe",
      maxPages: 1,
      downloadMode: "bulk",
    });

    const orchestrator = new ScrapeOrchestrator(fakePortal, fakeDownloader, runStore, config);
    const summary = await orchestrator.run();

    expect(summary.processed).toBe(1);
    expect(summary.downloaded).toBe(0);
    expect(summary.bulkZipDownloaded).toBe(1);
    expect(bulkCalls).toBe(1);
    const bulkFiles = readdirSync(join(temp, "bulk")).filter((name) => name.endsWith(".zip"));
    expect(bulkFiles.length).toBe(1);
  });
});
