import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { extractPortalState, extractViewStateFromPartial, parsePartialResponse, PortalClient } from "../src/portalClient";

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

  it("prefers formBuscador when multiple forms exist", () => {
    const html = `
      <html><body>
        <form id="menuForm">
          <input name="javax.faces.ViewState" value="menu:1" />
        </form>
        <form id="formBuscador">
          <input name="javax.faces.ViewState" value="search:999" />
          <input name="formBuscador:txtBusqueda" value="" />
          <input name="formBuscador:j_idt422" value="descargar" />
        </form>
      </body></html>
    `;

    const state = extractPortalState(html);
    expect(state.formId).toBe("formBuscador");
    expect(state.viewState).toBe("search:999");
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

  it("detects dynamic bulk submit field from ajax update fragment", async () => {
    let capturedPayload = "";
    const seenFields: string[] = [];
    const fakeAxios = {
      post: async (_url: string, body: string, config?: { headers?: Record<string, string> }) => {
        if (config?.headers?.["Faces-Request"] === "partial/ajax") {
          const decoded = decodeURIComponent(body);
          const fieldMatch = decoded.match(/formBuscador:j_idt\d+=formBuscador:j_idt\d+/);
          if (fieldMatch?.[0]) {
            seenFields.push(fieldMatch[0].split("=")[0]);
          }
          if (decoded.includes("javax.faces.source=formBuscador:j_idt419")) {
            return {
              data: "<partial-response><changes><update id=\"formBuscador:panelDescarga1\"><![CDATA[<a href=\"#\" onclick=\"RichFaces.ajax(\&quot;formBuscador:j_idt429\&quot;,event,{\&quot;incId\&quot;:\&quot;1\&quot;});return false;\">Descargar <img src=\"../imagen/zip_file.png\"/></a>]]></update><update id=\"javax.faces.ViewState\"><![CDATA[2:2]]></update></changes></partial-response>",
              headers: { "content-type": "text/xml" },
            };
          }
          return {
            data: "<partial-response><changes><update id=\"formBuscador:panelDescarga1\"><![CDATA[<a href=\"#\" onclick=\"mojarra.jsfcljs(document.getElementById('formBuscador'),{'formBuscador:j_idt540':'formBuscador:j_idt540'},'');return false\">Descargar</a>]]></update><update id=\"javax.faces.ViewState\"><![CDATA[3:3]]></update></changes></partial-response>",
            headers: { "content-type": "text/xml" },
          };
        }
        capturedPayload = body;
        return {
          headers: { "content-type": "application/zip" },
          data: Buffer.from("PK\u0003\u0004test"),
        };
      },
    } as never;

    const client = new PortalClient({ baseUrl: "https://example.com" }, fakeAxios);
    (client as unknown as { state: unknown }).state = {
      formId: "formBuscador",
      viewState: "1:1",
      formDefaults: {},
      bulkSubmitField: "formBuscador:j_idt422",
    };

    await client.downloadBulkZip(
      [{ bulkFieldName: "formBuscador:repeat:0:j_idt457" }],
      "familia",
      1,
    );

    expect(capturedPayload).toContain("formBuscador%3Aj_idt429=formBuscador%3Aj_idt429");
  });

  it("sets spinner according to explicit page number when downloading bulk zip", async () => {
    let capturedPayload = "";
    let capturedHeaders: Record<string, string> = {};
    const requests: Array<{ body: string; headers?: Record<string, string> }> = [];
    const fakeAxios = {
      post: async (_url: string, body: string, config?: { headers?: Record<string, string> }) => {
        requests.push({ body, headers: config?.headers });
        if (config?.headers?.["Faces-Request"] === "partial/ajax") {
          return {
            data: "<partial-response><changes><update id=\"javax.faces.ViewState\"><![CDATA[2:2]]></update></changes></partial-response>",
            headers: { "content-type": "text/xml" },
          };
        }
        capturedPayload = body;
        capturedHeaders = config?.headers ?? {};
        return {
          headers: { "content-type": "application/zip" },
          data: Buffer.from("PK\u0003\u0004test"),
        };
      },
    } as never;

    const client = new PortalClient({ baseUrl: "https://example.com" }, fakeAxios);
    (client as unknown as { state: unknown }).state = {
      formId: "formBuscador",
      viewState: "1:1",
      formDefaults: {},
      bulkSubmitField: "formBuscador:j_idt422",
    };

    await client.downloadBulkZip(
      [{ bulkFieldName: "formBuscador:repeat:20:j_idt457" }],
      "civil",
      3,
    );

    expect(capturedPayload).toContain("formBuscador%3Aspinner=3");
    expect(capturedPayload).toContain("formBuscador%3Aspinner2=3");
    expect(capturedPayload).toContain("formBuscador%3Aj_idt419=on");
    expect(capturedPayload).toContain("formBuscador%3Aj_idt525=on");
    expect(capturedPayload).toContain("formBuscador%3Aj_idt533=on");
    expect(capturedHeaders["Upgrade-Insecure-Requests"]).toBe("1");
    expect(capturedHeaders.Origin).toBe("https://example.com");
    expect(capturedHeaders.Referer).toBe("https://example.com/faces/page/resultado.xhtml");
    expect(capturedHeaders.Accept).toContain("text/html");
    expect(capturedHeaders["Sec-Fetch-Dest"]).toBe("document");
    expect(capturedHeaders["Sec-Fetch-Mode"]).toBe("navigate");
    expect(capturedHeaders["Sec-Fetch-Site"]).toBe("same-origin");
    expect(capturedHeaders["Sec-Fetch-User"]).toBe("?1");
    expect(requests.some((req) => req.headers?.["Faces-Request"] === "partial/ajax")).toBe(true);
    expect(capturedPayload).toContain("javax.faces.ViewState=2%3A2");
  });

  it("infers spinner page from bulk field index when page number is absent", async () => {
    let capturedPayload = "";
    const fakeAxios = {
      post: async (_url: string, body: string) => {
        capturedPayload = body;
        return {
          headers: { "content-type": "application/zip" },
          data: Buffer.from("PK\u0003\u0004test"),
        };
      },
    } as never;

    const client = new PortalClient({ baseUrl: "https://example.com" }, fakeAxios);
    (client as unknown as { state: unknown }).state = {
      formId: "formBuscador",
      viewState: "1:1",
      formDefaults: {},
      bulkSubmitField: "formBuscador:j_idt422",
    };

    await client.downloadBulkZip(
      [{ bulkFieldName: "formBuscador:repeat:10:j_idt457" }],
      "civil",
    );

    expect(capturedPayload).toContain("formBuscador%3Aspinner=2");
    expect(capturedPayload).toContain("formBuscador%3Aspinner2=2");
    expect(capturedPayload).toContain("formBuscador%3Aj_idt419=on");
  });

  it("includes expected bulk helper fields for page-1", async () => {
    let capturedPayload = "";
    const fakeAxios = {
      post: async (_url: string, body: string) => {
        capturedPayload = body;
        return {
          headers: { "content-type": "application/zip" },
          data: Buffer.from("PK\u0003\u0004test"),
        };
      },
    } as never;

    const client = new PortalClient({ baseUrl: "https://example.com" }, fakeAxios);
    (client as unknown as { state: unknown }).state = {
      formId: "formBuscador",
      viewState: "1:1",
      formDefaults: {},
      bulkSubmitField: "formBuscador:j_idt422",
    };

    await client.downloadBulkZip(
      [{ bulkFieldName: "formBuscador:repeat:0:j_idt457" }],
      "civil",
      1,
    );

    expect(capturedPayload).toContain("formBuscador%3Aspinner=1");
    expect(capturedPayload).toContain("formBuscador%3Aspinner2=1");
    expect(capturedPayload).toContain("formBuscador%3Aj_idt419=on");
    expect(capturedPayload).toContain("formBuscador%3Aj_idt525=on");
    expect(capturedPayload).toContain("formBuscador%3Aj_idt533=on");
  });

});
