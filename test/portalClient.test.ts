import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { extractPortalState, extractViewStateFromPartial, parsePartialResponse } from "../src/portalClient";

const fixturesDir = join(__dirname, "fixtures");

describe("portal client parsing", () => {
  it("extracts initial form state", () => {
    const html = readFileSync(join(fixturesDir, "portal.initial.html"), "utf8");
    const state = extractPortalState(html);
    expect(state.formId).toBe("formBuscador");
    expect(state.viewState).toBe("123:456");
    expect(state.formDefaults["formBuscador:txtBusqueda"]).toBe("");
    expect(state.bulkSubmitField).toBe("formBuscador:j_idt422");
  });

  it("extracts updates and next viewstate from partial response", () => {
    const xml = readFileSync(join(fixturesDir, "portal.partial.xml"), "utf8");
    const updates = parsePartialResponse(xml);
    expect(updates["formBuscador:panel"]).toContain("Expediente 1");
    expect(extractViewStateFromPartial(xml)).toBe("999:888");
  });

  it("parses pagination partial payload with servlet download links", () => {
    const xml = readFileSync(join(fixturesDir, "portal.pagination.partial.xml"), "utf8");
    const updates = parsePartialResponse(xml);
    expect(updates["formBuscador:panel"]).toContain("ServletDescarga?uuid=");
    expect(extractViewStateFromPartial(xml)).toBe("777:666");
  });

  it("throws when JSF partial response contains error block", () => {
    const xml = readFileSync(join(fixturesDir, "portal.error.partial.xml"), "utf8");
    expect(() => parsePartialResponse(xml)).toThrow(/ViewExpiredException/);
  });
});
