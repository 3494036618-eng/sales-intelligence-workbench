import { HttpError } from "../utils/http.js";
import { makeId } from "../utils/ids.js";
import { nowIso } from "../utils/time.js";

export class DemoService {
  constructor(repository, providers, options = {}) {
    this.repository = repository;
    this.providers = providers;
    this.getProviderStatusSnapshot = options.getProviderStatus || (() => ({}));
    this.webSearchProvider = options.webSearchProvider || null;
    this.modelProvider = options.modelProvider || null;
    this.dataProProvider = options.dataProProvider || null;
    this.openVikingProvider = options.openVikingProvider || null;
    this.supabaseProvider = options.supabaseProvider || null;
    this.supabaseDataProvider = options.supabaseDataProvider || null;
    this.visionProvider = options.visionProvider || null;
  }

  requireScope(scopeId) {
    const scope = this.repository.getScope(scopeId);
    if (!scope) throw new HttpError(404, "scope_not_found", "Scope was not found.", { scope_id: scopeId });
    return scope;
  }

  requireObject(scopeId, objectId) {
    this.requireScope(scopeId);
    if (!this.repository.hasObject(scopeId, objectId)) {
      throw new HttpError(404, "object_not_found", "Tracked object was not found.", { scope_id: scopeId, object_id: objectId });
    }
    const object = this.repository.getCatalogObject(objectId);
    if (!object) throw new HttpError(404, "object_not_found", "Object was not found.", { object_id: objectId });
    return object;
  }

  listScopes() {
    return this.repository.listScopes();
  }

  createScope(body) {
    const name = String(body.name || "").trim();
    if (!name) throw new HttpError(400, "bad_request", "Scope name is required.");
    return this.repository.createScope({ name, description: body.description });
  }

  getScope(scopeId) {
    return this.requireScope(scopeId);
  }

  getScopeStats(scopeId) {
    this.requireScope(scopeId);
    return this.repository.getScopeStats(scopeId);
  }

  getProviderStatus() {
    return this.getProviderStatusSnapshot();
  }

  async probeWebSearch(body) {
    if (!this.webSearchProvider) throw new HttpError(500, "provider_unavailable", "Web search provider is not available.");
    const query = String(body.query || "").trim();
    if (!query) throw new HttpError(400, "bad_request", "query is required.");
    const result = await this.webSearchProvider.search({
      query,
      count: body.count,
      search_type: body.search_type,
      time_range: body.time_range,
      auth_level: body.auth_level,
      need_summary: body.need_summary,
    });
    if (!result.ok) {
      const status = result.error?.code === "missing_config" ? 503 : 502;
      throw new HttpError(status, result.error?.code || "provider_error", result.error?.message || "Web search probe failed.", {
        provider: "web_search",
        request_id: result.request_id || null,
      });
    }
    return result;
  }

  async probeDataPro(body = {}) {
    if (!this.dataProProvider) throw new HttpError(500, "provider_unavailable", "DataPro provider is not available.");
    const query = String(body.query || "灵犀影像科技有限公司 企业工商信息").trim();
    if (!query) throw new HttpError(400, "bad_request", "query is required.");
    const result = await this.dataProProvider.callTool(query);
    if (!result.ok) {
      const status = result.error?.code === "missing_config" ? 503 : 502;
      throw new HttpError(status, result.error?.code || "provider_error", result.error?.message || "DataPro probe failed.", {
        provider: "datapro",
        request_id: result.request_id || null,
      });
    }
    return result;
  }

  async probeModel(body = {}) {
    if (!this.modelProvider) throw new HttpError(500, "provider_unavailable", "Model provider is not available.");
    const object = body.object || {
      id: "model-probe-object",
      name: "模型连通性测试对象",
      object_type: "product",
      summary: "用于验证模型 Harness 是否能返回结构化 JSON。",
      baseline: [{
        id: "model-probe-baseline",
        dimension: "公开来源",
        title: "公开来源",
        value: "历史基线未记录本次探针来源。",
        source_ids: [],
      }],
    };
    const sources = Array.isArray(body.sources) && body.sources.length
      ? body.sources
      : [{
        id: "model-probe-source",
        type: "探针来源",
        label: "模型 Harness 探针来源",
        url: "https://example.com/model-probe",
        summary: "这是一次模型连通性探针，用于验证结构化变化卡输出。",
        provider: "manual",
        provider_mode: "real",
      }];
    const result = await this.modelProvider.generateChangeCards({ object, sources });
    if (!result.ok) {
      const status = result.error?.code === "missing_config" ? 503 : 502;
      throw new HttpError(status, result.error?.code || "provider_error", result.error?.message || "Model probe failed.", {
        provider: "model",
        request_id: result.request_id || null,
      });
    }
    return result;
  }

  async probeVision(body = {}) {
    if (!this.visionProvider) throw new HttpError(500, "provider_unavailable", "Vision provider is not available.");
    if (!body.execute) {
      return {
        ok: this.visionProvider.isConfigured(),
        provider: "vision",
        provider_mode: "real",
        dry_run: true,
        configured: this.visionProvider.isConfigured(),
        run_enabled: this.visionProvider.isRunEnabled(),
        model: this.visionProvider.imageModel,
        message: "Vision provider is configured. Pass execute=true to generate one real image.",
      };
    }

    const result = await this.visionProvider.generateVisualBrief({
      prompt: body.prompt,
      visualType: body.visual_type || "executive_cover",
      size: body.size,
      scope: { name: "视觉模型探针" },
      object: { object_type: "product" },
      confirmedCards: [{ title: "确认变化视觉探针" }],
      sources: [{ type: "探针来源" }],
    });
    if (!result.ok) {
      const status = result.error?.code === "missing_config" ? 503 : 502;
      throw new HttpError(status, result.error?.code || "provider_error", result.error?.message || "Vision probe failed.", {
        provider: "vision",
        request_id: result.request_id || null,
      });
    }
    return result;
  }

  async probeOpenViking(body = {}) {
    if (!this.openVikingProvider) throw new HttpError(500, "provider_unavailable", "OpenViking provider is not available.");
    const query = String(body.query || "").trim();
    const result = query
      ? await this.openVikingProvider.findMemories(query, { limit: body.limit })
      : await this.openVikingProvider.health();
    if (!result.ok) {
      const status = result.error?.code === "missing_config" ? 503 : 502;
      throw new HttpError(status, result.error?.code || "provider_error", result.error?.message || "OpenViking probe failed.", {
        provider: "openviking",
      });
    }
    return result;
  }

  async probeSupabase() {
    const provider = this.supabaseDataProvider?.isConfigured?.()
      ? this.supabaseDataProvider
      : this.supabaseProvider;
    if (!provider) throw new HttpError(500, "provider_unavailable", "Supabase provider is not available.");
    let result;
    try {
      result = await provider.probe();
    } catch (error) {
      throw new HttpError(502, error.code || "provider_error", error.message || "Supabase probe failed.", {
        provider: "supabase",
      });
    }
    if (!result.ok) {
      const status = result.error?.code === "missing_config" ? 503 : 502;
      throw new HttpError(status, result.error?.code || "provider_error", result.error?.message || "Supabase probe failed.", {
        provider: "supabase",
      });
    }
    return result;
  }

  listObjects(scopeId) {
    this.requireScope(scopeId);
    return this.repository.listObjects(scopeId);
  }

  getObject(scopeId, objectId) {
    this.requireObject(scopeId, objectId);
    return this.repository.objectDetail(scopeId, objectId);
  }

  discoverObjects(scopeId, body) {
    this.requireScope(scopeId);
    const query = String(body.query || "").trim();
    const mode = body.mode || "broad";
    if (!["broad", "exact"].includes(mode)) throw new HttpError(400, "bad_request", "mode must be broad or exact.");
    const candidates = this.providers.discovery.discoverObjects(this.repository, scopeId, query, mode);
    if (candidates.length) return this.repository.setCandidates(scopeId, candidates);
    const custom = this.createCustomCandidate(scopeId, query, mode);
    return this.repository.setCandidates(scopeId, custom ? [custom] : []);
  }

  createCustomCandidate(scopeId, query, mode) {
    const name = String(query || "").trim();
    if (!name) return null;
    const objectType = this.inferObjectType(name, mode);
    const object = this.repository.createCustomObject({
      name,
      object_type: objectType,
      summary: objectType === "company"
        ? "用户输入的公司对象。加入追踪后，运行时会调用 DataPro 和联网搜索补充证据。"
        : "用户输入的产品或主题对象。加入追踪后，运行时会调用联网搜索补充公开证据。",
      primary_source: objectType === "company" ? "专业数据集" : "公开来源",
    });
    if (!object) return null;
    return {
      ...this.repository.objectSummary(scopeId, object.id),
      reason: objectType === "company"
        ? "未命中内置候选，已创建动态公司对象；运行时会先核验专业数据。"
        : "未命中内置候选，已创建动态产品对象；运行时会先搜索公开来源。",
      tracked: this.repository.hasObject(scopeId, object.id),
    };
  }

  inferObjectType(query, mode) {
    const text = String(query || "").toLowerCase();
    if (/公司|集团|有限|股份|科技|inc\.?|corp\.?|ltd\.?|llc|co\./i.test(text)) return "company";
    return mode === "exact" && /企业|主体|工商|法人/.test(text) ? "company" : "product";
  }

  getCandidates(scopeId) {
    this.requireScope(scopeId);
    return this.repository.getCandidates(scopeId);
  }

  addObject(scopeId, body) {
    this.requireScope(scopeId);
    const objectId = String(body.object_id || "").trim();
    if (!objectId) throw new HttpError(400, "bad_request", "object_id is required.");
    if (!this.repository.getCatalogObject(objectId)) throw new HttpError(404, "object_not_found", "Object was not found.", { object_id: objectId });
    if (this.repository.hasObject(scopeId, objectId)) throw new HttpError(409, "already_exists", "Object is already tracked.", { scope_id: scopeId, object_id: objectId });
    return this.repository.addObject(scopeId, objectId);
  }

  async runObject(scopeId, objectId) {
    const object = this.requireObject(scopeId, objectId);
    const runId = makeId("run");
    const startedAt = nowIso();
    const dataCollection = await this.queryStructuredFacts(scopeId, object, runId);
    const dataEvidence = dataCollection.evidence;
    const sourceCollection = await this.collectPublicSources(scopeId, object, runId);
    const publicSourceEvidence = sourceCollection.evidence;
    const mergedEvidence = this.mergeEvidence(dataEvidence, publicSourceEvidence);
    const cardGeneration = await this.generateChangeCards(scopeId, object, runId, mergedEvidence);
    const cards = cardGeneration.cards;
    const finishedAt = nowIso();
    const steps = [
      this.step(runId, "read_baseline", "读取基线", `读取到 ${object.baseline.length} 条历史基线。`, startedAt),
      this.step(runId, "query_structured_facts", object.object_type === "company" ? "查询专业数据" : "查询公开来源", dataEvidence.summary, startedAt, dataCollection.stepOptions),
      this.step(runId, "collect_public_sources", "搜索公开来源", publicSourceEvidence.summary, startedAt, sourceCollection.stepOptions),
      this.step(runId, "generate_change_cards", "生成变化卡", cardGeneration.summary, startedAt, cardGeneration.stepOptions),
    ];
    const traces = [
      ...dataCollection.traces,
      ...sourceCollection.traces,
      ...cardGeneration.traces,
    ];
    const providerMode = dataEvidence.provider_mode === "real" || mergedEvidence.provider_mode === "real" || cardGeneration.provider_mode === "real" || cardGeneration.provider_mode === "mixed" ? "mixed" : "mock";
    const runRecord = {
      id: runId,
      scope_id: scopeId,
      object_id: objectId,
      status: "ready",
      mode: "manual",
      provider: providerMode === "mixed" ? "fixture+datapro+web_search+model" : "fixture",
      provider_mode: providerMode,
      started_at: startedAt,
      finished_at: finishedAt,
      error_message: null,
      steps,
      cards,
      traces,
    };
    const runView = this.repository.addRun(scopeId, runRecord);
    const syncRecord = await this.syncRunSnapshot(scopeId, runRecord);
    if (syncRecord) runView.sync_record = syncRecord;
    return runView;
  }

  async syncRunSnapshot(scopeId, runRecord) {
    const baseRecord = {
      id: makeId("sync"),
      scope_id: scopeId,
      object_id: runRecord.object_id,
      run_id: runRecord.id,
      provider: "supabase",
      provider_mode: "real",
      status: "skipped",
      raw_ref: null,
      summary: "Supabase 同步未启用。",
      created_at: nowIso(),
    };

    if (!this.supabaseProvider?.isRunEnabled?.()) return this.repository.addSyncRecord(scopeId, baseRecord);

    const result = await this.supabaseProvider.syncRunSnapshot(runRecord);
    const status = result.ok ? "ready" : (result.skipped ? "skipped" : "failed");
    const summary = result.ok
      ? "运行快照已同步到 Supabase。"
      : `Supabase 同步失败：${result.error?.code || "provider_error"}`;
    return this.repository.addSyncRecord(scopeId, {
      ...baseRecord,
      status,
      raw_ref: result.raw_ref || null,
      summary,
      latency_ms: result.latency_ms || 0,
      error_code: result.ok ? null : result.error?.code || "provider_error",
    });
  }

  async queryStructuredFacts(scopeId, object, runId) {
    const fixtureEvidence = this.providers.data.queryStructuredFacts(object);
    if (object.object_type !== "company") {
      return {
        evidence: fixtureEvidence,
        stepOptions: {},
        traces: [
          this.trace(runId, "fixture", "mockDataProvider.queryStructuredFacts", `object=${object.name}`, fixtureEvidence.summary, `fixture:objects.${object.id}.source_ids`),
        ],
      };
    }

    if (!this.dataProProvider?.isRunEnabled?.()) {
      return {
        evidence: fixtureEvidence,
        stepOptions: {},
        traces: [
          this.trace(runId, "fixture", "mockDataProvider.queryStructuredFacts", `object=${object.name}`, fixtureEvidence.summary, `fixture:objects.${object.id}.source_ids`),
        ],
      };
    }

    const result = await this.dataProProvider.queryCompanyFacts(object);
    if (!result.ok) {
      const summary = `DataPro 查询失败，已保留 fixture 专业数据。错误：${result.error?.code || "provider_error"}`;
      return {
        evidence: {
          ...fixtureEvidence,
          provider: "fixture+datapro",
          provider_mode: "mock",
          summary,
        },
        stepOptions: { provider: "fixture+datapro", provider_mode: "mock" },
        traces: [
          this.trace(runId, "datapro", "dataProProvider.queryCompanyFacts", `object=${object.name}`, summary, result.raw_ref || null, {
            provider_mode: "real",
            status: "failed",
            latency_ms: result.latency_ms || 0,
            trace_id: result.request_id || `datapro-${runId}-failed`,
          }),
          this.trace(runId, "fixture", "mockDataProvider.queryStructuredFacts", `object=${object.name}`, fixtureEvidence.summary, `fixture:objects.${object.id}.source_ids`),
        ],
      };
    }

    const savedSources = this.repository.addObjectSources(scopeId, object.id, this.dataProResultToSources(object, result));
    const sourceIds = savedSources.map((source) => source.id);
    const summary = sourceIds.length
      ? `DataPro 返回 ${sourceIds.length} 条专业数据来源，已保存到对象来源；后续交给模型生成候选变化卡。`
      : "DataPro 查询成功但未保存到可用来源；后续不会基于空专业数据生成确定变化。";
    return {
      evidence: {
        provider: "datapro",
        provider_mode: "real",
        evidence: sourceIds,
        raw_ref: result.raw_ref,
        summary,
      },
      stepOptions: { provider: "datapro", provider_mode: "real" },
      traces: [
        this.trace(runId, "datapro", "dataProProvider.queryCompanyFacts", `object=${object.name}`, summary, result.raw_ref, {
          provider_mode: "real",
          latency_ms: result.latency_ms,
          trace_id: result.request_id || `datapro-${runId}`,
        }),
      ],
    };
  }

  mergeEvidence(...items) {
    const realItems = items.filter((item) => item?.provider_mode === "real");
    if (!realItems.length) return items.find(Boolean);
    const evidence = [...new Set(realItems.flatMap((item) => item.evidence || []))];
    return {
      provider: realItems.map((item) => item.provider).join("+"),
      provider_mode: "real",
      evidence,
      summary: realItems.map((item) => item.summary).filter(Boolean).join(" "),
      raw_ref: realItems.map((item) => item.raw_ref).filter(Boolean).join(",") || null,
    };
  }

  dataProResultToSources(object, result) {
    const now = nowIso();
    const label = `${object.name} DataPro 专业数据`;
    return [{
      id: makeId("src_datapro"),
      type: "专业数据集",
      label,
      url: result.raw_ref || `datapro://${encodeURIComponent(object.name)}`,
      snippet: result.summary,
      summary: result.summary,
      provider: "datapro",
      provider_mode: "real",
      raw_ref: result.raw_ref,
      retrieved_at: now,
      credibility: "high",
      source_meta: {
        request_id: result.request_id || null,
        query: result.query,
      },
      created_at: now,
      updated_at: now,
    }];
  }

  async generateChangeCards(scopeId, object, runId, sourceEvidence) {
    const realSourceIds = sourceEvidence.provider_mode === "real" ? sourceEvidence.evidence || [] : [];
    const modelSources = this.repository.sourceList(scopeId, object.id, realSourceIds);

    if (this.modelProvider?.isRunEnabled?.() && modelSources.length) {
      const result = await this.modelProvider.generateChangeCards({ object, sources: modelSources });
      if (result.ok && result.cards.length) {
        return {
          cards: result.cards.map((card) => this.cardFromModel(scopeId, object, runId, card, result.raw_ref)),
          summary: `模型基于 ${modelSources.length} 条真实来源生成 ${result.cards.length} 条候选变化卡。`,
          provider_mode: "real",
          stepOptions: { provider: "model", provider_mode: "real" },
          traces: [
            this.trace(runId, "model", "modelProvider.generateChangeCards", `sources=${realSourceIds.join(",")}`, `${result.cards.length} cards`, result.raw_ref, {
              provider_mode: "real",
              latency_ms: result.latency_ms,
              trace_id: result.request_id || `model-${runId}`,
            }),
          ],
        };
      }

      const reason = result.ok ? "模型未产出通过校验的确定变化卡" : `模型输出未通过校验：${result.error?.code || "provider_error"}`;
      return {
        cards: this.buildEvidenceCandidateCards(scopeId, object, runId, modelSources, result.raw_ref || sourceEvidence.raw_ref),
        summary: `${reason}，已基于真实来源生成待核验候选卡。`,
        provider_mode: "mixed",
        stepOptions: { provider: "model+rule", provider_mode: "mixed" },
        traces: [
          this.trace(runId, "model", "modelProvider.generateChangeCards", `sources=${realSourceIds.join(",")}`, reason, result.raw_ref || null, {
            provider_mode: "real",
            status: result.ok ? "ready" : "failed",
            latency_ms: result.latency_ms || 0,
            trace_id: result.request_id || `model-${runId}-fallback`,
          }),
          this.trace(runId, "rule", "evidenceCandidate.generateChangeCards", `sources=${realSourceIds.join(",")}`, "1 evidence candidate card", sourceEvidence.raw_ref || null, {
            provider_mode: "mixed",
            trace_id: `rule-${runId}-evidence-candidate`,
          }),
        ],
      };
    }

    if (modelSources.length) {
      return {
        cards: this.buildEvidenceCandidateCards(scopeId, object, runId, modelSources, sourceEvidence.raw_ref),
        summary: "模型主流程未启用，已基于真实来源生成待核验候选卡。",
        provider_mode: "mixed",
        stepOptions: { provider: "rule", provider_mode: "mixed" },
        traces: [
          this.trace(runId, "rule", "evidenceCandidate.generateChangeCards", `sources=${realSourceIds.join(",")}`, "1 evidence candidate card", sourceEvidence.raw_ref || null, {
            provider_mode: "mixed",
            trace_id: `rule-${runId}-evidence-candidate`,
          }),
        ],
      };
    }

    const cards = this.providers.agent.generateChangeCards(scopeId, object, runId, this.repository);
    return {
      cards,
      summary: cards.length ? `${cards.length} 条 fixture 候选` : "未发现可核验变化",
      provider_mode: "mock",
      stepOptions: {},
      traces: [
        this.trace(runId, "fixture", "mockAgentProvider.generateChangeCards", `object=${object.name}`, cards.length ? `${cards.length} cards` : "0 cards", `fixture:objects.${object.id}.planned_cards`),
      ],
    };
  }

  cardFromModel(scopeId, object, runId, card, rawRef) {
    const now = nowIso();
    return {
      id: makeId("card_model"),
      run_id: runId,
      scope_id: scopeId,
      object_id: object.id,
      dimension: card.dimension,
      title: card.title,
      before: card.before,
      after: card.after,
      source_ids: card.source_ids,
      confidence: card.confidence,
      status: "pending",
      provider: "model",
      provider_mode: "real",
      raw_ref: rawRef,
      created_at: now,
      updated_at: now,
    };
  }

  buildEvidenceCandidateCards(scopeId, object, runId, sources, rawRef) {
    const now = nowIso();
    const source = sources[0];
    if (!source) return [];
    const baseline = object.baseline?.[0];
    return [{
      id: makeId("card_evidence"),
      run_id: runId,
      scope_id: scopeId,
      object_id: object.id,
      dimension: source.type || baseline?.dimension || "公开来源",
      title: `发现 ${object.name} 的公开来源候选`,
      before: baseline?.value || "历史基线未记录该公开来源候选。",
      after: `真实来源「${source.label}」与该对象相关，建议人工核验是否构成变化。`,
      source_ids: [source.id],
      confidence: "低",
      status: "pending",
      provider: "rule",
      provider_mode: "mixed",
      raw_ref: rawRef || source.raw_ref || null,
      created_at: now,
      updated_at: now,
    }];
  }

  async collectPublicSources(scopeId, object, runId) {
    const fixtureEvidence = this.providers.source.collectSources(object);
    if (!this.webSearchProvider?.isRunEnabled?.()) {
      return {
        evidence: fixtureEvidence,
        stepOptions: {},
        traces: [
          this.trace(runId, "fixture", "mockSourceProvider.collectSources", `object=${object.name}`, fixtureEvidence.summary, `fixture:objects.${object.id}.source_ids`),
        ],
      };
    }

    const query = this.buildWebSearchQuery(object);
    const searchResult = await this.webSearchProvider.search({
      query,
      count: 1,
      need_summary: true,
    });

    if (!searchResult.ok) {
      const outputSummary = `真实联网搜索失败，已保留 fixture 来源。错误：${searchResult.error?.code || "provider_error"}`;
      return {
        evidence: {
          ...fixtureEvidence,
          provider: "fixture+web_search",
          provider_mode: "mock",
          summary: outputSummary,
        },
        stepOptions: { provider: "fixture+web_search", provider_mode: "mock", status: "ready" },
        traces: [
          this.trace(runId, "web_search", "webSearchProvider.search", `query=${query}`, outputSummary, searchResult.raw_ref || null, {
            provider_mode: "real",
            status: "failed",
            latency_ms: searchResult.latency_ms || 0,
            trace_id: searchResult.request_id || `web_search-${runId}-failed`,
          }),
          this.trace(runId, "fixture", "mockSourceProvider.collectSources", `object=${object.name}`, fixtureEvidence.summary, `fixture:objects.${object.id}.source_ids`),
        ],
      };
    }

    const savedSources = this.repository.addObjectSources(scopeId, object.id, this.webResultsToSources(object, searchResult));
    const sourceIds = savedSources.map((source) => source.id);
    const outputSummary = sourceIds.length
      ? `真实联网搜索返回 ${sourceIds.length} 条候选来源，已保存到对象来源；后续交给模型或规则生成候选变化卡。`
      : "真实联网搜索未返回可保存来源；后续不会基于空来源生成确定变化。";

    return {
      evidence: {
        provider: "web_search",
        provider_mode: "real",
        evidence: sourceIds,
        summary: outputSummary,
      },
      stepOptions: { provider: "web_search", provider_mode: "real" },
      traces: [
        this.trace(runId, "web_search", "webSearchProvider.search", `query=${query}`, outputSummary, searchResult.raw_ref, {
          provider_mode: "real",
          latency_ms: searchResult.latency_ms,
          trace_id: searchResult.request_id || searchResult.log_id || `web_search-${runId}`,
        }),
      ],
    };
  }

  buildWebSearchQuery(object) {
    const baselineHint = (object.baseline || [])
      .slice(0, 2)
      .map((item) => item.title || item.dimension)
      .filter(Boolean)
      .join(" ");
    return [object.name, baselineHint || object.summary].filter(Boolean).join(" ").slice(0, 100).trim();
  }

  webResultsToSources(object, searchResult) {
    const now = nowIso();
    return (searchResult.results || [])
      .filter((result) => result.url || result.title)
      .slice(0, 3)
      .map((result, index) => ({
        id: makeId("src_web"),
        type: "联网搜索",
        label: result.title || result.url || `${object.name} 搜索结果 ${index + 1}`,
        url: result.url || "",
        snippet: result.snippet || null,
        summary: result.summary || null,
        provider: "web_search",
        provider_mode: "real",
        raw_ref: searchResult.raw_ref,
        retrieved_at: now,
        credibility: result.auth_level === 1 ? "high" : "medium",
        source_meta: {
          request_id: searchResult.request_id || null,
          log_id: searchResult.log_id || null,
          query: searchResult.query,
          sort_id: result.sort_id,
          site_name: result.site_name,
          publish_time: result.publish_time,
          rank_score: result.rank_score,
          auth_description: result.auth_description,
          auth_level: result.auth_level,
        },
        created_at: now,
        updated_at: now,
      }));
  }

  step(runId, stepKey, label, summary, startedAt, options = {}) {
    return {
      id: makeId("step"),
      run_id: runId,
      step_key: stepKey,
      label,
      status: options.status || "ready",
      summary,
      provider: options.provider || "fixture",
      provider_mode: options.provider_mode || "mock",
      started_at: startedAt,
      finished_at: nowIso(),
    };
  }

  trace(runId, provider, toolName, inputSummary, outputSummary, rawRef, options = {}) {
    return {
      id: makeId("trace"),
      run_id: runId,
      provider,
      provider_mode: options.provider_mode || "mock",
      tool_name: toolName,
      input_summary: inputSummary,
      output_summary: outputSummary,
      raw_ref: rawRef,
      trace_id: options.trace_id || `${provider}-${runId}-${toolName.split(".").pop()}`,
      status: options.status || "ready",
      latency_ms: options.latency_ms ?? 20,
      created_at: nowIso(),
    };
  }

  getRun(runId) {
    const run = this.repository.getRun(runId);
    if (!run) throw new HttpError(404, "run_not_found", "Run was not found.", { run_id: runId });
    return run;
  }

  getRunTraces(runId) {
    const traces = this.repository.getRunTraces(runId);
    if (!traces) throw new HttpError(404, "run_not_found", "Run was not found.", { run_id: runId });
    return traces;
  }

  getRunCards(runId) {
    const cards = this.repository.getRunCards(runId);
    if (!cards) throw new HttpError(404, "run_not_found", "Run was not found.", { run_id: runId });
    return cards;
  }

  async saveCardAction(cardId, body) {
    const scopeId = String(body.scope_id || "").trim();
    const objectId = String(body.object_id || "").trim();
    const action = String(body.action || "").trim();
    if (!scopeId || !objectId || !action) throw new HttpError(400, "bad_request", "scope_id, object_id and action are required.");
    const object = this.requireObject(scopeId, objectId);
    if (!["confirm", "ignore", "insufficient"].includes(action)) throw new HttpError(422, "invalid_action", "Action is not supported.", { action });

    const { card } = this.repository.findLatestCard(scopeId, objectId, cardId);
    if (!card) throw new HttpError(404, "card_not_found", "Change card was not found.", { card_id: cardId });
    if (card.status !== "pending" && card.status !== "confirmed") {
      throw new HttpError(422, "invalid_action", "Card action is already final.", { card_id: cardId, status: card.status });
    }

    const statusMap = { confirm: "confirmed", ignore: "ignored", insufficient: "insufficient" };
    card.status = statusMap[action];
    card.updated_at = nowIso();
    const userAction = {
      id: makeId("act"),
      scope_id: scopeId,
      object_id: objectId,
      card_id: cardId,
      action_type: action,
      note: body.note || null,
      provider: "manual",
      provider_mode: "real",
      created_at: nowIso(),
    };
    let memoryRecord = null;
    if (action === "confirm") {
      this.repository.addConfirmedCard(scopeId, card);
      memoryRecord = await this.rememberConfirmedCard(scopeId, object, card, userAction);
    }
    this.repository.addAction(scopeId, userAction);
    return {
      object: this.repository.objectDetail(scopeId, objectId),
      action: userAction,
      memory_record: memoryRecord,
    };
  }

  async rememberConfirmedCard(scopeId, object, card, userAction) {
    const scope = this.repository.getScope(scopeId);
    const sources = this.repository.sourceList(scopeId, object.id, card.source_ids);
    const baseRecord = {
      id: makeId("mem"),
      scope_id: scopeId,
      object_id: object.id,
      card_id: card.id,
      action_id: userAction.id,
      provider: "openviking",
      provider_mode: "real",
      status: "skipped",
      raw_ref: null,
      summary: "OpenViking 写入未启用。",
      created_at: nowIso(),
    };

    if (!this.openVikingProvider?.isRunEnabled?.()) {
      userAction.memory_provider = "openviking";
      userAction.memory_status = "skipped";
      userAction.memory_ref = null;
      return this.repository.addMemoryRecord(scopeId, baseRecord);
    }

    const result = await this.openVikingProvider.rememberConfirmedCard({ scope, object, card, sources });
    const status = result.ok ? "ready" : (result.skipped ? "skipped" : "failed");
    const summary = result.ok ? result.summary : `OpenViking 写入失败：${result.error?.code || "provider_error"}`;
    const record = {
      ...baseRecord,
      status,
      raw_ref: result.raw_ref || null,
      summary,
      latency_ms: result.latency_ms || 0,
      error_code: result.ok ? null : result.error?.code || "provider_error",
    };
    userAction.memory_provider = "openviking";
    userAction.memory_status = status;
    userAction.memory_ref = record.raw_ref;
    return this.repository.addMemoryRecord(scopeId, record);
  }

  getMemory(scopeId, body = {}) {
    this.requireScope(scopeId);
    const objectId = String(body.object_id || "").trim();
    return {
      records: this.repository.getMemoryRecords(scopeId, objectId),
    };
  }

  getSyncRecords(scopeId, body = {}) {
    this.requireScope(scopeId);
    const objectId = String(body.object_id || "").trim();
    return {
      records: this.repository.getSyncRecords(scopeId, objectId),
    };
  }

  getAssets(scopeId) {
    this.requireScope(scopeId);
    return this.repository.getAssets(scopeId);
  }

  async generateAsset(scopeId, body) {
    this.requireScope(scopeId);
    const type = String(body.type || "").trim();
    if (!["report", "infographic"].includes(type)) throw new HttpError(400, "bad_request", "type must be report or infographic.");
    const objectId = body.object_id || "";
    const confirmed = this.repository.getConfirmedCards(scopeId, objectId);
    if (!confirmed.length) throw new HttpError(422, "no_confirmed_cards", "No confirmed change cards are available for asset generation.");
    if (type === "report") return this.generateReportAsset(scopeId, objectId, confirmed);
    return this.generateInfographicAsset(scopeId, objectId, confirmed, body);
  }

  assetContext(scopeId, objectId, confirmed) {
    const scope = this.repository.getScope(scopeId);
    const resolvedObjectId = objectId || confirmed[0].object_id;
    const object = this.requireObject(scopeId, resolvedObjectId);
    const sourceIds = [...new Set(confirmed.flatMap((card) => card.source_ids || []))];
    const sources = this.repository.sourceList(scopeId, resolvedObjectId, sourceIds);
    return { scope, object, sources, resolvedObjectId };
  }

  async generateReportAsset(scopeId, objectId, confirmed) {
    const { scope, object, sources, resolvedObjectId } = this.assetContext(scopeId, objectId, confirmed);
    const visualAsset = this.repository.getAssets(scopeId).find((asset) => asset.object_id === resolvedObjectId && asset.type === "infographic") || null;
    let provider = "rule";
    let providerMode = "mixed";
    let rawRef = "rule:asset.report";
    let contentJson = this.buildRuleReportContent(scope, object, confirmed, sources, visualAsset);

    if (this.modelProvider?.isRunEnabled?.()) {
      const result = await this.modelProvider.generateReport({ scope, object, cards: confirmed, sources, visualAsset });
      if (result.ok && result.content_json?.sections?.length) {
        provider = "model";
        providerMode = "real";
        rawRef = result.raw_ref || rawRef;
        contentJson = result.content_json;
      } else if (result.raw_ref || result.error) {
        provider = "model+rule";
        rawRef = result.raw_ref || rawRef;
        contentJson.generation_note = result.ok
          ? "模型报告未通过引用校验，已使用规则报告降级。"
          : `模型报告生成失败，已使用规则报告降级：${result.error?.code || "provider_error"}`;
      }
    }

    const asset = {
      id: makeId("asset_report"),
      scope_id: scopeId,
      object_id: resolvedObjectId,
      type: "report",
      title: `${scope.name}变化追踪报告`,
      status: "ready",
      source_card_ids: confirmed.map((card) => card.id),
      content_json: contentJson,
      provider,
      provider_mode: providerMode,
      raw_ref: rawRef,
      related_asset_ids: visualAsset ? [visualAsset.id] : [],
      created_at: nowIso(),
    };
    return this.repository.addAsset(scopeId, asset);
  }

  async generateInfographicAsset(scopeId, objectId, confirmed, body = {}) {
    const { scope, object, sources, resolvedObjectId } = this.assetContext(scopeId, objectId, confirmed);
    const visualType = body.visual_type || "evidence_board";
    let provider = "rule";
    let providerMode = "mixed";
    let rawRef = "rule:asset.infographic";
    let imageUrl = null;
    let b64Json = null;
    let contentJson = this.buildVisualBriefContent(scope, object, confirmed, sources, visualType);

    if (this.visionProvider?.isRunEnabled?.()) {
      const result = await this.visionProvider.generateVisualBrief({
        scope,
        object,
        confirmedCards: confirmed,
        sources,
        visualType,
        size: body.size,
      });
      if (result.ok) {
        provider = "vision";
        providerMode = "real";
        rawRef = result.raw_ref || rawRef;
        imageUrl = result.image_url || null;
        b64Json = result.b64_json || null;
        contentJson.prompt_summary = result.prompt_summary;
        contentJson.model = result.model;
      } else {
        provider = "vision+rule";
        rawRef = result.raw_ref || rawRef;
        const detail = result.error?.message ? `：${result.error.message}` : "";
        contentJson.generation_note = `视觉模型生成失败，已使用结构化视觉简报降级：${result.error?.code || "provider_error"}${detail}`;
      }
    }

    const asset = {
      id: makeId("asset_infographic"),
      scope_id: scopeId,
      object_id: resolvedObjectId,
      type: "infographic",
      title: `${object.name}视觉简报图`,
      status: "ready",
      source_card_ids: confirmed.map((card) => card.id),
      image_url: imageUrl,
      b64_json: b64Json,
      content_json: contentJson,
      provider,
      provider_mode: providerMode,
      raw_ref: rawRef,
      created_at: nowIso(),
    };
    return this.repository.addAsset(scopeId, asset);
  }

  buildRuleReportContent(scope, object, confirmed, sources, visualAsset) {
    return {
      summary: `${scope.name}已确认 ${confirmed.length} 条关于 ${object.name} 的变化，报告仅基于已确认变化和来源证据生成。`,
      sections: [
        {
          title: "关键变化",
          items: confirmed.map((card) => ({
            text: `${card.title}：${card.after}`,
            citation_card_ids: [card.id],
            citation_source_ids: [...card.source_ids],
          })),
        },
        {
          title: "证据来源",
          items: sources.slice(0, 6).map((source) => ({
            text: `${source.label || source.url} 支撑当前确认变化。`,
            citation_card_ids: confirmed.filter((card) => card.source_ids?.includes(source.id)).map((card) => card.id),
            citation_source_ids: [source.id],
          })),
        },
      ],
      risks: [{
        text: "该报告只覆盖当前已确认变化，不代表持续监控已经完成。",
        citation_card_ids: confirmed.slice(0, 1).map((card) => card.id),
        citation_source_ids: confirmed[0]?.source_ids || [],
      }],
      next_steps: ["继续运行对象获取新证据", "人工复核低置信度候选变化", "将确认结果同步到后续汇报材料"],
      related_visual_asset_id: visualAsset?.id || null,
    };
  }

  buildVisualBriefContent(scope, object, confirmed, sources, visualType) {
    return {
      visual_type: visualType,
      headline: `${object.name}竞争变化视觉简报`,
      subheadline: `${scope.name} · ${confirmed.length} 条已确认变化 · ${sources.length} 个来源`,
      overlay: {
        object_name: object.name,
        scope_name: scope.name,
        confirmed_count: confirmed.length,
        source_count: sources.length,
        highlights: confirmed.slice(0, 3).map((card) => ({
          title: card.title,
          dimension: card.dimension,
          confidence: card.confidence,
          citation_card_ids: [card.id],
          citation_source_ids: [...card.source_ids],
        })),
        source_labels: sources.slice(0, 5).map((source) => source.label || source.url || source.id),
      },
    };
  }

  legacyAsset(scopeId, type, objectId, confirmed) {
    const scope = this.repository.getScope(scopeId);
    const titleMap = { report: "变化追踪报告", infographic: "变化信息图" };
    const asset = {
      id: makeId(`asset_${type}`),
      scope_id: scopeId,
      object_id: objectId || confirmed[0].object_id,
      type,
      title: `${scope.name}${titleMap[type]}`,
      status: "ready",
      source_card_ids: confirmed.map((card) => card.id),
      content_json: { summary: "基于已确认变化生成。", sections: [] },
      provider: "fixture",
      provider_mode: "mock",
      raw_ref: `fixture:asset.${type}`,
      created_at: nowIso(),
    };
    return this.repository.addAsset(scopeId, asset);
  }

  getReport(assetId) {
    const report = this.repository.getReport(assetId);
    if (!report) throw new HttpError(404, "asset_not_found", "Report asset was not found.", { asset_id: assetId });
    return report;
  }

  getQa(scopeId) {
    this.requireScope(scopeId);
    return this.repository.getQa(scopeId);
  }

  async askQuestion(scopeId, body) {
    this.requireScope(scopeId);
    const question = String(body.question || "").trim();
    if (!question) throw new HttpError(400, "bad_request", "question is required.");
    const confirmed = this.repository.getConfirmedCards(scopeId);
    if (!confirmed.length) return this.repository.getQa(scopeId);
    const scope = this.repository.getScope(scopeId);
    const sourceIds = [...new Set(confirmed.flatMap((card) => card.source_ids || []))];
    const sources = sourceIds
      .map((sourceId) => this.repository.sourceView(scopeId, confirmed.find((card) => card.source_ids?.includes(sourceId))?.object_id || confirmed[0].object_id, sourceId))
      .filter(Boolean);
    const userMessage = {
      id: makeId("msg_u"),
      scope_id: scopeId,
      role: "user",
      text: question,
      citations: [],
      citation_card_ids: [],
      citation_source_ids: [],
      provider: "manual",
      provider_mode: "real",
      created_at: nowIso(),
    };
    let answer = this.buildRuleQaAnswer(question, confirmed, sources);
    let provider = "rule";
    let providerMode = "mixed";
    let rawRef = "rule:qa.answer";
    if (this.modelProvider?.isRunEnabled?.()) {
      const result = await this.modelProvider.generateQaAnswer({
        scope,
        question,
        cards: confirmed,
        sources,
        assets: this.repository.getAssets(scopeId),
        excerpts: this.repository.getQa(scopeId).excerpts,
      });
      if (result.ok && result.answer?.text && (result.answer.insufficient || result.answer.citation_card_ids.length || result.answer.citation_source_ids.length)) {
        answer = result.answer;
        provider = "model";
        providerMode = "real";
        rawRef = result.raw_ref || rawRef;
      } else {
        provider = "model+rule";
        rawRef = result.raw_ref || rawRef;
      }
    }
    const assistantMessage = {
      id: makeId("msg_a"),
      scope_id: scopeId,
      role: "assistant",
      text: answer.text,
      citations: answer.citations,
      citation_card_ids: answer.citation_card_ids,
      citation_source_ids: answer.citation_source_ids,
      provider,
      provider_mode: providerMode,
      raw_ref: rawRef,
      created_at: nowIso(),
    };
    this.repository.addQaMessage(scopeId, userMessage);
    this.repository.addQaMessage(scopeId, assistantMessage);
    return this.repository.getQa(scopeId);
  }

  buildRuleQaAnswer(question, confirmed, sources) {
    const first = confirmed[0];
    const citationSources = sources.filter((source) => first.source_ids?.includes(source.id));
    return {
      text: `基于当前已确认资料，可以看到：${first.title}。${first.after}。这个回答只引用当前范围内已确认的变化卡和来源证据；如果要回答更宽泛的问题，需要先运行对象补充证据。`,
      citations: citationSources.map((source) => source.label),
      citation_card_ids: [first.id],
      citation_source_ids: [...first.source_ids],
      insufficient: false,
    };
  }

  saveExcerpt(scopeId, body) {
    this.requireScope(scopeId);
    const messageId = String(body.message_id || "").trim();
    if (!messageId) throw new HttpError(400, "bad_request", "message_id is required.");
    const message = this.repository.findQaMessage(scopeId, messageId);
    if (!message || message.role !== "assistant") throw new HttpError(404, "message_not_found", "Assistant message was not found.", { message_id: messageId });
    const confirmed = this.repository.getConfirmedCards(scopeId);
    const excerpt = {
      id: makeId("excerpt"),
      scope_id: scopeId,
      type: "excerpt",
      title: "资料问答摘录",
      text: message.text,
      source_card_ids: confirmed.slice(0, 2).map((card) => card.id),
      status: "ready",
      provider: "manual",
      provider_mode: "real",
      created_at: nowIso(),
    };
    return this.repository.addExcerpt(scopeId, excerpt);
  }
}
