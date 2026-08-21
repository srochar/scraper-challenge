import * as cheerio from "cheerio";
import { DocumentRecord } from "./types";
import { stableRecordId } from "./utils/hash";

export function parseDocumentsFromPanelHtml(panelHtml: string, sourcePage: number): DocumentRecord[] {
  const $ = cheerio.load(panelHtml);

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

    const pdfHref = element.find("a[href*='.pdf'], a[href*='pdf']").first().attr("href");
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
      sourcePage,
    });
  }

  return dedupeById(records);
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
