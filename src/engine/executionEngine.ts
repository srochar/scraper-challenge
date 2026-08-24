import * as cheerio from "cheerio";
import { Logger } from "../logging/logger";
import { parseDocumentsFromPanelHtml } from "../parsing/resultParser";
import { DocumentRecord } from "../types";
import {
  buildInitialPaginationPlan,
  createPaginationPages,
  refinePaginationPlanAfterFallback,
  resolveMaxPages,
} from "../scheduler/paginationScheduler";

export interface PortalResponseLike {
  raw: string;
  updates?: Record<string, string>;
}

export interface ExecutionPortalOps {
  initialize?: () => Promise<PortalResponseLike>;
  submitSearchFromInicio: () => Promise<PortalResponseLike>;
  search: () => Promise<PortalResponseLike>;
  gotoPage: (page: number) => Promise<PortalResponseLike>;
}

export interface ExecutionEngineOptions {
  searchTerm: string;
  maxPages?: number;
  logger?: Logger;
}

export class ExecutionEngine {
  constructor(private readonly options: ExecutionEngineOptions) {}

  async collectDiscoveredRecords(ops: ExecutionPortalOps): Promise<DocumentRecord[]> {
    const initResult = await this.initializeWithFallback(ops);
    const records: DocumentRecord[] = [];

    const maxPages = resolveMaxPages(this.options.maxPages);
    let page1Records = extractRecordsFromHtml(initResult.raw, 1);
    let usedFallbackSearch = false;
    let paginationPlan = buildInitialPaginationPlan(maxPages, initResult.raw);

    if (page1Records.length === 0) {
      usedFallbackSearch = true;
      const firstPage = await ops.search();
      page1Records = extractRecordsFromResponse(firstPage, 1);
      this.options.logger?.debug("Fallback search records", {
        accion: "buscar_fallback",
        records: page1Records.length,
      });
      paginationPlan = refinePaginationPlanAfterFallback(paginationPlan, page1Records.length, usedFallbackSearch);
    }

    this.options.logger?.info("Pagina procesada", { accion: "procesar_pagina", page: 1, records: page1Records.length });
    records.push(...page1Records);

    if (!paginationPlan.shouldAttemptPagination) {
      this.options.logger?.info("Skipping pagination due to missing paginator or low page-1 volume", {
        page1Records: page1Records.length,
        maxPages,
      });
      return records;
    }

    for (const page of createPaginationPages(maxPages)) {
      const pageResponse = await ops.gotoPage(page);
      const pageRecords = extractRecordsFromResponse(pageResponse, page);
      this.options.logger?.info("Pagina procesada", { accion: "procesar_pagina", page, records: pageRecords.length });
      if (pageRecords.length === 0) {
        this.options.logger?.info("Stopping pagination due to empty page", { page });
        break;
      }
      records.push(...pageRecords);
    }

    return records;
  }

  private async initializeWithFallback(ops: ExecutionPortalOps): Promise<PortalResponseLike> {
    try {
      return await ops.submitSearchFromInicio();
    } catch (error) {
      if (!ops.initialize) {
        throw error;
      }
      this.options.logger?.warn("Inicio via formulario fallo; probando inicializacion alternativa", {
        accion: "init_fallback",
        error: error instanceof Error ? error.message : String(error),
      });
      return ops.initialize();
    }
  }
}

function extractRecordsFromResponse(response: { updates?: Record<string, string> }, page: number): DocumentRecord[] {
  const panel = response.updates?.["formBuscador:panel"];
  if (!panel) {
    return [];
  }
  return parseDocumentsFromPanelHtml(panel, page);
}

function extractRecordsFromHtml(html: string, page: number): DocumentRecord[] {
  if (!html.trim()) {
    return [];
  }

  const $ = cheerio.load(html);
  const panel = $("#formBuscador\\:panel").first();
  if (panel.length === 0) {
    return [];
  }

  return parseDocumentsFromPanelHtml($.html(panel), page);
}
