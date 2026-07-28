import assert from "node:assert/strict";
import test from "node:test";
import { SalesService } from "../src/services/salesService.js";

const developmentPolicy = Object.freeze({
  mode: "development",
  fail_closed: false,
  allow_fixture_data: false,
  allow_provider_fallback: false,
});

const productionPolicy = Object.freeze({
  mode: "production",
  fail_closed: true,
  allow_fixture_data: false,
  allow_provider_fallback: false,
});

function envReader(values = {}) {
  return {
    value(name, fallback = "") {
      return Object.hasOwn(values, name) ? values[name] : fallback;
    },
  };
}

function seed() {
  return {
    goals: [],
    companies: {
      company_1: {
        id: "company_1",
        name: "测试科技有限公司",
        initial: "测",
        industry: "企业软件",
        location: "北京",
        tags: [],
        progress: { label: "新商机", summary: "待生成档案", evidence: "暂无", updated_at: null },
        dossier_ids: [],
        material_ids: ["material_1"],
        qa_session_id: "sales-company_1",
      },
    },
    dossiers: {},
    materials: {
      material_1: {
        id: "material_1",
        company_id: "company_1",
        title: "客户需求确认会",
        summary: "客户希望先验证知识库问答，并要求明确数据权限边界。",
        source_type: "飞书会议纪要",
        openviking_uri: "viking://resources/workspace-test/companies/company_1/materials/material_1",
        updated_at: "2026-07-20T08:00:00.000Z",
      },
    },
    qa_messages: { company_1: [] },
    sync_sources: {},
    sync_checkpoints: {},
    jobs: {},
  };
}

function createWorkflowService({
  sharedSessionMessages = new Map(),
  seedData = seed(),
} = {}) {
  let publicSummary = "测试科技有限公司发布了企业知识库产品更新公告。";
  const modelCalls = [];
  const sessionMessages = sharedSessionMessages;
  const modelProvider = {
    isRunEnabled: () => true,
    async callJson(input) {
      modelCalls.push(structuredClone(input));
      if (input.operation === "sales_qa") {
        const dossier = input.payload.evidence.find((item) => item.source_kind === "企业档案");
        const internal = input.payload.evidence.find((item) => item.source_kind !== "企业档案");
        return {
          ok: true,
          parsed: {
            paragraphs: [
              { text: "当前企业档案显示该企业近期更新了知识库产品。", citation_ids: [dossier.id] },
              { text: "历史沟通中，客户要求先确认数据权限边界。", citation_ids: [internal.id] },
            ],
            insufficient: false,
          },
          usage: { prompt_tokens: 120, completion_tokens: 60, total_tokens: 180 },
          raw_ref: "model:qa-1",
        };
      }
      const professional = input.payload.citations.find((item) => item.source_kind === "专业数据集");
      const publicSource = input.payload.citations.find((item) => item.source_kind === "联网搜索");
      return {
        ok: true,
        parsed: {
          title: "测试科技有限公司销售情报报告",
          summary: publicSummary,
          body: [
            { text: "企业与业务概览：该企业主体信息已通过专业数据核验，当前面向企业客户提供软件产品。", citation_ids: [professional.id] },
            { text: "经营与业务动态：专业数据反映该企业持续经营企业软件相关业务，可进一步核验重点产品线。", citation_ids: [professional.id] },
            { text: `近期公开动态：${publicSummary}`, citation_ids: [publicSource.id] },
            { text: "风险与关注事项：现有外部资料仍需持续核验来源日期、企业归属和关键经营变化。", citation_ids: [professional.id, publicSource.id] },
            { text: "销售机会判断：结合企业业务范围与产品更新，可优先验证企业知识库相关场景。", citation_ids: [professional.id, publicSource.id] },
            { text: "建议行动：确认相关业务部门、当前产品规划、试点范围和数据合规要求。", citation_ids: [professional.id, publicSource.id] },
          ],
          memory_summary: "企业近期更新知识库产品，适合继续核验相关业务场景。",
        },
        usage: { prompt_tokens: 300, completion_tokens: 140, total_tokens: 440 },
        raw_ref: `model:dossier-${modelCalls.length}`,
      };
    },
  };
  const service = new SalesService({
    env: envReader({ APP_WORKSPACE_ID: "workspace-test" }),
    runtimePolicy: developmentPolicy,
    seed: seedData,
    dataProProvider: {
      maxSources: 1,
      isRunEnabled: () => true,
      async callTool(query) {
        return {
          ok: true,
          summary: "测试科技有限公司；统一社会信用代码：TEST0001；经营范围：企业软件。",
          raw_ref: "datapro:company_1",
          query,
        };
      },
    },
    webSearchProvider: {
      isRunEnabled: () => true,
      async search() {
        return {
          ok: true,
          results: [{
            title: "测试科技有限公司产品更新公告",
            summary: publicSummary,
            url: "https://news.test/company-1-update",
            publish_time: "2026-07-20T09:00:00.000Z",
          }],
        };
      },
    },
    modelProvider,
    openVikingProvider: {
      isConfigured: () => true,
      isRunEnabled: () => true,
      salesCompanyUri: ({ workspaceId, companyId }) => `viking://resources/${workspaceId}/companies/${companyId}`,
      salesSessionId: ({ workspaceId, companyId }) => `sales-${workspaceId}-${companyId}`,
      async findMemories() {
        return {
          ok: true,
          result: {
            resources: [
              {
                uri: "viking://resources/workspace-test/companies/company_1/materials/material_1.md",
                title: "material_1.md",
                abstract: "客户希望先验证知识库问答，并要求明确数据权限边界。",
              },
              {
                uri: "viking://resources/workspace-test/companies/company_1/materials/overview.md",
                title: "overview",
                abstract: "内部目录 company_dp_should_not_be_visible 的实现说明。",
              },
            ],
          },
        };
      },
      async getSessionContext(sessionId) {
        const messages = sessionMessages.get(sessionId) || [];
        if (!messages.length) {
          return { ok: false, http_status: 404, error: { code: "not_found", message: "Session not found" } };
        }
        return {
          ok: true,
          session_id: sessionId,
          messages,
          latest_archive_overview: "",
          raw_ref: `openviking:session:${sessionId}:context`,
        };
      },
      async addSessionMessages(sessionId, messages) {
        const existing = sessionMessages.get(sessionId) || [];
        const appended = messages.map((message, index) => ({
          id: `session-message-${existing.length + index + 1}`,
          role: message.role,
          text: message.content,
          created_at: "2026-07-26T10:00:00.000Z",
        }));
        sessionMessages.set(sessionId, [...existing, ...appended]);
        return {
          ok: true,
          session_id: sessionId,
          raw_ref: `openviking:session:${sessionId}:messages`,
        };
      },
      async recordSessionUsed() {
        return { ok: true };
      },
      async commitSession(sessionId) {
        return { ok: true, raw_ref: `openviking:session:${sessionId}:commit` };
      },
    },
  });
  return {
    service,
    modelCalls,
    sessionMessages,
    changePublicSummary(value) {
      publicSummary = value;
    },
  };
}

test("dossier generation skips unchanged evidence and versions material changes", async () => {
  const fixture = createWorkflowService();
  const first = await fixture.service.createDossier("company_1");
  const firstModelCalls = fixture.modelCalls.filter((call) => call.operation === "sales_dossier");

  assert.equal(first.action, "created");
  assert.equal(first.detail.version_no, 1);
  assert.equal(first.detail.previous_dossier_id, null);
  assert.equal(Object.hasOwn(first.detail, "evidence_hash"), false);
  assert.equal(Object.hasOwn(first.detail, "dossier_fingerprint"), false);
  assert.equal(Object.hasOwn(first.detail, "provider_run_id"), false);
  assert.equal(firstModelCalls.length, 1);
  assert.equal(first.detail.body.length, 6);
  assert.ok(
    first.detail.body.every((paragraph) => paragraph.citation_ids.length > 0),
    JSON.stringify({ body: first.detail.body, citations: first.detail.citations }, null, 2),
  );
  assert.ok(first.detail.citations.every((citation) => ["专业数据集", "联网搜索"].includes(citation.source_kind)));
  assert.equal(first.detail.citations.some((citation) => citation.source_kind === "内部资料"), false);
  assert.equal(firstModelCalls[0].payload.citations.some((citation) => citation.source_kind === "内部资料"), false);

  const unchanged = await fixture.service.createDossier("company_1");
  assert.equal(unchanged.action, "no_material_change");
  assert.equal(unchanged.detail.id, first.detail.id);
  assert.equal(fixture.modelCalls.filter((call) => call.operation === "sales_dossier").length, 1);
  assert.equal(Object.keys(fixture.service.data.dossiers).length, 1);

  fixture.changePublicSummary("测试科技有限公司新增了面向销售团队的知识库协作能力。");
  const changed = await fixture.service.createDossier("company_1");
  assert.equal(changed.action, "created");
  assert.equal(changed.detail.version_no, 2);
  assert.equal(changed.detail.previous_dossier_id, first.detail.id);
  assert.equal(fixture.modelCalls.filter((call) => call.operation === "sales_dossier").length, 2);
  assert.equal(Object.keys(fixture.service.data.dossiers).length, 2);

  const jobs = await fixture.service.listJobs({ job_type: "sales_dossier_generation" });
  assert.equal(jobs.length, 3);
  assert.ok(jobs.every((job) => job.status === "succeeded"));
});

test("dossier evidence collection supplements professional data with public risk queries", async () => {
  const webQueries = [];
  const service = new SalesService({
    env: envReader({ APP_WORKSPACE_ID: "workspace-test" }),
    runtimePolicy: developmentPolicy,
    seed: seed(),
    dataProProvider: {
      maxSources: 2,
      isRunEnabled: () => true,
      planDossierQueries: () => [
        {
          label: "企业工商数据库",
          purpose: "主体与经营信息核验",
          query: "测试科技有限公司 企业工商数据",
        },
        {
          label: "企业风险数据库",
          purpose: "风险与关注事项核验",
          query: "测试科技有限公司 企业风险数据",
        },
      ],
      async callTool(query) {
        return {
          ok: true,
          summary: query.includes("风险")
            ? "企业风险信息包含经营异常、行政处罚、司法诉讼和限制高消费等核验维度。"
            : "测试科技有限公司经营范围包括企业软件与知识库产品。",
          raw_ref: `datapro:${query}`,
        };
      },
    },
    webSearchProvider: {
      isRunEnabled: () => true,
      async search(input) {
        webQueries.push(input.query);
        return {
          ok: true,
          results: [{
            title: `${input.query}公开结果`,
            summary: "公开来源披露了与该查询相关的企业事项。",
            url: `https://news.test/${webQueries.length}`,
            publish_time: "2026-07-20T09:00:00.000Z",
          }],
        };
      },
    },
  });

  await service.collectDossierEvidence(service.data.companies.company_1);

  assert.ok(webQueries.some((query) => (
    /行政处罚/.test(query)
    && /司法诉讼/.test(query)
    && /失信被执行/.test(query)
    && /经营异常/.test(query)
  )));
});

test("dossier generation repairs invalid model citation ids once", async () => {
  const modelCalls = [];
  const modelProvider = {
    isRunEnabled: () => true,
    async callJson(input) {
      modelCalls.push(structuredClone(input));
      if (input.operation === "sales_dossier") {
        return {
          ok: true,
          parsed: {
            title: "测试科技有限公司销售情报报告",
            summary: "企业近期发布了产品更新公告。",
            body: [
              { text: "企业与业务概览：该企业面向企业客户提供软件产品。", citation_ids: ["1"] },
              { text: "经营与业务动态：媒体 作者 7月25日 测试科技有限公司（简称“测试科技”，立即注册查看更多相关信息。", citation_ids: ["1"] },
              { text: "近期公开动态：企业近期发布了产品更新公告。", citation_ids: ["2"] },
              { text: "风险与关注事项：关键字段存在来源差异，公开摘要还写有净利润432。", citation_ids: ["1", "2"] },
              { text: "销售机会判断：当前可优先验证知识库问答场景。", citation_ids: ["1", "2"] },
              { text: "建议行动：确认业务部门、试点范围和数据合规要求。", citation_ids: ["1", "2"] },
            ],
            memory_summary: "企业近期更新产品，可继续核验知识库问答场景。",
          },
          raw_ref: "model:dossier-invalid",
        };
      }
      return {
        ok: true,
        parsed: {
          title: "测试科技有限公司销售情报报告",
          summary: "企业近期发布了产品更新公告。",
          body: [
            { text: "企业与业务概览：该企业面向企业客户提供软件产品，核心业务覆盖知识库建设、内容检索和协作管理。", citation_ids: ["evidence_professional"] },
            { text: "经营与业务动态：该企业持续经营企业软件相关业务，近期产品更新进一步强化了知识库协作能力。", citation_ids: ["evidence_professional"] },
            { text: "近期公开动态：企业近期发布产品更新公告，新增面向销售团队的知识库协作能力和内容检索功能。", citation_ids: ["evidence_public"] },
            { text: "风险与关注事项：产品落地需要同步确认企业数据权限、知识库访问边界和部署环境要求，避免影响试点交付。", citation_ids: ["evidence_professional", "evidence_public"] },
            { text: "销售机会判断：产品更新与企业软件业务形成直接关联，可优先从销售知识库问答和协作检索场景开展试点。", citation_ids: ["evidence_professional", "evidence_public"] },
            { text: "建议行动：1. 联系产品与销售运营负责人确认试点目标。\n2. 核实知识库范围和数据权限边界。\n3. 准备小范围验证方案与验收指标。", citation_ids: ["evidence_professional", "evidence_public"] },
          ],
          memory_summary: "企业近期更新产品，可继续核验知识库问答场景。",
        },
        raw_ref: "model:dossier-repaired",
      };
    },
  };
  const service = new SalesService({
    env: envReader({ APP_WORKSPACE_ID: "workspace-test" }),
    runtimePolicy: productionPolicy,
    seed: seed(),
    modelProvider,
  });
  const evidencePack = {
    evidence_hash: "evidence-pack-test",
    items: [
      {
        id: "evidence_professional",
        label: "企业工商数据库",
        source_kind_label: "专业数据集",
        summary: "测试科技有限公司面向企业客户提供软件产品。",
        provider: "datapro",
        quality_tier: 1,
        independence_key: "datapro-company",
      },
      {
        id: "evidence_risk",
        label: "企业风险数据库",
        source_kind_label: "专业数据集",
        summary: "本次查询未发现可直接下结论的重大风险记录，仍需核验来源日期。",
        provider: "datapro",
        quality_tier: 1,
        independence_key: "datapro-risk",
      },
      {
        id: "evidence_public",
        label: "企业产品更新公告",
        source_kind_label: "联网搜索",
        summary: "测试科技有限公司近期发布了产品更新公告。",
        provider: "web_search",
        url: "https://news.test/company-update",
        quality_tier: 2,
        independence_key: "news.test",
      },
      {
        id: "evidence_internal",
        label: "客户需求确认会",
        source_kind_label: "内部资料",
        summary: "客户希望先验证知识库问答，并要求明确数据权限边界。",
        provider: "openviking",
        uri: "viking://resources/workspaces/test/companies/company_1/materials/material_1",
        quality_tier: 2,
        independence_key: "internal-material-1",
      },
    ],
  };

  const dossier = await service.generateDossierWithModel(
    service.data.companies.company_1,
    evidencePack,
    [],
  );

  assert.equal(modelCalls.length, 2);
  assert.equal(modelCalls[0].operation, "sales_dossier");
  assert.deepEqual(modelCalls[0].payload.allowed_citation_ids, [
    "evidence_professional",
    "evidence_risk",
    "evidence_public",
  ]);
  assert.equal(modelCalls[0].payload.citations.some((item) => item.source_kind === "内部资料"), false);
  assert.equal(
    modelCalls[0].payload.output_schema.body[0].citation_ids[0],
    "evidence_professional",
  );
  assert.deepEqual(
    modelCalls[0].payload.source_selection_policy.risk_database_ids,
    [],
  );
  assert.equal(
    modelCalls[0].payload.output_schema.body[3].citation_ids[0],
    "evidence_professional",
  );
  assert.equal(modelCalls[1].operation, "sales_dossier_repair");
  assert.ok(modelCalls[1].payload.validation_errors.some((item) => item.includes("系统内部")));
  assert.ok(modelCalls[1].payload.validation_errors.some((item) => (
    /引流|未闭合|截断数字/.test(item)
  )));
  assert.doesNotMatch(JSON.stringify(dossier), /关键字段存在来源差异|来源冲突/);
  assert.ok(modelCalls[1].payload.validation_errors.some((item) => item.includes("无效引用")));
  assert.equal(dossier.body.length, 6);
  assert.deepEqual(dossier.body[0].citation_ids, ["evidence_professional"]);
  assert.deepEqual(dossier.body[3].citation_ids, ["evidence_professional", "evidence_public"]);
  assert.equal(dossier.raw_ref, "model:dossier-repaired");
});

test("production repairs a malformed dossier JSON response from the original model output", async () => {
  const modelCalls = [];
  const modelProvider = {
    isRunEnabled: () => true,
    async callJson(input) {
      modelCalls.push(structuredClone(input));
      if (modelCalls.length === 1) {
        return {
          ok: false,
          error: {
            code: "invalid_json",
            message: "Unterminated string in JSON response.",
          },
          invalid_content: "{\"title\":\"测试科技有限公司销售情报报告\",\"body\":[{\"text\":\"未闭合",
        };
      }
      return {
        ok: true,
        parsed: {
          title: "测试科技有限公司销售情报报告",
          summary: "企业近期发布了产品更新公告，可优先验证销售知识库场景。",
          body: [
            { text: "企业与业务概览：该企业面向企业客户提供软件产品，核心业务覆盖知识库建设、内容检索和协作管理。", citation_ids: ["evidence_professional"] },
            { text: "经营与业务动态：该企业持续经营企业软件相关业务，近期产品更新进一步强化了知识库协作能力。", citation_ids: ["evidence_professional"] },
            { text: "近期公开动态：企业近期发布产品更新公告，新增面向销售团队的知识库协作能力和内容检索功能。", citation_ids: ["evidence_public"] },
            { text: "风险与关注事项：产品落地需要同步确认企业数据权限、知识库访问边界和部署环境要求，避免影响试点交付。", citation_ids: ["evidence_professional", "evidence_public"] },
            { text: "销售机会判断：产品更新与企业软件业务形成直接关联，可优先从销售知识库问答和协作检索场景开展试点。", citation_ids: ["evidence_professional", "evidence_public"] },
            { text: "建议行动：1. 联系产品与销售运营负责人确认试点目标。\n2. 核实知识库范围和数据权限边界。\n3. 准备小范围验证方案与验收指标。", citation_ids: ["evidence_professional", "evidence_public"] },
          ],
          memory_summary: "企业近期更新产品，可继续核验知识库问答场景。",
        },
        usage: { prompt_tokens: 160, completion_tokens: 80, total_tokens: 240 },
        raw_ref: "model:dossier-retry",
      };
    },
  };
  const service = new SalesService({
    env: envReader({ APP_WORKSPACE_ID: "workspace-test" }),
    runtimePolicy: productionPolicy,
    seed: seed(),
    modelProvider,
  });
  const evidencePack = {
    evidence_hash: "evidence-pack-json-retry",
    items: [
      {
        id: "evidence_professional",
        label: "企业工商数据库",
        source_kind_label: "专业数据集",
        summary: "测试科技有限公司面向企业客户提供软件产品。",
        provider: "datapro",
        quality_tier: 1,
        independence_key: "datapro-company",
      },
      {
        id: "evidence_public",
        label: "企业产品更新公告",
        source_kind_label: "联网搜索",
        summary: "测试科技有限公司近期发布了产品更新公告。",
        provider: "web_search",
        url: "https://news.test/company-update",
        quality_tier: 2,
        independence_key: "news.test",
      },
    ],
  };

  const dossier = await service.generateDossierWithModel(
    service.data.companies.company_1,
    evidencePack,
    [],
  );

  assert.equal(modelCalls.length, 2);
  assert.equal(modelCalls[0].operation, "sales_dossier");
  assert.equal(modelCalls[0].maxTokens, 2800);
  assert.equal(modelCalls[1].operation, "sales_dossier_json_repair");
  assert.equal(modelCalls[1].maxTokens, 3600);
  assert.match(modelCalls[1].system, /修复上一轮模型生成的无效 JSON/);
  assert.equal(
    modelCalls[1].payload.invalid_json_content,
    "{\"title\":\"测试科技有限公司销售情报报告\",\"body\":[{\"text\":\"未闭合",
  );
  assert.equal(dossier.body.length, 6);
  assert.equal(dossier.raw_ref, "model:dossier-retry");
});

test("QA derives paragraph citations from allowed evidence and records model usage", async () => {
  const fixture = createWorkflowService();
  await fixture.service.createDossier("company_1");
  const result = await fixture.service.askQuestion("company_1", { question: "客户最关注什么，下一步怎么推进？" });

  assert.ok(result.job_id);
  assert.ok(result.provider_run_id);
  assert.equal(result.message.paragraphs.length, 2);
  assert.equal(result.message.citations.length, 2);
  assert.ok(result.message.paragraphs.every((paragraph) => paragraph.citation_ids.length > 0));
  assert.ok(result.message.citation_ids.every((id) => result.message.citations.some((citation) => citation.id === id)));
  const qaCall = fixture.modelCalls.find((call) => call.operation === "sales_qa");
  assert.deepEqual(
    [...new Set(qaCall.payload.evidence.map((item) => item.source_kind))].sort(),
    ["企业档案", "云文档"].sort(),
  );
  const materialEvidence = qaCall.payload.evidence.find((item) => item.source_kind === "云文档");
  assert.equal(materialEvidence.label, "客户需求确认会");
  assert.doesNotMatch(JSON.stringify(qaCall.payload.evidence), /overview|company_dp_should_not_be_visible/i);
  assert.match(qaCall.system, /正式展示标题/);
  assert.match(qaCall.system, /不得输出 evidence\.uri/);
  assert.match(qaCall.system, /不得自行增加“补充”/);

  const run = await fixture.service.getProviderRun(result.provider_run_id);
  const modelStep = run.steps.find((step) => step.provider === "model");
  assert.equal(run.job_id, result.job_id);
  assert.equal(modelStep.usage.total_tokens, 180);
  assert.equal((await fixture.service.getJob(result.job_id)).status, "succeeded");
});

test("QA hydrates the full OpenViking resource before chunking and reranking", async () => {
  const fixture = createWorkflowService();
  fixture.service.openVikingProvider.readTextResource = async () => ({
    ok: true,
    content: [
      `${"一般会议背景。".repeat(180)}\n\n预算窗口：客户计划在第四季度确认预算，首批试点覆盖两个业务部门。`,
      "<!-- sales-workbench-material-v1:eyJ0ZXh0IjoicHJpdmF0ZS1zeW5jLXNuYXBzaG90In0= -->",
    ].join("\n"),
  });
  await fixture.service.createDossier("company_1");
  await fixture.service.askQuestion("company_1", { question: "客户的预算窗口和试点范围是什么？" });

  const qaCall = fixture.modelCalls.find((call) => call.operation === "sales_qa");
  assert.ok(qaCall.payload.evidence.some((item) => (
    item.source_kind === "云文档"
    && item.summary.includes("第四季度确认预算")
    && item.summary.includes("两个业务部门")
  )));
  assert.doesNotMatch(JSON.stringify(qaCall.payload.evidence), /sales-workbench-material-v1|cHJpdmF0ZS1zeW5jLXNuYXBzaG90/);
  assert.ok(qaCall.payload.retrieval_plan.answerability.supported);
});

test("QA sends bounded prior turns to the model for follow-up questions", async () => {
  const fixture = createWorkflowService();
  await fixture.service.createDossier("company_1");
  await fixture.service.askQuestion("company_1", { question: "客户最关注什么？" });
  await fixture.service.askQuestion("company_1", { question: "那下一步怎么推进？" });

  const qaCalls = fixture.modelCalls.filter((call) => call.operation === "sales_qa");
  assert.equal(qaCalls.length, 2);
  assert.deepEqual(
    qaCalls[0].payload.conversation_history,
    [],
  );
  assert.equal(qaCalls[1].payload.question, "那下一步怎么推进？");
  assert.equal(qaCalls[1].payload.conversation_history.length, 2);
  assert.equal(qaCalls[1].payload.conversation_history[0].role, "user");
  assert.equal(qaCalls[1].payload.conversation_history[0].text, "客户最关注什么？");
  assert.equal(qaCalls[1].payload.conversation_history[1].role, "assistant");
  assert.match(qaCalls[1].payload.conversation_history[1].text, /知识库产品|数据权限边界/);
  assert.equal(
    qaCalls[1].payload.conversation_history.some((message) => message.text === "那下一步怎么推进？"),
    false,
  );
});

test("QA restores recent turns and citations from OpenViking after a process restart", async () => {
  const sharedSessionMessages = new Map();
  const firstRuntime = createWorkflowService({ sharedSessionMessages });
  await firstRuntime.service.createDossier("company_1");
  await firstRuntime.service.askQuestion("company_1", { question: "客户最关注什么？" });

  const persistedSeed = structuredClone(firstRuntime.service.data);
  persistedSeed.qa_messages = { company_1: [] };
  const restartedRuntime = createWorkflowService({
    sharedSessionMessages,
    seedData: persistedSeed,
  });

  const restored = await restartedRuntime.service.getQa("company_1");
  assert.equal(restored.messages.length, 2);
  assert.equal(restored.messages[0].role, "user");
  assert.equal(restored.messages[0].text, "客户最关注什么？");
  assert.equal(restored.messages[1].role, "assistant");
  assert.equal(restored.messages[1].citations.length, 2);

  await restartedRuntime.service.askQuestion("company_1", { question: "那下一步怎么推进？" });
  const qaCall = restartedRuntime.modelCalls.find((call) => call.operation === "sales_qa");
  assert.equal(qaCall.payload.conversation_history.length, 2);
  assert.equal(qaCall.payload.conversation_history[0].text, "客户最关注什么？");
  assert.match(qaCall.payload.conversation_history[1].text, /知识库产品|数据权限边界/);
});

test("QA hides legacy dossier-memory answers and excludes them from follow-up context", async () => {
  const fixture = createWorkflowService();
  fixture.service.data.qa_messages.company_1.push(
    {
      id: "qa_user_legacy",
      role: "user",
      text: "旧问题",
      created_at: "2026-07-19T08:00:00.000Z",
    },
    {
      id: "qa_assistant_legacy",
      role: "assistant",
      text: "旧 Demo 回答",
      citations: [{
        id: "legacy_dossier_memory",
        source_kind: "内部资料",
        label: "旧档案记忆",
        uri: "viking://resources/workspaces/test/companies/company_1/dossiers/legacy.md",
      }],
      citation_ids: ["legacy_dossier_memory"],
      created_at: "2026-07-19T08:01:00.000Z",
    },
  );

  assert.deepEqual((await fixture.service.getQa("company_1")).messages, []);

  await fixture.service.createDossier("company_1");
  await fixture.service.askQuestion("company_1", { question: "当前重点是什么？" });
  const qaCall = fixture.modelCalls.find((call) => call.operation === "sales_qa");
  assert.deepEqual(qaCall.payload.conversation_history, []);
  assert.equal((await fixture.service.getQa("company_1")).messages.length, 2);
});

test("business responses do not expose OpenViking or provider raw references", async () => {
  const fixture = createWorkflowService();
  const dossier = await fixture.service.createDossier("company_1");
  const qa = await fixture.service.askQuestion("company_1", { question: "客户最关注什么？" });
  const materials = fixture.service.listMaterials("company_1");

  const publicPayload = JSON.stringify({ dossier: dossier.detail, qa: qa.message, materials });
  assert.doesNotMatch(publicPayload, /viking:\/\//i);
  assert.doesNotMatch(publicPayload, /model:/i);
  assert.equal(Object.hasOwn(materials[0], "openviking_uri"), false);
  assert.equal(materials[0].memory_ready, true);
  assert.equal(Object.hasOwn(dossier.detail, "raw_ref"), false);
  assert.equal(Object.hasOwn(dossier.detail, "evidence_pack"), false);
  assert.equal(Object.hasOwn(dossier.detail, "provider_run_id"), false);
  assert.equal(Object.hasOwn(dossier.detail, "memory_summary"), false);
});

test("QA public view hides legacy internal paths and resource identifiers", () => {
  const fixture = createWorkflowService();
  const publicMessage = fixture.service.publicQaMessage({
    id: "qa_internal_leak",
    role: "assistant",
    text: "资料位于 company_dp_1234567890 的 /materials/private 目录。",
    paragraphs: [{
      text: "OpenViking URI 是 viking://resources/private/materials/one。",
      citation_ids: [],
    }],
    citations: [],
    citation_ids: [],
  });

  assert.match(publicMessage.text, /已隐藏/);
  assert.match(publicMessage.paragraphs[0].text, /已隐藏/);
  assert.doesNotMatch(JSON.stringify(publicMessage), /company_dp_|\/materials\/|viking:\/\//i);
});

test("QA public view merges retrieval chunks from the same Feishu material", () => {
  const fixture = createWorkflowService();
  const publicMessage = fixture.service.publicQaMessage({
    id: "qa_duplicate_material_chunks",
    role: "assistant",
    text: "会议纪要显示当前仍处于方案验证阶段。",
    paragraphs: [
      {
        text: "客户首先关注数据权限边界。",
        citation_ids: ["chunk_1", "chunk_2"],
      },
      {
        text: "下一步需要确认试点范围和负责人。",
        citation_ids: ["chunk_3", "chunk_4"],
      },
    ],
    citations: [1, 2, 3, 4].map((index) => ({
      id: `chunk_${index}`,
      material_id: "material_1",
      source_kind: "飞书云文档",
      label: "客户需求确认会",
      uri: `viking://resources/workspace-test/companies/company_1/materials/material_1/chunks/${index}`,
    })),
    citation_ids: ["chunk_1", "chunk_2", "chunk_3", "chunk_4"],
  });

  assert.equal(publicMessage.citations.length, 1);
  assert.deepEqual(publicMessage.citation_ids, ["1"]);
  assert.deepEqual(publicMessage.paragraphs[0].citation_ids, ["1"]);
  assert.deepEqual(publicMessage.paragraphs[1].citation_ids, ["1"]);
  assert.equal(publicMessage.citations[0].label, "客户需求确认会");
});

test("QA removes legacy answers that only cite generic internal materials", async () => {
  const fixture = createWorkflowService();
  fixture.service.data.qa_messages.company_1.push(
    {
      id: "qa_user_generic_internal",
      role: "user",
      text: "旧版资料标题是什么？",
      created_at: "2026-07-19T09:00:00.000Z",
    },
    {
      id: "qa_assistant_generic_internal",
      role: "assistant",
      text: "这是旧版本根据正文推测出的标题。",
      citations: [{
        id: "material_1",
        source_kind: "内部资料",
        label: "内部资料",
        uri: "viking://resources/workspace-test/companies/company_1/materials/material_1.md",
      }],
      citation_ids: ["material_1"],
      created_at: "2026-07-19T09:01:00.000Z",
    },
  );

  assert.deepEqual((await fixture.service.getQa("company_1")).messages, []);

  await fixture.service.createDossier("company_1");
  await fixture.service.askQuestion("company_1", { question: "请使用正式标题回答。" });
  const qaCall = fixture.modelCalls.find((call) => call.operation === "sales_qa");
  assert.deepEqual(qaCall.payload.conversation_history, []);
});

test("legacy dossier summaries are converted into a six-section report without technical ids", () => {
  const fixture = createWorkflowService();
  const publicDossier = fixture.service.publicDossier({
    id: "legacy_dossier_1",
    company_id: "company_1",
    title: "测试科技有限公司最近档案",
    summary: "企业资料已更新。",
    version_no: 1,
    body: [
      {
        text: "企业情况：企业ID(关联主键):254716 | 企业ID(关联主键):58059066。",
        citation_ids: ["professional_1"],
      },
      {
        text: "近期动态：企业近期发布产品更新公告。",
        citation_ids: ["public_1"],
      },
      {
        text: "销售判断：可继续跟进。",
        citation_ids: ["professional_1", "public_1"],
      },
      {
        text: "下一步建议：确认业务场景。",
        citation_ids: ["public_1"],
      },
    ],
    citations: [
      {
        id: "professional_1",
        label: "企业工商数据库",
        source_kind: "专业数据集",
        summary: "公司名称:测试科技有限公司;经营范围:企业软件与知识库产品。",
        conflict_fields: ["registered_capital"],
      },
      {
        id: "public_1",
        label: "测试科技有限公司产品更新公告",
        source_kind: "联网搜索",
        summary: "测试科技有限公司近期发布产品更新公告。",
        url: "https://news.test/company-update",
      },
    ],
  });

  assert.equal(publicDossier.title, "测试科技有限公司 销售情报报告");
  assert.equal(publicDossier.body.length, 6);
  assert.deepEqual(
    publicDossier.body.map((paragraph) => paragraph.text.split("：")[0]),
    ["企业与业务概览", "经营与业务动态", "近期公开动态", "风险与关注事项", "销售机会判断", "建议行动"],
  );
  assert.doesNotMatch(JSON.stringify(publicDossier), /企业ID|关联主键|内部资料|OpenViking/i);
  assert.doesNotMatch(JSON.stringify(publicDossier), /关键字段存在来源差异|conflict_label/i);
});

test("public dossiers never expose stored retrieval diagnostics or source conflicts", () => {
  const fixture = createWorkflowService();
  const publicDossier = fixture.service.publicDossier({
    id: "diagnostic_dossier_1",
    company_id: "company_1",
    title: "测试科技有限公司销售情报报告",
    summary: "企业近期发布了产品更新公告。",
    body: [
      { text: "企业与业务概览：该企业经营范围包括企业软件、知识库建设和内容检索服务。", citation_ids: ["professional_1"] },
      { text: "经营与业务动态：本次未检索到可核验的经营变化，专业数据仅覆盖工商注册记录。", citation_ids: ["professional_1", "public_1"] },
      { text: "近期公开动态：企业于2026年7月发布产品更新公告，新增销售知识库协作功能。", citation_ids: ["public_1"] },
      { text: "风险与关注事项：资料缺口包括供应链交付明细，多个公开来源的经营数字口径冲突，因此不作为确定事实。", citation_ids: ["professional_1", "risk_public_1"] },
      { text: "销售机会判断：产品更新为销售知识库问答和协作检索试点提供了明确切入场景。", citation_ids: ["professional_1", "public_1"] },
      { text: "建议行动：1. 联系销售运营负责人。\n2. 核实知识库范围。\n3. 准备试点方案。", citation_ids: ["professional_1", "public_1"] },
    ],
    citations: [
      {
        id: "professional_1",
        label: "企业工商数据库",
        source_kind: "专业数据集",
        summary: "测试科技有限公司经营范围包括企业软件、知识库建设和内容检索服务。",
        conflict_fields: ["revenue"],
      },
      {
        id: "public_1",
        label: "测试科技有限公司产品更新公告",
        source_kind: "联网搜索",
        summary: "企业于2026年7月发布产品更新公告，新增销售知识库协作功能。",
        url: "https://news.test/company-update",
      },
      {
        id: "risk_public_1",
        label: "测试科技有限公司供应链交付公告",
        source_kind: "联网搜索",
        summary: "企业公告披露部分核心组件交付周期延长，可能影响重点项目的实施排期。",
        url: "https://news.test/company-risk",
      },
    ],
  });

  const serialized = JSON.stringify(publicDossier);
  assert.equal(publicDossier.body.length, 6);
  assert.doesNotMatch(
    serialized,
    /本次未检索到|资料缺口|关键字段存在来源差异|来源冲突|口径冲突|不作为确定事实|conflict_label/i,
  );
  assert.match(publicDossier.body[3].text, /核心组件交付周期延长/);
  const professionalPublicId = publicDossier.citations.find((item) => item.label === "企业工商数据库")?.id;
  const riskPublicId = publicDossier.citations.find((item) => item.label === "测试科技有限公司供应链交付公告")?.id;
  assert.ok(publicDossier.body[3].citation_ids.includes(professionalPublicId));
  assert.ok(publicDossier.body[3].citation_ids.includes(riskPublicId));
});

test("public dossiers normalize Chinese punctuation and remove placeholder citations", () => {
  const fixture = createWorkflowService();
  const publicDossier = fixture.service.publicDossier({
    id: "punctuation_dossier_1",
    company_id: "company_1",
    title: "测试科技有限公司销售情报报告",
    summary: "企业近期发布产品升级公告。",
    body: [
      {
        text: "企业与业务概览：测试科技有限公司(简称:“测试科技”,TEST.SZ)主营企业软件,面向销售团队提供知识库产品;",
        citation_ids: ["professional_main"],
      },
      {
        text: "经营与业务动态：公司于2026年7月发布产品升级公告,产品使用率达到25%,587Ah 规格已进入交付阶段,相关收入为2,769.17万元;",
        citation_ids: ["public_business", "public_untitled"],
      },
      {
        text: "近期公开动态：公司官网于2026年7月披露合作计划,将推进客户服务场景落地;",
        citation_ids: ["public_latest"],
      },
      {
        text: "风险与关注事项：公开公告提示部分项目交付周期可能延长,需核实实施排期;",
        citation_ids: ["public_risk"],
      },
      {
        text: "销售机会判断：产品升级形成明确切入场景,可优先确认试点部门与预算窗口;",
        citation_ids: ["professional_main", "public_business"],
      },
      {
        text: "建议行动：1. 联系销售运营负责人; 2. 核实试点范围; 3. 准备交付计划;",
        citation_ids: ["professional_main", "public_business"],
      },
    ],
    citations: [
      {
        id: "professional_main",
        label: "企业工商数据库",
        source_kind: "专业数据集",
        summary: "测试科技有限公司主营企业软件，面向销售团队提供知识库产品。",
      },
      {
        id: "public_business",
        label: "测试科技有限公司产品升级公告",
        source_kind: "联网搜索",
        summary: "公司于2026年7月发布产品升级公告，产品使用率达到25%，587Ah 规格已进入交付阶段，相关收入为2,769.17万元。",
        url: "https://news.test/product-update",
      },
      {
        id: "public_latest",
        label: "测试科技有限公司合作计划",
        source_kind: "联网搜索",
        summary: "公司官网于2026年7月披露合作计划，将推进客户服务场景落地。",
        url: "https://news.test/cooperation",
      },
      {
        id: "public_risk",
        label: "测试科技有限公司项目交付公告",
        source_kind: "联网搜索",
        summary: "公开公告提示部分项目交付周期可能延长，需核实实施排期。",
        url: "https://news.test/delivery",
      },
      {
        id: "public_untitled",
        label: "Untitled",
        source_kind: "联网搜索",
        summary: "无有效标题的搜索结果。",
        url: "https://news.test/untitled",
      },
    ],
  });

  const bodyText = publicDossier.body.map((paragraph) => paragraph.text).join("\n");
  assert.match(
    publicDossier.body[0].text,
    /公司（简称：“测试科技”，TEST\.SZ）主营企业软件，面向销售团队提供知识库产品。/,
  );
  assert.doesNotMatch(bodyText, /(?<!\d),|,(?!\d)|;/u);
  assert.match(publicDossier.body[1].text, /达到25%，587Ah/);
  assert.match(publicDossier.body[1].text, /2,769\.17万元/);
  assert.doesNotMatch(
    publicDossier.citations.map((citation) => citation.label).join("\n"),
    /Untitled/i,
  );
  assert.ok(publicDossier.body.every((paragraph) => (
    paragraph.text
      .split(/\n+/u)
      .filter(Boolean)
      .every((line) => /[。！？]$/u.test(line))
  )));
});

test("public dossiers remove website-production case studies and rebuild recent dynamics from substantive events", () => {
  const fixture = createWorkflowService();
  const publicDossier = fixture.service.publicDossier({
    id: "source_quality_dossier_1",
    company_id: "company_1",
    title: "测试科技有限公司销售情报报告",
    summary: "测试科技有限公司近期披露客户服务产品合作计划。",
    body: [
      {
        text: "企业与业务概览：测试科技有限公司主营企业软件与知识库产品。",
        citation_ids: ["professional_main"],
      },
      {
        text: "经营与业务动态：测试科技有限公司持续推进企业软件与客户服务产品。",
        citation_ids: ["professional_main"],
      },
      {
        text: "近期公开动态：经过项目团队数月建设，测试科技有限公司全新品牌官网上线；测试科技有限公司于2026年7月签署客户服务产品合作协议。",
        citation_ids: ["website_case", "official_cooperation"],
      },
      {
        text: "风险与关注事项：商务推进应确认数据合规、合同责任与交付排期。",
        citation_ids: ["professional_main"],
      },
      {
        text: "销售机会判断：客户服务产品合作形成了可继续核验的业务切入点。",
        citation_ids: ["professional_main", "official_cooperation"],
      },
      {
        text: "建议行动：1. 确认合作项目牵头部门。\n2. 核验采购范围与预算窗口。\n3. 准备客户服务产品方案。",
        citation_ids: ["professional_main", "official_cooperation"],
      },
    ],
    citations: [
      {
        id: "professional_main",
        label: "企业工商数据库",
        source_kind: "专业数据集",
        summary: "公司名称：测试科技有限公司；经营范围：企业软件与知识库产品。",
      },
      {
        id: "website_case",
        label: "测试科技有限公司网站建设｜企业官网全面焕新",
        source_kind: "联网搜索",
        summary: "经过项目团队数月建设，测试科技有限公司全新品牌官网上线，这是网站建设服务商的客户案例。",
        url: "https://agency.test/cases/test-company",
        published_at: "2026-07-18T09:00:00.000Z",
      },
      {
        id: "generic_homepage",
        label: "测试科技有限公司 · TEST",
        source_kind: "联网搜索",
        summary: "测试科技有限公司面向企业客户提供软件与知识库产品。",
        url: "https://test-company.test/",
      },
      {
        id: "official_product",
        label: "测试科技有限公司发布企业知识库产品升级公告",
        source_kind: "联网搜索",
        summary: "测试科技有限公司于2026年7月发布企业知识库产品升级公告，新增面向销售团队的协作能力。",
        url: "https://test-company.test/news/product-update",
        published_at: "2026-07-20T09:00:00.000Z",
        auth_level: 3,
      },
      {
        id: "official_cooperation",
        label: "测试科技有限公司客户服务产品合作公告",
        source_kind: "联网搜索",
        summary: "测试科技有限公司于2026年7月签署客户服务产品合作协议，双方将推进知识库产品在客户服务场景落地。",
        url: "https://test-company.test/news/cooperation",
        published_at: "2026-07-21T09:00:00.000Z",
        auth_level: 3,
      },
    ],
  });

  const serialized = JSON.stringify(publicDossier);
  assert.doesNotMatch(serialized, /网站建设|官网全面焕新|项目团队数月建设|网站建设服务商/);
  assert.match(publicDossier.body[2].text, /客户服务产品合作协议|客户服务场景落地/);
  assert.doesNotMatch(publicDossier.body[2].text, /测试科技有限公司 · TEST/);
  assert.ok(publicDossier.body[2].citation_ids.length > 0);
  const recentCitationLabels = publicDossier.body[2].citation_ids.map((id) => (
    publicDossier.citations.find((citation) => citation.id === id)?.label
  ));
  assert.deepEqual(recentCitationLabels, ["测试科技有限公司客户服务产品合作公告"]);
});

test("public dossiers replace malformed search snippets and exclude branch records from the company overview", () => {
  const fixture = createWorkflowService();
  const publicDossier = fixture.service.publicDossier({
    id: "malformed_dossier_1",
    company_id: "company_1",
    title: "测试科技有限公司销售情报报告",
    summary: "企业近期发布产品升级公告。",
    body: [
      { text: "企业与业务概览：测试科技有限公司持续经营企业软件业务。", citation_ids: ["professional_main"] },
      { text: "经营与业务动态：测试科技有限公司(简称:“测试科技”,TEST.SZ)发布产品升级公告,将面向销售团队推出知识库协作功能;", citation_ids: ["public_business", "public_untitled"] },
      { text: "近期公开动态：媒体 作者 7月25日 测试科技有限公司（简称“测试科技”。", citation_ids: ["public_business"] },
      { text: "风险与关注事项：公开摘要显示净利润432。", citation_ids: ["public_risk"] },
      { text: "销售机会判断：可围绕企业软件产品升级验证销售知识库场景。", citation_ids: ["professional_main", "public_business"] },
      { text: "建议行动：1. 联系产品负责人。2. 核实试点范围。3. 准备交付计划。", citation_ids: ["professional_main", "public_business"] },
    ],
    citations: [
      {
        id: "professional_main",
        label: "企业工商数据库 · 记录 1",
        source_kind: "专业数据集",
        summary: "公司名称：测试科技有限公司；统一社会信用代码：TEST0001；法定代表人：张三；注册地址：北京市海淀区；成立日期：2020-01-01。",
      },
      {
        id: "professional_branch",
        label: "企业工商数据库 · 记录 2",
        source_kind: "专业数据集",
        summary: "公司名称：测试科技有限公司上海分公司；统一社会信用代码：BRANCH0001；法定代表人：李四；注册地址：上海市徐汇区；成立日期：2023-01-01。",
      },
      {
        id: "public_business",
        label: "测试科技有限公司于2026年7月发布销售知识库产品升级公告_产业观察",
        source_kind: "联网搜索",
        summary: "媒体 作者 7月25日 测试科技有限公司（简称“测试科技”，立即注册查看更多相关信息。",
        url: "https://news.test/product-update",
      },
      {
        id: "public_risk",
        label: "测试科技有限公司核心组件交付延期公告",
        source_kind: "联网搜索",
        summary: "公司公告披露部分核心组件交付周期延长，可能影响重点项目的实施排期。",
        url: "https://news.test/delivery-risk",
      },
      {
        id: "public_untitled",
        label: "Untitled",
        source_kind: "联网搜索",
        summary: "无有效标题的搜索结果。",
        url: "https://news.test/untitled",
      },
    ],
  });

  const serialized = JSON.stringify(publicDossier);
  assert.doesNotMatch(serialized, /立即注册|查看更多|净利润432|上海分公司|BRANCH0001|Untitled/);
  assert.match(publicDossier.body[0].text, /测试科技有限公司/);
  assert.match(publicDossier.body[1].text, /2026年7月发布销售知识库产品升级公告/);
  assert.match(publicDossier.body[3].text, /核心组件交付周期延长/);
  assert.match(publicDossier.body[5].text, /1\..*\n2\..*\n3\./);
  assert.doesNotMatch(publicDossier.body[2].text, /2026年7月发布销售知识库产品升级公告/);
  assert.doesNotMatch(publicDossier.body[1].text, /核心组件交付周期延长/);
  assert.ok(publicDossier.body.every((paragraph) => (
    paragraph.text
      .split(/\n+/u)
      .filter(Boolean)
      .every((line) => /[。！？]$/u.test(line))
  )));
  assert.deepEqual(
    publicDossier.citations.map((citation) => citation.label),
    [
      "企业工商数据库 · 记录 1",
      "测试科技有限公司于2026年7月发布销售知识库产品升级公告",
      "测试科技有限公司核心组件交付延期公告",
    ],
  );
  assert.equal(
    publicDossier.citations.find((citation) => /产品升级公告/.test(citation.label))?.summary,
    "测试科技有限公司于2026年7月发布销售知识库产品升级公告",
  );
  assert.equal(publicDossier.body.length, 6);
});

test("public dossiers remove search metadata, repeated sections, and risks attributed to another company", () => {
  const fixture = createWorkflowService();
  fixture.service.data.companies.company_1 = {
    ...fixture.service.data.companies.company_1,
    name: "宁德时代新能源科技股份有限公司",
    aliases: ["宁德时代"],
    industry: "新能源",
  };
  const repeatedBusinessPoint = "宁德时代于2026年7月披露储能合作和产线建设进展，相关项目处于持续推进阶段。";
  const publicDossier = fixture.service.publicDossier({
    id: "cross_entity_risk_dossier_1",
    company_id: "company_1",
    title: "宁德时代新能源科技股份有限公司销售情报报告",
    summary: "宁德时代近期披露多项储能合作和产线建设进展。",
    body: [
      {
        text: "企业与业务概览：宁德时代新能源科技股份有限公司主营动力电池、储能电池及相关系统产品。",
        citation_ids: ["professional_main"],
      },
      {
        text: `经营与业务动态：近期公开披露的业务动作包括：${repeatedBusinessPoint}`,
        citation_ids: ["public_business"],
      },
      {
        text: `近期公开动态：${repeatedBusinessPoint}`,
        citation_ids: ["public_business", "public_metadata"],
      },
      {
        text: "风险与关注事项：北京永勤律师事务所律师表示，相关投资者可以请求赔偿。",
        citation_ids: ["public_wrong_risk", "professional_main"],
      },
      {
        text: "销售机会判断：储能合作和产线建设为设备、系统集成和供应链协同提供了跟进场景。",
        citation_ids: ["professional_main", "public_business"],
      },
      {
        text: "建议行动：1. 核验项目阶段。2. 联系采购负责人。3. 准备供应方案。",
        citation_ids: ["professional_main", "public_business"],
      },
    ],
    citations: [
      {
        id: "professional_main",
        label: "企业工商数据库",
        source_kind: "专业数据集",
        summary: "公司名称：宁德时代新能源科技股份有限公司；统一社会信用代码：TESTCATL001；经营范围：动力电池、储能电池及相关系统产品。",
      },
      {
        id: "public_business",
        label: "宁德时代披露储能合作和产线建设进展",
        source_kind: "联网搜索",
        summary: repeatedBusinessPoint,
        url: "https://news.test/catl-business",
      },
      {
        id: "public_metadata",
        label: "1000Wh时代!宁德时代即将迈入",
        source_kind: "联网搜索",
        summary: "1000Wh时代!宁德时代即将迈入 2026年06月28日 23:53 市场资讯 (来源：连线新能源 NELinked) 近日，宁德时代发布新一代储能电池产品。",
        url: "https://news.test/catl-storage",
      },
      {
        id: "public_wrong_risk",
        label: "1200亿“画饼”宁德时代被罚，容百科技投资者可以索赔了!",
        source_kind: "联网搜索",
        summary: "文章标题提到宁德时代被罚，但北京永勤律师事务所金融律师表示，实际索赔对象为容百科技部分投资者。",
        url: "https://news.test/other-company-risk",
      },
    ],
  });

  const serialized = JSON.stringify(publicDossier);
  assert.equal(publicDossier.body.length, 6);
  assert.doesNotMatch(serialized, /市场资讯|来源：连线新能源|北京永勤|容百科技|请求赔偿/);
  assert.doesNotMatch(
    publicDossier.citations.map((citation) => citation.label).join("\n"),
    /容百科技/,
  );
  assert.notEqual(publicDossier.body[1].text, publicDossier.body[2].text);
  assert.match(publicDossier.body[2].text, /储能电池产品|储能合作/);
  assert.match(publicDossier.body[3].text, /供应商准入|合同责任|供应保障|交付排期/);
  assert.match(publicDossier.body[5].text, /1\..*\n2\..*\n3\./);
});

test("dossier generation reconstructs a useful report after two repetitive malformed model answers", async () => {
  const modelCalls = [];
  const service = new SalesService({
    env: envReader({ APP_WORKSPACE_ID: "workspace-test" }),
    runtimePolicy: developmentPolicy,
    seed: seed(),
    modelProvider: {
      isRunEnabled: () => true,
      async callJson(input) {
        modelCalls.push(input);
        return {
          ok: true,
          parsed: {
            title: "测试科技有限公司销售情报报告",
            summary: "相同内容",
            body: [
              "企业与业务概览",
              "经营与业务动态",
              "近期公开动态",
              "风险与关注事项",
              "销售机会判断",
              "建议行动",
            ].map((title) => ({
              text: `${title}：企业近期发布产品升级公告并需要继续关注`,
              citation_ids: ["1"],
            })),
            memory_summary: "相同内容",
          },
          usage: { prompt_tokens: 30, completion_tokens: 20, total_tokens: 50 },
          raw_ref: `model:invalid-${modelCalls.length}`,
        };
      },
    },
  });
  const company = service.data.companies.company_1;
  const dossier = await service.generateDossierWithModel(company, {
    professional: [
      {
        label: "企业工商数据库",
        summary: "公司名称：测试科技有限公司；统一社会信用代码：TEST0001；经营范围：企业软件与知识库产品。",
      },
      {
        label: "企业风险数据库",
        summary: "风险状态需要结合公开公告持续关注。",
      },
    ],
    public_sources: [
      {
        label: "测试科技有限公司产品升级公告",
        summary: "测试科技有限公司于2026年7月发布销售知识库产品升级公告。",
        url: "https://news.test/product-update",
        published_at: "2026-07-20T09:00:00.000Z",
      },
      {
        label: "测试科技有限公司核心组件交付延期公告",
        summary: "企业公告披露部分核心组件交付周期延长，可能影响重点项目的实施排期。",
        url: "https://news.test/delivery-risk",
        published_at: "2026-07-21T09:00:00.000Z",
      },
    ],
  }, []);

  assert.equal(modelCalls.length, 2);
  assert.ok(dossier);
  assert.equal(dossier.body.length, 6);
  assert.match(dossier.body[1].text, /销售知识库产品升级公告/);
  assert.match(dossier.body[3].text, /核心组件交付周期延长/);
  assert.doesNotMatch(dossier.body[2].text, /销售知识库产品升级公告/);
  assert.doesNotMatch(dossier.body[1].text, /核心组件交付周期延长/);
  assert.ok(dossier.body.every((paragraph) => (
    paragraph.text
      .split(/\n+/u)
      .filter(Boolean)
      .every((line) => /[。！？]$/u.test(line))
  )));
});

test("production reconstruction keeps target-company collaboration news after an invalid repair response", async () => {
  const modelCalls = [];
  const service = new SalesService({
    env: envReader({ APP_WORKSPACE_ID: "workspace-test" }),
    runtimePolicy: productionPolicy,
    seed: seed(),
    modelProvider: {
      isRunEnabled: () => true,
      async callJson(input) {
        modelCalls.push(input);
        if (modelCalls.length === 2) {
          return {
            ok: false,
            error: {
              code: "invalid_json",
              message: "The repair response was truncated.",
            },
          };
        }
        return {
          ok: true,
          parsed: {
            title: "宁德时代新能源科技股份有限公司销售情报报告",
            summary: "重复且引用错误的模型结果。",
            body: [
              "企业与业务概览",
              "经营与业务动态",
              "近期公开动态",
              "风险与关注事项",
              "销售机会判断",
              "建议行动",
            ].map((title) => ({
              text: `${title}：企业近期发布合作信息，需要销售团队继续关注。`,
              citation_ids: ["1"],
            })),
            memory_summary: "重复且引用错误的模型结果。",
          },
          usage: { prompt_tokens: 30, completion_tokens: 20, total_tokens: 50 },
          raw_ref: "model:invalid-collaboration-dossier",
        };
      },
    },
  });
  const company = {
    ...service.data.companies.company_1,
    name: "宁德时代新能源科技股份有限公司",
    aliases: ["宁德时代"],
    industry: "新能源",
  };
  const dossier = await service.generateDossierWithModel(company, {
    professional: [
      {
        label: "企业工商数据库",
        summary: "公司名称：宁德时代新能源科技股份有限公司；统一社会信用代码：TESTCATL001；经营范围：动力电池、储能电池及相关系统产品。",
      },
      {
        label: "金融数据库",
        summary: "宁德时代新能源科技股份有限公司持续开展动力电池、储能系统及相关产业链业务。",
      },
      {
        label: "企业风险数据库",
        summary: "宁德时代新能源科技股份有限公司的供应链履约、项目交付与合同责任需要持续核验。",
      },
    ],
    public_sources: [
      {
        label: "宁德时代与大连德泰签署战略合作协议",
        summary: "宁德时代新能源科技股份有限公司与大连德泰有限公司签署战略合作协议，双方将推进储能项目建设与运营。",
        url: "https://news.test/catl-deta-cooperation",
        published_at: "2026-07-23T09:00:00.000Z",
      },
    ],
  }, []);

  assert.equal(modelCalls.length, 2);
  assert.ok(dossier);
  assert.equal(dossier.body.length, 6);
  assert.match(dossier.body[2].text, /大连德泰|储能项目建设与运营/);
  const publicCitationId = dossier.citations.find((item) => item.source_kind === "联网搜索")?.id;
  assert.ok(publicCitationId);
  assert.ok(dossier.body[2].citation_ids.includes(publicCitationId));
  assert.ok(dossier.body.every((paragraph) => (
    paragraph.text
      .split(/\n+/u)
      .filter(Boolean)
      .every((line) => /[。！？]$/u.test(line))
  )));
});

test("dossier reconstruction ignores empty specialized databases when enforcing section sources", async () => {
  const service = new SalesService({
    env: envReader({ APP_WORKSPACE_ID: "workspace-test" }),
    runtimePolicy: developmentPolicy,
    seed: seed(),
    modelProvider: {
      isRunEnabled: () => true,
      async callJson() {
        return {
          ok: true,
          parsed: {
            title: "测试科技有限公司销售情报报告",
            summary: "无效重复内容",
            body: [
              "企业与业务概览",
              "经营与业务动态",
              "近期公开动态",
              "风险与关注事项",
              "销售机会判断",
              "建议行动",
            ].map((title) => ({
              text: `${title}：企业近期发布产品升级公告并需要继续关注`,
              citation_ids: ["1"],
            })),
            memory_summary: "无效重复内容",
          },
          usage: { prompt_tokens: 30, completion_tokens: 20, total_tokens: 50 },
          raw_ref: "model:invalid-specialized-sources",
        };
      },
    },
  });
  const company = service.data.companies.company_1;
  const dossier = await service.generateDossierWithModel(company, {
    professional: [
      {
        label: "企业工商数据库",
        summary: "公司名称：测试科技有限公司；统一社会信用代码：TEST0001；经营范围：企业软件与知识库产品。",
      },
      {
        label: "企业风险数据库",
        summary: "本次未检索到可核验的司法、处罚或失信记录。",
      },
      {
        label: "金融数据库",
        summary: "企业ID(关联主键):254716。",
      },
    ],
    public_sources: [
      {
        label: "测试科技有限公司产品升级公告",
        summary: "测试科技有限公司于2026年7月发布销售知识库产品升级公告。",
        url: "https://news.test/product-update",
        published_at: "2026-07-20T09:00:00.000Z",
      },
      {
        label: "测试科技有限公司核心组件交付延期公告",
        summary: "企业公告披露部分核心组件交付周期延长，可能影响重点项目的实施排期。",
        url: "https://news.test/delivery-risk",
        published_at: "2026-07-21T09:00:00.000Z",
      },
    ],
  }, []);

  assert.ok(dossier);
  assert.equal(dossier.body.length, 6);
  assert.doesNotMatch(JSON.stringify(dossier.body), /企业ID|本次未检索到/);
  assert.ok(dossier.body.every((paragraph) => (
    paragraph.text
      .split(/\n+/u)
      .filter(Boolean)
      .every((line) => /[。！？]$/u.test(line))
  )));
});

test("production rejects a QA answer that fabricates citation identifiers", async () => {
  const service = new SalesService({
    env: envReader(),
    runtimePolicy: productionPolicy,
    seed: seed(),
    modelProvider: {
      isRunEnabled: () => true,
      async callJson() {
        return {
          ok: true,
          parsed: {
            paragraphs: [{ text: "这是一个没有真实来源的结论。", citation_ids: ["invented-source"] }],
            insufficient: false,
          },
        };
      },
    },
  });

  await assert.rejects(
    () => service.generateQaAnswer(
      service.data.companies.company_1,
      "测试问题",
      null,
      [],
      [{ id: "evidence_real", label: "真实来源", source_kind: "专业数据集", summary: "真实内容" }],
    ),
    (error) => error.status === 503
      && error.code === "model_unavailable"
      && error.details.validation_errors.some((item) => item.includes("无效引用")),
  );
});

test("production repairs a malformed QA JSON response from the original model output", async () => {
  const calls = [];
  const service = new SalesService({
    env: envReader(),
    runtimePolicy: productionPolicy,
    seed: seed(),
    modelProvider: {
      isRunEnabled: () => true,
      async callJson(input) {
        calls.push(structuredClone(input));
        if (calls.length === 1) {
          return {
            ok: false,
            error: {
              code: "invalid_json",
              message: "Unterminated string in JSON response.",
            },
            invalid_content: "{\"paragraphs\":[{\"text\":\"结论：企业正在推进扩产计划",
          };
        }
        return {
          ok: true,
          parsed: {
            paragraphs: [
              {
                text: "结论：现有资料显示企业正在推进扩产计划。",
                citation_ids: ["evidence_real"],
              },
              {
                text: "下一步：核验采购时间表和预算窗口。",
                citation_ids: ["evidence_real"],
              },
            ],
            insufficient: false,
          },
          usage: { prompt_tokens: 160, completion_tokens: 80, total_tokens: 240 },
          raw_ref: "model:qa-retry",
        };
      },
    },
  });

  const answer = await service.generateQaAnswer(
    service.data.companies.company_1,
    "扩产计划和下一步行动是什么？",
    null,
    [],
    [{
      id: "evidence_real",
      label: "企业档案",
      source_kind: "企业档案",
      summary: "企业正在推进扩产计划，下一步需核验采购时间表和预算窗口。",
    }],
  );

  assert.equal(calls.length, 2);
  assert.equal(calls[0].operation, "sales_qa");
  assert.equal(calls[0].maxTokens, 1600);
  assert.equal(calls[1].operation, "sales_qa_json_repair");
  assert.equal(calls[1].maxTokens, 2200);
  assert.equal(
    calls[1].payload.invalid_json_content,
    "{\"paragraphs\":[{\"text\":\"结论：企业正在推进扩产计划",
  );
  assert.equal(answer.insufficient, false);
  assert.match(answer.text, /扩产计划/);
  assert.deepEqual(answer.citation_ids, ["evidence_real"]);
});

test("production retries a QA answer that omits explicit table items", async () => {
  const calls = [];
  const evidence = [{
    id: "evidence_capabilities",
    label: "个人投资助手 CookBook",
    source_kind: "飞书云文档",
    retrieval_score: 0.9,
    summary: [
      "| 能力点 | 说明 |",
      "|-|-|",
      "| 语言模型 | 完成需求理解 |",
      "| Claude code/ Agent 能力 | 负责任务编排 |",
      "| 联网搜索 | 补充公开动态 |",
      "| Data MCP：股票金融数据/国内企业工商数据 | 查询专业数据 |",
      "| 多工具兼容 | 支持多个 Agent 平台 |",
      "| 消耗统一计量 | 控制台查看消耗 |",
    ].join(" "),
  }];
  const service = new SalesService({
    env: envReader(),
    runtimePolicy: productionPolicy,
    seed: seed(),
    modelProvider: {
      isRunEnabled: () => true,
      async callJson(input) {
        calls.push(structuredClone(input));
        const complete = input.operation === "sales_qa_quality_retry";
        return {
          ok: true,
          parsed: {
            paragraphs: [{
              text: complete
                ? "文档列出的能力包括语言模型、Claude Code/Agent 能力、联网搜索、Data MCP、多工具兼容和消耗统一计量。"
                : "文档列出的能力包括语言模型、Claude Code、联网搜索和 Data MCP。",
              citation_ids: ["evidence_capabilities"],
            }],
            insufficient: false,
          },
          usage: { prompt_tokens: 160, completion_tokens: 80, total_tokens: 240 },
          raw_ref: complete ? "model:qa-quality-retry" : "model:qa-incomplete",
        };
      },
    },
  });

  const answer = await service.generateQaAnswer(
    service.data.companies.company_1,
    "这份文档明确使用了哪些核心能力？",
    null,
    [],
    evidence,
  );

  assert.equal(calls.length, 2);
  assert.equal(calls[0].operation, "sales_qa");
  assert.equal(calls[1].operation, "sales_qa_quality_retry");
  assert.deepEqual(
    calls[0].payload.enumeration_requirements.map((item) => item.label),
    ["语言模型", "Claude code/ Agent 能力", "联网搜索", "Data MCP:股票金融数据/国内企业工商数据", "多工具兼容", "消耗统一计量"],
  );
  assert.ok(calls[1].payload.validation_feedback.some((item) => item.includes("多工具兼容")));
  assert.match(answer.text, /消耗统一计量/);
});

test("production retries a QA answer with invalid citations and keeps fail-closed validation", async () => {
  const calls = [];
  const service = new SalesService({
    env: envReader(),
    runtimePolicy: productionPolicy,
    seed: seed(),
    modelProvider: {
      isRunEnabled: () => true,
      async callJson(input) {
        calls.push(structuredClone(input));
        const corrected = input.operation === "sales_qa_quality_retry";
        return {
          ok: true,
          parsed: {
            paragraphs: [{
              text: corrected
                ? "Trace 通过唯一 Trace ID 串联一次完整调用，Span 表示其中的单个执行节点。"
                : "Trace 通过唯一 Trace ID 串联一次完整调用，Span 表示其中的单个执行节点。",
              citation_ids: [corrected ? "evidence_trace" : "1"],
            }],
            insufficient: false,
          },
          usage: { prompt_tokens: 160, completion_tokens: 80, total_tokens: 240 },
          raw_ref: corrected ? "model:qa-citation-retry" : "model:qa-invalid-citation",
        };
      },
    },
  });

  const answer = await service.generateQaAnswer(
    service.data.companies.company_1,
    "Trace 和 Span 分别承担什么作用？",
    null,
    [],
    [{
      id: "evidence_trace",
      label: "方舟全链路数据体系建设研讨会",
      source_kind: "飞书云文档",
      summary: "Trace 通过唯一 Trace ID 串联一次完整调用；每个执行节点对应一个 Span。",
    }],
  );

  assert.equal(calls.length, 2);
  assert.equal(calls[0].operation, "sales_qa");
  assert.equal(calls[1].operation, "sales_qa_quality_retry");
  assert.ok(calls[1].payload.validation_feedback.some((item) => item.includes("无效引用")));
  assert.deepEqual(answer.citation_ids, ["evidence_trace"]);
  assert.equal(answer.citations[0].label, "方舟全链路数据体系建设研讨会");
});

test("QA workflow preserves bounded citation validation diagnostics in the failed provider run", async () => {
  const fixture = createWorkflowService();
  fixture.service.modelProvider = {
    isRunEnabled: () => true,
    async callJson() {
      return {
        ok: true,
        parsed: {
          paragraphs: [{
            text: "客户希望先验证知识库问答，并确认数据权限边界。",
            citation_ids: ["invented-source"],
          }],
          insufficient: false,
        },
      };
    },
  };
  const generateQaAnswer = fixture.service.generateQaAnswer.bind(fixture.service);
  fixture.service.generateQaAnswer = async (...args) => {
    const previousPolicy = fixture.service.runtimePolicy;
    fixture.service.runtimePolicy = { ...previousPolicy, fail_closed: true };
    try {
      return await generateQaAnswer(...args);
    } finally {
      fixture.service.runtimePolicy = previousPolicy;
    }
  };

  await assert.rejects(
    () => fixture.service.askQuestion("company_1", { question: "客户希望先验证什么？" }),
    (error) => error.code === "model_unavailable",
  );

  const [run] = await fixture.service.listProviderRuns({
    operation: "sales_qa",
    entity_id: "company_1",
  });
  assert.equal(run.status, "failed");
  assert.ok(run.error.validation_errors.some((item) => item.includes("无效引用")));
  assert.equal((await fixture.service.getJob(run.job_id)).status, "failed");
});

test("cancelled jobs remain cancelled when a late workflow completion arrives", async () => {
  const fixture = createWorkflowService();
  const job = await fixture.service.startJob({
    job_type: "sales_dossier_generation",
    entity_type: "target_enterprise",
    entity_id: "company_1",
    max_attempts: 3,
    request: {},
  });

  const cancelled = await fixture.service.cancelJob(job.id);
  assert.equal(cancelled.status, "cancelled");
  assert.ok(cancelled.cancel_requested_at);

  await fixture.service.completeJob(job.id, { result_ref: "late-result" });
  await fixture.service.failJob(job.id, { code: "late-error", message: "late error" });
  const afterLateWrites = await fixture.service.getJob(job.id);
  assert.equal(afterLateWrites.status, "cancelled");
  assert.equal(afterLateWrites.result_ref, null);
  assert.equal(afterLateWrites.error, null);
});

test("failed jobs remain failed when a late workflow completion arrives", async () => {
  const fixture = createWorkflowService();
  const job = await fixture.service.startJob({
    job_type: "sales_dossier_generation",
    entity_type: "target_enterprise",
    entity_id: "company_1",
    max_attempts: 3,
    request: {},
  });

  await fixture.service.failJob(job.id, {
    code: "provider_timeout",
    message: "provider timeout",
    retryable: true,
  });
  await fixture.service.completeJob(job.id, { result_ref: "late-result" });

  const afterLateCompletion = await fixture.service.getJob(job.id);
  assert.equal(afterLateCompletion.status, "failed");
  assert.equal(afterLateCompletion.result_ref, null);
  assert.equal(afterLateCompletion.error.code, "provider_timeout");
});

test("manual retry reuses a failed dossier job and increments its attempt", async () => {
  const fixture = createWorkflowService();
  const job = await fixture.service.startJob({
    job_type: "sales_dossier_generation",
    entity_type: "target_enterprise",
    entity_id: "company_1",
    max_attempts: 3,
    request: {},
  });
  await fixture.service.failJob(job.id, {
    code: "temporary_provider_error",
    message: "temporary provider error",
    retryable: true,
  });

  const result = await fixture.service.retryJob(job.id);
  const retried = await fixture.service.getJob(job.id);
  assert.equal(result.job_id, job.id);
  assert.equal(result.action, "created");
  assert.equal(retried.status, "succeeded");
  assert.equal(retried.attempt_count, 2);
  assert.equal(retried.error, null);
});

test("manual retry rejects terminal success and exhausted attempts", async () => {
  const fixture = createWorkflowService();
  const succeeded = await fixture.service.startJob({
    job_type: "sales_dossier_generation",
    entity_type: "target_enterprise",
    entity_id: "company_1",
    max_attempts: 3,
  });
  await fixture.service.completeJob(succeeded.id);
  await assert.rejects(
    () => fixture.service.retryJob(succeeded.id),
    (error) => error.status === 409 && error.code === "job_not_retryable",
  );

  const exhausted = await fixture.service.startJob({
    job_type: "sales_dossier_generation",
    entity_type: "target_enterprise",
    entity_id: "company_1",
    max_attempts: 1,
  });
  await fixture.service.failJob(exhausted.id, { code: "failed", message: "failed" });
  await assert.rejects(
    () => fixture.service.retryJob(exhausted.id),
    (error) => error.status === 409 && error.code === "job_attempts_exhausted",
  );
});
