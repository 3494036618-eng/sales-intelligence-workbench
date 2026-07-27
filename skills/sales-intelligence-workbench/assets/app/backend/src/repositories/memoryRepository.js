import { seedData } from "../fixtures/demoData.js";
import { makeId } from "../utils/ids.js";
import { nowIso, nowLabel } from "../utils/time.js";

const clone = (value) => JSON.parse(JSON.stringify(value));

export class MemoryRepository {
  constructor(seed = seedData) {
    this.sources = clone(seed.sources);
    this.objects = clone(seed.objects);
    this.scopes = clone(seed.scopes);
    this.scopeState = clone(seed.scopeState);
    this.topicCandidates = clone(seed.topicCandidates);
  }

  ensureScopeState(scopeId) {
    if (!this.scopeState[scopeId]) {
      this.scopeState[scopeId] = {
        candidates: [],
        runs: [],
        confirmed_cards: [],
        actions: [],
        memory_records: [],
        sync_records: [],
        assets: [],
        qa_messages: [],
        excerpts: [],
      };
    }
    return this.scopeState[scopeId];
  }

  listScopes() {
    return this.scopes.map((scope) => this.scopeView(scope));
  }

  getScope(scopeId) {
    const scope = this.scopes.find((item) => item.id === scopeId);
    return scope ? this.scopeView(scope) : null;
  }

  getScopeRaw(scopeId) {
    return this.scopes.find((item) => item.id === scopeId) || null;
  }

  createScope({ name, description }) {
    const now = nowIso();
    const scope = {
      id: makeId("scope"),
      name,
      description: description || "新建范围，等待发现对象和建立档案。",
      object_ids: [],
      last_run_at: null,
      last_run_label: "尚未运行",
      is_demo: false,
      created_at: now,
      updated_at: now,
    };
    this.scopes.unshift(scope);
    this.ensureScopeState(scope.id);
    return this.scopeView(scope);
  }

  scopeView(scope) {
    return {
      id: scope.id,
      name: scope.name,
      description: scope.description,
      is_demo: scope.is_demo,
      last_run_at: scope.last_run_at,
      last_run_label: scope.last_run_label,
      stats: this.getScopeStats(scope.id),
      created_at: scope.created_at,
      updated_at: scope.updated_at,
    };
  }

  getScopeStats(scopeId) {
    const scope = this.getScopeRaw(scopeId);
    const state = this.ensureScopeState(scopeId);
    const objectIds = scope?.object_ids || [];
    const sources = new Set(objectIds.flatMap((objectId) => this.objects[objectId]?.source_ids || []));
    return {
      objects: objectIds.length,
      confirmed: state.confirmed_cards.length,
      assets: state.assets.length,
      sources: sources.size,
    };
  }

  getCatalogObject(objectId) {
    return this.objects[objectId] || null;
  }

  sourceView(scopeId, objectId, sourceId) {
    const source = this.sources[sourceId];
    if (!source) return null;
    const createdAt = source.created_at || "2026-06-13T00:00:00.000Z";
    const sourceType = String(source.type || "");
    return {
      ...clone(source),
      id: source.id || sourceId,
      scope_id: scopeId,
      object_id: objectId,
      provider: source.provider || "fixture",
      provider_mode: source.provider_mode || "mock",
      raw_ref: source.raw_ref || `fixture:sources.${sourceId}`,
      retrieved_at: source.retrieved_at || nowIso(),
      credibility: source.credibility || (sourceType.includes("数据库") ? "high" : "medium"),
      created_at: createdAt,
      updated_at: source.updated_at || createdAt,
    };
  }

  sourceList(scopeId, objectId, sourceIds) {
    return (sourceIds || []).map((id) => this.sourceView(scopeId, objectId, id)).filter(Boolean);
  }

  addObjectSources(scopeId, objectId, sources) {
    const object = this.getCatalogObject(objectId);
    if (!this.hasObject(scopeId, objectId) || !object) return [];
    const now = nowIso();
    const savedIds = [];
    for (const source of sources || []) {
      const existingId = source.url
        ? object.source_ids.find((id) => this.sources[id]?.url === source.url && this.sources[id]?.provider === source.provider)
        : null;
      const id = existingId || source.id || makeId("src");
      this.sources[id] = {
        ...clone(source),
        id,
        created_at: source.created_at || this.sources[id]?.created_at || now,
        updated_at: now,
      };
      if (!object.source_ids.includes(id)) object.source_ids.push(id);
      savedIds.push(id);
    }
    return this.sourceList(scopeId, objectId, savedIds);
  }

  objectSummary(scopeId, objectId) {
    const object = this.getCatalogObject(objectId);
    if (!object) return null;
    const state = this.ensureScopeState(scopeId);
    const latestRun = this.getLatestRun(scopeId, objectId);
    return {
      id: object.id,
      scope_id: scopeId,
      name: object.name,
      object_type: object.object_type,
      summary: object.summary,
      primary_source: object.primary_source,
      status: "active",
      source_ids: clone(object.source_ids),
      sources: this.sourceList(scopeId, object.id, object.source_ids),
      confirmed_count: state.confirmed_cards.filter((card) => card.object_id === objectId).length,
      asset_count: state.assets.filter((asset) => asset.object_id === objectId).length,
      run_status: latestRun?.status || "idle",
      created_at: "2026-06-13T00:00:00.000Z",
      updated_at: "2026-06-13T00:00:00.000Z",
    };
  }

  listObjects(scopeId) {
    const scope = this.getScopeRaw(scopeId);
    if (!scope) return null;
    return scope.object_ids.map((objectId) => this.objectSummary(scopeId, objectId)).filter(Boolean);
  }

  hasObject(scopeId, objectId) {
    const scope = this.getScopeRaw(scopeId);
    return Boolean(scope?.object_ids.includes(objectId));
  }

  addObject(scopeId, objectId) {
    const scope = this.getScopeRaw(scopeId);
    const object = this.getCatalogObject(objectId);
    if (!scope || !object) return null;
    if (!scope.object_ids.includes(objectId)) {
      scope.object_ids.push(objectId);
      scope.updated_at = nowIso();
    }
    const state = this.ensureScopeState(scopeId);
    state.candidates = state.candidates.map((candidate) => (candidate.id === objectId ? { ...candidate, tracked: true } : candidate));
    return this.objectDetail(scopeId, objectId);
  }

  baselineView(scopeId, objectId, baseline) {
    return {
      scope_id: scopeId,
      object_id: objectId,
      provider: "fixture",
      provider_mode: "mock",
      created_from_card_id: baseline.created_from_card_id || null,
      ...clone(baseline),
    };
  }

  cardView(scopeId, card) {
    return {
      ...clone(card),
      sources: this.sourceList(scopeId, card.object_id, card.source_ids),
    };
  }

  runView(run) {
    if (!run) return null;
    return {
      ...clone(run),
      traces: undefined,
      cards: run.cards.map((card) => this.cardView(run.scope_id, card)),
    };
  }

  objectDetail(scopeId, objectId) {
    const object = this.getCatalogObject(objectId);
    if (!object) return null;
    const state = this.ensureScopeState(scopeId);
    return {
      id: object.id,
      scope_id: scopeId,
      name: object.name,
      object_type: object.object_type,
      summary: object.summary,
      primary_source: object.primary_source,
      source_ids: clone(object.source_ids),
      sources: this.sourceList(scopeId, object.id, object.source_ids),
      baseline: object.baseline.map((baseline) => this.baselineView(scopeId, object.id, baseline)),
      run: this.runView(this.getLatestRun(scopeId, objectId)),
      confirmed_cards: state.confirmed_cards.filter((card) => card.object_id === objectId).map((card) => this.cardView(scopeId, card)),
      actions: clone(state.actions.filter((action) => action.object_id === objectId)),
      memory_records: clone((state.memory_records || []).filter((record) => record.object_id === objectId)),
      sync_records: clone((state.sync_records || []).filter((record) => record.object_id === objectId)),
      assets: clone(state.assets.filter((asset) => asset.object_id === objectId)),
      created_at: "2026-06-13T00:00:00.000Z",
      updated_at: "2026-06-13T00:00:00.000Z",
    };
  }

  setCandidates(scopeId, candidates) {
    const state = this.ensureScopeState(scopeId);
    state.candidates = clone(candidates);
    return this.getCandidates(scopeId);
  }

  getCandidates(scopeId) {
    return clone(this.ensureScopeState(scopeId).candidates);
  }

  getTopicCandidates(key) {
    return clone(this.topicCandidates[key] || []);
  }

  listCatalogObjects() {
    return Object.values(this.objects).map(clone);
  }

  createCustomObject({ name, object_type = "product", summary = "", primary_source = "" }) {
    const normalizedName = String(name || "").trim();
    if (!normalizedName) return null;
    const existing = Object.values(this.objects).find((object) => object.name === normalizedName);
    if (existing) return clone(existing);
    const id = makeId("obj_custom");
    const objectType = object_type === "company" ? "company" : "product";
    const object = {
      id,
      name: normalizedName,
      object_type: objectType,
      summary: summary || (objectType === "company" ? "用户输入的公司对象，等待专业数据和公开来源核验。" : "用户输入的产品或主题对象，等待公开来源核验。"),
      primary_source: primary_source || (objectType === "company" ? "专业数据集" : "公开来源"),
      source_ids: [],
      baseline: [],
      planned_cards: [],
      is_custom: true,
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    this.objects[id] = object;
    return clone(object);
  }

  addRun(scopeId, run) {
    const state = this.ensureScopeState(scopeId);
    state.runs.unshift(clone(run));
    const scope = this.getScopeRaw(scopeId);
    if (scope) {
      scope.last_run_at = run.finished_at || run.started_at;
      scope.last_run_label = nowLabel();
      scope.updated_at = nowIso();
    }
    return this.runView(run);
  }

  getRun(runId) {
    for (const [scopeId, state] of Object.entries(this.scopeState)) {
      const run = state.runs.find((item) => item.id === runId);
      if (run) return this.runView(run);
    }
    return null;
  }

  getRunRaw(runId) {
    for (const state of Object.values(this.scopeState)) {
      const run = state.runs.find((item) => item.id === runId);
      if (run) return run;
    }
    return null;
  }

  getLatestRun(scopeId, objectId) {
    const state = this.ensureScopeState(scopeId);
    return state.runs.find((run) => run.object_id === objectId) || null;
  }

  getRunTraces(runId) {
    const run = this.getRunRaw(runId);
    return run ? clone(run.traces || []) : null;
  }

  getRunCards(runId) {
    const run = this.getRunRaw(runId);
    return run ? run.cards.map((card) => this.cardView(run.scope_id, card)) : null;
  }

  findLatestCard(scopeId, objectId, cardId) {
    const run = this.getLatestRun(scopeId, objectId);
    const card = run?.cards.find((item) => item.id === cardId);
    return { run, card };
  }

  addAction(scopeId, action) {
    const state = this.ensureScopeState(scopeId);
    state.actions.unshift(clone(action));
    return clone(action);
  }

  addMemoryRecord(scopeId, record) {
    const state = this.ensureScopeState(scopeId);
    if (!state.memory_records) state.memory_records = [];
    state.memory_records.unshift(clone(record));
    return clone(record);
  }

  getMemoryRecords(scopeId, objectId = "") {
    const state = this.ensureScopeState(scopeId);
    const records = state.memory_records || [];
    return clone(objectId ? records.filter((record) => record.object_id === objectId) : records);
  }

  addSyncRecord(scopeId, record) {
    const state = this.ensureScopeState(scopeId);
    if (!state.sync_records) state.sync_records = [];
    state.sync_records.unshift(clone(record));
    return clone(record);
  }

  getSyncRecords(scopeId, objectId = "") {
    const state = this.ensureScopeState(scopeId);
    const records = state.sync_records || [];
    return clone(objectId ? records.filter((record) => record.object_id === objectId) : records);
  }

  addConfirmedCard(scopeId, card) {
    const state = this.ensureScopeState(scopeId);
    if (!state.confirmed_cards.some((item) => item.id === card.id)) {
      state.confirmed_cards.unshift({
        ...clone(card),
        confirmed_at: nowIso(),
      });
      const object = this.getCatalogObject(card.object_id);
      object.baseline.unshift({
        id: makeId("base"),
        dimension: card.dimension,
        title: card.dimension,
        value: `${card.after} 已确认。`,
        source_ids: clone(card.source_ids),
        created_from_card_id: card.id,
        created_at: nowIso(),
      });
    }
  }

  getAssets(scopeId) {
    return clone(this.ensureScopeState(scopeId).assets);
  }

  addAsset(scopeId, asset) {
    const state = this.ensureScopeState(scopeId);
    state.assets.unshift(clone(asset));
    return clone(asset);
  }

  findAsset(assetId) {
    for (const [scopeId, state] of Object.entries(this.scopeState)) {
      const asset = state.assets.find((item) => item.id === assetId);
      if (asset) return { scopeId, asset: clone(asset) };
    }
    return null;
  }

  getConfirmedCards(scopeId, objectId = "") {
    const cards = this.ensureScopeState(scopeId).confirmed_cards;
    return clone(objectId ? cards.filter((card) => card.object_id === objectId) : cards);
  }

  getReport(assetId) {
    const found = this.findAsset(assetId);
    if (!found || found.asset.type !== "report") return null;
    const cards = this.getConfirmedCards(found.scopeId).filter((card) => found.asset.source_card_ids.includes(card.id));
    const object = this.objectDetail(found.scopeId, found.asset.object_id);
    return {
      asset: found.asset,
      object,
      cards: cards.map((card) => this.cardView(found.scopeId, card)),
    };
  }

  getQa(scopeId) {
    const state = this.ensureScopeState(scopeId);
    const sourceIds = new Set(state.confirmed_cards.flatMap((card) => card.source_ids));
    return {
      messages: clone(state.qa_messages),
      excerpts: clone(state.excerpts),
      boundary: {
        confirmed: state.confirmed_cards.length,
        sources: sourceIds.size,
        reports: state.assets.filter((asset) => asset.type === "report").length,
        excerpts: state.excerpts.length,
      },
    };
  }

  addQaMessage(scopeId, message) {
    const state = this.ensureScopeState(scopeId);
    state.qa_messages.push(clone(message));
    return clone(message);
  }

  findQaMessage(scopeId, messageId) {
    return this.ensureScopeState(scopeId).qa_messages.find((message) => message.id === messageId) || null;
  }

  addExcerpt(scopeId, excerpt) {
    const state = this.ensureScopeState(scopeId);
    state.excerpts.unshift(clone(excerpt));
    state.assets.unshift({
      id: excerpt.id,
      scope_id: scopeId,
      object_id: state.confirmed_cards[0]?.object_id || "",
      type: "excerpt",
      title: excerpt.title,
      status: excerpt.status,
      text: excerpt.text,
      source_card_ids: clone(excerpt.source_card_ids),
      content_json: { text: excerpt.text },
      provider: excerpt.provider,
      provider_mode: excerpt.provider_mode,
      raw_ref: "manual:qa_excerpt",
      created_at: excerpt.created_at,
    });
    return clone(excerpt);
  }
}
