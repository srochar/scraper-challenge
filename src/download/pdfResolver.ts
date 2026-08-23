import { DocumentRecord } from "../types";

export function resolvePdfUrl(record: DocumentRecord, baseUrl: string): string | undefined {
  if (!record.pdfHref) {
    return undefined;
  }

  try {
    return new URL(record.pdfHref, baseUrl).toString();
  } catch {
    return undefined;
  }
}
