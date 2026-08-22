import axios, { AxiosInstance, AxiosResponse } from "axios";
import * as cheerio from "cheerio";
import { XMLParser } from "fast-xml-parser";
import { wrapper } from "axios-cookiejar-support";
import { CookieJar } from "tough-cookie";
import { join } from "path";
import { writeFile } from "fs/promises";
import { Logger } from "./logger";
import { PartialUpdateMap, PortalState } from "./types";
import { ensureDir } from "./utils/fs";

export interface PortalClientOptions {
  baseUrl: string;
  formId?: string;
  initPath?: string;
  resultPath?: string;
  debugCaptureDir?: string;
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
  private readonly debugCaptureDir?: string;
  private state?: PortalState;
  private readonly browserUserAgent =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";
  private debugCaptureSeq = 0;
  private bulkSubmitCandidates: string[] = [];

  constructor(options: PortalClientOptions, axiosInstance?: AxiosInstance, logger?: Logger) {
    this.baseUrl = options.baseUrl;
    this.initPath = options.initPath ?? "/faces/page/inicio.xhtml";
    this.resultPath = options.resultPath ?? "/faces/page/resultado.xhtml";
    this.logger = logger;
    this.debugCaptureDir = options.debugCaptureDir;
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
            "User-Agent": this.browserUserAgent,
            "Accept-Language": "es-US,es-419;q=0.9,es;q=0.8",
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
          Accept: "application/xml, text/xml, */*; q=0.01",
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "Faces-Request": "partial/ajax",
          "X-Requested-With": "XMLHttpRequest",
          Origin: this.getPortalOrigin(),
          Referer: this.buildUrl(this.resultPath),
        },
      },
    );

    const responseContentType = String(response.headers?.["content-type"] ?? "");
    if (!responseContentType.toLowerCase().includes("xml")) {
      this.logger?.warn("Search returned non-XML response; refreshing state from result page", {
        contentType: responseContentType,
      });
      const refreshed = await this.axios.get<string>(this.buildUrl(this.resultPath), {
        headers: {
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          Origin: this.getPortalOrigin(),
          Referer: this.buildUrl(this.resultPath),
          "Upgrade-Insecure-Requests": "1",
        },
      });
      const refreshedState = extractPortalState(refreshed.data);
      this.state = refreshedState;
      return {
        raw: refreshed.data,
        state: refreshedState,
        isPartial: false,
      };
    }

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
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: this.getPortalOrigin(),
        Referer: this.buildUrl(this.initPath),
        "Upgrade-Insecure-Requests": "1",
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
        Accept: "application/xml, text/xml, */*; q=0.01",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "Faces-Request": "partial/ajax",
        "X-Requested-With": "XMLHttpRequest",
        Origin: this.getPortalOrigin(),
        Referer: this.buildUrl(this.resultPath),
      },
    });

    const responseContentType = String(response.headers?.["content-type"] ?? "");
    if (!responseContentType.toLowerCase().includes("xml")) {
      this.logger?.warn("Pagination returned non-XML response; refreshing state from result page", {
        page,
        contentType: responseContentType,
      });
      const refreshed = await this.axios.get<string>(this.buildUrl(this.resultPath), {
        headers: {
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          Origin: this.getPortalOrigin(),
          Referer: this.buildUrl(this.resultPath),
          "Upgrade-Insecure-Requests": "1",
        },
      });
      const refreshedState = extractPortalState(refreshed.data);
      this.state = refreshedState;
      return {
        raw: refreshed.data,
        state: refreshedState,
        isPartial: false,
      };
    }

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

  async downloadBulkZip(
    records: Array<{ bulkFieldName?: string }>,
    searchTerm: string,
    pageNumber?: number,
  ): Promise<Buffer | undefined> {
    if (!this.state?.bulkSubmitField || records.length === 0) {
      this.logger?.warn("Bulk ZIP skipped due to missing state/records", {
        hasState: Boolean(this.state),
        hasBulkSubmitField: Boolean(this.state?.bulkSubmitField),
        records: records.length,
      });
      return undefined;
    }

    const inferredPage = inferPageFromBulkFields(records);
    const spinnerPage = pageNumber && pageNumber > 0 ? pageNumber : inferredPage;
    await this.prepareBulkSelection(searchTerm, spinnerPage);

    const firstAttempt = await this.submitBulkZip(records, searchTerm, spinnerPage, "bulk-download");
    if (firstAttempt.buffer) {
      return firstAttempt.buffer;
    }

    const retryBuffer = await this.retryBulkZipAfterSelectionMismatch(records, searchTerm, spinnerPage, firstAttempt.responseBody);
    if (retryBuffer) {
      return retryBuffer;
    }

    return undefined;
  }

  private async submitBulkZip(
    records: Array<{ bulkFieldName?: string }>,
    searchTerm: string,
    spinnerPage: number | undefined,
    captureStep: string,
    submitFieldOverride?: string,
  ): Promise<{ buffer?: Buffer; responseBody: Buffer }> {
    if (!this.state) {
      return { responseBody: Buffer.alloc(0) };
    }

    const payload = new URLSearchParams();
    payload.set(this.state.formId, this.state.formId);
    payload.set("javax.faces.ViewState", this.state.viewState);
    addBulkFilterDefaults(payload, this.state.formDefaults, this.state.formId);
    payload.set(`${this.state.formId}:txtBusqueda`, searchTerm);

    for (const record of records) {
      if (record.bulkFieldName) {
        payload.set(record.bulkFieldName, "on");
      }
    }

    if (spinnerPage) {
      payload.set(`${this.state.formId}:spinner`, String(spinnerPage));
      payload.set(`${this.state.formId}:spinner2`, String(spinnerPage));
      payload.set(`${this.state.formId}:j_idt419`, "on");
      payload.set(`${this.state.formId}:j_idt525`, "on");
      payload.set(`${this.state.formId}:j_idt533`, "on");
    }

    const submitField = submitFieldOverride ?? this.state.bulkSubmitField ?? `${this.state.formId}:j_idt422`;
    payload.set(submitField, submitField);
    this.logger?.info("Submitting bulk ZIP download", {
      selected: records.filter((record) => Boolean(record.bulkFieldName)).length,
      submitField,
      step: captureStep,
    });

    const response = await this.axios.post<ArrayBuffer>(this.buildUrl(this.resultPath), payload.toString(), {
      responseType: "arraybuffer",
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Cache-Control": "max-age=0",
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: this.getPortalOrigin(),
        Referer: this.buildUrl(this.resultPath),
        "Upgrade-Insecure-Requests": "1",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-User": "?1",
      },
    });

    await this.captureDebugResponse(
      captureStep,
      payload.toString(),
      response.status,
      response.headers,
      Buffer.from(response.data),
    );

    const contentType = String(response.headers["content-type"] ?? "");
    const contentDisposition = String(response.headers["content-disposition"] ?? "");
    const buffer = Buffer.from(response.data);
    const hasZipSignature = buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
    const looksLikeZip = contentType.toLowerCase().includes("application/zip")
      || contentDisposition.toLowerCase().includes(".zip")
      || hasZipSignature;

    if (!looksLikeZip) {
      const responsePreview = buffer
        .toString("utf8", 0, Math.min(buffer.length, 280))
        .replace(/\s+/g, " ")
        .trim();
      this.logger?.warn("Bulk ZIP response content-type mismatch", { contentType });
      this.logger?.debug("Bulk ZIP non-zip response preview", {
        status: response.status,
        contentType,
        contentDisposition,
        responsePreview,
        step: captureStep,
      });
      return { responseBody: buffer };
    }

    return { buffer, responseBody: buffer };
  }

  private async retryBulkZipAfterSelectionMismatch(
    records: Array<{ bulkFieldName?: string }>,
    searchTerm: string,
    spinnerPage: number | undefined,
    responseBody: Buffer,
  ): Promise<Buffer | undefined> {
    if (!this.state || responseBody.length === 0) {
      return undefined;
    }

    const html = responseBody.toString("utf8");
    const hasSelectionWarning = /debe haber al menos una seleccionada/i.test(html)
      || /maximo de 10/i.test(html)
      || /m\u00e1ximo de 10/i.test(html);
    if (!hasSelectionWarning) {
      return undefined;
    }

    this.logger?.info("Retrying bulk ZIP after selection mismatch warning", {
      spinnerPage,
      submitField: this.state.bulkSubmitField,
    });

    try {
      const refreshed = extractPortalState(html);
      this.state = {
        ...this.state,
        formDefaults: refreshed.formDefaults,
        viewState: refreshed.viewState,
      };
    } catch (error) {
      this.logger?.debug("Unable to refresh state from bulk mismatch response", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const triggerFields = inferBulkTriggerFieldsFromContent(html, this.state.formId);
    const candidates = triggerFields.length > 0
      ? triggerFields
      : [`${this.state.formId}:j_idt429`, `${this.state.formId}:j_idt535`, `${this.state.formId}:j_idt422`];

    for (const triggerField of candidates) {
      const prepared = await this.prepareBulkDownloadPanel(triggerField, searchTerm, spinnerPage);
      if (prepared) {
        break;
      }
    }

    const submitCandidates = Array.from(new Set([
      this.state.bulkSubmitField,
      ...this.bulkSubmitCandidates,
      ...inferBulkSubmitFieldsFromContent(html, this.state.formId),
      `${this.state.formId}:j_idt422`,
      `${this.state.formId}:j_idt528`,
    ].filter((value): value is string => Boolean(value))));

    for (let index = 0; index < submitCandidates.length; index += 1) {
      const candidate = submitCandidates[index];
      const step = index === 0 ? "bulk-download-retry" : `bulk-download-retry-${index + 1}`;
      const retry = await this.submitBulkZip(records, searchTerm, spinnerPage, step, candidate);
      if (retry.buffer) {
        return retry.buffer;
      }
    }

    return undefined;
  }

  private async prepareBulkSelection(searchTerm: string, spinnerPage?: number): Promise<void> {
    if (!this.state) {
      return;
    }

    const sourceField = `${this.state.formId}:j_idt419`;
    const ajaxPayload = new URLSearchParams();
    ajaxPayload.set(this.state.formId, this.state.formId);
    ajaxPayload.set("javax.faces.ViewState", this.state.viewState);
    addDefaults(ajaxPayload, this.state.formDefaults);
    ajaxPayload.set(`${this.state.formId}:txtBusqueda`, searchTerm);
    ajaxPayload.set(sourceField, "on");
    ajaxPayload.set(`${this.state.formId}:j_idt434`, "on");
    ajaxPayload.set(`${this.state.formId}:j_idt540`, "on");
    if (spinnerPage) {
      ajaxPayload.set(`${this.state.formId}:spinner`, String(spinnerPage));
      ajaxPayload.set(`${this.state.formId}:spinner2`, String(spinnerPage));
    }
    ajaxPayload.set("javax.faces.source", sourceField);
    ajaxPayload.set("javax.faces.partial.event", "click");
    ajaxPayload.set("javax.faces.partial.execute", `${sourceField} @component`);
    ajaxPayload.set("javax.faces.partial.render", "@component");
    ajaxPayload.set("javax.faces.behavior.event", "click");
    ajaxPayload.set("org.richfaces.ajax.component", sourceField);
    ajaxPayload.set("AJAX:EVENTS_COUNT", "1");
    ajaxPayload.set("javax.faces.partial.ajax", "true");

    try {
      const ajaxResponse = await this.axios.post<string>(this.buildUrl(this.resultPath), ajaxPayload.toString(), {
        headers: {
          Accept: "*/*",
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "Faces-Request": "partial/ajax",
          "X-Requested-With": "XMLHttpRequest",
          Origin: this.getPortalOrigin(),
          Referer: this.buildUrl(this.resultPath),
          "Sec-Fetch-Dest": "empty",
          "Sec-Fetch-Mode": "cors",
          "Sec-Fetch-Site": "same-origin",
        },
      });

      await this.captureDebugResponse(
        "bulk-select-all",
        ajaxPayload.toString(),
        ajaxResponse.status,
        ajaxResponse.headers,
        Buffer.from(ajaxResponse.data, "utf8"),
      );

      const updates = parsePartialResponse(ajaxResponse.data);
      const nextState = extractViewStateFromPartial(ajaxResponse.data) ?? this.state.viewState;
      const updatesBlob = Object.values(updates).join("\n");
      const inferredSubmitField = inferBulkSubmitFieldFromUpdates(updates, this.state.formId);
      const bulkSubmitField = inferredSubmitField ?? this.state.bulkSubmitField;
      this.bulkSubmitCandidates = Array.from(new Set([
        bulkSubmitField,
        ...inferBulkSubmitFieldsFromContent(updatesBlob, this.state.formId),
      ].filter((value): value is string => Boolean(value))));
      this.state = {
        ...this.state,
        viewState: nextState,
        bulkSubmitField,
      };

      let prepared = false;
      let candidateFields: string[] = [];
      const shouldPreparePanel = !inferredSubmitField && !hasFieldInContent(updatesBlob, this.state.formId, this.state.bulkSubmitField);
      if (shouldPreparePanel) {
        const triggerFields = inferBulkTriggerFieldsFromContent(updatesBlob, this.state.formId);
        candidateFields = triggerFields.length > 0
          ? triggerFields
          : [`${this.state.formId}:j_idt429`, `${this.state.formId}:j_idt422`];

        for (const triggerField of candidateFields) {
          prepared = await this.prepareBulkDownloadPanel(triggerField, searchTerm, spinnerPage);
          if (prepared) {
            break;
          }
        }
      }

      this.logger?.debug("Bulk selection prepared", {
        spinnerPage,
        updateCount: Object.keys(updates).length,
        submitField: bulkSubmitField,
        submitCandidates: this.bulkSubmitCandidates,
        inferredSubmitField,
        triggerFields: candidateFields,
        prepared,
      });
    } catch (error) {
      this.logger?.warn("Bulk selection preparation failed; continuing with ZIP submit", {
        spinnerPage,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async prepareBulkDownloadPanel(
    triggerField: string,
    searchTerm: string,
    spinnerPage?: number,
  ): Promise<boolean> {
    if (!this.state) {
      return false;
    }

    const payload = new URLSearchParams();
    payload.set(this.state.formId, this.state.formId);
    payload.set("javax.faces.ViewState", this.state.viewState);
    addDefaults(payload, this.state.formDefaults);
    payload.set(`${this.state.formId}:txtBusqueda`, searchTerm);
    payload.set(triggerField, triggerField);
    payload.set("incId", "1");
    if (spinnerPage) {
      payload.set(`${this.state.formId}:spinner`, String(spinnerPage));
      payload.set(`${this.state.formId}:spinner2`, String(spinnerPage));
    }
    payload.set("javax.faces.source", triggerField);
    payload.set("javax.faces.partial.event", "click");
    payload.set("javax.faces.partial.execute", `${triggerField} @component`);
    payload.set("javax.faces.partial.render", "@component");
    payload.set("javax.faces.behavior.event", "click");
    payload.set("org.richfaces.ajax.component", triggerField);
    payload.set("AJAX:EVENTS_COUNT", "1");
    payload.set("javax.faces.partial.ajax", "true");

    try {
      const response = await this.axios.post<string>(this.buildUrl(this.resultPath), payload.toString(), {
        headers: {
          Accept: "*/*",
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "Faces-Request": "partial/ajax",
          "X-Requested-With": "XMLHttpRequest",
          Origin: this.getPortalOrigin(),
          Referer: this.buildUrl(this.resultPath),
          "Sec-Fetch-Dest": "empty",
          "Sec-Fetch-Mode": "cors",
          "Sec-Fetch-Site": "same-origin",
        },
      });

      await this.captureDebugResponse(
        "bulk-download-trigger",
        payload.toString(),
        response.status,
        response.headers,
        Buffer.from(response.data, "utf8"),
      );

      const updates = parsePartialResponse(response.data);
      const nextState = extractViewStateFromPartial(response.data) ?? this.state.viewState;
      const dynamicSubmit = inferBulkSubmitFieldFromUpdates(updates, this.state.formId) ?? this.state.bulkSubmitField;
      this.state = {
        ...this.state,
        viewState: nextState,
        bulkSubmitField: dynamicSubmit,
      };

      this.logger?.debug("Bulk download panel prepared", {
        triggerField,
        submitField: dynamicSubmit,
        updateCount: Object.keys(updates).length,
      });
      return true;
    } catch (error) {
      this.logger?.debug("Bulk download panel trigger failed", {
        triggerField,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
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

  private getPortalOrigin(): string {
    try {
      return new URL(this.baseUrl).origin;
    } catch {
      return this.baseUrl;
    }
  }

  private async captureDebugResponse(
    step: string,
    requestPayload: string,
    status: number,
    headers: Record<string, unknown>,
    body: Buffer,
  ): Promise<void> {
    if (!this.debugCaptureDir) {
      return;
    }

    try {
      await ensureDir(this.debugCaptureDir);
      this.debugCaptureSeq += 1;
      const prefix = `${String(this.debugCaptureSeq).padStart(2, "0")}-${step}`;
      const payloadPath = join(this.debugCaptureDir, `${prefix}.request.txt`);
      const metaPath = join(this.debugCaptureDir, `${prefix}.meta.json`);
      const htmlPath = join(this.debugCaptureDir, `${prefix}.response.html`);
      const xmlPath = join(this.debugCaptureDir, `${prefix}.response.xml`);
      const binPath = join(this.debugCaptureDir, `${prefix}.response.bin`);

      await writeFile(payloadPath, requestPayload, "utf8");
      await writeFile(metaPath, JSON.stringify({ step, status, headers }, null, 2), "utf8");

      const contentType = String((headers["content-type"] ?? headers["Content-Type"] ?? "")).toLowerCase();
      if (contentType.includes("text/html") || looksLikeHtml(body)) {
        const html = body.toString("utf8");
        await writeFile(htmlPath, html, "utf8");
        return;
      }

      if (contentType.includes("xml") || looksLikeXml(body)) {
        await writeFile(xmlPath, body.toString("utf8"), "utf8");
        return;
      }

      await writeFile(binPath, body);
    } catch (error) {
      this.logger?.warn("Debug capture failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

}

function looksLikeHtml(body: Buffer): boolean {
  const probe = body.toString("utf8", 0, Math.min(body.length, 512)).toLowerCase();
  return probe.includes("<html") || probe.includes("<!doctype html") || probe.includes("xhtml");
}

function looksLikeXml(body: Buffer): boolean {
  const probe = body.toString("utf8", 0, Math.min(body.length, 512)).toLowerCase();
  return probe.includes("<?xml") || probe.includes("<partial-response");
}

function inferPageFromBulkFields(records: Array<{ bulkFieldName?: string }>): number | undefined {
  const indexes = records
    .map((record) => {
      const match = record.bulkFieldName?.match(/:repeat:(\d+):/);
      return match ? Number(match[1]) : undefined;
    })
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));

  if (indexes.length === 0) {
    return undefined;
  }

  const smallestIndex = Math.min(...indexes);
  return Math.floor(smallestIndex / 10) + 1;
}


export function extractPortalState(html: string): PortalState {
  const $ = cheerio.load(html);
  const form = selectPortalForm($);
  const formId = form.attr("id");
  const viewState = form.find("input[name='javax.faces.ViewState']").first().attr("value")
    ?? $("input[name='javax.faces.ViewState']").first().attr("value");

  if (!formId || !viewState) {
    throw new Error("Unable to extract form id or ViewState from portal page");
  }

  const defaults = extractFormDefaults($, formId);
  const bulkSubmitField = extractBulkSubmitField($, formId) ?? `${formId}:j_idt422`;

  return { formId, viewState, formDefaults: defaults, bulkSubmitField };
}

function selectPortalForm($: cheerio.CheerioAPI): cheerio.Cheerio<any> {
  const byId = $("form#formBuscador").first();
  if (byId.length > 0) {
    return byId;
  }

  const withSearchField = $("form").filter((_idx, form) => {
    const el = $(form);
    return el.find("input[name$=':txtBusqueda']").length > 0;
  }).first();
  if (withSearchField.length > 0) {
    return withSearchField;
  }

  return $("form").first();
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

function addBulkFilterDefaults(payload: URLSearchParams, defaults: Record<string, string>, formId: string): void {
  const allowedKeys = new Set([
    `${formId}:buCorte`,
    `${formId}:buDistrito`,
    `${formId}:buEspecialidad`,
    `${formId}:buPretensionValue`,
    `${formId}:buPretensionInput`,
    `${formId}:buPalabraClaveValue`,
    `${formId}:buPalabraClaveInput`,
    `${formId}:buNroExpediente`,
    `${formId}:buSala`,
    `${formId}:buPretensionDelitoSupValue`,
    `${formId}:buPretensionDelitoSupInput`,
    `${formId}:buTipoRecurso`,
    `${formId}:buTipoResolucion`,
    `${formId}:buTipoResolucionInput`,
    `${formId}:buAnio`,
    `${formId}:buOrden`,
    `${formId}:buOrdenForma`,
  ]);

  for (const [key, value] of Object.entries(defaults)) {
    if (!allowedKeys.has(key)) {
      continue;
    }
    payload.set(key, value ?? "");
  }
}

function extractBulkSubmitField($: cheerio.CheerioAPI, formId: string): string | undefined {
  const escaped = escapeCssId(formId);
  const candidate = $(`form#${escaped} input[name='${formId}:j_idt422'], form#${escaped} input[id='${formId}:j_idt422']`)
    .first()
    .attr("name");
  if (candidate) {
    return candidate;
  }

  const dynamicAnchor = $(`form#${escaped} a[onclick*='mojarra.jsfcljs']`).toArray().find((el) => {
    const onclick = $(el).attr("onclick") ?? "";
    const text = $(el).text().toLowerCase();
    return /j_idt\d+/.test(onclick) && (text.includes("descargar") || onclick.toLowerCase().includes("zip_file"));
  });
  if (dynamicAnchor) {
    const onclick = $(dynamicAnchor).attr("onclick") ?? "";
    const dynamicMatch = onclick.match(new RegExp(`${formId}:j_idt\\d+`, "i"));
    if (dynamicMatch?.[0]) {
      return dynamicMatch[0];
    }
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
  const dynamicJsfcljs = blob.match(new RegExp(`mojarra\\.jsfcljs\\([^)]*\{'(${formId}:j_idt\\d+)'`, "i"));
  if (dynamicJsfcljs?.[1]) {
    return dynamicJsfcljs[1];
  }

  const regex = new RegExp(`${formId}:j_idt422`, "i");
  const match = blob.match(regex);
  if (match?.[0]) {
    return match[0];
  }

  const anySubmit = blob.match(new RegExp(`${formId}:j_idt\\d+`, "i"));
  if (anySubmit?.[0]) {
    return anySubmit[0];
  }

  return undefined;
}

function inferBulkTriggerFieldsFromContent(content: string, formId: string): string[] {
  const $ = cheerio.load(content);
  const candidates = $("a[onclick*='RichFaces.ajax']").toArray().flatMap((el) => {
    const node = $(el);
    const onclick = node.attr("onclick") ?? "";
    const hasZipIcon = node.find("img[src*='zip_file']").length > 0;
    const hasDescargarText = node.text().toLowerCase().includes("descargar");
    if (!onclick.includes(`${formId}:j_idt`) || (!hasZipIcon && !hasDescargarText)) {
      return [];
    }
    const match = onclick.match(new RegExp(`${formId}:j_idt\\d+`, "i"));
    return match?.[0] ? [match[0]] : [];
  });

  const fallbackMatches = [...content.matchAll(new RegExp(`RichFaces\\.ajax\\((?:&quot;|\\")(${formId}:j_idt\\d+)(?:&quot;|\\")`, "ig"))]
    .map((m) => m[1]);

  return Array.from(new Set([...candidates, ...fallbackMatches]));
}

function inferBulkSubmitFieldsFromContent(content: string, formId: string): string[] {
  const matches = Array.from(content.matchAll(new RegExp(`${formId}:j_idt\\d+`, "ig"))).map((match) => match[0]);
  const unique = Array.from(new Set(matches));
  const preferred = unique.filter((field) => field.endsWith(":j_idt422") || field.endsWith(":j_idt528"));
  return preferred.length > 0 ? [...preferred, ...unique] : unique;
}

function hasFieldInContent(content: string, formId: string, field: string | undefined): boolean {
  if (!field) {
    return false;
  }
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`(^|[^\\w:])${escaped}([^\\w:]|$)`, "i").test(content)) {
    return true;
  }
  const dynamic = field.match(new RegExp(`${formId}:j_idt\\d+`, "i"))?.[0];
  if (!dynamic) {
    return false;
  }
  return content.toLowerCase().includes(dynamic.toLowerCase());
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
