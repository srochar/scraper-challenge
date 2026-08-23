import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import { ScrapeSummary } from "../types";
import { RunResultSource } from "./types";

export async function writeGlobalConsolidatedResults(
  runsRootOrDir: string,
  sources: RunResultSource[],
): Promise<string | undefined> {
  if (sources.length === 0) {
    return undefined;
  }

  const isJson = sources[0].path.toLowerCase().endsWith(".json");
  if (isJson) {
    const merged: Array<Record<string, unknown>> = [];
    for (const source of sources) {
      try {
        const raw = await readFile(source.path, "utf8");
        const rows = JSON.parse(raw) as Array<Record<string, unknown>>;
        if (!Array.isArray(rows)) {
          continue;
        }
        for (const row of rows) {
          merged.push({
            ...row,
            bot: typeof row.bot === "string" ? row.bot : source.bot,
            runId: typeof row.runId === "string" ? row.runId : source.runId,
          });
        }
      } catch {
        continue;
      }
    }

    const ordered = merged.sort(compareGlobalRows);
    const targetPath = join(runsRootOrDir, "result-global.json");
    await writeFile(targetPath, `${JSON.stringify(ordered, null, 2)}\n`, "utf8");
    return targetPath;
  }

  let header: string | undefined;
  const bodyRows: string[] = [];
  for (const source of sources) {
    try {
      const raw = await readFile(source.path, "utf8");
      const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
      if (lines.length === 0) {
        continue;
      }
      if (!header) {
        header = lines[0];
      }
      bodyRows.push(...lines.slice(1));
    } catch {
      continue;
    }
  }

  if (!header) {
    return undefined;
  }

  const targetPath = join(runsRootOrDir, "result-global.csv");
  await writeFile(targetPath, `${[header, ...bodyRows].join("\n")}\n`, "utf8");
  return targetPath;
}

export function isSummarySuccessful(summary: ScrapeSummary): boolean {
  if (summary.processed === 0) {
    return false;
  }
  return summary.failed === 0;
}

export function buildUnsuccessfulSummaryMessage(summary: ScrapeSummary): string {
  if (summary.processed === 0) {
    return "La corrida termino sin registros procesados (processed=0).";
  }
  if (summary.failed > 0) {
    return `La corrida termino con ${summary.failed} descargas fallidas (processed=${summary.processed}, downloaded=${summary.downloaded}).`;
  }
  return `La corrida termino en estado no exitoso (processed=${summary.processed}, downloaded=${summary.downloaded}, failed=${summary.failed}).`;
}

function compareGlobalRows(a: Record<string, unknown>, b: Record<string, unknown>): number {
  const botOrder = String(a.bot ?? "").localeCompare(String(b.bot ?? ""));
  if (botOrder !== 0) {
    return botOrder;
  }

  const pageA = Number(a.sourcePage ?? 0);
  const pageB = Number(b.sourcePage ?? 0);
  if (pageA !== pageB) {
    return pageA - pageB;
  }

  const titleOrder = String(a.title ?? "").localeCompare(String(b.title ?? ""));
  if (titleOrder !== 0) {
    return titleOrder;
  }

  return String(a.id ?? "").localeCompare(String(b.id ?? ""));
}
