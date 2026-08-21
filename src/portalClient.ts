import axios, { AxiosInstance, AxiosResponse } from "axios";
import * as cheerio from "cheerio";
import { XMLParser } from "fast-xml-parser";
import { PartialUpdateMap, PortalState } from "./types";

export interface PortalClientOptions {
  baseUrl: string;
  formId?: string;
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
  private state?: PortalState;

  constructor(options: PortalClientOptions, axiosInstance?: AxiosInstance) {
    this.baseUrl = options.baseUrl;
    this.axios =
      axiosInstance ??
      axios.create({
        baseURL: options.baseUrl,
        withCredentials: true,
        headers: {
          "User-Agent": "scraping-bot/1.0",
        },
      });
  }

  getState(): PortalState | undefined {
    return this.state;
  }

  async initialize(path = ""): Promise<PortalResponse> {
    const response = await this.axios.get<string>(this.buildUrl(path));
    const state = extractPortalState(response.data);
    this.state = state;
    return {
      raw: response.data,
      state,
      isPartial: false,
    };
  }

  async search(term: string): Promise<PortalResponse> {
    if (!this.state) {
      throw new Error("Portal client is not initialized");
    }

    const payload = new URLSearchParams();
    payload.set(this.state.formId, this.state.formId);
    payload.set("javax.faces.partial.ajax", "true");
    payload.set("javax.faces.source", `${this.state.formId}:txtBusqueda`);
    payload.set("javax.faces.partial.execute", `${this.state.formId}:txtBusqueda`);
    payload.set(
      "javax.faces.partial.render",
      `${this.state.formId}:panel ${this.state.formId}:optResultado ${this.state.formId}:optResumen ${this.state.formId}:optTema ${this.state.formId}:optBaseLegal`,
    );
    payload.set("javax.faces.behavior.event", "valueChange");
    payload.set("javax.faces.partial.event", "change");
    payload.set(`${this.state.formId}:txtBusqueda`, term);
    payload.set("javax.faces.ViewState", this.state.viewState);

    const response = await this.axios.post<string>(
      this.buildUrl(""),
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
    this.state = {
      ...this.state,
      viewState: nextState,
    };

    return {
      raw: response.data,
      state: this.state,
      updates,
      isPartial: true,
    };
  }

  private buildUrl(path: string): string {
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

  return { formId, viewState };
}

export function extractViewStateFromPartial(xml: string): string | undefined {
  const updates = parsePartialResponse(xml);
  return updates["javax.faces.ViewState"];
}

export function parsePartialResponse(xml: string): PartialUpdateMap {
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
