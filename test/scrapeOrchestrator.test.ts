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
    resultsDir: join(temp, "results"),
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
    resultFormat: "json",
    unzip: false,
    sessionKey: "civil:test-session",
    maxConsecutiveDownloadFailures: 0,
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

    const transformed = JSON.parse(readFileSync(join(temp, "results", "records.json"), "utf8")) as Array<{ downloadStatus: string }>;
    expect(transformed.length).toBe(2);
    expect(transformed.some((record) => record.downloadStatus === "failed")).toBe(true);
    expect(transformed.some((record) => record.downloadStatus === "downloaded")).toBe(true);
  });

  it("keeps processing when one case has no zip link", async () => {
    const panel =
      '<div id="formBuscador:panel"><div class="row">Doc A | Civil</div><div class="row">Doc B | Penal <a href="https://example.com/b.pdf">PDF</a></div></div>';

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

    let calls = 0;
    const fakeAxios = {
      get: async () => {
        calls += 1;
        return { status: 200, data: Buffer.from("PDF") };
      },
    } as never;

    const temp = mkdtempSync(join(tmpdir(), "scraper-orch-missing-zip-"));
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
    expect(summary.downloaded).toBe(1);
    expect(summary.missingLink).toBe(1);
    expect(summary.failed).toBe(0);
    expect(calls).toBe(1);
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
        return { result: { status: "downloaded", attempts: 1, filePath: "x.pdf" } };
      },
    } as unknown as PdfDownloadService;

    const config = createConfig(temp, { failedOnly: true });

    const orchestrator = new ScrapeOrchestrator(fakePortal, fakeDownloader, runStore, config);
    const summary = await orchestrator.run();

    expect(summary.processed).toBe(1);
    expect(summary.downloaded).toBe(1);
    expect(calls).toBe(1);

    const transformed = JSON.parse(readFileSync(join(temp, "results", "records.json"), "utf8")) as Array<{ id: string }>;
    expect(transformed.length).toBe(1);
    expect(transformed[0].id).toBe("x1");
  });

  it("writes CSV transformed output when resultFormat is csv", async () => {
    const panel =
      '<div id="formBuscador:panel"><div class="row">Doc A | Civil <a href="https://example.com/a.pdf">PDF</a></div><div class="row">Doc B | Penal <a href="https://example.com/b.pdf">PDF</a></div></div>';

    const fakePortal = {
      submitSearchFromInicio: async () => ({ raw: "", state: { formId: "formBuscador", viewState: "1:1", formDefaults: {} }, isPartial: false }),
      search: async () => ({
        raw: "",
        state: { formId: "formBuscador", viewState: "2:2", formDefaults: {} },
        isPartial: true,
        updates: { "formBuscador:panel": panel },
      }),
    } as unknown as PortalClient;

    const fakeDownloader = {
      download: async () => ({ result: { status: "downloaded" as const, attempts: 1, filePath: "x.pdf" } }),
    } as unknown as PdfDownloadService;

    const temp = mkdtempSync(join(tmpdir(), "scraper-orch-csv-"));
    const runStore = new RunStore(buildRunStorePaths(join(temp, "data")));
    const config = createConfig(temp, { resultFormat: "csv" });

    const orchestrator = new ScrapeOrchestrator(fakePortal, fakeDownloader, runStore, config);
    const summary = await orchestrator.run();

    expect(summary.processed).toBe(2);
    const csvPath = join(temp, "results", "records.csv");
    const csv = readFileSync(csvPath, "utf8");
    expect(csv).toContain("bot,runId,id,title,sourcePage");
    expect(csv).toContain("downloadStatus");
    expect(csv).toContain("bulkDownloadStatus");
    expect(csv).toContain("bulkUnzipStatus");
    expect(csv).toContain("metadata.field_1");
    expect(csv).toContain("downloaded");
    expect(readdirSync(join(temp, "results"))).toContain("records.csv");
    expect(readdirSync(join(temp, "results"))).not.toContain("records.json");
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
        updates: { "formBuscador:panel": '<div id="formBuscador:panel"><div class="row">Expediente 1 | Materia civil <a href="/downloads/c67a9b8b-0f70-413c-919a-598091c08781.pdf">PDF</a></div></div>' },
      }),
      gotoPage: async (page: number) => {
        if (page === 2) {
          return {
            raw: page2Xml,
            state: { formId: "formBuscador", viewState: "3:3", formDefaults: {} },
            isPartial: true,
            updates: { "formBuscador:panel": '<div id="formBuscador:panel"><div class="row">Expediente P2 | Penal <a href="/downloads/11111111-1111-1111-1111-111111111111.pdf">PDF</a></div></div>' },
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
      download: async () => ({ result: { status: "downloaded", attempts: 1, filePath: "x.pdf" } }),
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
      '<div id="formBuscador:panel"><table><tbody><tr><td>1</td><td>Doc A</td><td>Civil</td><td><a href="/downloads/abc.zip">ZIP</a><input type="checkbox" name="formBuscador:repeat:0:j_idt457" /></td></tr></tbody></table></div>';
    const panelPage2 =
      '<div id="formBuscador:panel"><table><tbody><tr><td>2</td><td>Doc B</td><td>Penal</td><td><a href="/downloads/def.zip">ZIP</a><input type="checkbox" name="formBuscador:repeat:10:j_idt457" /></td></tr></tbody></table></div>';

    const bulkCalls: number[] = [];
    const fakePortal = {
      submitSearchFromInicio: async () => ({
        raw: '<html><body><div id="formBuscador:data1ds"></div></body></html>',
        state: { formId: "formBuscador", viewState: "1:1", formDefaults: {}, bulkSubmitField: "formBuscador:j_idt422" },
        isPartial: false,
      }),
      search: async () => ({ raw: "", state: { formId: "formBuscador", viewState: "2:2", formDefaults: {}, bulkSubmitField: "formBuscador:j_idt422" }, isPartial: true, updates: { "formBuscador:panel": panel } }),
      gotoPage: async (page: number) => ({
        raw: "",
        state: { formId: "formBuscador", viewState: "3:3", formDefaults: {}, bulkSubmitField: "formBuscador:j_idt422" },
        isPartial: true,
        updates: { "formBuscador:panel": page === 2 ? panelPage2 : '<div id="formBuscador:panel"></div>' },
      }),
      downloadBulkZip: async (_records: Array<{ bulkFieldName?: string }>, _term: string, page?: number) => {
        bulkCalls.push(page ?? 0);
        return Buffer.from("PK\u0003\u0004test");
      },
    } as unknown as PortalClient;

    const fakeDownloader = {
      download: async () => ({ result: { status: "downloaded", attempts: 1, filePath: "x.pdf" } }),
    } as unknown as PdfDownloadService;

    const temp = mkdtempSync(join(tmpdir(), "scraper-orch-bulk-"));
    const runStore = new RunStore(buildRunStorePaths(join(temp, "data")));
    const config = createConfig(temp, {
      baseUrl: "https://jurisprudencia.pj.gob.pe",
      maxPages: 3,
      downloadMode: "bulk",
    });

    const orchestrator = new ScrapeOrchestrator(fakePortal, fakeDownloader, runStore, config);
    const summary = await orchestrator.run();

    expect(summary.processed).toBe(2);
    expect(summary.downloaded).toBe(0);
    expect(summary.bulkZipDownloaded).toBe(2);
    expect(bulkCalls).toEqual([1, 2]);
    const bulkFiles = readdirSync(join(temp, "bulk")).filter((name) => name.endsWith(".zip"));
    expect(bulkFiles.length).toBe(2);

    const transformed = JSON.parse(readFileSync(join(temp, "results", "records.json"), "utf8")) as Array<{
      sourcePage: number;
      bulkDownloadStatus?: string;
      bulkZipFile?: string;
      bulkUnzipStatus?: string;
    }>;
    expect(transformed).toHaveLength(2);
    expect(transformed.every((row) => row.bulkDownloadStatus === "downloaded")).toBe(true);
    expect(transformed.every((row) => row.bulkUnzipStatus === "not_requested")).toBe(true);
    expect(transformed.every((row) => (row.bulkZipFile ?? "").includes("Resoluciones_Jurisprudencia_page-"))).toBe(true);
    expect(transformed.every((row) => (row.bulkZipFile ?? "").endsWith(".zip"))).toBe(true);
  });

  it("continues bulk processing for next page when one page bulk download fails", async () => {
    const panelPage1 =
      '<div id="formBuscador:panel"><table><tbody><tr><td>1</td><td>Doc A</td><td>Civil</td><td><input type="checkbox" name="formBuscador:repeat:0:j_idt457" /></td></tr></tbody></table></div>';
    const panelPage2 =
      '<div id="formBuscador:panel"><table><tbody><tr><td>2</td><td>Doc B</td><td>Penal</td><td><input type="checkbox" name="formBuscador:repeat:10:j_idt457" /></td></tr></tbody></table></div>';

    const attemptedPages: number[] = [];
    const fakePortal = {
      submitSearchFromInicio: async () => ({
        raw: '<html><body><div id="formBuscador:data1ds"></div></body></html>',
        state: { formId: "formBuscador", viewState: "1:1", formDefaults: {}, bulkSubmitField: "formBuscador:j_idt422" },
        isPartial: false,
      }),
      search: async () => ({
        raw: "",
        state: { formId: "formBuscador", viewState: "2:2", formDefaults: {}, bulkSubmitField: "formBuscador:j_idt422" },
        isPartial: true,
        updates: { "formBuscador:panel": panelPage1 },
      }),
      gotoPage: async (page: number) => ({
        raw: "",
        state: { formId: "formBuscador", viewState: "3:3", formDefaults: {}, bulkSubmitField: "formBuscador:j_idt422" },
        isPartial: true,
        updates: { "formBuscador:panel": page === 2 ? panelPage2 : '<div id="formBuscador:panel"></div>' },
      }),
      downloadBulkZip: async (_records: Array<{ bulkFieldName?: string }>, _term: string, page?: number) => {
        attemptedPages.push(page ?? 0);
        if (page === 1) {
          throw new Error("bulk failed page 1");
        }
        return Buffer.from("PK\u0003\u0004test");
      },
    } as unknown as PortalClient;

    const fakeDownloader = {
      download: async () => ({ result: { status: "downloaded" as const, attempts: 1, filePath: "x.pdf" } }),
    } as unknown as PdfDownloadService;

    const temp = mkdtempSync(join(tmpdir(), "scraper-orch-bulk-continue-"));
    const runStore = new RunStore(buildRunStorePaths(join(temp, "data")));
    const config = createConfig(temp, {
      baseUrl: "https://jurisprudencia.pj.gob.pe",
      maxPages: 3,
      downloadMode: "bulk",
    });

    const orchestrator = new ScrapeOrchestrator(fakePortal, fakeDownloader, runStore, config);
    const summary = await orchestrator.run();

    expect(summary.processed).toBe(2);
    expect(summary.bulkZipDownloaded).toBe(1);
    expect(attemptedPages).toEqual([1, 2]);

    const transformed = JSON.parse(readFileSync(join(temp, "results", "records.json"), "utf8")) as Array<{
      sourcePage: number;
      bulkDownloadStatus?: string;
    }>;
    expect(transformed).toHaveLength(2);
    const page1 = transformed.find((row) => row.sourcePage === 1);
    const page2 = transformed.find((row) => row.sourcePage === 2);
    expect(page1?.bulkDownloadStatus).toBe("failed");
    expect(page2?.bulkDownloadStatus).toBe("downloaded");
  });

  it("writes deterministic order in transformed json output", async () => {
    const panel =
      '<div id="formBuscador:panel"><div class="row">Zulu | Civil <a href="https://example.com/z.pdf">PDF</a></div><div class="row">Alpha | Civil <a href="https://example.com/a.pdf">PDF</a></div></div>';

    const fakePortal = {
      submitSearchFromInicio: async () => ({ raw: "", state: { formId: "formBuscador", viewState: "1:1", formDefaults: {} }, isPartial: false }),
      search: async () => ({
        raw: "",
        state: { formId: "formBuscador", viewState: "2:2", formDefaults: {} },
        isPartial: true,
        updates: { "formBuscador:panel": panel },
      }),
    } as unknown as PortalClient;

    const fakeDownloader = {
      download: async () => ({ result: { status: "downloaded" as const, attempts: 1, filePath: "x.pdf" } }),
    } as unknown as PdfDownloadService;

    const temp = mkdtempSync(join(tmpdir(), "scraper-orch-order-"));
    const runStore = new RunStore(buildRunStorePaths(join(temp, "data")));
    const config = createConfig(temp, { resultFormat: "json" });

    const orchestrator = new ScrapeOrchestrator(fakePortal, fakeDownloader, runStore, config);
    await orchestrator.run();

    const transformed = JSON.parse(readFileSync(join(temp, "results", "records.json"), "utf8")) as Array<{ title: string; bot: string; runId: string }>;
    expect(transformed.map((item) => item.title)).toEqual(["Alpha", "Zulu"]);
    expect(transformed.every((item) => item.bot === "civil")).toBe(true);
    expect(transformed.every((item) => item.runId === "run-test-001")).toBe(true);
  });

  it("recovers session and retries search on ViewExpiredException", async () => {
    const panel =
      '<div id="formBuscador:panel"><div class="row">Doc A | Civil <a href="https://example.com/a.pdf">PDF</a></div></div>';

    let searchCalls = 0;
    let submitCalls = 0;
    const fakePortal = {
      submitSearchFromInicio: async () => {
        submitCalls += 1;
        return { raw: "", state: { formId: "formBuscador", viewState: "1:1", formDefaults: {} }, isPartial: false };
      },
      search: async () => {
        searchCalls += 1;
        if (searchCalls === 1) {
          throw new Error("JSF partial error: class javax.faces.application.ViewExpiredException viewId:/page/resultado.xhtml - View /page/resultado.xhtml could not be restored.");
        }
        return {
          raw: "",
          state: { formId: "formBuscador", viewState: "2:2", formDefaults: {} },
          isPartial: true,
          updates: { "formBuscador:panel": panel },
        };
      },
    } as unknown as PortalClient;

    const fakeDownloader = {
      download: async () => ({ result: { status: "downloaded" as const, attempts: 1, filePath: "x.pdf" } }),
    } as unknown as PdfDownloadService;

    const temp = mkdtempSync(join(tmpdir(), "scraper-orch-recover-"));
    const runStore = new RunStore(buildRunStorePaths(join(temp, "data")));
    const config = createConfig(temp, { maxPages: 1 });

    const orchestrator = new ScrapeOrchestrator(fakePortal, fakeDownloader, runStore, config);
    const summary = await orchestrator.run();

    expect(summary.processed).toBe(1);
    expect(summary.downloaded).toBe(1);
    expect(searchCalls).toBe(2);
    expect(submitCalls).toBe(2);
  });

  it("retries pagination on transient 500 before succeeding", async () => {
    const panel =
      '<div id="formBuscador:panel"><div class="row">Doc A | Civil <a href="https://example.com/a.pdf">PDF</a></div></div>';

    let gotoCalls = 0;
    const fakePortal = {
      submitSearchFromInicio: async () => ({
        raw: `<html><body>${panel}<div id="formBuscador:data1ds"></div></body></html>`,
        state: { formId: "formBuscador", viewState: "1:1", formDefaults: {} },
        isPartial: false,
      }),
      search: async () => ({
        raw: "",
        state: { formId: "formBuscador", viewState: "2:2", formDefaults: {} },
        isPartial: true,
        updates: { "formBuscador:panel": panel },
      }),
      gotoPage: async () => {
        gotoCalls += 1;
        if (gotoCalls === 1) {
          const err = new Error("Request failed with status code 500") as Error & {
            response?: { status: number };
          };
          err.response = { status: 500 };
          throw err;
        }
        return {
          raw: "",
          state: { formId: "formBuscador", viewState: "3:3", formDefaults: {} },
          isPartial: true,
          updates: { "formBuscador:panel": '<div id="formBuscador:panel"></div>' },
        };
      },
    } as unknown as PortalClient;

    const fakeDownloader = {
      download: async () => ({ result: { status: "downloaded" as const, attempts: 1, filePath: "x.pdf" } }),
    } as unknown as PdfDownloadService;

    const temp = mkdtempSync(join(tmpdir(), "scraper-orch-paginate-500-"));
    const runStore = new RunStore(buildRunStorePaths(join(temp, "data")));
    const config = createConfig(temp, { maxPages: 2 });

    const orchestrator = new ScrapeOrchestrator(fakePortal, fakeDownloader, runStore, config);
    const summary = await orchestrator.run();

    expect(summary.processed).toBe(1);
    expect(gotoCalls).toBe(2);
  });

  it("aborts run when consecutive download failures threshold is reached", async () => {
    const panel =
      '<div id="formBuscador:panel"><div class="row">Doc A | Civil <a href="https://example.com/a.pdf">PDF</a></div><div class="row">Doc B | Civil <a href="https://example.com/b.pdf">PDF</a></div><div class="row">Doc C | Civil <a href="https://example.com/c.pdf">PDF</a></div></div>';

    const fakePortal = {
      submitSearchFromInicio: async () => ({ raw: "", state: { formId: "formBuscador", viewState: "1:1", formDefaults: {} }, isPartial: false }),
      search: async () => ({
        raw: "",
        state: { formId: "formBuscador", viewState: "2:2", formDefaults: {} },
        isPartial: true,
        updates: { "formBuscador:panel": panel },
      }),
    } as unknown as PortalClient;

    const fakeDownloader = {
      download: async (record: { id: string; pdfHref?: string }) => ({
        result: { status: "failed" as const, attempts: 5, reason: "http_429" },
        failure: {
          id: record.id,
          reason: "http_429",
          attempts: 5,
          pdfUrl: record.pdfHref,
          timestamp: new Date().toISOString(),
        },
      }),
    } as unknown as PdfDownloadService;

    const temp = mkdtempSync(join(tmpdir(), "scraper-orch-threshold-"));
    const runStore = new RunStore(buildRunStorePaths(join(temp, "data")));
    const config = createConfig(temp, { maxConsecutiveDownloadFailures: 2 });

    const orchestrator = new ScrapeOrchestrator(fakePortal, fakeDownloader, runStore, config);

    await expect(orchestrator.run()).rejects.toThrow(/fallas consecutivas de descarga/);
  });

  it("retries init on transient 500 and continues", async () => {
    const panel =
      '<div id="formBuscador:panel"><div class="row">Doc A | Civil <a href="https://example.com/a.pdf">PDF</a></div></div>';

    let initCalls = 0;
    const fakePortal = {
      submitSearchFromInicio: async () => {
        initCalls += 1;
        if (initCalls === 1) {
          const err = new Error("Request failed with status code 500") as Error & {
            response?: { status: number };
          };
          err.response = { status: 500 };
          throw err;
        }
        return {
          raw: `<html><body>${panel}<div id="formBuscador:data1ds"></div></body></html>`,
          state: { formId: "formBuscador", viewState: "1:1", formDefaults: {} },
          isPartial: false,
        };
      },
      search: async () => ({
        raw: "",
        state: { formId: "formBuscador", viewState: "2:2", formDefaults: {} },
        isPartial: true,
        updates: { "formBuscador:panel": panel },
      }),
      gotoPage: async () => ({
        raw: "",
        state: { formId: "formBuscador", viewState: "3:3", formDefaults: {} },
        isPartial: true,
        updates: { "formBuscador:panel": "<div id=\"formBuscador:panel\"></div>" },
      }),
    } as unknown as PortalClient;

    const fakeDownloader = {
      download: async () => ({ result: { status: "downloaded" as const, attempts: 1, filePath: "x.pdf" } }),
    } as unknown as PdfDownloadService;

    const temp = mkdtempSync(join(tmpdir(), "scraper-orch-init-retry-"));
    const runStore = new RunStore(buildRunStorePaths(join(temp, "data")));
    const config = createConfig(temp, { maxPages: 1 });

    const orchestrator = new ScrapeOrchestrator(fakePortal, fakeDownloader, runStore, config);
    const summary = await orchestrator.run();

    expect(initCalls).toBe(2);
    expect(summary.processed).toBe(1);
    expect(summary.downloaded).toBe(1);
  });
});
