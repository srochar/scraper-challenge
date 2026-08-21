import axios, { AxiosInstance, AxiosResponse } from "axios";
import * as cheerio from "cheerio";
import { XMLParser } from "fast-xml-parser";
import { wrapper } from "axios-cookiejar-support";
import { CookieJar } from "tough-cookie";
import { Logger } from "./logger";
import { PartialUpdateMap, PortalState } from "./types";

export interface PortalClientOptions {
  baseUrl: string;
  formId?: string;
  initPath?: string;
  resultPath?: string;
}

export interface PortalResponse {
  raw: string;
  state: PortalState;
  updates?: PartialUpdateMap;
  isPartial: boolean;
}

export class PortalClient {
  private readonly axios: AxiosInstance;
  private readonly baseUrl: string;
  private readonly initPath: string;
  private readonly resultPath: string;
  private readonly logger?: Logger;
  private state?: PortalState;

  constructor(options: PortalClientOptions, axiosInstance?: AxiosInstance, logger?: Logger) {
    this.baseUrl = options.baseUrl;
    this.initPath = options.initPath ?? "/faces/page/inicio.xhtml";
    this.resultPath = options.resultPath ?? "/faces/page/resultado.xhtml";
    this.logger = logger;
    if (axiosInstance) {
      this.axios = axiosInstance;
    } else {
      const jar = new CookieJar();
      this.axios = wrapper(
        axios.create({
          baseURL: options.baseUrl,
          withCredentials: true,
          jar,
          headers: {
            "User-Agent": "scraping-bot/1.0",
          },
        }),
      );
    }
  }

  getState(): PortalState | undefined {
    return this.state;
  }

  async initialize(path = ""): Promise<PortalResponse> {
    const targets = path ? [path] : [this.initPath, this.resultPath];
    let lastError: unknown;
    for (const target of targets) {
      try {
        this.logger?.debug("Initializing portal state", { target });
        const response = await this.axios.get<string>(this.buildUrl(target));
        const state = extractPortalState(response.data);
        this.state = state;
        this.logger?.info("Portal state initialized", {
          formId: state.formId,
          viewStateLength: state.viewState.length,
          defaultFields: Object.keys(state.formDefaults).length,
          target,
        });
        return {
          raw: response.data,
          state,
          isPartial: false,
        };
      } catch (error) {
        lastError = error;
        this.logger?.warn("Initialization path failed", {
          target,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    throw lastError instanceof Error ? lastError : new Error("Unable to initialize portal session");
  }

  async search(term: string): Promise<PortalResponse> {
    if (!this.state) {
      throw new Error("Portal client is not initialized");
    }

    const payload = buildSearchPayload(this.state, term);
    this.logger?.debug("Submitting search payload", {
      searchTerm: term,
      payloadSize: payload.toString().length,
    });

    const response = await this.axios.post<string>(
      this.buildUrl(this.resultPath),
      payload.toString(),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "Faces-Request": "partial/ajax",
          "X-Requested-With": "XMLHttpRequest",
        },
      },
    );

    const updates = parsePartialResponse(response.data);
    const nextState = extractViewStateFromPartial(response.data) ?? this.state.viewState;
    const bulkSubmitField = inferBulkSubmitFieldFromUpdates(updates, this.state.formId) ?? this.state.bulkSubmitField;
    this.state = {
      ...this.state,
      viewState: nextState,
      bulkSubmitField,
    };
    this.logger?.info("Search response received", {
      accion: "buscar",
      updateCount: Object.keys(updates).length,
      hasPanel: Boolean(updates["formBuscador:panel"]),
    });

    return {
      raw: response.data,
      state: this.state,
      updates,
      isPartial: true,
    };
  }

  async submitSearchFromInicio(term: string): Promise<PortalResponse> {
    this.logger?.debug("Submitting inicio search form", { term });
    const inicioHtml = await this.axios.get<string>(this.buildUrl(this.initPath));
    const inicioState = extractPortalState(inicioHtml.data);

    const payload = new URLSearchParams();
    payload.set(inicioState.formId, inicioState.formId);
    payload.set("javax.faces.ViewState", inicioState.viewState);
    payload.set(`${inicioState.formId}:tabpanel-value`, "general");
    payload.set(`${inicioState.formId}:txtBusqueda`, `${term} `);
    payload.set(`${inicioState.formId}:buCorte`, "1");
    payload.set(`${inicioState.formId}:buDistrito`, "0");
    payload.set(`${inicioState.formId}:buEspecialidad`, "0");
    payload.set(`${inicioState.formId}:buSala`, "0");
    payload.set(`${inicioState.formId}:buPretensionDelitoSupValue`, "");
    payload.set(`${inicioState.formId}:buPretensionDelitoSupInput`, "");
    payload.set(`${inicioState.formId}:buPretensionValue`, "");
    payload.set(`${inicioState.formId}:buPretensionInput`, "");
    payload.set(`${inicioState.formId}:buPalabraClaveValue`, "");
    payload.set(`${inicioState.formId}:buPalabraClaveInput`, "");
    payload.set(`${inicioState.formId}:buNroExpediente`, "Ingrese Nro de Expediente XXXXXX");
    payload.set(`${inicioState.formId}:buAnio`, "");
    payload.set(`${inicioState.formId}:j_idt31`, `${inicioState.formId}:j_idt31`);
    payload.set("forward", "buscar");
    payload.set("busqueda", "especializada");
    payload.set(`${inicioState.formId}:j_idt34`, "21");
    payload.set(`${inicioState.formId}:j_idt35`, "DESC");
    payload.set(`${inicioState.formId}:j_idt36`, "Principal");
    payload.set(`${inicioState.formId}:j_idt37`, "1");

    await this.axios.post(this.buildUrl(this.initPath), payload.toString(), {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      maxRedirects: 10,
      beforeRedirect: (options) => {
        if (options.protocol === "http:") {
          options.protocol = "https:";
          options.port = "443";
        }
      },
    });

    const resultPage = await this.axios.get<string>(this.buildUrl(this.resultPath));
    const resultState = extractPortalState(resultPage.data);
    this.state = resultState;
    this.logger?.info("Search form submitted and result page loaded", {
      accion: "buscar",
      viewStateLength: resultState.viewState.length,
      defaults: Object.keys(resultState.formDefaults).length,
    });

    return {
      raw: resultPage.data,
      state: resultState,
      isPartial: false,
    };
  }

  async gotoPage(page: number, term: string): Promise<PortalResponse> {
    if (!this.state) {
      throw new Error("Portal client is not initialized");
    }

    const payload = buildPagePayload(this.state, term, page);
    this.logger?.debug("Submitting page payload", {
      page,
      searchTerm: term,
      payloadSize: payload.toString().length,
    });
    const response = await this.axios.post<string>(this.buildUrl(this.resultPath), payload.toString(), {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "Faces-Request": "partial/ajax",
        "X-Requested-With": "XMLHttpRequest",
      },
    });

    const updates = parsePartialResponse(response.data);
    const nextState = extractViewStateFromPartial(response.data) ?? this.state.viewState;
    const bulkSubmitField = inferBulkSubmitFieldFromUpdates(updates, this.state.formId) ?? this.state.bulkSubmitField;
    this.state = {
      ...this.state,
      viewState: nextState,
      bulkSubmitField,
    };
    this.logger?.info("Pagination response received", {
      accion: "paginar",
      page,
      updateCount: Object.keys(updates).length,
      hasPanel: Boolean(updates["formBuscador:panel"]),
    });

    return {
      raw: response.data,
      state: this.state,
      updates,
      isPartial: true,
    };
  }

  getPortalState(): PortalState | undefined {
    return this.state;
  }

  async downloadBulkZip(records: Array<{ bulkFieldName?: string }>, searchTerm: string): Promise<Buffer | undefined> {
    if (!this.state?.bulkSubmitField || records.length === 0) {
      this.logger?.warn("Bulk ZIP skipped due to missing state/records", {
        hasState: Boolean(this.state),
        hasBulkSubmitField: Boolean(this.state?.bulkSubmitField),
        records: records.length,
      });
      return undefined;
    }

    const payload = new URLSearchParams();
    payload.set(this.state.formId, this.state.formId);
    payload.set("javax.faces.ViewState", this.state.viewState);
    addDefaults(payload, this.state.formDefaults);
    payload.set(`${this.state.formId}:txtBusqueda`, `${searchTerm} `);

    for (const record of records) {
      if (record.bulkFieldName) {
        payload.set(record.bulkFieldName, "on");
      }
    }

    const hasPage1Selection = records.some((record) => record.bulkFieldName?.includes(":repeat:0:"));
    const hasPage2Selection = records.some((record) => record.bulkFieldName?.includes(":repeat:10:"));
    if (hasPage1Selection) {
      payload.set(`${this.state.formId}:j_idt419`, "on");
      payload.set(`${this.state.formId}:spinner`, "1");
    }
    if (hasPage2Selection) {
      payload.set(`${this.state.formId}:j_idt434`, "on");
      payload.set(`${this.state.formId}:spinner`, "2");
    }

    payload.set(this.state.bulkSubmitField, this.state.bulkSubmitField);
    this.logger?.info("Submitting bulk ZIP download", {
      selected: records.filter((record) => Boolean(record.bulkFieldName)).length,
      submitField: this.state.bulkSubmitField,
    });

    const response = await this.axios.post<ArrayBuffer>(this.buildUrl(this.resultPath), payload.toString(), {
      responseType: "arraybuffer",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });

    const contentType = String(response.headers["content-type"] ?? "");
    if (!contentType.toLowerCase().includes("application/zip")) {
      this.logger?.warn("Bulk ZIP response content-type mismatch", { contentType });
      return undefined;
    }

    return Buffer.from(response.data);
  }

  private buildUrl(path: string): string {
    if (/^https?:\/\//i.test(path)) {
      return path;
    }
    if (!path) {
      return this.baseUrl;
    }
    return `${this.baseUrl.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
  }
}

export function extractPortalState(html: string): PortalState {
  const $ = cheerio.load(html);
  const formId = $("form").first().attr("id");
  const viewState = $("input[name='javax.faces.ViewState']").attr("value");

  if (!formId || !viewState) {
    throw new Error("Unable to extract form id or ViewState from portal page");
  }

  const defaults = extractFormDefaults($, formId);
  const bulkSubmitField = extractBulkSubmitField($, formId) ?? `${formId}:j_idt422`;

  return { formId, viewState, formDefaults: defaults, bulkSubmitField };
}

function extractFormDefaults($: cheerio.CheerioAPI, formId: string): Record<string, string> {
  const defaults: Record<string, string> = {};

  $(`form#${escapeCssId(formId)} input[name], form#${escapeCssId(formId)} select[name], form#${escapeCssId(formId)} textarea[name]`).each(
    (_idx, el) => {
      const element = $(el);
      const name = element.attr("name");
      if (!name) {
        return;
      }

      const type = (element.attr("type") ?? "").toLowerCase();
      if (type === "checkbox") {
        if (element.is(":checked")) {
          defaults[name] = element.attr("value") ?? "on";
        }
        return;
      }
      if (type === "radio") {
        if (element.is(":checked")) {
          defaults[name] = element.attr("value") ?? "";
        }
        return;
      }

      defaults[name] = element.attr("value") ?? element.val()?.toString() ?? "";
    },
  );

  return defaults;
}

function escapeCssId(id: string): string {
  return id.replace(/:/g, "\\:");
}

function buildSearchPayload(state: PortalState, term: string): URLSearchParams {
  const payload = new URLSearchParams();
  payload.set(state.formId, state.formId);
  addDefaults(payload, state.formDefaults);
  payload.set(`${state.formId}:txtBusqueda`, term);
  payload.set("javax.faces.ViewState", state.viewState);
  payload.set("javax.faces.source", `${state.formId}:data1`);
  payload.set("javax.faces.partial.event", "rich:datascroller:onscroll");
  payload.set("javax.faces.partial.execute", `${state.formId}:data1 @component`);
  payload.set("javax.faces.partial.render", "@component");
  payload.set(`${state.formId}:data1:page`, "1");
  payload.set("org.richfaces.ajax.component", `${state.formId}:data1`);
  payload.set(`${state.formId}:data1`, `${state.formId}:data1`);
  payload.set("AJAX:EVENTS_COUNT", "1");
  payload.set("javax.faces.partial.ajax", "true");
  return payload;
}

function buildPagePayload(state: PortalState, term: string, page: number): URLSearchParams {
  const payload = new URLSearchParams();
  payload.set(state.formId, state.formId);
  addDefaults(payload, state.formDefaults);
  payload.set(`${state.formId}:txtBusqueda`, term);
  payload.set("javax.faces.ViewState", state.viewState);
  payload.set("javax.faces.source", `${state.formId}:data1`);
  payload.set("javax.faces.partial.event", "rich:datascroller:onscroll");
  payload.set("javax.faces.partial.execute", `${state.formId}:data1 @component`);
  payload.set("javax.faces.partial.render", "@component");
  payload.set(`${state.formId}:data1:page`, String(page));
  payload.set("org.richfaces.ajax.component", `${state.formId}:data1`);
  payload.set(`${state.formId}:data1`, `${state.formId}:data1`);
  payload.set("AJAX:EVENTS_COUNT", "1");
  payload.set("javax.faces.partial.ajax", "true");
  return payload;
}

function addDefaults(payload: URLSearchParams, defaults: Record<string, string>): void {
  Object.entries(defaults).forEach(([key, value]) => {
    if (key === "javax.faces.ViewState") {
      return;
    }
    if (key === "formBuscador:txtBusqueda") {
      return;
    }
    payload.set(key, value ?? "");
  });
}

function extractBulkSubmitField($: cheerio.CheerioAPI, formId: string): string | undefined {
  const escaped = escapeCssId(formId);
  const candidate = $(`form#${escaped} input[name='${formId}:j_idt422'], form#${escaped} input[id='${formId}:j_idt422']`)
    .first()
    .attr("name");
  if (candidate) {
    return candidate;
  }

  const byOnclickAnchor = $(`form#${escaped} a[onclick*='j_idt422']`).first();
  if (byOnclickAnchor.length > 0) {
    const onclick = byOnclickAnchor.attr("onclick") ?? "";
    const match = onclick.match(/formBuscador:j_idt422/);
    if (match?.[0]) {
      return match[0];
    }
  }

  const byOnclick = $(`form#${escaped} input[type='submit'], form#${escaped} button`).toArray().find((el) => {
    const onclick = $(el).attr("onclick") ?? "";
    return onclick.includes("j_idt422");
  });

  if (byOnclick) {
    return $(byOnclick).attr("name") ?? $(byOnclick).attr("id") ?? undefined;
  }

  return undefined;
}

function inferBulkSubmitFieldFromUpdates(updates: PartialUpdateMap, formId: string): string | undefined {
  const blob = Object.values(updates).join("\n");
  const regex = new RegExp(`${formId}:j_idt422`, "i");
  const match = blob.match(regex);
  if (match?.[0]) {
    return match[0];
  }
  return undefined;
}

export function extractViewStateFromPartial(xml: string): string | undefined {
  const updates = parsePartialResponse(xml);
  return updates["javax.faces.ViewState"];
}

export function parsePartialResponse(xml: string): PartialUpdateMap {
  const partialError = parsePartialError(xml);
  if (partialError) {
    throw new Error(`JSF partial error: ${partialError.name} ${partialError.message}`.trim());
  }

  const parser = new XMLParser({
    ignoreAttributes: false,
    trimValues: false,
  });
  const parsed = parser.parse(xml) as {
    "partial-response"?: {
      changes?: {
        update?: { "#text"?: string; "@_id"?: string } | Array<{ "#text"?: string; "@_id"?: string }>;
      };
    };
  };

  const updatesNode = parsed["partial-response"]?.changes?.update;
  if (!updatesNode) {
    return {};
  }

  const updatesArray = Array.isArray(updatesNode) ? updatesNode : [updatesNode];
  const updates: PartialUpdateMap = {};
  for (const update of updatesArray) {
    if (update["@_id"]) {
      updates[update["@_id"]] = update["#text"] ?? "";
    }
  }
  return updates;
}

export function isRateLimited(response: AxiosResponse | { status: number }): boolean {
  return response.status === 429;
}

function parsePartialError(xml: string): { name: string; message: string } | undefined {
  const parser = new XMLParser({ ignoreAttributes: false, trimValues: false });
  const parsed = parser.parse(xml) as {
    "partial-response"?: {
      error?: {
        "error-name"?: string;
        "error-message"?: string;
      };
    };
  };
  const error = parsed["partial-response"]?.error;
  if (!error?.["error-name"]) {
    return undefined;
  }
  return {
    name: error["error-name"],
    message: error["error-message"] ?? "",
  };
}
