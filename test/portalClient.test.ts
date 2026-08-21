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
  });

  it("extracts updates and next viewstate from partial response", () => {
    const xml = readFileSync(join(fixturesDir, "portal.partial.xml"), "utf8");
    const updates = parsePartialResponse(xml);
    expect(updates["formBuscador:panel"]).toContain("Expediente 1");
    expect(extractViewStateFromPartial(xml)).toBe("999:888");
  });
});
