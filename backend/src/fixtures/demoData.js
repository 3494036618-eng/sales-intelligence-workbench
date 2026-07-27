export const sources = {
  lingxiBiz: { id: "lingxiBiz", type: "企业工商数据库", label: "灵犀影像科技有限公司工商记录", url: "datapro://company/lingxi-video" },
  lingxiIp: { id: "lingxiIp", type: "知识产权数据库", label: "视频生成工作流软件著作权记录", url: "datapro://ip/lingxi-video" },
  lingxiNews: { id: "lingxiNews", type: "官网新闻", label: "灵犀影像官网新闻", url: "https://example.com/lingxi/news" },
  flowNews: { id: "flowNews", type: "官网新闻", label: "FlowFrame 官网新闻", url: "https://example.com/flowframe/news" },
  flowDocs: { id: "flowDocs", type: "文档站", label: "FlowFrame 文档站", url: "https://example.com/flowframe/docs" },
  flowPrice: { id: "flowPrice", type: "价格页", label: "FlowFrame 价格页", url: "https://example.com/flowframe/pricing" },
  clipRelease: { id: "clipRelease", type: "GitHub release", label: "ClipForge Studio release", url: "https://example.com/clipforge/releases" },
  clipDocs: { id: "clipDocs", type: "文档站", label: "ClipForge Studio 文档站", url: "https://example.com/clipforge/docs" },
  feishuBiz: { id: "feishuBiz", type: "企业工商数据库", label: "飞书科技有限公司工商记录", url: "datapro://company/feishu" },
  feishuIp: { id: "feishuIp", type: "知识产权数据库", label: "飞书文档协作专利记录", url: "datapro://ip/feishu" },
  notionPrice: { id: "notionPrice", type: "价格页", label: "Notion 价格页快照", url: "https://example.com/notion/pricing" },
};

export const objects = {
  lingxiVideoCompany: {
    id: "lingxiVideoCompany",
    name: "灵犀影像科技有限公司",
    object_type: "company",
    summary: "视频生成与智能影像服务商",
    primary_source: "企业工商数据库",
    source_ids: ["lingxiBiz", "lingxiIp", "lingxiNews"],
    baseline: [
      { id: "base-lingxi-1", dimension: "企业主体", title: "企业主体", value: "经营范围包含智能影像软件开发。", source_ids: ["lingxiBiz"], created_at: "2026-06-04T10:30:00.000Z" },
      { id: "base-lingxi-2", dimension: "知识产权", title: "知识产权", value: "未记录视频生成工作流相关软件著作权。", source_ids: ["lingxiIp"], created_at: "2026-06-04T10:30:00.000Z" },
    ],
    planned_cards: [
      {
        id: "card-lingxi-copyright",
        dimension: "知识产权",
        title: "新增视频生成工作流相关软件著作权",
        before: "未记录视频生成工作流相关软件著作权。",
        after: "知识产权数据库候选结果显示新增 2 条视频生成工作流相关登记。",
        source_ids: ["lingxiIp"],
        confidence: "高",
      },
    ],
  },
  flowframeVideo: {
    id: "flowframeVideo",
    name: "FlowFrame Video",
    object_type: "product",
    summary: "视频生成与镜头编辑产品",
    primary_source: "公开来源",
    source_ids: ["flowNews", "flowDocs", "flowPrice"],
    baseline: [{ id: "base-flow-1", dimension: "价格页", title: "价格页", value: "未出现批量生成额度说明。", source_ids: ["flowPrice"], created_at: "2026-06-03T03:20:00.000Z" }],
    planned_cards: [
      {
        id: "card-flow-price",
        dimension: "价格页",
        title: "价格页新增批量生成额度说明",
        before: "未出现批量生成额度说明。",
        after: "价格页新增 batch render credits 与 team seat 字段。",
        source_ids: ["flowPrice"],
        confidence: "中",
      },
    ],
  },
  clipforgeStudio: {
    id: "clipforgeStudio",
    name: "ClipForge Studio",
    object_type: "product",
    summary: "开源视频生成工作台",
    primary_source: "公开来源",
    source_ids: ["clipRelease", "clipDocs"],
    baseline: [{ id: "base-clip-1", dimension: "GitHub release", title: "GitHub release", value: "未支持多镜头模板。", source_ids: ["clipRelease"], created_at: "2026-06-02T07:00:00.000Z" }],
    planned_cards: [
      {
        id: "card-clip-template",
        dimension: "GitHub release",
        title: "发布记录新增多镜头模板能力",
        before: "未支持多镜头模板。",
        after: "GitHub release 候选结果显示新增 multi-shot template 配置说明。",
        source_ids: ["clipRelease", "clipDocs"],
        confidence: "中",
      },
    ],
  },
  feishuCompany: {
    id: "feishuCompany",
    name: "飞书科技有限公司",
    object_type: "company",
    summary: "文档协作与办公平台厂商",
    primary_source: "企业工商数据库",
    source_ids: ["feishuBiz", "feishuIp"],
    baseline: [{ id: "base-feishu-1", dimension: "企业主体", title: "企业主体", value: "企业名称为飞书科技有限公司。", source_ids: ["feishuBiz"], created_at: "2026-06-01T01:20:00.000Z" }],
    planned_cards: [
      {
        id: "card-feishu-ip",
        dimension: "知识产权",
        title: "新增文档智能检索相关专利记录",
        before: "历史基线仅记录企业主体名称。",
        after: "知识产权数据库候选结果显示新增文档智能检索相关专利记录。",
        source_ids: ["feishuIp"],
        confidence: "中",
      },
    ],
  },
  notionProduct: {
    id: "notionProduct",
    name: "Notion",
    object_type: "product",
    summary: "新一代文档协作产品",
    primary_source: "公开来源",
    source_ids: ["notionPrice"],
    baseline: [{ id: "base-notion-1", dimension: "价格页", title: "价格页", value: "团队知识库整理能力已在价格页公开。", source_ids: ["notionPrice"], created_at: "2026-06-01T01:20:00.000Z" }],
    planned_cards: [
      {
        id: "card-notion-price",
        dimension: "价格页",
        title: "价格页新增团队 AI 管理字段",
        before: "价格页仅展示团队知识库整理能力。",
        after: "价格页候选快照显示新增团队 AI 管理字段。",
        source_ids: ["notionPrice"],
        confidence: "中",
      },
    ],
  },
};

export const scopes = [
  {
    id: "video-demo",
    name: "视频生成工具",
    description: "示例范围，展示从对象发现到变化核验、成果生成和资料问答的完整闭环。",
    object_ids: ["lingxiVideoCompany"],
    last_run_at: null,
    last_run_label: "尚未运行",
    is_demo: true,
    created_at: "2026-06-13T00:00:00.000Z",
    updated_at: "2026-06-13T00:00:00.000Z",
  },
  {
    id: "ai-docs",
    name: "AI 文档协作工具",
    description: "示例范围，包含已沉淀的对象档案与成果。",
    object_ids: ["feishuCompany", "notionProduct"],
    last_run_at: "2026-06-11T01:50:00.000Z",
    last_run_label: "2026-06-11 09:50",
    is_demo: true,
    created_at: "2026-06-13T00:00:00.000Z",
    updated_at: "2026-06-13T00:00:00.000Z",
  },
];

export const scopeState = {
  "video-demo": {
    candidates: [],
    runs: [],
    confirmed_cards: [],
    actions: [],
    assets: [],
    qa_messages: [],
    excerpts: [],
  },
  "ai-docs": {
    candidates: [],
    runs: [],
    confirmed_cards: [
      {
        id: "confirmed-feishu-name",
        scope_id: "ai-docs",
        object_id: "feishuCompany",
        dimension: "企业主体",
        title: "企业主体信息已核验",
        before: "历史记录缺少统一主体名称。",
        after: "企业名称已确认为飞书科技有限公司。",
        source_ids: ["feishuBiz"],
        confirmed_at: "2026-06-11T01:50:00.000Z",
        provider: "fixture",
        provider_mode: "mock",
        raw_ref: "fixture:scopeState.ai-docs.confirmedCards.confirmed-feishu-name",
      },
    ],
    actions: [
      {
        id: "act-demo-1",
        scope_id: "ai-docs",
        object_id: "feishuCompany",
        card_id: "confirmed-feishu-name",
        action_type: "confirm",
        note: null,
        provider: "manual",
        provider_mode: "real",
        created_at: "2026-06-11T01:50:00.000Z",
      },
    ],
    assets: [
      {
        id: "asset-demo-report",
        scope_id: "ai-docs",
        object_id: "feishuCompany",
        type: "report",
        title: "AI 文档协作工具变化追踪报告",
        status: "ready",
        source_card_ids: ["confirmed-feishu-name"],
        content_json: { summary: "基于已确认变化生成。", sections: [] },
        provider: "fixture",
        provider_mode: "mock",
        raw_ref: "fixture:scopeState.ai-docs.assets.asset-demo-report",
        created_at: "2026-06-11T02:10:00.000Z",
      },
    ],
    qa_messages: [],
    excerpts: [],
  },
};

export const topicCandidates = {
  video: [
    { object_id: "lingxiVideoCompany", reason: "公司主体可由专业数据核验" },
    { object_id: "flowframeVideo", reason: "官网、文档与价格页来源完整" },
    { object_id: "clipforgeStudio", reason: "开源发布记录稳定" },
  ],
  docs: [
    { object_id: "feishuCompany", reason: "公司主体可由专业数据核验" },
    { object_id: "notionProduct", reason: "价格页来源稳定" },
  ],
};

export const seedData = {
  sources,
  objects,
  scopes,
  scopeState,
  topicCandidates,
};
