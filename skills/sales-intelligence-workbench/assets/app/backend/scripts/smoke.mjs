import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { MemoryRepository } from "../src/repositories/memoryRepository.js";
import { DemoService } from "../src/services/demoService.js";
import { SalesService } from "../src/services/salesService.js";
import { createMockProviders } from "../src/providers/mockProviders.js";
import { WebSearchProvider } from "../src/providers/webSearchProvider.js";
import { ModelProvider } from "../src/providers/modelProvider.js";
import { DataProProvider } from "../src/providers/dataProProvider.js";
import { OpenVikingProvider } from "../src/providers/openVikingProvider.js";
import { SupabaseProvider } from "../src/providers/supabaseProvider.js";
import { VisionProvider } from "../src/providers/visionProvider.js";
import { salesSeedData } from "../src/fixtures/salesData.js";

process.env.APP_MODE = "demo";
process.env.REPOSITORY_MODE = "memory";
process.env.WEB_SEARCH_RUN_ENABLED = "false";
process.env.MODEL_RUN_ENABLED = "false";
process.env.DATAPRO_RUN_ENABLED = "false";
process.env.OPENVIKING_RUN_ENABLED = "false";
process.env.SUPABASE_RUN_ENABLED = "false";
process.env.VISION_RUN_ENABLED = "false";
const server = createApp();

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

async function request(baseUrl, method, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`${method} ${path} failed: ${response.status} ${JSON.stringify(payload)}`);
  }
  return payload;
}

try {
  const fakeWebSearch = new WebSearchProvider({
    env: {
      value(name, fallback = "") {
        const values = {
          WEB_SEARCH_API_KEY: "test-key",
          WEB_SEARCH_BASE_URL: "https://example.test/search",
          WEB_SEARCH_MAX_COUNT: "1",
        };
        return values[name] || fallback;
      },
      number(name, fallback) {
        return Number(this.value(name)) || fallback;
      },
    },
    fetchImpl: async (_url, request) => {
      const body = JSON.parse(request.body);
      assert.equal(body.Count, 1);
      return new Response(JSON.stringify({
        ResponseMetadata: { RequestId: "req-test-web-search" },
        Result: {
          ResultCount: 1,
          LogId: "log-test-web-search",
          SearchContext: { SearchType: "web" },
          WebResults: [{ SortId: 1, Title: "Test Result", Url: "https://example.test/result", Snippet: "snippet" }],
        },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  });
  const fakeSearchResult = await fakeWebSearch.search({ query: "test query", count: 5 });
  assert.equal(fakeSearchResult.ok, true);
  assert.equal(fakeSearchResult.result_count, 1);
  assert.equal(fakeSearchResult.results[0].url, "https://example.test/result");

  const fakeModelProvider = new ModelProvider({
    env: {
      value(name, fallback = "") {
        const values = {
          MODEL_API_KEY: "test-model-key",
          MODEL_BASE_URL: "https://example.test/model/v3",
          MODEL_NAME: "ark-code-latest",
          MODEL_RUN_ENABLED: "true",
          MODEL_MAX_CARDS: "2",
          MODEL_MAX_TOKENS: "400",
        };
        return values[name] || fallback;
      },
      number(name, fallback) {
        return Number(this.value(name)) || fallback;
      },
    },
    fetchImpl: async (url, request) => {
      assert.equal(url, "https://example.test/model/v3/chat/completions");
      const body = JSON.parse(request.body);
      assert.equal(body.model, "ark-code-latest");
      const prompt = JSON.parse(body.messages[1].content);
      const sourceId = prompt.sources[0].id;
      return new Response(JSON.stringify({
        id: "chatcmpl-test-model",
        choices: [{
          message: {
            content: JSON.stringify({
              cards: [{
                dimension: "价格页",
                title: "价格页出现新候选信息",
                before: "历史基线未记录该信息。",
                after: "真实来源显示价格页存在需要核验的新字段。",
                confidence: "中",
                source_ids: [sourceId],
              }],
              note: "test",
            }),
          },
        }],
        usage: { total_tokens: 120 },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  });
  const fakeModelResult = await fakeModelProvider.generateChangeCards({
    object: { id: "demo", name: "Demo", object_type: "product", summary: "demo", baseline: [] },
    sources: [{ id: "src-real", type: "联网搜索", label: "Real Source", url: "https://example.test", provider: "web_search", provider_mode: "real" }],
  });
  assert.equal(fakeModelResult.ok, true);
  assert.equal(fakeModelResult.cards[0].source_ids[0], "src-real");

  const fakeDataProProvider = new DataProProvider({
    env: {
      value(name, fallback = "") {
        const values = {
          DATAPRO_API_KEY: "test-datapro-key",
          DATAPRO_MCP_URL: "https://example.test/datapro/mcp",
          DATAPRO_RUN_ENABLED: "true",
          DATAPRO_MAX_SOURCES: "2",
        };
        return values[name] || fallback;
      },
      number(name, fallback) {
        return Number(this.value(name)) || fallback;
      },
    },
    fetchImpl: async (url, request) => {
      assert.equal(url, "https://example.test/datapro/mcp");
      assert.equal(request.headers["X-Agent-Plan-Key"], "test-datapro-key");
      const body = JSON.parse(request.body);
      assert.equal(body.method, "tools/call");
      assert.equal(body.params.name, "dataPro_search");
      assert.match(body.params.arguments.query, /灵犀影像科技有限公司/);
      return new Response(JSON.stringify({
        jsonrpc: "2.0",
        id: body.id,
        result: {
          isError: false,
          content: [{ type: "text", text: "{\"trace_id\":\"trace-test-datapro\",\"company\":\"灵犀影像科技有限公司\",\"credit_code\":\"91110000TEST\",\"business_scope\":\"智能影像软件开发\"}" }],
        },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  });
  const fakeDataProResult = await fakeDataProProvider.queryCompanyFacts({
    id: "lingxiVideoCompany",
    name: "灵犀影像科技有限公司",
    object_type: "company",
  });
  assert.equal(fakeDataProResult.ok, true);
  assert.equal(fakeDataProResult.request_id, "trace-test-datapro");

  const fakeOpenVikingProvider = new OpenVikingProvider({
    env: {
      value(name, fallback = "") {
        const values = {
          OPENVIKING_CLI: "ov",
          OPENVIKING_RUN_ENABLED: "true",
          OPENVIKING_FIND_LIMIT: "3",
        };
        return values[name] || fallback;
      },
      number(name, fallback) {
        return Number(this.value(name)) || fallback;
      },
    },
    execFile: async (_cli, args) => {
      if (args[0] === "add-memory") {
        assert.match(args[1], /竞争变化卡已被用户确认/);
        return { stdout: JSON.stringify({ ok: true, result: { message: "stored test memory" } }), stderr: "" };
      }
      if (args[0] === "health") {
        return { stdout: JSON.stringify({ ok: true, result: { healthy: true } }), stderr: "" };
      }
      return { stdout: JSON.stringify({ ok: true, result: { total: 0 } }), stderr: "" };
    },
  });
  const fakeOpenVikingResult = await fakeOpenVikingProvider.rememberConfirmedCard({
    scope: { id: "video-demo", name: "视频生成工具追踪" },
    object: { id: "flowframeVideo", name: "FlowFrame Video" },
    card: {
      id: "card-test",
      run_id: "run-test",
      scope_id: "video-demo",
      object_id: "flowframeVideo",
      dimension: "价格页",
      title: "测试确认变化卡",
      after: "确认后的测试变化。",
      confidence: "中",
      source_ids: ["src-test"],
    },
    sources: [{ id: "src-test", label: "测试来源", url: "https://example.test/source" }],
  });
  assert.equal(fakeOpenVikingResult.ok, true);

  const fakeSupabaseProvider = new SupabaseProvider({
    env: {
      value(name, fallback = "") {
        const values = {
          VOLCENGINE_ACCESS_KEY: "test-ak",
          VOLCENGINE_SECRET_KEY: "test-sk",
          VOLCENGINE_REGION: "cn-beijing",
          SUPABASE_WORKSPACE_ID: "ws-test",
          SUPABASE_BRANCH_ID: "branch-test",
          SUPABASE_CLI_BIN: "fake-supabase-cli",
          SUPABASE_RUN_ENABLED: "true",
          SUPABASE_READ_ONLY: "false",
        };
        return values[name] || fallback;
      },
      number(name, fallback) {
        return Number(this.value(name)) || fallback;
      },
    },
    execFile: async (_cmd, args) => {
      assert.equal(args[0], "db");
      assert.equal(args[1], "query");
      assert.ok(args.includes("--file"));
      assert.ok(args.includes("ws-test"));
      assert.ok(args.includes("branch-test"));
      return { stdout: JSON.stringify({ rows: [{ supabase_probe: 1 }] }), stderr: "" };
    },
  });
  const fakeSupabaseProbe = await fakeSupabaseProvider.probe();
  assert.equal(fakeSupabaseProbe.ok, true);
  const fakeSupabaseSync = await fakeSupabaseProvider.syncRunSnapshot({
    id: "run-test",
    scope_id: "video-demo",
    object_id: "flowframeVideo",
    status: "ready",
    provider: "fixture",
    provider_mode: "mock",
    cards: [],
    traces: [],
  });
  assert.equal(fakeSupabaseSync.ok, true);

  const fakeVisionProvider = new VisionProvider({
    env: {
      value(name, fallback = "") {
        const values = {
          VISION_API_KEY: "test-vision-key",
          VISION_BASE_URL: "https://example.test/vision/v3",
          VISION_IMAGE_MODEL: "doubao-seedream-5.0-lite",
          VISION_RUN_ENABLED: "true",
          VISION_TIMEOUT_MS: "1000",
          VISION_IMAGE_SIZE: "1536x1024",
        };
        return values[name] || fallback;
      },
      number(name, fallback) {
        return Number(this.value(name)) || fallback;
      },
    },
    fetchImpl: async (url, request) => {
      assert.equal(url, "https://example.test/vision/v3/images/generations");
      const body = JSON.parse(request.body);
      assert.equal(body.model, "doubao-seedream-5.0-lite");
      assert.match(body.prompt, /competitive/i);
      return new Response(JSON.stringify({
        id: "img-test-vision",
        data: [{ url: "https://example.test/generated-brief.png" }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  });
  const fakeVisionResult = await fakeVisionProvider.generateVisualBrief({
    scope: { name: "视频生成工具" },
    object: { object_type: "company" },
    confirmedCards: [{ title: "测试确认变化" }],
    sources: [{ type: "联网搜索" }],
  });
  assert.equal(fakeVisionResult.ok, true);
  assert.equal(fakeVisionResult.image_url, "https://example.test/generated-brief.png");

  const salesPersistCalls = [];
  const fakeSalesRepository = {
    getSalesState(seed) {
      salesPersistCalls.push("load");
      return seed;
    },
    persistSalesGoal(goal) {
      salesPersistCalls.push(`goal:${goal.id}`);
    },
    persistSalesCompany(company) {
      salesPersistCalls.push(`company:${company.id}`);
    },
    persistSalesTargetEnterprise(goalId, company) {
      salesPersistCalls.push(`target:${goalId}:${company.id}`);
    },
    persistSalesSearchResults(goalId, _query, companies) {
      salesPersistCalls.push(`search:${goalId}:${companies.length}`);
    },
    persistSalesDossier(dossier) {
      salesPersistCalls.push(`dossier:${dossier.company_id}`);
    },
    persistSalesOpenVikingRef(record) {
      salesPersistCalls.push(`ov:${record.related_type}`);
    },
  };
  const fakeSalesOpenVikingProvider = {
    isConfigured: () => true,
    isRunEnabled: () => true,
    storeMemory: async (messages) => {
      assert.match(messages[0].content, /销售历史资料|最近档案/);
      return { ok: true, raw_ref: "openviking:add-memory:sales-material", summary: "stored" };
    },
    findMemories: async (query) => {
      assert.match(query, /星蓝新能源科技有限公司/);
      return {
        ok: true,
        result: {
          memories: [{
            uri: "viking://memory/sales/qichen/q2",
            title: "Q2 车企智能化合作会议纪要",
            abstract: "对方重点关注数据安全、私有化部署和供应商准入流程。",
            score: 0.92,
          }],
        },
      };
    },
    addSessionMessages: async (_sessionId, messages) => {
      assert.equal(messages.length, 2);
      return { ok: true, raw_ref: "openviking:session:sales-qichen:messages" };
    },
    recordSessionUsed: async (_sessionId, contexts) => {
      assert.ok(contexts.length >= 1);
      return { ok: true, raw_ref: "openviking:session:sales-qichen:used" };
    },
    commitSession: async () => ({ ok: true, raw_ref: "openviking:session:sales-qichen:commit" }),
  };
  const salesService = new SalesService({
    seed: salesSeedData,
    runtimePolicy: {
      mode: "development",
      fail_closed: false,
      allow_fixture_data: false,
      allow_provider_fallback: false,
    },
    repository: fakeSalesRepository,
    openVikingProvider: fakeSalesOpenVikingProvider,
  });
  const searchedCompanies = await salesService.searchCompanies("goal_auto", { query: "智能驾驶 杭州" });
  assert.ok(searchedCompanies.some((company) => company.id === "future_auto"));
  const addedEnterprise = salesService.addTargetEnterprise("goal_auto", { company_id: "future_auto" });
  assert.equal(addedEnterprise.id, "future_auto");
  const materialSync = await salesService.syncMaterialsToOpenViking("qichen");
  assert.equal(materialSync.status, "ready");
  assert.ok(materialSync.records.length >= 1);
  const salesDossier = await salesService.createDossier("qichen");
  assert.equal(salesDossier.detail.company_id, "qichen");
  const salesQa = await salesService.askQuestion("qichen", { question: "之前提到过哪些部署要求？" });
  assert.ok(salesQa.message.text);
  const qaCommit = await salesService.commitQaMemory("qichen");
  assert.equal(qaCommit.status, "ready");
  assert.ok(salesPersistCalls.some((call) => call.startsWith("search:goal_auto:")));
  assert.ok(salesPersistCalls.includes("target:goal_auto:future_auto"));
  assert.ok(salesPersistCalls.includes("dossier:qichen"));
  assert.ok(salesPersistCalls.includes("qa:qichen:user"));
  assert.ok(salesPersistCalls.includes("qa:qichen:assistant"));
  assert.ok(salesPersistCalls.some((call) => call === "ov:material"));
  assert.ok(salesPersistCalls.some((call) => call === "ov:qa_session"));

  const runRepository = new MemoryRepository();
  runRepository.addObject("video-demo", "flowframeVideo");
  const runService = new DemoService(runRepository, createMockProviders(), { webSearchProvider: fakeWebSearch });
  const realSourceRun = await runService.runObject("video-demo", "flowframeVideo");
  assert.equal(realSourceRun.provider_mode, "mock");

  const fakeRunWebSearch = new WebSearchProvider({
    env: {
      value(name, fallback = "") {
        const values = {
          WEB_SEARCH_API_KEY: "test-key",
          WEB_SEARCH_BASE_URL: "https://example.test/search",
          WEB_SEARCH_MAX_COUNT: "1",
          WEB_SEARCH_RUN_ENABLED: "true",
        };
        return values[name] || fallback;
      },
      number(name, fallback) {
        return Number(this.value(name)) || fallback;
      },
    },
    fetchImpl: async (_url, request) => {
      const body = JSON.parse(request.body);
      assert.equal(body.Count, 1);
      assert.match(body.Query, /FlowFrame Video/);
      return new Response(JSON.stringify({
        ResponseMetadata: { RequestId: "req-test-run-search" },
        Result: {
          ResultCount: 1,
          LogId: "log-test-run-search",
          SearchContext: { SearchType: "web" },
          WebResults: [{ SortId: 1, Title: "FlowFrame Pricing", Url: "https://example.test/flowframe-pricing", Snippet: "pricing snippet" }],
        },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  });
  const mixedRepository = new MemoryRepository();
  mixedRepository.addObject("video-demo", "flowframeVideo");
  const mixedService = new DemoService(mixedRepository, createMockProviders(), { webSearchProvider: fakeRunWebSearch });
  const mixedRun = await mixedService.runObject("video-demo", "flowframeVideo");
  assert.equal(mixedRun.provider_mode, "mixed");
  assert.equal(mixedRun.steps.find((step) => step.step_key === "collect_public_sources").provider_mode, "real");
  const mixedTraces = mixedRepository.getRunTraces(mixedRun.id);
  assert.ok(mixedTraces.some((trace) => trace.provider === "web_search" && trace.trace_id === "req-test-run-search"));
  const mixedObject = mixedRepository.objectDetail("video-demo", "flowframeVideo");
  assert.ok(mixedObject.sources.some((source) => source.provider === "web_search" && source.url === "https://example.test/flowframe-pricing"));

  const modelRepository = new MemoryRepository();
  modelRepository.addObject("video-demo", "flowframeVideo");
  const modelService = new DemoService(modelRepository, createMockProviders(), { webSearchProvider: fakeRunWebSearch, modelProvider: fakeModelProvider });
  const modelRun = await modelService.runObject("video-demo", "flowframeVideo");
  assert.equal(modelRun.provider_mode, "mixed");
  assert.equal(modelRun.cards[0].provider, "model");
  assert.equal(modelRun.steps.find((step) => step.step_key === "generate_change_cards").provider_mode, "real");
  const modelTraces = modelRepository.getRunTraces(modelRun.id);
  assert.ok(modelTraces.some((trace) => trace.provider === "model" && trace.trace_id === "chatcmpl-test-model"));

  const dataProRepository = new MemoryRepository();
  const dataProService = new DemoService(dataProRepository, createMockProviders(), { dataProProvider: fakeDataProProvider, modelProvider: fakeModelProvider });
  const dataProRun = await dataProService.runObject("video-demo", "lingxiVideoCompany");
  assert.equal(dataProRun.provider_mode, "mixed");
  assert.equal(dataProRun.steps.find((step) => step.step_key === "query_structured_facts").provider_mode, "real");
  assert.equal(dataProRun.cards[0].provider, "model");
  const dataProObject = dataProRepository.objectDetail("video-demo", "lingxiVideoCompany");
  assert.ok(dataProObject.sources.some((source) => source.provider === "datapro" && source.raw_ref === "datapro:trace-test-datapro"));

  const port = await listen(server);
  const baseUrl = `http://127.0.0.1:${port}`;

  const health = await request(baseUrl, "GET", "/api/health");
  assert.equal(health.data.status, "ok");

  const providerStatus = await request(baseUrl, "GET", "/api/providers/status");
  assert.ok(providerStatus.data.repository.available_modes.includes("memory"));
  assert.ok(providerStatus.data.environment.local_env_path);
  assert.ok(providerStatus.data.providers.some((provider) => provider.id === "fixture" && provider.status === "ready"));
  assert.ok(providerStatus.data.providers.some((provider) => provider.id === "web_search"));
  assert.ok(providerStatus.data.providers.some((provider) => provider.id === "vision"));

  const salesGoals = await request(baseUrl, "GET", "/api/sales-goals");
  assert.ok(salesGoals.data.some((goal) => goal.id === "goal_auto"));
  const salesSearch = await request(baseUrl, "POST", "/api/sales-goals/goal_auto/company-search", { query: "新能源车" });
  assert.ok(salesSearch.data.length >= 1);
  const salesTarget = await request(baseUrl, "POST", "/api/sales-goals/goal_auto/target-enterprises", { company_id: salesSearch.data[0].id });
  assert.ok(salesTarget.data.id);
  const salesMaterialSync = await request(baseUrl, "POST", `/api/target-enterprises/${salesTarget.data.id}/materials/sync-openviking`, {});
  assert.ok(["ready", "partial", "skipped"].includes(salesMaterialSync.data.status));
  const salesGeneratedDossier = await request(baseUrl, "POST", `/api/target-enterprises/${salesTarget.data.id}/dossiers`, {});
  assert.ok(Array.isArray(salesGeneratedDossier.data.detail.citations));
  assert.ok(salesGeneratedDossier.data.detail.citations.every((citation) => ["专业数据集", "联网搜索"].includes(citation.source_kind)));
  assert.deepEqual(salesGeneratedDossier.data.detail.body.map((paragraph) => paragraph.text.split("：")[0]), ["企业情况", "近期动态", "销售判断", "下一步建议"]);
  const salesQuestion = await request(baseUrl, "POST", `/api/target-enterprises/${salesTarget.data.id}/qa`, { question: "当前推进重点是什么？" });
  assert.ok(salesQuestion.data.message.text);

  const scopes = await request(baseUrl, "GET", "/api/scopes");
  assert.equal(scopes.data.length, 2);

  const createdScope = await request(baseUrl, "POST", "/api/scopes", { name: "Smoke 测试范围" });
  assert.equal(createdScope.data.name, "Smoke 测试范围");

  const discovered = await request(baseUrl, "POST", "/api/scopes/video-demo/discover-objects", { query: "视频生成工具", mode: "broad" });
  assert.ok(discovered.data.some((candidate) => candidate.id === "flowframeVideo"));

  const customDiscovered = await request(baseUrl, "POST", "/api/scopes/video-demo/discover-objects", { query: "星河智能影像有限公司", mode: "exact" });
  assert.equal(customDiscovered.data.length, 1);
  assert.equal(customDiscovered.data[0].object_type, "company");
  assert.match(customDiscovered.data[0].id, /^obj_custom_/);
  const customAdded = await request(baseUrl, "POST", "/api/scopes/video-demo/objects", { object_id: customDiscovered.data[0].id });
  assert.equal(customAdded.data.name, "星河智能影像有限公司");

  const added = await request(baseUrl, "POST", "/api/scopes/video-demo/objects", { object_id: "flowframeVideo" });
  assert.equal(added.data.id, "flowframeVideo");

  const run = await request(baseUrl, "POST", "/api/scopes/video-demo/objects/flowframeVideo/runs", {});
  assert.equal(run.data.status, "ready");
  assert.ok(run.data.id);
  assert.ok(run.data.steps.length >= 4);
  assert.ok(run.data.cards.length >= 1);
  assert.ok(run.data.cards[0].source_ids.length >= 1);
  assert.equal(run.data.sync_record.status, "skipped");

  const traces = await request(baseUrl, "GET", `/api/runs/${run.data.id}/traces`);
  assert.ok(traces.data.length >= 1);
  const syncRecords = await request(baseUrl, "GET", "/api/scopes/video-demo/sync-records");
  assert.ok(syncRecords.data.records.some((record) => record.run_id === run.data.id && record.status === "skipped"));

  const action = await request(baseUrl, "POST", `/api/change-cards/${run.data.cards[0].id}/actions`, {
    scope_id: "video-demo",
    object_id: "flowframeVideo",
    action: "confirm",
  });
  assert.ok(action.data.object.confirmed_cards.length >= 1);
  assert.equal(action.data.action.memory_status, "skipped");
  const memory = await request(baseUrl, "GET", "/api/scopes/video-demo/memory");
  assert.ok(memory.data.records.some((record) => record.card_id === run.data.cards[0].id && record.status === "skipped"));

  const asset = await request(baseUrl, "POST", "/api/scopes/video-demo/assets", { type: "report", object_id: "flowframeVideo" });
  assert.equal(asset.data.type, "report");
  assert.ok(asset.data.content_json.sections.length >= 1);

  const visualAsset = await request(baseUrl, "POST", "/api/scopes/video-demo/assets", { type: "infographic", object_id: "flowframeVideo" });
  assert.equal(visualAsset.data.type, "infographic");
  assert.equal(visualAsset.data.content_json.visual_type, "evidence_board");

  const qa = await request(baseUrl, "POST", "/api/scopes/video-demo/qa/messages", { question: "这次确认的变化说明了什么？" });
  const assistantMessage = qa.data.messages.find((message) => message.role === "assistant");
  assert.ok(assistantMessage);
  assert.ok(assistantMessage.citation_card_ids.length >= 1);

  const excerpt = await request(baseUrl, "POST", "/api/scopes/video-demo/qa/excerpts", { message_id: assistantMessage.id });
  assert.equal(excerpt.data.type, "excerpt");

  console.log("smoke ok");
} finally {
  server.close();
}
