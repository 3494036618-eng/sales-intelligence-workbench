(function () {
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const defaultApiBase = ["http:", "https:"].includes(window.location.protocol)
    ? `${window.location.origin}/api`
    : "http://127.0.0.1:8787/api";
  const API_BASE = (window.AGENT_DEMO_API_BASE || defaultApiBase).replace(/\/$/, "");
  const reportsByAssetId = {};
  const runTracesById = {};
  let backendConnected = false;
  let lastBackendError = "";
  let providerStatus = {
    repository: { active: "memory", status: "unknown", notes: [] },
    providers: [],
    generatedAt: "",
  };

  function formatTime(value, fallback = "") {
    if (!value) return fallback;
    if (value === "刚刚" || value === "尚未运行") return value;
    if (!String(value).includes("T")) return value;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return fallback || value;
    return date.toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }

  async function apiRequest(path, options = {}) {
    const response = await fetch(`${API_BASE}${path}`, {
      method: options.method || "GET",
      headers: options.body ? { "Content-Type": "application/json" } : undefined,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error?.message || `API request failed: ${response.status}`);
      error.status = response.status;
      error.code = payload.error?.code || "api_error";
      throw error;
    }
    backendConnected = true;
    lastBackendError = "";
    return payload.data;
  }

  function rememberBackendError(error) {
    backendConnected = false;
    lastBackendError = error?.message || "后端暂时不可用";
    console.warn("[AgentDemoService] backend fallback:", lastBackendError);
  }

  function apiSource(source) {
    if (!source) return null;
    return {
      id: source.id,
      type: source.type,
      label: source.label,
      url: source.url,
      provider: source.provider,
      providerMode: source.provider_mode,
      rawRef: source.raw_ref,
      retrievedAt: source.retrieved_at,
      credibility: source.credibility,
    };
  }

  function apiSources(sources) {
    return (sources || []).map(apiSource).filter(Boolean);
  }

  function apiScope(scope, objectIds = []) {
    return {
      id: scope.id,
      name: scope.name,
      description: scope.description,
      objectIds,
      lastRun: scope.last_run_label || formatTime(scope.last_run_at, "尚未运行"),
      isDemo: Boolean(scope.is_demo),
      stats: scope.stats || { objects: objectIds.length, confirmed: 0, assets: 0, sources: 0 },
    };
  }

  function apiBaseline(item) {
    return {
      id: item.id,
      title: item.title || item.dimension || "基线",
      value: item.value,
      sourceIds: item.source_ids || [],
      createdAt: formatTime(item.created_at, item.createdAt || ""),
    };
  }

  function apiStep(step) {
    return {
      label: step.label,
      status: step.summary || (step.status === "ready" ? "完成" : step.status),
      provider: step.provider,
      providerMode: step.provider_mode,
    };
  }

  function apiTrace(trace) {
    return {
      id: trace.id,
      runId: trace.run_id,
      provider: trace.provider,
      providerMode: trace.provider_mode,
      toolName: trace.tool_name,
      inputSummary: trace.input_summary,
      outputSummary: trace.output_summary,
      rawRef: trace.raw_ref,
      traceId: trace.trace_id,
      status: trace.status,
      latencyMs: trace.latency_ms || 0,
      createdAt: formatTime(trace.created_at, "刚刚"),
    };
  }

  function apiCard(card) {
    return {
      id: card.id,
      objectId: card.object_id,
      dimension: card.dimension,
      title: card.title,
      before: card.before,
      after: card.after,
      sourceIds: card.source_ids || [],
      sources: apiSources(card.sources),
      confidence: card.confidence,
      status: card.status || "pending",
      provider: card.provider,
      providerMode: card.provider_mode,
      confirmedAt: formatTime(card.confirmed_at || card.updated_at || card.created_at, "刚刚"),
    };
  }

  function apiSyncRecord(record) {
    return {
      id: record.id,
      objectId: record.object_id,
      runId: record.run_id,
      provider: record.provider,
      providerMode: record.provider_mode,
      status: record.status,
      rawRef: record.raw_ref,
      summary: record.summary,
      createdAt: formatTime(record.created_at, "刚刚"),
    };
  }

  function apiMemoryRecord(record) {
    return {
      id: record.id,
      objectId: record.object_id,
      cardId: record.card_id,
      actionId: record.action_id,
      provider: record.provider,
      providerMode: record.provider_mode,
      status: record.status,
      rawRef: record.raw_ref,
      summary: record.summary,
      createdAt: formatTime(record.created_at, "刚刚"),
    };
  }

  function apiRun(run) {
    if (!run) return null;
    return {
      id: run.id,
      objectId: run.object_id,
      status: run.status,
      provider: run.provider,
      providerMode: run.provider_mode,
      syncRecord: run.sync_record ? apiSyncRecord(run.sync_record) : null,
      createdAt: formatTime(run.finished_at || run.started_at, "刚刚"),
      steps: (run.steps || []).map(apiStep),
      cards: (run.cards || []).map(apiCard),
      traces: run.traces ? run.traces.map(apiTrace) : runTracesById[run.id] || [],
    };
  }

  function apiAction(action) {
    return {
      id: action.id,
      objectId: action.object_id,
      cardId: action.card_id,
      type: action.action_type || action.type,
      memoryStatus: action.memory_status,
      memoryRef: action.memory_ref,
      createdAt: formatTime(action.created_at, "刚刚"),
    };
  }

  function apiAsset(asset) {
    return {
      id: asset.id,
      type: asset.type,
      title: asset.title,
      objectId: asset.object_id,
      createdAt: formatTime(asset.created_at, "刚刚"),
      sourceCardIds: asset.source_card_ids || [],
      status: asset.status,
      text: asset.text,
      provider: asset.provider,
      providerMode: asset.provider_mode,
      rawRef: asset.raw_ref,
      imageUrl: asset.image_url,
      b64Json: asset.b64_json,
      contentJson: asset.content_json || {},
      relatedAssetIds: asset.related_asset_ids || [],
    };
  }

  function apiObject(object) {
    const mapped = {
      id: object.id,
      name: object.name,
      objectType: object.object_type,
      summary: object.summary,
      primarySource: object.primary_source,
      sourceIds: object.source_ids || [],
      sources: apiSources(object.sources),
      confirmedCount: object.confirmed_count || 0,
      assetCount: object.asset_count || 0,
      runStatus: object.run_status || object.run?.status || "idle",
      reason: object.reason,
      tracked: object.tracked,
    };
    if (object.baseline) mapped.baseline = object.baseline.map(apiBaseline);
    if (object.run !== undefined) mapped.run = apiRun(object.run);
    if (object.confirmed_cards) mapped.confirmedCards = object.confirmed_cards.map(apiCard);
    if (object.actions) mapped.actions = object.actions.map(apiAction);
    if (object.memory_records) mapped.memoryRecords = object.memory_records.map(apiMemoryRecord);
    if (object.sync_records) mapped.syncRecords = object.sync_records.map(apiSyncRecord);
    if (object.assets) mapped.assets = object.assets.map(apiAsset);
    return mapped;
  }

  function apiQa(qa) {
    return {
      messages: (qa.messages || []).map((message) => ({
        ...message,
        providerMode: message.provider_mode,
        citationCardIds: message.citation_card_ids || [],
        citationSourceIds: message.citation_source_ids || [],
      })),
      excerpts: (qa.excerpts || []).map(apiAsset),
      boundary: qa.boundary || { confirmed: 0, sources: 0, reports: 0, excerpts: 0 },
    };
  }

  function apiReport(report) {
    return {
      asset: apiAsset(report.asset),
      object: apiObject(report.object),
      cards: (report.cards || []).map(apiCard),
    };
  }

  function apiProviderStatus(status) {
    return {
      generatedAt: formatTime(status.generated_at, "刚刚"),
      environment: status.environment || {},
      repository: status.repository || { active: "memory", status: "unknown", notes: [] },
      providers: (status.providers || []).map((provider) => ({
        id: provider.id,
        label: provider.label,
        status: provider.status,
        mode: provider.mode,
        role: provider.role,
        notes: provider.notes || [],
        safeConfig: provider.safe_config || {},
      })),
      nextRecommendedTasks: status.next_recommended_tasks || [],
    };
  }

  function upsertScope(scope) {
    const index = scopes.findIndex((item) => item.id === scope.id);
    if (index >= 0) scopes[index] = { ...scopes[index], ...scope };
    else scopes.unshift(scope);
    ensureScopeState(scope.id);
    return scopes.find((item) => item.id === scope.id);
  }

  function upsertObject(object) {
    if (!object?.id) return null;
    objects[object.id] = {
      ...(objects[object.id] || {}),
      ...object,
      sourceIds: object.sourceIds || objects[object.id]?.sourceIds || [],
      sources: object.sources || objects[object.id]?.sources || [],
      baseline: object.baseline || objects[object.id]?.baseline || [],
    };
    return objects[object.id];
  }

  function cacheObjectDetail(scopeId, object) {
    const mapped = apiObject(object);
    upsertObject(mapped);
    const state = ensureScopeState(scopeId);
    if (mapped.run) state.runs[mapped.id] = mapped.run;
    if (mapped.confirmedCards) {
      state.confirmedCards = [
        ...mapped.confirmedCards,
        ...state.confirmedCards.filter((card) => card.objectId !== mapped.id),
      ];
    }
    if (mapped.actions) {
      state.actions = [
        ...mapped.actions,
        ...state.actions.filter((action) => action.objectId !== mapped.id),
      ];
    }
    if (mapped.memoryRecords) {
      state.memoryRecords = [
        ...mapped.memoryRecords,
        ...state.memoryRecords.filter((record) => record.objectId !== mapped.id),
      ];
    }
    if (mapped.syncRecords) {
      state.syncRecords = [
        ...mapped.syncRecords,
        ...state.syncRecords.filter((record) => record.objectId !== mapped.id),
      ];
    }
    if (mapped.assets) {
      const otherAssets = state.assets.filter((asset) => asset.objectId !== mapped.id);
      state.assets = [...mapped.assets, ...otherAssets];
    }
    return mapped;
  }

  async function refreshScope(scopeId) {
    const [scopeData, objectList, candidates, assets, qa] = await Promise.all([
      apiRequest(`/scopes/${encodeURIComponent(scopeId)}`),
      apiRequest(`/scopes/${encodeURIComponent(scopeId)}/objects`),
      apiRequest(`/scopes/${encodeURIComponent(scopeId)}/candidates`),
      apiRequest(`/scopes/${encodeURIComponent(scopeId)}/assets`),
      apiRequest(`/scopes/${encodeURIComponent(scopeId)}/qa`),
    ]);
    const objectIds = objectList.map((object) => object.id);
    const scope = upsertScope(apiScope(scopeData, objectIds));
    const state = ensureScopeState(scopeId);
    state.candidates = candidates.map((candidate) => {
      const mapped = apiObject(candidate);
      upsertObject(mapped);
      return mapped;
    });
    state.assets = assets.map(apiAsset);
    const qaState = apiQa(qa);
    state.qaMessages = qaState.messages;
    state.excerpts = qaState.excerpts;

    const details = await Promise.all(
      objectList.map((object) =>
        apiRequest(`/scopes/${encodeURIComponent(scopeId)}/objects/${encodeURIComponent(object.id)}`).catch(() => object),
      ),
    );
    details.forEach((object) => cacheObjectDetail(scopeId, object));
    await Promise.all(details.map((object) => refreshRunTraces(scopeId, object.id).catch(() => null)));
    return scope;
  }

  async function refreshRunTraces(scopeId, objectId) {
    const state = ensureScopeState(scopeId);
    const run = state.runs[objectId];
    if (!run?.id) return [];
    const traces = await apiRequest(`/runs/${encodeURIComponent(run.id)}/traces`);
    const mappedTraces = (traces || []).map(apiTrace);
    run.traces = mappedTraces;
    runTracesById[run.id] = mappedTraces;
    state.traces[run.id] = mappedTraces;
    return mappedTraces;
  }

  const sources = {
    lingxiBiz: { id: "lingxiBiz", type: "企业工商数据库", label: "灵犀影像科技有限公司工商记录", url: "datapro://company/lingxi-video" },
    lingxiIp: { id: "lingxiIp", type: "知识产权数据库", label: "AI 内容生产平台软件著作权记录", url: "datapro://ip/lingxi-video" },
    lingxiNews: { id: "lingxiNews", type: "公开动态", label: "灵犀影像公开业务动态", url: "https://example.com/lingxi/news" },
    flowNews: { id: "flowNews", type: "官网新闻", label: "FlowFrame 官网新闻", url: "https://example.com/flowframe/news" },
    flowDocs: { id: "flowDocs", type: "文档站", label: "FlowFrame 文档站", url: "https://example.com/flowframe/docs" },
    flowPrice: { id: "flowPrice", type: "价格页", label: "FlowFrame 价格页", url: "https://example.com/flowframe/pricing" },
    clipRelease: { id: "clipRelease", type: "GitHub release", label: "ClipForge Studio release", url: "https://example.com/clipforge/releases" },
    clipDocs: { id: "clipDocs", type: "文档站", label: "ClipForge Studio 文档站", url: "https://example.com/clipforge/docs" },
    feishuBiz: { id: "feishuBiz", type: "企业工商数据库", label: "飞书科技有限公司工商记录", url: "datapro://company/feishu" },
    feishuIp: { id: "feishuIp", type: "知识产权数据库", label: "飞书文档协作专利记录", url: "datapro://ip/feishu" },
    notionPrice: { id: "notionPrice", type: "价格页", label: "Notion 价格页快照", url: "https://example.com/notion/pricing" },
  };

  const objects = {
    lingxiVideoCompany: {
      id: "lingxiVideoCompany",
      name: "灵犀影像科技有限公司",
      objectType: "company",
      summary: "智能影像与内容生成方案潜在客户",
      primarySource: "企业工商数据库",
      sourceIds: ["lingxiBiz", "lingxiIp", "lingxiNews"],
      baseline: [
        { id: "base-lingxi-1", title: "企业主体", value: "经营范围包含智能影像软件开发，可作为 AI 内容生产方案潜在客户。", createdAt: "2026-06-04 18:30" },
        { id: "base-lingxi-2", title: "历史沟通", value: "暂无预算、部署方式或安全要求的明确沟通记录。", createdAt: "2026-06-04 18:30" },
      ],
      plannedCards: [
        {
          id: "card-lingxi-copyright",
          dimension: "客户线索",
          title: "发现 AI 内容生产相关合作切入点",
          before: "历史资料中暂无明确商机记录。",
          after: "企业资料显示其业务覆盖智能影像软件开发，适合进一步确认 AI 内容生产、私有化部署和安全合规需求。",
          sourceIds: ["lingxiIp"],
          confidence: "高",
        },
      ],
    },
    flowframeVideo: {
      id: "flowframeVideo",
      name: "FlowFrame Video",
      objectType: "product",
      summary: "视频生成与镜头编辑产品",
      primarySource: "公开来源",
      sourceIds: ["flowNews", "flowDocs", "flowPrice"],
      baseline: [{ id: "base-flow-1", title: "价格页", value: "未出现批量生成额度说明。", createdAt: "2026-06-03 11:20" }],
      plannedCards: [
        {
          id: "card-flow-price",
          dimension: "价格页",
          title: "价格页新增批量生成额度说明",
          before: "未出现批量生成额度说明。",
          after: "价格页新增 batch render credits 与 team seat 字段。",
          sourceIds: ["flowPrice"],
          confidence: "中",
        },
      ],
    },
    clipforgeStudio: {
      id: "clipforgeStudio",
      name: "ClipForge Studio",
      objectType: "product",
      summary: "开源视频生成工作台",
      primarySource: "公开来源",
      sourceIds: ["clipRelease", "clipDocs"],
      baseline: [{ id: "base-clip-1", title: "GitHub release", value: "未支持多镜头模板。", createdAt: "2026-06-02 15:00" }],
      plannedCards: [
        {
          id: "card-clip-template",
          dimension: "GitHub release",
          title: "发布记录新增多镜头模板能力",
          before: "未支持多镜头模板。",
          after: "GitHub release 候选结果显示新增 multi-shot template 配置说明。",
          sourceIds: ["clipRelease", "clipDocs"],
          confidence: "中",
        },
      ],
    },
    feishuCompany: {
      id: "feishuCompany",
      name: "飞书科技有限公司",
      objectType: "company",
      summary: "企业协作与办公平台客户",
      primarySource: "企业工商数据库",
      sourceIds: ["feishuBiz", "feishuIp"],
      baseline: [{ id: "base-feishu-1", title: "企业主体", value: "企业名称为飞书科技有限公司。", createdAt: "2026-06-01 09:20" }],
      plannedCards: [
        {
          id: "card-feishu-ip",
          dimension: "客户线索",
          title: "知识管理和企业 AI 助手方向值得跟进",
          before: "历史资料仅记录企业主体信息。",
          after: "企业资料显示其与文档协作、智能检索相关，适合进一步确认企业知识管理和 AI 助手合作需求。",
          sourceIds: ["feishuIp"],
          confidence: "中",
        },
      ],
    },
    notionProduct: {
      id: "notionProduct",
      name: "Notion",
      objectType: "product",
      summary: "新一代文档协作产品",
      primarySource: "公开来源",
      sourceIds: ["notionPrice"],
      baseline: [{ id: "base-notion-1", title: "价格页", value: "团队知识库整理能力已在价格页公开。", createdAt: "2026-06-01 09:20" }],
      plannedCards: [
        {
          id: "card-notion-price",
          dimension: "价格页",
          title: "价格页新增团队 AI 管理字段",
          before: "价格页仅展示团队知识库整理能力。",
          after: "价格页候选快照显示新增团队 AI 管理字段。",
          sourceIds: ["notionPrice"],
          confidence: "中",
        },
      ],
    },
  };

  let scopes = [
    {
      id: "video-demo",
      name: "金融行业 AI 产品客户拓展",
      description: "围绕金融科技、AI 客服和数据智能方向，管理目标客户、客户进度和最新企业资料。",
      objectIds: ["lingxiVideoCompany"],
      lastRun: "尚未运行",
      isDemo: true,
    },
    {
      id: "ai-docs",
      name: "教育行业 AI 助手客户池",
      description: "面向教育行业客户拓展，沉淀客户资料、历史沟通和可跟进线索。",
      objectIds: ["feishuCompany", "notionProduct"],
      lastRun: "2026-06-11 09:50",
      isDemo: true,
    },
  ];

  const scopeState = {
    "video-demo": {
      candidates: [],
      runs: {},
      confirmedCards: [],
      actions: [],
      memoryRecords: [],
      syncRecords: [],
      assets: [],
      qaMessages: [],
      excerpts: [],
    },
    "ai-docs": {
      candidates: [],
      runs: {},
      confirmedCards: [
        {
          id: "confirmed-feishu-name",
          objectId: "feishuCompany",
          dimension: "客户线索",
          title: "企业协作场景已形成初步跟进方向",
          before: "历史资料缺少明确客户进展。",
          after: "企业主体信息已核验，可围绕知识管理和 AI 助手场景继续跟进。",
          sourceIds: ["feishuBiz"],
          confirmedAt: "2026-06-11 09:50",
        },
      ],
      actions: [{ id: "act-demo-1", objectId: "feishuCompany", type: "confirm", cardId: "confirmed-feishu-name", createdAt: "2026-06-11 09:50" }],
      memoryRecords: [],
      syncRecords: [],
      assets: [
        {
          id: "asset-demo-report",
          type: "report",
          title: "教育行业 AI 助手客户摘要",
          objectId: "feishuCompany",
          createdAt: "2026-06-11 10:10",
          sourceCardIds: ["confirmed-feishu-name"],
          status: "ready",
        },
      ],
      qaMessages: [],
      excerpts: [],
    },
  };

  const topicCandidates = {
    video: [
      { objectId: "lingxiVideoCompany", reason: "企业主体可核验，适合评估 AI 内容生产合作机会" },
      { objectId: "feishuCompany", reason: "企业主体可核验，适合评估知识管理和 AI 助手合作机会" },
    ],
    docs: [
      { objectId: "feishuCompany", reason: "企业主体可核验，适合评估知识管理和 AI 助手合作机会" },
    ],
  };

  function nowLabel() {
    return "刚刚";
  }

  function ensureScopeState(scopeId) {
    if (!scopeState[scopeId]) {
      scopeState[scopeId] = {
        candidates: [],
        runs: {},
        confirmedCards: [],
        actions: [],
        memoryRecords: [],
      syncRecords: [],
      assets: [],
      qaMessages: [],
        excerpts: [],
        traces: {},
      };
    }
    if (!scopeState[scopeId].traces) scopeState[scopeId].traces = {};
    return scopeState[scopeId];
  }

  function sourceList(ids) {
    return (ids || []).map((id) => sources[id]).filter(Boolean);
  }

  function hydrateObject(object) {
    if (!object) return null;
    return {
      ...object,
      sources: object.sources?.length ? object.sources : sourceList(object.sourceIds),
    };
  }

  async function init() {
    try {
      await refreshProviderStatus().catch(rememberBackendError);
      const scopeList = await apiRequest("/scopes");
      scopes = scopeList.map((scope) => apiScope(scope));
      await Promise.all(scopes.map((scope) => refreshScope(scope.id)));
      return { connected: true };
    } catch (error) {
      rememberBackendError(error);
      return { connected: false, error: lastBackendError };
    }
  }

  async function refreshProviderStatus() {
    const status = await apiRequest("/providers/status");
    providerStatus = apiProviderStatus(status);
    return clone(providerStatus);
  }

  function getProviderStatus() {
    return clone(providerStatus);
  }

  function getScopes() {
    return clone(scopes.map((scope) => ({ ...scope, stats: getScopeStats(scope.id) })));
  }

  function getScope(scopeId) {
    return clone(scopes.find((scope) => scope.id === scopeId) || scopes[0]);
  }

  function getScopeStats(scopeId) {
    const scope = scopes.find((item) => item.id === scopeId);
    const state = ensureScopeState(scopeId);
    return {
      objects: scope ? scope.objectIds.length : 0,
      confirmed: state.confirmedCards.length,
      assets: state.assets.length,
      sources: new Set((scope ? scope.objectIds : []).flatMap((objectId) => objects[objectId]?.sourceIds || [])).size,
    };
  }

  async function createScope(name) {
    try {
      const created = await apiRequest("/scopes", {
        method: "POST",
        body: { name: name || "新的销售目标" },
      });
      const scope = upsertScope(apiScope(created, []));
      return clone(scope);
    } catch (error) {
      rememberBackendError(error);
    }
    const id = `scope-${Date.now()}`;
    const scope = {
      id,
      name: name || "新的销售目标",
      description: "新的销售目标，等待推荐客户企业并建立客户档案。",
      objectIds: [],
      lastRun: "尚未运行",
      isDemo: false,
    };
    scopes.unshift(scope);
    ensureScopeState(id);
    return clone(scope);
  }

  function getTrackedObjects(scopeId) {
    const scope = scopes.find((item) => item.id === scopeId);
    if (!scope) return [];
    const state = ensureScopeState(scopeId);
    return clone(
      scope.objectIds.map((objectId) => {
        const object = hydrateObject(objects[objectId]);
        if (!object) return null;
        const confirmedCount = state.confirmedCards.filter((card) => card.objectId === objectId).length;
        const assetCount = state.assets.filter((asset) => asset.objectId === objectId).length;
        const run = state.runs[objectId];
        return { ...object, confirmedCount, assetCount, runStatus: run ? run.status : "idle" };
      }).filter(Boolean),
    );
  }

  function getObject(scopeId, objectId) {
    const state = ensureScopeState(scopeId);
    const object = hydrateObject(objects[objectId]);
    if (!object) return null;
    return clone({
      ...object,
      run: state.runs[objectId] || null,
      confirmedCards: state.confirmedCards
        .filter((card) => card.objectId === objectId)
        .map((card) => ({ ...card, sources: card.sources?.length ? card.sources : sourceList(card.sourceIds) })),
      actions: state.actions.filter((action) => action.objectId === objectId),
      memoryRecords: state.memoryRecords.filter((record) => record.objectId === objectId),
      syncRecords: state.syncRecords.filter((record) => record.objectId === objectId),
      assets: state.assets.filter((asset) => asset.objectId === objectId),
    });
  }

  async function discoverObjects(scopeId, query, mode = "broad") {
    const text = String(query || "").trim().toLowerCase();
    const state = ensureScopeState(scopeId);
    if (!text) {
      state.candidates = [];
      return [];
    }

    try {
      const candidates = await apiRequest(`/scopes/${encodeURIComponent(scopeId)}/discover-objects`, {
        method: "POST",
        body: { query, mode },
      });
      state.candidates = candidates.map((candidate) => {
        const mapped = apiObject(candidate);
        upsertObject(mapped);
        return mapped;
      });
      return clone(state.candidates);
    } catch (error) {
      rememberBackendError(error);
    }

    await wait(260);

    const exact = Object.values(objects)
      .filter((object) => object.name.toLowerCase().includes(text) || text.includes(object.name.toLowerCase()))
      .map((object) => ({ objectId: object.id, reason: "按客户名称匹配到可核验客户企业" }));

    let candidates = exact;
    if (!candidates.length && mode === "broad") {
      if (/视频|影像|video|生成|金融|上海|科技|客服|客户|ai|智能|销售|拓展/.test(text)) candidates = topicCandidates.video;
      if (/文档|协作|docs|notion|飞书|知识库/.test(text)) candidates = topicCandidates.docs;
    }
    if (!candidates.length && mode === "exact") {
      state.candidates = [];
      return [];
    }

    const tracked = new Set((scopes.find((scope) => scope.id === scopeId) || {}).objectIds || []);
    state.candidates = candidates.map((candidate) => {
      const object = hydrateObject(objects[candidate.objectId]);
      return { ...object, reason: candidate.reason, tracked: tracked.has(candidate.objectId) };
    });
    return clone(state.candidates);
  }

  function getCandidates(scopeId) {
    return clone(ensureScopeState(scopeId).candidates);
  }

  async function addTrackedObject(scopeId, objectId) {
    try {
      const object = await apiRequest(`/scopes/${encodeURIComponent(scopeId)}/objects`, {
        method: "POST",
        body: { object_id: objectId },
      });
      const mapped = cacheObjectDetail(scopeId, object);
      const scope = scopes.find((item) => item.id === scopeId);
      if (scope && !scope.objectIds.includes(objectId)) scope.objectIds.push(objectId);
      const state = ensureScopeState(scopeId);
      state.candidates = state.candidates.map((candidate) => (candidate.id === objectId ? { ...candidate, tracked: true } : candidate));
      return clone(getObject(scopeId, mapped.id));
    } catch (error) {
      if (error.code === "already_exists") {
        const object = await apiRequest(`/scopes/${encodeURIComponent(scopeId)}/objects/${encodeURIComponent(objectId)}`);
        const mapped = cacheObjectDetail(scopeId, object);
        return clone(getObject(scopeId, mapped.id));
      }
      rememberBackendError(error);
    }

    await wait(120);
    const scope = scopes.find((item) => item.id === scopeId);
    const state = ensureScopeState(scopeId);
    if (scope && objects[objectId] && !scope.objectIds.includes(objectId)) {
      scope.objectIds.push(objectId);
    }
    state.candidates = state.candidates.map((candidate) => (candidate.id === objectId ? { ...candidate, tracked: true } : candidate));
    return getObject(scopeId, objectId);
  }

  async function runObject(scopeId, objectId) {
    try {
      const run = await apiRequest(`/scopes/${encodeURIComponent(scopeId)}/objects/${encodeURIComponent(objectId)}/runs`, {
        method: "POST",
        body: {},
      });
      const mappedRun = apiRun(run);
      const state = ensureScopeState(scopeId);
      try {
        const traces = await apiRequest(`/runs/${encodeURIComponent(mappedRun.id)}/traces`);
        mappedRun.traces = (traces || []).map(apiTrace);
        runTracesById[mappedRun.id] = mappedRun.traces;
        state.traces[mappedRun.id] = mappedRun.traces;
      } catch (traceError) {
        console.warn("[AgentDemoService] trace fetch failed:", traceError?.message || traceError);
      }
      state.runs[objectId] = mappedRun;
      if (mappedRun.syncRecord) {
        state.syncRecords = [mappedRun.syncRecord, ...state.syncRecords.filter((record) => record.id !== mappedRun.syncRecord.id)];
      }
      const scope = scopes.find((item) => item.id === scopeId);
      if (scope) scope.lastRun = "刚刚";
      return clone(mappedRun);
    } catch (error) {
      rememberBackendError(error);
    }

    await wait(420);
    const state = ensureScopeState(scopeId);
    const scope = scopes.find((item) => item.id === scopeId);
    const object = objects[objectId];
    const cards = object.plannedCards.map((card) => ({
      ...card,
      objectId,
      status: "pending",
      sources: sourceList(card.sourceIds),
    }));
    state.runs[objectId] = {
      id: `run-${Date.now()}`,
      objectId,
      status: "ready",
      createdAt: nowLabel(),
      steps: [
        { label: "读取历史资料", status: "完成" },
        { label: "查询企业数据", status: "完成" },
        { label: "补充公开动态", status: "完成" },
        { label: "整理客户进展", status: cards.length ? `${cards.length} 条客户线索` : "未发现明确进展" },
      ],
      cards,
      traces: [
        {
          id: `trace-${Date.now()}`,
          runId: `run-${Date.now()}`,
          provider: "fixture",
          providerMode: "mock",
          toolName: "offlineFallback.runObject",
          outputSummary: "后端不可用时使用本地兜底数据。",
          rawRef: "fixture:fallback",
          traceId: "fixture-fallback",
          status: "ready",
          latencyMs: 0,
          createdAt: nowLabel(),
        },
      ],
    };
    if (scope) scope.lastRun = nowLabel();
    return clone(state.runs[objectId]);
  }

  function getRunTraces(scopeId, objectId) {
    const run = ensureScopeState(scopeId).runs[objectId];
    if (!run) return [];
    return clone(run.traces || runTracesById[run.id] || []);
  }

  async function saveCardAction(scopeId, objectId, cardId, action) {
    try {
      const result = await apiRequest(`/change-cards/${encodeURIComponent(cardId)}/actions`, {
        method: "POST",
        body: { scope_id: scopeId, object_id: objectId, action },
      });
      if (result.object) cacheObjectDetail(scopeId, result.object);
      return getObject(scopeId, objectId);
    } catch (error) {
      rememberBackendError(error);
    }

    await wait(160);
    const state = ensureScopeState(scopeId);
    const run = state.runs[objectId];
    if (!run) throw new Error("No run result");
    const card = run.cards.find((item) => item.id === cardId);
    if (!card) throw new Error("No change card");

    const statusMap = { confirm: "confirmed", ignore: "ignored", insufficient: "insufficient" };
    card.status = statusMap[action] || "pending";
    state.actions.unshift({ id: `act-${Date.now()}`, objectId, cardId, type: action, createdAt: nowLabel() });

    if (action === "confirm" && !state.confirmedCards.some((item) => item.id === card.id)) {
      state.confirmedCards.unshift({
        id: card.id,
        objectId,
        dimension: card.dimension,
        title: card.title,
        before: card.before,
        after: card.after,
        sourceIds: card.sourceIds,
        confirmedAt: nowLabel(),
      });
      objects[objectId].baseline.unshift({ id: `base-${Date.now()}`, title: card.dimension, value: `${card.after} 已确认。`, createdAt: nowLabel() });
    }

    return getObject(scopeId, objectId);
  }

  function getAssets(scopeId) {
    return clone(ensureScopeState(scopeId).assets);
  }

  async function generateAsset(scopeId, type, objectId) {
    try {
      const asset = await apiRequest(`/scopes/${encodeURIComponent(scopeId)}/assets`, {
        method: "POST",
        body: { type, object_id: objectId || "" },
      });
      const mappedAsset = apiAsset(asset);
      const state = ensureScopeState(scopeId);
      state.assets = [mappedAsset, ...state.assets.filter((item) => item.id !== mappedAsset.id)];
      if (type === "report") {
        const report = await apiRequest(`/assets/${encodeURIComponent(mappedAsset.id)}/report`);
        reportsByAssetId[mappedAsset.id] = apiReport(report);
      }
      return clone(mappedAsset);
    } catch (error) {
      if (error.code === "no_confirmed_cards") return null;
      rememberBackendError(error);
    }

    await wait(180);
    const state = ensureScopeState(scopeId);
    const scope = scopes.find((item) => item.id === scopeId);
    const confirmed = state.confirmedCards.filter((card) => !objectId || card.objectId === objectId);
    if (!confirmed.length) return null;
    const titleMap = { report: "客户摘要", infographic: "跟进简报图", excerpt: "保存摘录" };
    const asset = {
      id: `asset-${type}-${Date.now()}`,
      type,
      title: `${scope.name}${titleMap[type]}`,
      objectId: objectId || confirmed[0].objectId,
      createdAt: nowLabel(),
      sourceCardIds: confirmed.map((card) => card.id),
      status: "ready",
    };
    state.assets.unshift(asset);
    return clone(asset);
  }

  function getReport(scopeId, assetId) {
    if (reportsByAssetId[assetId]) return clone(reportsByAssetId[assetId]);
    const state = ensureScopeState(scopeId);
    const asset = state.assets.find((item) => item.id === assetId) || state.assets.find((item) => item.type === "report");
    if (!asset) return null;
    const cards = state.confirmedCards.filter((card) => asset.sourceCardIds.includes(card.id));
    const object = objects[asset.objectId];
    return clone({
      asset,
      object: hydrateObject(object),
      cards: cards.map((card) => ({ ...card, sources: card.sources?.length ? card.sources : sourceList(card.sourceIds) })),
    });
  }

  function getQa(scopeId) {
    const state = ensureScopeState(scopeId);
    return clone({
      messages: state.qaMessages,
      excerpts: state.excerpts,
      boundary: {
        confirmed: state.confirmedCards.length,
        sources: new Set(state.confirmedCards.flatMap((card) => card.sourceIds)).size,
        reports: state.assets.filter((asset) => asset.type === "report").length,
        excerpts: state.excerpts.length,
      },
    });
  }

  async function askQuestion(scopeId, question) {
    try {
      const qa = await apiRequest(`/scopes/${encodeURIComponent(scopeId)}/qa/messages`, {
        method: "POST",
        body: { question },
      });
      const mappedQa = apiQa(qa);
      const state = ensureScopeState(scopeId);
      state.qaMessages = mappedQa.messages;
      state.excerpts = mappedQa.excerpts;
      return getQa(scopeId);
    } catch (error) {
      rememberBackendError(error);
    }

    await wait(200);
    const state = ensureScopeState(scopeId);
    state.qaMessages.push({ id: `msg-u-${Date.now()}`, role: "user", text: question, citations: [] });
    if (!state.confirmedCards.length) {
      state.qaMessages.push({
        id: `msg-a-${Date.now()}`,
        role: "assistant",
        text: "当前客户档案里的历史资料还不够完整，暂时不能给出确定判断。建议先更新客户档案，或补充会议纪要、沟通记录、客户官网和企业数据来源。",
        citations: [],
      });
      return getQa(scopeId);
    }
    const first = state.confirmedCards[0];
    state.qaMessages.push({
      id: `msg-a-${Date.now()}`,
      role: "assistant",
      text: `基于当前客户档案，可以看到：${first.title}。该回答只引用当前客户档案、历史资料和已有资料来源。`,
      citations: sourceList(first.sourceIds).map((source) => source.label),
    });
    return getQa(scopeId);
  }

  async function saveExcerpt(scopeId, messageId) {
    try {
      const excerpt = await apiRequest(`/scopes/${encodeURIComponent(scopeId)}/qa/excerpts`, {
        method: "POST",
        body: { message_id: messageId },
      });
      const mappedExcerpt = apiAsset(excerpt);
      const state = ensureScopeState(scopeId);
      state.excerpts = [mappedExcerpt, ...state.excerpts.filter((item) => item.id !== mappedExcerpt.id)];
      state.assets = [
        { ...mappedExcerpt, objectId: state.confirmedCards[0]?.objectId || mappedExcerpt.objectId || "" },
        ...state.assets.filter((item) => item.id !== mappedExcerpt.id),
      ];
      return clone(mappedExcerpt);
    } catch (error) {
      rememberBackendError(error);
    }

    await wait(120);
    const state = ensureScopeState(scopeId);
    const message = state.qaMessages.find((item) => item.id === messageId && item.role === "assistant");
    if (!message) return null;
    const excerpt = {
      id: `excerpt-${Date.now()}`,
      type: "excerpt",
      title: "客户资料问答摘录",
      text: message.text,
      createdAt: nowLabel(),
      sourceCardIds: state.confirmedCards.slice(0, 2).map((card) => card.id),
      status: "ready",
    };
    state.excerpts.unshift(excerpt);
    state.assets.unshift({ ...excerpt, objectId: state.confirmedCards[0]?.objectId || "" });
    return clone(excerpt);
  }

  window.AgentDemoService = {
    init,
    isBackendConnected: () => backendConnected,
    getLastBackendError: () => lastBackendError,
    getProviderStatus,
    refreshProviderStatus,
    getScopes,
    getScope,
    getScopeStats,
    createScope,
    getTrackedObjects,
    getObject,
    discoverObjects,
    getCandidates,
    addTrackedObject,
    runObject,
    getRunTraces,
    saveCardAction,
    getAssets,
    generateAsset,
    getReport,
    getQa,
    askQuestion,
    saveExcerpt,
  };
})();
