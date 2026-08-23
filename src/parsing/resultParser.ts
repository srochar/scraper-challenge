import * as cheerio from "cheerio";
import { DocumentRecord } from "../types";
import { stableRecordId } from "../utils/hash";

export function parseDocumentsFromPanelHtml(panelHtml: string, sourcePage: number): DocumentRecord[] {
  const $ = cheerio.load(panelHtml);

  const richPanels = $("div[id*=':repeat:'][id$='j_idt455']").toArray();
  if (richPanels.length > 0) {
    return dedupeById(
      richPanels
        .map((panel) => parseRichPanel($, panel, sourcePage))
        .filter((record): record is DocumentRecord => Boolean(record)),
    );
  }

  const tableRows = $("table tbody tr").toArray();
  if (tableRows.length > 0) {
    return dedupeById(
      tableRows
        .map((row) => parseTableRow($, row, sourcePage))
        .filter((record): record is DocumentRecord => Boolean(record)),
    );
  }

  const candidates = [
    ...$(".row").toArray(),
    ...$(".panel-body .row").toArray(),
    ...$("table tr").toArray(),
    ...$("li").toArray(),
  ];

  const records: DocumentRecord[] = [];
  for (const node of candidates) {
    const element = $(node);
    const text = element.text().replace(/\s+/g, " ").trim();
    if (!text || text.length < 8) {
      continue;
    }

    const pdfHref = findDownloadHref($, element);
    const metadata: Record<string, string> = {};
    const pairs = text.split("|").map((part) => part.trim()).filter(Boolean);
    pairs.forEach((pair, index) => {
      metadata[`field_${index + 1}`] = pair;
    });

    const title = pairs[0] ?? text.slice(0, 120);
    const id = stableRecordId(metadata, `${title}|${sourcePage}`);
    records.push({
      id,
      title,
      metadata,
      pdfHref,
      bulkFieldName: element.find("input[type='checkbox'][name]").first().attr("name") ?? undefined,
      sourcePage,
    });
  }

  return dedupeById(records);
}

function parseRichPanel($: cheerio.CheerioAPI, panel: unknown, sourcePage: number): DocumentRecord | undefined {
  const node = panel as Parameters<cheerio.CheerioAPI>[0];
  const el = $(node);

  const titleType = el.find(".rf-p-hdr span").eq(0).text().replace(/\s+/g, " ").trim();
  const titleNumber = el.find(".rf-p-hdr span").eq(1).text().replace(/\s+/g, " ").trim();
  const title = [titleType, titleNumber].filter(Boolean).join(" ").trim();
  if (!title) {
    return undefined;
  }

  const metadata: Record<string, string> = {};
  el.find(".txtbold").each((_idx, labelNode) => {
    const label = $(labelNode).text().replace(/\s+/g, " ").trim().replace(/:$/, "");
    const value = $(labelNode).parent().find("div").eq(1).text().replace(/\s+/g, " ").trim();
    if (label) {
      metadata[label] = value;
    }
  });

  const bulkFieldName = el.find("input[type='checkbox'][name]").first().attr("name") ?? undefined;
  const downloadLink = el
    .find("a")
    .toArray()
    .map((node) => $(node))
    .find((candidate) => isDownloadAnchor(candidate)) ??
    el.find("a[onclick*='ServletDescarga'], a[href*='ServletDescarga']").first();
  const href = downloadLink.attr("href") ?? undefined;
  const onclick = downloadLink.attr("onclick") ?? "";
  const uuid = onclick.match(/ServletDescarga\?uuid=([a-f0-9\-]{36})/i)?.[1];
  const pdfHref = href ?? (isDownloadOnclick(onclick) && uuid ? `/jurisprudenciaweb/ServletDescarga?uuid=${uuid}` : undefined);

  const id = stableRecordId(metadata, `${title}|${sourcePage}`);

  return {
    id,
    title,
    metadata,
    pdfHref,
    bulkFieldName,
    sourcePage,
  };
}

function parseTableRow($: cheerio.CheerioAPI, row: unknown, sourcePage: number): DocumentRecord | undefined {
  const rowNode = row as Parameters<cheerio.CheerioAPI>[0];
  const tds = $(rowNode).find("td").toArray();
  if (tds.length < 3) {
    return undefined;
  }

  const values = tds
    .map((td) => $(td).text().replace(/\s+/g, " ").trim())
    .filter(Boolean);
  if (values.length === 0) {
    return undefined;
  }

  const metadata: Record<string, string> = {};
  values.forEach((value, idx) => {
    metadata[`field_${idx + 1}`] = value;
  });

  const pdfHref = findDownloadHref($, $(rowNode));
  const onclick = $(rowNode).find("a[onclick*='ServletDescarga'], a[onclick*='uuid=']").first().attr("onclick") ?? "";
  const onclickUuid = onclick.match(/uuid=([a-f0-9\-]{36})/i)?.[1];
  const resolvedPdfHref = pdfHref ?? (isDownloadOnclick(onclick) && onclickUuid ? `/jurisprudenciaweb/ServletDescarga?uuid=${onclickUuid}` : undefined);
  const bulkFieldName =
    $(rowNode).find("input[type='checkbox'][name]").first().attr("name") ??
    inferBulkFieldNameFromOnclick(onclick);
  const title = values[1] ?? values[0];
  const id = stableRecordId(metadata, `${title}|${sourcePage}`);

  return {
    id,
    title,
    metadata,
    pdfHref: resolvedPdfHref,
    bulkFieldName,
    sourcePage,
  };
}

function inferBulkFieldNameFromOnclick(onclick: string): string | undefined {
  if (!onclick) {
    return undefined;
  }

  const match = onclick.match(/formBuscador:repeat:\d+:j_idt457/);
  return match?.[0];
}

function findDownloadHref($: cheerio.CheerioAPI, element: cheerio.Cheerio<any>): string | undefined {
  const anchors = element.find("a").toArray();
  for (const anchor of anchors) {
    const node = $(anchor);
    if (isDownloadAnchor(node)) {
      return node.attr("href") ?? undefined;
    }
  }
  return undefined;
}

function isDownloadAnchor(anchor: cheerio.Cheerio<any>): boolean {
  const href = (anchor.attr("href") ?? "").toLowerCase();
  const onclick = (anchor.attr("onclick") ?? "").toLowerCase();
  const text = anchor.text().toLowerCase();

  if (href.includes("servletdescarga")) {
    return true;
  }

  if (href.includes(".pdf") || href.includes("format=pdf") || href.includes("tipo=pdf")) {
    return true;
  }

  if (text.includes("pdf") || text.includes("resoluci")) {
    return true;
  }

  return isDownloadOnclick(onclick);
}

function isDownloadOnclick(onclick: string): boolean {
  const normalized = onclick.toLowerCase();
  return normalized.includes("servletdescarga") || normalized.includes("pdf") || normalized.includes("format=pdf") || normalized.includes("tipo=pdf");
}

function dedupeById(records: DocumentRecord[]): DocumentRecord[] {
  const seen = new Set<string>();
  const result: DocumentRecord[] = [];
  for (const record of records) {
    if (!seen.has(record.id)) {
      seen.add(record.id);
      result.push(record);
    }
  }
  return result;
}
