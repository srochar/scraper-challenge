import { describe, expect, it } from "vitest";
import { parseDocumentsFromPanelHtml } from "../src/resultParser";

describe("result parser", () => {
  it("extracts records and deterministic ids", () => {
    const html = `
      <div id="formBuscador:panel">
        <div class="rf-p " id="formBuscador:repeat:0:j_idt455">
          <div class="rf-p-hdr " id="formBuscador:repeat:0:j_idt455_header">
            <table><tbody><tr>
              <td><input id="formBuscador:repeat:0:j_idt457" type="checkbox" name="formBuscador:repeat:0:j_idt457" /></td>
              <td><span>Casación</span></td>
              <td><span>029269-2025</span></td>
            </tr></tbody></table>
          </div>
          <div class="rf-p-b " id="formBuscador:repeat:0:j_idt455_body">
            <div class="row"><div class="col-md-12 txtbold">Pretensión/Delito:</div><div class="col-md-12">Nulidad</div></div>
            <a href="/downloads/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.pdf">Resolución PDF</a>
          </div>
        </div>
      </div>
    `;

    const records = parseDocumentsFromPanelHtml(html, 1);
    expect(records.length).toBe(1);
    expect(records[0].title).toContain("Casación");
    expect(records[0].pdfHref).toContain(".pdf");
    expect(records[0].bulkFieldName).toBe("formBuscador:repeat:0:j_idt457");
    expect(records[0].id.length).toBe(16);
  });

  it("prefers pdf links over non-download assets", () => {
    const html = `
      <div id="formBuscador:panel">
        <div class="row">
          Expediente 1 | Civil
          <a href="https://example.com/app.css">CSS</a>
          <a href="https://example.com/doc.zip">ZIP</a>
          <a href="https://example.com/doc.pdf">PDF</a>
        </div>
      </div>
    `;

    const records = parseDocumentsFromPanelHtml(html, 1);
    expect(records.length).toBe(1);
    expect(records[0].pdfHref).toBe("https://example.com/doc.pdf");
  });
});
