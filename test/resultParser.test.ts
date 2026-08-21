import { describe, expect, it } from "vitest";
import { parseDocumentsFromPanelHtml } from "../src/resultParser";

describe("result parser", () => {
  it("extracts records and deterministic ids", () => {
    const html = `
      <div id="formBuscador:panel">
        <div class="row">Expediente 100 | Sala Civil | Lima <a href="https://example.com/a.pdf">PDF</a></div>
        <div class="row">Expediente 100 | Sala Civil | Lima <a href="https://example.com/a.pdf">PDF</a></div>
      </div>
    `;

    const records = parseDocumentsFromPanelHtml(html, 1);
    expect(records.length).toBe(1);
    expect(records[0].pdfHref).toContain("a.pdf");
    expect(records[0].id.length).toBe(16);
  });
});
