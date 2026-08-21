import { describe, expect, it } from "vitest";
import { resolvePdfUrl } from "../src/pdfResolver";
import { DocumentRecord } from "../src/types";

const baseRecord: DocumentRecord = {
  id: "1",
  title: "Doc",
  metadata: {},
  sourcePage: 1,
};

describe("pdf resolver", () => {
  it("resolves relative href against base url", () => {
    const url = resolvePdfUrl({ ...baseRecord, pdfHref: "/jurisprudenciaweb/docs/a.pdf" }, "https://jurisprudencia.pj.gob.pe");
    expect(url).toBe("https://jurisprudencia.pj.gob.pe/jurisprudenciaweb/docs/a.pdf");
  });

  it("keeps absolute href", () => {
    const url = resolvePdfUrl({ ...baseRecord, pdfHref: "https://example.com/a.pdf" }, "https://jurisprudencia.pj.gob.pe");
    expect(url).toBe("https://example.com/a.pdf");
  });
});
