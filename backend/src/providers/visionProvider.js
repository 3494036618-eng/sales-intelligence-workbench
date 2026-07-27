import { createEnvReader } from "../config/runtimeEnv.js";
import { providerFailure, providerSuccess } from "./providerResult.js";

const DEFAULT_BASE_URL = "https://ark.cn-beijing.volces.com/api/plan/v3";
const DEFAULT_MODEL = "doubao-seedream-5.0-lite";
const DEFAULT_TIMEOUT_MS = 60000;

function enabled(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").toLowerCase());
}

function truncate(text, maxLength = 12000) {
  const value = String(text || "");
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function normalizeError(payload) {
  const error = payload?.error || payload?.ResponseMetadata?.Error || payload?.Error || null;
  if (!error) return null;
  return {
    code: error.code || error.Code || "provider_error",
    message: error.message || error.Message || "Vision provider returned an error.",
  };
}

function firstImage(payload) {
  const candidates = [
    ...(Array.isArray(payload?.data) ? payload.data : []),
    ...(Array.isArray(payload?.result?.data) ? payload.result.data : []),
    ...(Array.isArray(payload?.images) ? payload.images : []),
  ];
  const found = candidates.find((item) => item?.url || item?.image_url || item?.b64_json || item?.base64);
  if (!found) return {};
  return {
    image_url: found.url || found.image_url || null,
    b64_json: found.b64_json || found.base64 || null,
  };
}

export class VisionProvider {
  constructor(options = {}) {
    this.env = options.env || createEnvReader();
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
  }

  get apiKey() {
    return this.env.value("VISION_API_KEY")
      || this.env.value("MODEL_API_KEY")
      || this.env.value("AGENT_PLAN_API_KEY")
      || this.env.value("ARK_API_KEY");
  }

  get baseUrl() {
    return this.env.value("VISION_BASE_URL", DEFAULT_BASE_URL).replace(/\/$/, "");
  }

  get imageModel() {
    return this.env.value("VISION_IMAGE_MODEL", DEFAULT_MODEL);
  }

  get imageSize() {
    return this.env.value("VISION_IMAGE_SIZE", "1920x1920");
  }

  get timeoutMs() {
    return this.env.number("VISION_TIMEOUT_MS", DEFAULT_TIMEOUT_MS);
  }

  isConfigured() {
    return Boolean(this.apiKey && this.baseUrl && this.imageModel);
  }

  isRunEnabled() {
    return this.isConfigured() && enabled(this.env.value("VISION_RUN_ENABLED", "false"));
  }

  buildVisualPrompt({ scope, object, confirmedCards = [], sources = [], visualType = "evidence_board" }) {
    const changeTitles = confirmedCards.slice(0, 4).map((card) => card.title).filter(Boolean).join("; ");
    const sourceTypes = [...new Set(sources.slice(0, 6).map((source) => source.type || source.provider).filter(Boolean))].join(", ");
    const typeLabel = visualType === "executive_cover" ? "executive briefing cover" : "competitive intelligence evidence board";
    return [
      `Create a premium ${typeLabel} for an enterprise SaaS competitive-change monitoring product.`,
      "Visual style: clean professional intelligence brief, strong focal point, layered evidence cards, subtle radar lines, source markers, modern blue/violet/cyan accents, high quality editorial composition.",
      `Business context: scope ${scope?.name || "competitive tracking"}, object ${object?.object_type || "company/product"} monitoring.`,
      changeTitles ? `Represent these confirmed change themes abstractly without writing exact text: ${changeTitles}.` : "",
      sourceTypes ? `Use abstract evidence motifs for source types: ${sourceTypes}.` : "",
      "Do not include real logos, real people, trademark-like marks, tiny unreadable text, fake charts with precise numbers, or fabricated company names.",
      "Leave clean negative space for an accurate text overlay added later by the application.",
    ].filter(Boolean).join("\n");
  }

  async generateVisualBrief(input) {
    if (!this.isConfigured()) {
      return providerFailure("vision", { code: "missing_config", message: "AGENT_PLAN_API_KEY, VISION_BASE_URL or VISION_IMAGE_MODEL is not configured." });
    }

    const prompt = input.prompt || this.buildVisualPrompt(input);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const startedAt = Date.now();
    let response;
    let payload;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/images/generations`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.imageModel,
          prompt,
          size: input.size || this.imageSize,
        }),
        signal: controller.signal,
      });
      const text = await response.text();
      payload = text ? JSON.parse(text) : {};
    } catch (error) {
      return providerFailure("vision", {
          code: error.name === "AbortError" ? "timeout" : "network_error",
          message: error.name === "AbortError" ? "vision request timed out." : error.message,
      }, {
        latency_ms: Date.now() - startedAt,
      });
    } finally {
      clearTimeout(timeout);
    }

    const providerError = normalizeError(payload);
    const requestId = payload?.id || payload?.ResponseMetadata?.RequestId || null;
    if (!response.ok || providerError) {
      return providerFailure("vision", providerError || { code: "http_error", message: `HTTP ${response.status}` }, {
        http_status: response.status,
        request_id: requestId,
        raw_ref: requestId ? `vision:${requestId}` : null,
        latency_ms: Date.now() - startedAt,
      });
    }

    const image = firstImage(payload);
    if (!image.image_url && !image.b64_json) {
      return providerFailure("vision", { code: "missing_image", message: "Vision provider returned no image URL or base64 image." }, {
        request_id: requestId,
        raw_ref: requestId ? `vision:${requestId}` : null,
        latency_ms: Date.now() - startedAt,
      });
    }

    return providerSuccess("vision", {
      model: this.imageModel,
      request_id: requestId,
      raw_ref: requestId ? `vision:${requestId}` : "vision:images/generations",
      image_url: image.image_url,
      b64_json: image.b64_json,
      prompt_summary: truncate(prompt, 600),
      latency_ms: Date.now() - startedAt,
    });
  }
}

export function createVisionProvider(options = {}) {
  return new VisionProvider(options);
}
