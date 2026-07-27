import { createHash } from "node:crypto";

const COMPANY_SUFFIXES = [
  "股份有限公司",
  "有限责任公司",
  "集团有限公司",
  "有限公司",
  "集团",
  "公司",
];

const DAY_MS = 24 * 60 * 60 * 1000;
const OFFICIAL_PUBLIC_HOSTS = [
  "gov.cn",
  "sse.com.cn",
  "szse.cn",
  "hkexnews.hk",
  "cninfo.com.cn",
];
const CRITICAL_FACT_PATTERNS = [
  { field: "registered_capital", label: "注册资本", pattern: /注册资本(?:为|是|达到|约为|约|[:：])?\s*([+-]?\d[\d,.]*(?:\.\d+)?\s*(?:亿|万)?\s*(?:人民币|美元|元))/gi },
  { field: "revenue", label: "营业收入", pattern: /(?:营业收入|营收)(?:为|达到|约为|约|[:：])?\s*([+-]?\d[\d,.]*(?:\.\d+)?\s*(?:亿|万)?\s*(?:人民币|美元|元|%|％))/gi },
  { field: "net_profit", label: "净利润", pattern: /(?:净利润|净亏损)(?:为|达到|约为|约|[:：])?\s*([+-]?\d[\d,.]*(?:\.\d+)?\s*(?:亿|万)?\s*(?:人民币|美元|元|%|％))/gi },
  { field: "financing", label: "融资金额", pattern: /(?:融资金额|完成融资|获融资)(?:为|达到|约为|约|[:：])?\s*([+-]?\d[\d,.]*(?:\.\d+)?\s*(?:亿|万)?\s*(?:人民币|美元|元))/gi },
  { field: "valuation", label: "估值", pattern: /估值(?:为|达到|约为|约|[:：])?\s*([+-]?\d[\d,.]*(?:\.\d+)?\s*(?:亿|万)?\s*(?:人民币|美元|元))/gi },
];
const DOSSIER_SECTION_TITLES = [
  "企业与业务概览",
  "经营与业务动态",
  "近期公开动态",
  "风险与关注事项",
  "销售机会判断",
  "建议行动",
];
const QA_INTENT_RULES = [
  {
    id: "risk",
    pattern: /风险|处罚|诉讼|失信|异常|隐患|合规|顾虑|阻碍|问题/,
    terms: ["风险", "关注事项", "处罚", "诉讼", "失信", "异常", "合规", "顾虑"],
  },
  {
    id: "timeline",
    pattern: /时间|日期|何时|什么时候|节点|计划|周期|进度|最近|最新|先后|历史/,
    terms: ["时间", "日期", "节点", "计划", "进度", "近期", "历史"],
  },
  {
    id: "people",
    pattern: /谁|负责人|联系人|决策人|部门|角色|对接人/,
    terms: ["负责人", "联系人", "决策人", "部门", "角色", "对接"],
  },
  {
    id: "requirement",
    pattern: /需求|痛点|关注|目标|场景|想要|希望|要求|预算/,
    terms: ["需求", "痛点", "关注", "目标", "场景", "希望", "要求", "预算"],
  },
  {
    id: "action",
    pattern: /下一步|怎么推进|如何推进|建议|行动|跟进|切入|机会/,
    terms: ["下一步", "建议行动", "推进", "跟进", "切入", "销售机会"],
  },
  {
    id: "overview",
    pattern: /总结|概括|整体|情况|介绍|是什么|(?:企业|公司|客户).{0,4}怎么样/,
    terms: ["概览", "总结", "企业与业务概览", "经营与业务动态"],
  },
];

function text(value, maxLength = 12000) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function digest(value) {
  return createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function qaText(value, maxLength = 20000) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, maxLength);
}

function qaLexemes(value) {
  const normalized = qaText(value, 12000).toLowerCase();
  const lexemes = new Set(normalized.match(/[a-z][a-z0-9._-]{1,}|[0-9][0-9.,%+-]*/g) || []);
  for (const sequence of normalized.match(/[\p{Script=Han}]{2,}/gu) || []) {
    const compact = sequence.slice(0, 80);
    for (let size = 2; size <= Math.min(4, compact.length); size += 1) {
      for (let index = 0; index <= compact.length - size; index += 1) {
        lexemes.add(compact.slice(index, index + size));
      }
    }
  }
  return lexemes;
}

function qaLexicalSimilarity(queryLexemes, candidateValue) {
  if (!queryLexemes.size) return 0;
  const candidateLexemes = qaLexemes(candidateValue);
  if (!candidateLexemes.size) return 0;
  const overlap = [...queryLexemes].filter((term) => candidateLexemes.has(term)).length;
  const cosine = overlap / Math.sqrt(queryLexemes.size * candidateLexemes.size);
  const queryCoverage = overlap / queryLexemes.size;
  return Math.min(1, cosine * 0.65 + queryCoverage * 0.35);
}

function meaningfulQaSummary(value) {
  const visibleText = qaText(value, 2400)
    .replace(/<[^>]+>/g, " ")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/[-|#*_`~=:：/\\\s]+/g, "");
  return /[\p{L}\p{N}]{2,}/u.test(visibleText);
}

function qaEnumerationKey(value) {
  return qaText(value, 500)
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[*_`~]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function qaEnumerationAliases(label) {
  const cleaned = qaText(label, 240)
    .replace(/<[^>]+>/g, "")
    .replace(/[*_`~]/g, "")
    .trim();
  const base = cleaned.split(/[:：]/, 1)[0].trim();
  const parts = base.split(/[\/+、]|(?:\s+(?:及|与)\s+)/).map((item) => item.trim());
  return [...new Set([cleaned, base, ...parts].map(qaEnumerationKey))]
    .filter((item) => item.length >= 4);
}

function qaTableRowLabels(value) {
  const source = qaText(value, 6000);
  const separatorCell = (value) => /^:?-{1,}:?$/.test(String(value || "").trim());
  const cleanCell = (value, maxLength = 900) => (
    qaText(value, maxLength)
      .replace(/<[^>]+>/g, "")
      .replace(/[*_`~]/g, "")
      .trim()
  );
  const rowSegments = source.split(/\|\s+\|/).map((item) => item.trim()).filter(Boolean);
  const tables = [];
  for (let index = 0; index < rowSegments.length; index += 1) {
    const separatorCells = rowSegments[index].split("|").map((item) => cleanCell(item, 180));
    if (
      separatorCells.length < 2
      || !separatorCells.every(separatorCell)
    ) {
      continue;
    }
    const columnCount = separatorCells.length;
    const labels = [];
    for (let rowIndex = index + 1; rowIndex < rowSegments.length; rowIndex += 1) {
      const cells = rowSegments[rowIndex].split("|").map((item, cellIndex) => cleanCell(
        item,
        cellIndex ? 900 : 180,
      ));
      if (cells.length < columnCount) break;
      const row = cells.slice(0, columnCount);
      if (row.every(separatorCell)) break;
      const label = row[0]
        .replace(/<[^>]+>/g, "")
        .replace(/[*_`~]/g, "")
        .trim();
      const description = row.slice(1).join(" ");
      const key = qaEnumerationKey(label);
      if (
        !key
        || /^#{1,6}\s/.test(label)
        || /^---/.test(label)
        || separatorCell(label)
        || separatorCell(description)
      ) {
        break;
      }
      if (!labels.some((item) => qaEnumerationKey(item) === key)) labels.push(label);
    }
    if (labels.length) tables.push(labels);
  }
  return tables.sort((left, right) => right.length - left.length)[0] || [];
}

function qaEnumerationSubject(value) {
  const source = qaText(value, 1200);
  const afterCue = source.match(
    /(?:哪些|有哪(?:些)?|列出|列举|逐项(?:说明)?|所有|全部|包括什么|包含什么|多少(?:项|种|个))\s*([^，。？！?；;\n]{2,40})/,
  )?.[1];
  const beforeCue = source.match(
    /([^，。？！?；;\n]{2,40}?)(?:有哪些|有哪(?:些)?|包括什么|包含什么)/,
  )?.[1];
  return qaText(afterCue || beforeCue || source, 80)
    .replace(/^(?:这份|该|当前|上述|文档|资料|明确|使用了?)+/g, "")
    .replace(/(?:请|并请|需要).*/g, "")
    .trim();
}

function splitQaChunks(value, maxChars = 1100) {
  const input = qaText(value);
  if (!input) return [];
  const blocks = input
    .split(/\n{2,}|(?=^#{1,6}\s)/m)
    .map((item) => item.trim())
    .filter(Boolean);
  const chunks = [];
  let headingContext = "";
  for (const rawBlock of blocks) {
    const headingOnly = rawBlock.match(/^(#{1,6}\s+[^\n]+)$/);
    if (headingOnly) {
      headingContext = headingOnly[1].trim();
      continue;
    }
    const leadingHeading = rawBlock.match(/^(#{1,6}\s+[^\n]+)\n+([\s\S]+)$/);
    const block = leadingHeading ? leadingHeading[2].trim() : rawBlock;
    if (leadingHeading) headingContext = leadingHeading[1].trim();
    const contextualize = (chunk) => (
      headingContext && !chunk.startsWith(headingContext)
        ? `${headingContext}\n${chunk}`
        : chunk
    );
    if (block.length <= maxChars) {
      chunks.push(contextualize(block));
      continue;
    }
    const sentences = block.split(/(?<=[。！？!?；;])\s*/).filter(Boolean);
    let current = "";
    for (const sentence of sentences.length ? sentences : [block]) {
      if (current && current.length + sentence.length + 1 > maxChars) {
        chunks.push(contextualize(current.trim()));
        current = "";
      }
      if (sentence.length > maxChars) {
        if (current) chunks.push(contextualize(current.trim()));
        current = "";
        for (let index = 0; index < sentence.length; index += maxChars) {
          chunks.push(contextualize(sentence.slice(index, index + maxChars).trim()));
        }
      } else {
        current = `${current}${current ? " " : ""}${sentence}`;
      }
    }
    if (current) chunks.push(contextualize(current.trim()));
  }
  if (!chunks.length && headingContext) chunks.push(headingContext);
  const merged = [];
  for (const chunk of chunks.filter(Boolean)) {
    const heading = chunk.match(/^(#{1,6}\s+[^\n]+)\n/)?.[1] || "";
    const previous = merged.at(-1) || "";
    if (
      heading
      && previous.startsWith(`${heading}\n`)
      && previous.length + chunk.length - heading.length <= maxChars + heading.length + 1
    ) {
      merged[merged.length - 1] = `${previous}\n${chunk.slice(heading.length).trim()}`;
    } else {
      merged.push(chunk);
    }
  }
  return merged;
}

export function analyzeQaQuestion(question, conversationHistory = []) {
  const rawQuestion = qaText(question, 1800);
  const recentContext = (conversationHistory || [])
    .slice(-2)
    .map((message) => qaText(message?.text || message?.content, 500))
    .filter(Boolean)
    .join(" ");
  const resolvedQuestion = /^(?:那|那么|这个|它|其|上述|刚才)|(?:下一步|然后呢|还有呢)/.test(rawQuestion)
    ? qaText(`${recentContext} ${rawQuestion}`, 2200)
    : rawQuestion;
  const intents = QA_INTENT_RULES.filter((rule) => rule.pattern.test(resolvedQuestion)).map((rule) => rule.id);
  const subqueries = [...new Set(
    resolvedQuestion
      .split(/[？?；;]|\s+(?:以及|并且|同时|另外)\s+|(?:还要|还想|还需要)/)
      .map((item) => qaText(item, 500))
      .filter((item) => item.length >= 2),
  )].slice(0, 3);
  return {
    original_question: rawQuestion,
    resolved_question: resolvedQuestion,
    intents: intents.length ? intents : ["fact"],
    subqueries: subqueries.length ? subqueries : [resolvedQuestion],
  };
}

function qaEvidenceScore(questionPlan, item) {
  const queryLexemes = qaLexemes(questionPlan.resolved_question);
  const summaryText = String(item.summary || "");
  const labelText = String(item.label || "");
  const leadText = summaryText.slice(0, 260);
  const labelLexemes = qaLexemes(labelText);
  const focusLexemes = new Set(
    [...queryLexemes].filter((term) => !labelLexemes.has(term)),
  );
  const summaryLexical = qaLexicalSimilarity(queryLexemes, summaryText);
  const leadLexical = qaLexicalSimilarity(queryLexemes, leadText);
  const labelLexical = qaLexicalSimilarity(queryLexemes, labelText);
  const focusLexical = qaLexicalSimilarity(focusLexemes, summaryText);
  const focusLeadLexical = qaLexicalSimilarity(focusLexemes, leadText);
  const lexical = Math.min(
    1,
    focusLexical * 0.62
      + focusLeadLexical * 0.14
      + summaryLexical * 0.14
      + leadLexical * 0.05
      + labelLexical * 0.05,
  );
  const candidateText = `${labelText} ${summaryText}`;
  const intentTerms = QA_INTENT_RULES
    .filter((rule) => questionPlan.intents.includes(rule.id))
    .flatMap((rule) => rule.terms);
  const intentMatches = intentTerms.filter((term) => candidateText.includes(term)).length;
  const intent = intentTerms.length ? intentMatches / intentTerms.length : 0;
  const semantic = Number.isFinite(Number(item.semantic_score))
    ? Math.max(0, Math.min(1, Number(item.semantic_score)))
    : 0;
  const exactSubquery = questionPlan.subqueries.some((query) => (
    query.length >= 4 && candidateText.includes(query)
  )) ? 1 : 0;
  const contentSignal = Math.max(focusLexical, focusLeadLexical);
  const semanticWeight = contentSignal >= 0.02 || intent > 0 || exactSubquery > 0 ? 0.16 : 0.03;
  return {
    lexical_score: Number(lexical.toFixed(6)),
    summary_lexical_score: Number(summaryLexical.toFixed(6)),
    lead_lexical_score: Number(leadLexical.toFixed(6)),
    label_lexical_score: Number(labelLexical.toFixed(6)),
    focus_lexical_score: Number(focusLexical.toFixed(6)),
    focus_lead_lexical_score: Number(focusLeadLexical.toFixed(6)),
    intent_score: Number(intent.toFixed(6)),
    semantic_score: Number(semantic.toFixed(6)),
    exact_subquery_match: Boolean(exactSubquery),
    retrieval_score: Number((
      lexical * 0.56
      + intent * 0.24
      + semantic * semanticWeight
      + exactSubquery * 0.06
    ).toFixed(6)),
  };
}

function canonicalUrl(value) {
  const raw = text(value, 1000);
  if (!/^https?:\/\//i.test(raw)) return raw;
  try {
    const url = new URL(raw);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|spm|from|source)/i.test(key)) url.searchParams.delete(key);
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    return raw;
  }
}

function normalizedCompanyName(value) {
  return text(value, 160).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function shortCompanyName(value) {
  let name = text(value, 160);
  for (const suffix of COMPANY_SUFFIXES) {
    if (name.endsWith(suffix) && name.length > suffix.length) {
      name = name.slice(0, -suffix.length);
      break;
    }
  }
  return normalizedCompanyName(name);
}

function validIso(value) {
  const raw = text(value, 80);
  if (!raw) return null;
  const timestamp = new Date(raw).getTime();
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function latestIso(values, fallback = null) {
  const dates = values.map(validIso).filter(Boolean).sort();
  return dates.at(-1) || fallback;
}

function hostname(value) {
  const url = canonicalUrl(value);
  if (!url) return "";
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function isOfficialPublicSource(source, url) {
  if (source.official === true || /^(official|government)$/i.test(text(source.authority, 40))) return true;
  const host = hostname(url);
  return OFFICIAL_PUBLIC_HOSTS.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

function sourceQuality(kind, source, url) {
  const isFixture = /^(mock|demo|fixture)$/i.test(text(source.provider_mode, 40));
  if (isFixture) {
    return { source_quality: "limited", source_quality_label: "演示来源", quality_tier: 3, official: false };
  }
  if (kind === "professional") {
    return { source_quality: "professional", source_quality_label: "专业权威来源", quality_tier: 1, official: true };
  }
  if (kind === "internal") {
    return { source_quality: "internal", source_quality_label: "内部授权资料", quality_tier: 2, official: false };
  }
  if (isOfficialPublicSource(source, url)) {
    return { source_quality: "official", source_quality_label: "官方公开来源", quality_tier: 1, official: true };
  }
  if (hostname(url)) {
    return { source_quality: "traceable", source_quality_label: "可追溯公开来源", quality_tier: 2, official: false };
  }
  return { source_quality: "limited", source_quality_label: "来源信息有限", quality_tier: 3, official: false };
}

function sourceFreshness(kind, publishedAt, sourceUpdatedAt, generatedAt) {
  const referenceDate = kind === "public"
    ? publishedAt || sourceUpdatedAt
    : sourceUpdatedAt || publishedAt;
  if (!referenceDate) {
    return { freshness: "unknown", freshness_label: "日期未知", age_days: null };
  }
  const referenceTime = new Date(referenceDate).getTime();
  const generatedTime = new Date(generatedAt).getTime();
  const ageDays = Math.max(0, Math.floor((generatedTime - referenceTime) / DAY_MS));
  const currentDays = kind === "public" ? 180 : 365;
  const staleDays = kind === "public" ? 365 : 730;
  if (ageDays <= currentDays) return { freshness: "current", freshness_label: "近期资料", age_days: ageDays };
  if (ageDays <= staleDays) return { freshness: "aging", freshness_label: "较早资料", age_days: ageDays };
  return { freshness: "stale", freshness_label: "过期资料", age_days: ageDays };
}

function normalizeCriticalValue(value) {
  return text(value, 80).replace(/[\s,，]/g, "").replace(/％/g, "%").toLowerCase();
}

export function extractCriticalClaims(value) {
  const input = text(value, 4000);
  const claims = [];
  for (const definition of CRITICAL_FACT_PATTERNS) {
    const expression = new RegExp(definition.pattern.source, definition.pattern.flags);
    for (const match of input.matchAll(expression)) {
      const normalizedValue = normalizeCriticalValue(match[1]);
      if (!normalizedValue) continue;
      claims.push({
        field: definition.field,
        field_label: definition.label,
        value: text(match[1], 80),
        normalized_value: normalizedValue,
      });
    }
  }
  return claims.filter((claim, index, values) => values.findIndex((item) => (
    item.field === claim.field && item.normalized_value === claim.normalized_value
  )) === index);
}

function sourceIndependenceKey(kind, source, identity, url) {
  if (kind === "public") return hostname(url) || identity;
  if (kind === "professional") {
    return `${text(source.provider || "datapro", 80)}:${text(source.source_group || source.label || identity, 240)}`;
  }
  return text(source.uri, 1000) || identity;
}

function evidenceDate(item) {
  return validIso(item.published_at || item.source_updated_at);
}

function evidenceConflicts(items) {
  const byField = new Map();
  for (const item of items.filter((candidate) => candidate.source_kind !== "internal")) {
    for (const claim of item.critical_claims || []) {
      if (!byField.has(claim.field)) byField.set(claim.field, []);
      byField.get(claim.field).push({
        ...claim,
        evidence_id: item.id,
        source_key: item.source_key,
        source_date: evidenceDate(item),
      });
    }
  }
  const conflicts = [];
  for (const [field, claims] of byField) {
    const distinctValues = [...new Set(claims.map((claim) => claim.normalized_value))];
    if (distinctValues.length < 2) continue;
    const competing = claims.some((left, leftIndex) => claims.some((right, rightIndex) => {
      if (rightIndex <= leftIndex || left.normalized_value === right.normalized_value) return false;
      if (!left.source_date || !right.source_date) return true;
      return Math.abs(new Date(left.source_date).getTime() - new Date(right.source_date).getTime()) <= 180 * DAY_MS;
    }));
    if (!competing) continue;
    conflicts.push({
      field,
      field_label: claims[0].field_label,
      values: distinctValues.map((normalizedValue) => ({
        value: claims.find((claim) => claim.normalized_value === normalizedValue)?.value || normalizedValue,
        evidence_ids: claims.filter((claim) => claim.normalized_value === normalizedValue).map((claim) => claim.evidence_id),
      })),
    });
  }
  return conflicts;
}

function evidencePolicy(items, conflicts) {
  const counts = { professional: 0, public: 0, internal: 0 };
  for (const item of items) counts[item.source_kind] = Number(counts[item.source_kind] || 0) + 1;
  const warnings = [];
  const staleCount = items.filter((item) => item.freshness === "stale").length;
  const unknownDateCount = items.filter((item) => item.freshness === "unknown").length;
  if (staleCount) warnings.push(`${staleCount} 条来源已过期，不能作为最新动态依据。`);
  if (unknownDateCount) warnings.push(`${unknownDateCount} 条来源缺少可核验日期。`);
  if (conflicts.length) warnings.push(`${conflicts.length} 个关键数字存在来源冲突，不能直接选取单一值。`);
  return {
    schema_version: 1,
    source_counts: counts,
    authoritative_external_count: items.filter((item) => item.source_kind !== "internal" && item.quality_tier === 1).length,
    traceable_public_count: items.filter((item) => item.source_kind === "public" && item.quality_tier <= 2 && hostname(item.url)).length,
    current_public_count: items.filter((item) => item.source_kind === "public" && item.freshness === "current").length,
    stale_count: staleCount,
    unknown_date_count: unknownDateCount,
    conflict_count: conflicts.length,
    warnings,
  };
}

function sourceKindLabel(kind) {
  if (kind === "professional") return "专业数据集";
  if (kind === "public") return "联网搜索";
  return "内部资料";
}

function evidenceIdentity(kind, source, entity) {
  if (kind === "public") return canonicalUrl(source.url) || text(source.label || source.title, 240);
  if (kind === "internal") return text(source.uri, 1000) || text(source.source_id || source.title, 240);
  return text(source.source_key || source.label, 240) || `${entity.canonical_name}:professional`;
}

function entityMatch(kind, source, entity) {
  if (kind === "internal") return "company_scoped";
  const candidate = normalizedCompanyName(`${source.label || source.title || ""} ${source.summary || source.abstract || ""}`);
  if (entity.strict_aliases.some((alias) => alias.length >= 2 && candidate.includes(alias))) return "verified";
  if (entity.contextual_aliases.some((alias) => alias.length >= 2 && candidate.includes(alias))) {
    return "alias_scoped";
  }
  const query = normalizedCompanyName(source.query || "");
  if (kind === "professional" && entity.aliases.some((alias) => alias.length >= 2 && query.includes(alias))) {
    return "query_bound";
  }
  return "unverified";
}

function normalizeEvidence(kind, source, entity, generatedAt) {
  const summary = text(source.summary || source.abstract || source.text, 1600);
  const identity = evidenceIdentity(kind, source, entity);
  if (!summary || !identity) return null;
  const publishedAt = validIso(source.published_at || source.publish_time || source.occurred_at);
  const sourceUpdatedAt = validIso(source.last_synced_at || source.updated_at);
  const match = entityMatch(kind, source, entity);
  const url = canonicalUrl(source.url);
  const quality = sourceQuality(kind, source, url);
  const freshness = sourceFreshness(kind, publishedAt, sourceUpdatedAt, generatedAt);
  return {
    id: `evidence_${digest(`${kind}\n${identity}`).slice(0, 28)}`,
    source_key: identity,
    source_kind: kind,
    source_kind_label: sourceKindLabel(kind),
    label: text(source.label || source.title || identity, 240),
    summary,
    excerpt: text(source.excerpt || summary, 900),
    url,
    uri: text(source.uri, 1000),
    provider: text(source.provider || (kind === "internal" ? "openviking" : kind === "public" ? "web_search" : "datapro"), 80),
    provider_mode: text(source.provider_mode, 40),
    raw_ref: text(source.raw_ref, 500),
    query: text(source.query, 500),
    purpose: text(source.purpose, 160),
    published_at: publishedAt,
    source_updated_at: sourceUpdatedAt,
    observed_at: validIso(source.observed_at) || generatedAt,
    entity_match: match,
    ...quality,
    ...freshness,
    independence_key: sourceIndependenceKey(kind, source, identity, url),
    critical_claims: extractCriticalClaims(summary),
    score: source.score !== null && source.score !== undefined && Number.isFinite(Number(source.score))
      ? Number(source.score)
      : null,
  };
}

function hashableEvidence(item) {
  return {
    id: item.id,
    source_kind: item.source_kind,
    source_key: item.source_key,
    summary: item.summary,
    published_at: item.published_at,
    source_updated_at: item.source_updated_at,
    entity_match: item.entity_match,
  };
}

export function resolveCompanyEntity(company = {}) {
  const canonicalName = text(company.name, 160);
  const strictAliases = [
    normalizedCompanyName(canonicalName),
    shortCompanyName(canonicalName),
  ].filter((item, index, values) => item && values.indexOf(item) === index);
  const contextualAliases = (Array.isArray(company.aliases) ? company.aliases.map(normalizedCompanyName) : [])
    .filter((item, index, values) => (
      item
      && !strictAliases.includes(item)
      && values.indexOf(item) === index
    ));
  const aliases = [...strictAliases, ...contextualAliases];
  return {
    id: text(company.id, 200),
    canonical_name: canonicalName,
    normalized_name: normalizedCompanyName(canonicalName),
    aliases,
    strict_aliases: strictAliases,
    contextual_aliases: contextualAliases,
    identifiers: {
      unified_social_credit_code: text(company.unified_social_credit_code || company.credit_code, 80) || null,
    },
  };
}

export function buildDossierEvidencePack({ company, collected = {}, memoryContexts = [], generatedAt = new Date().toISOString() } = {}) {
  const entity = resolveCompanyEntity(company);
  if (!entity.id || !entity.canonical_name) throw new Error("company id and name are required for an evidence pack.");
  const candidates = [
    ...(collected.professional || []).map((source) => normalizeEvidence("professional", source, entity, generatedAt)),
    ...(collected.public_sources || []).map((source) => normalizeEvidence("public", source, entity, generatedAt)),
    ...(memoryContexts || []).map((source) => normalizeEvidence("internal", source, entity, generatedAt)),
  ].filter(Boolean);
  const rejected = candidates
    .filter((item) => item.entity_match === "unverified")
    .map((item) => ({ id: item.id, label: item.label, reason: "entity_not_verified" }));
  let items = candidates
    .filter((item) => item.entity_match !== "unverified")
    .sort((a, b) => a.source_kind.localeCompare(b.source_kind) || a.id.localeCompare(b.id));
  const conflicts = evidenceConflicts(items);
  const conflictFieldsByEvidence = new Map();
  for (const conflict of conflicts) {
    for (const value of conflict.values) {
      for (const evidenceId of value.evidence_ids) {
        if (!conflictFieldsByEvidence.has(evidenceId)) conflictFieldsByEvidence.set(evidenceId, []);
        conflictFieldsByEvidence.get(evidenceId).push(conflict.field);
      }
    }
  }
  items = items.map((item) => ({
    ...item,
    conflict_fields: [...new Set(conflictFieldsByEvidence.get(item.id) || [])],
  }));
  const evidenceHash = digest(JSON.stringify(items.map(hashableEvidence)));
  const dataAsOf = latestIso(items.flatMap((item) => [item.published_at, item.source_updated_at]));
  return {
    entity,
    items,
    rejected,
    evidence_hash: evidenceHash,
    data_as_of: dataAsOf,
    collected_at: generatedAt,
    conflicts,
    policy: evidencePolicy(items, conflicts),
  };
}

export function validateProductionEvidencePack(pack = {}) {
  const policy = pack.policy || evidencePolicy(pack.items || [], pack.conflicts || []);
  const errors = [];
  if (!policy.authoritative_external_count) errors.push("缺少可核验的专业或官方外部来源");
  if (!policy.traceable_public_count) errors.push("缺少带原始链接的可追溯公开来源");
  if (!policy.current_public_count) errors.push("缺少 180 天内带日期的公开来源，不能生成“最新”档案");
  return { ok: errors.length === 0, errors, policy };
}

export function evidencePackCitations(pack = {}) {
  return (pack.items || []).map((item) => ({
    id: item.id,
    evidence_id: item.id,
    label: item.label,
    source_kind: item.source_kind_label,
    url: item.url,
    uri: item.uri,
    summary: item.summary,
    excerpt: item.excerpt,
    provider: item.provider,
    provider_mode: item.provider_mode,
    raw_ref: item.raw_ref,
    query: item.query,
    purpose: item.purpose,
    published_at: item.published_at,
    source_updated_at: item.source_updated_at,
    entity_match: item.entity_match,
    source_quality: item.source_quality,
    source_quality_label: item.source_quality_label,
    quality_tier: item.quality_tier,
    official: item.official,
    freshness: item.freshness,
    freshness_label: item.freshness_label,
    age_days: item.age_days,
    independence_key: item.independence_key,
    critical_claims: item.critical_claims,
    conflict_fields: item.conflict_fields,
  }));
}

export function makeDossierFingerprint(dossier = {}) {
  const canonical = {
    title: text(dossier.title, 240),
    summary: text(dossier.summary, 1000),
    body: (dossier.body || []).map((paragraph) => ({
      text: text(paragraph.text, 1600),
      citation_ids: [...new Set((paragraph.citation_ids || []).map(String))].sort(),
    })),
    citations: (dossier.citations || []).map((citation) => ({
      id: String(citation.id || citation.evidence_id || ""),
      summary: text(citation.summary || citation.excerpt, 1600),
    })).sort((a, b) => a.id.localeCompare(b.id)),
  };
  return digest(JSON.stringify(canonical));
}

export function buildQaEvidence({
  dossier = null,
  contexts = [],
  question = "",
  conversationHistory = [],
  maxItems = 12,
} = {}) {
  const candidates = [];
  const questionPlan = analyzeQaQuestion(question, conversationHistory);
  if (dossier?.id) {
    const versionLabel = text(`${dossier.title || "企业档案"} V${Number(dossier.version_no || 1)}`, 240);
    const dossierParagraphs = (dossier.body || [])
      .map((paragraph) => text(paragraph?.text, 1800))
      .filter(Boolean);
    const chunks = dossierParagraphs.length
      ? dossierParagraphs
      : splitQaChunks([dossier.summary, dossier.title].filter(Boolean).join("\n"), 1200);
    chunks.forEach((chunk, index) => {
      const section = DOSSIER_SECTION_TITLES.find((title) => (
        chunk.startsWith(`${title}：`) || chunk.startsWith(`${title}:`)
      )) || `章节 ${index + 1}`;
      candidates.push({
        id: `evidence_dossier_${digest(`${dossier.id}\n${index}\n${chunk}`).slice(0, 24)}`,
        label: text(`${versionLabel} · ${section}`, 240),
        source_kind: "企业档案",
        summary: text(chunk, 1800),
        url: "",
        uri: "",
        source_quality: "verified_dossier",
        source_quality_label: "已核验企业档案",
        quality_tier: 1,
        freshness: "current",
        freshness_label: "当前档案",
        independence_key: `dossier:${dossier.id}:${index}`,
        critical_claims: extractCriticalClaims(chunk),
        semantic_score: null,
        chunk_index: index,
      });
    });
  }
  for (const context of contexts || []) {
    const identity = text(context.material_id, 240)
      || text(context.uri, 1000)
      || text(context.title, 240);
    if (!identity) continue;
    const content = qaText(
      context.content
      || context.text
      || context.abstract
      || context.summary,
    );
    splitQaChunks(content, 1100).forEach((chunk, index) => {
      candidates.push({
        id: `evidence_${digest(`internal\n${identity}\n${index}\n${chunk}`).slice(0, 28)}`,
        label: text(context.title || identity, 240),
        source_kind: text(context.source_kind || "内部资料", 80),
        summary: text(chunk, 1600),
        url: "",
        uri: text(context.uri, 1000),
        source_quality: "internal",
        source_quality_label: "内部授权资料",
        quality_tier: 2,
        freshness: "unknown",
        freshness_label: "日期未知",
        independence_key: `${identity}:${index}`,
        critical_claims: extractCriticalClaims(chunk),
        semantic_score: context.score ?? null,
        chunk_index: index,
        material_id: text(context.material_id, 240),
      });
    });
  }
  const deduped = [...new Map(
    candidates
      .filter((item) => item.summary && meaningfulQaSummary(item.summary))
      .map((item) => [digest(`${item.source_kind}\n${item.summary}`), item]),
  ).values()].map((item) => ({
    ...item,
    ...qaEvidenceScore(questionPlan, item),
  }));
  const ranked = deduped.sort((left, right) => (
    Number(right.retrieval_score || 0) - Number(left.retrieval_score || 0)
    || Number(left.quality_tier || 9) - Number(right.quality_tier || 9)
    || left.id.localeCompare(right.id)
  ));
  const limit = Math.max(2, Math.min(20, Number(maxItems || 12)));
  const selected = ranked.slice(0, limit);
  for (const sourceKind of ["企业档案", "internal"]) {
    const hasKind = sourceKind === "internal"
      ? selected.some((item) => item.source_kind !== "企业档案")
      : selected.some((item) => item.source_kind === sourceKind);
    if (hasKind) continue;
    const fallback = ranked.find((item) => (
      sourceKind === "internal"
        ? item.source_kind !== "企业档案"
        : item.source_kind === sourceKind
    ));
    if (!fallback) continue;
    if (selected.length >= limit) selected.pop();
    selected.push(fallback);
  }
  return selected.sort((left, right) => (
    Number(right.retrieval_score || 0) - Number(left.retrieval_score || 0)
  ));
}

export function buildQaEnumerationRequirements(question, evidence = []) {
  const normalizedQuestion = qaText(question, 1200);
  const asksForEnumeration = /哪些|有哪|列出|列举|逐项|分别|所有|全部|包括什么|包含什么|多少(?:项|种|个)/.test(normalizedQuestion);
  if (!asksForEnumeration) return [];
  const queryLexemes = qaLexemes(qaEnumerationSubject(normalizedQuestion));
  const candidates = (evidence || [])
    .map((item) => {
      const summary = String(item.summary || "");
      const labels = qaTableRowLabels(summary);
      const tableStart = summary.indexOf("|");
      const tableContext = tableStart >= 0 ? summary.slice(0, tableStart) : "";
      return {
        evidence_id: String(item.id || ""),
        labels,
        topic_score: qaLexicalSimilarity(queryLexemes, `${tableContext} ${labels.join(" ")}`),
        retrieval_score: Number(item.retrieval_score || 0),
      };
    })
    .filter((item) => (
      item.evidence_id
      && item.labels.length >= 2
      && item.labels.length <= 12
      && item.topic_score >= 0.015
    ))
    .sort((left, right) => (
      right.topic_score - left.topic_score
      || right.retrieval_score - left.retrieval_score
      || right.labels.length - left.labels.length
    ));
  const best = candidates[0];
  return best
    ? best.labels.map((label) => ({ label, evidence_id: best.evidence_id }))
    : [];
}

export function assessQaAnswerability(question, evidence = [], conversationHistory = []) {
  const plan = analyzeQaQuestion(question, conversationHistory);
  const ranked = [...(evidence || [])].sort((left, right) => (
    Number(right.retrieval_score || 0) - Number(left.retrieval_score || 0)
  ));
  const top = ranked[0] || null;
  const topScore = Number(top?.retrieval_score || 0);
  const groundedSignal = Boolean(
    Number(top?.lexical_score || 0) >= 0.01
    || Number(top?.intent_score || 0) >= 0.05
    || top?.exact_subquery_match,
  );
  const supported = ranked.length > 0 && topScore >= 0.07 && groundedSignal;
  return {
    supported,
    score: topScore,
    evidence_count: ranked.length,
    intents: plan.intents,
    reason: supported
      ? "retrieval_supported"
      : ranked.length
        ? "low_relevance"
        : "missing_evidence",
  };
}

function isInternalEvidence(item) {
  return /内部资料|OpenViking|历史资料|飞书|会议|文档/.test(text(item?.source_kind, 100));
}

function isVerifiedDossierEvidence(item) {
  return item?.source_quality === "verified_dossier"
    || /企业档案/.test(text(item?.source_kind, 100));
}

function independentExternalSources(items) {
  const keys = new Set();
  for (const item of items.filter((candidate) => !isInternalEvidence(candidate))) {
    keys.add(text(item.independence_key || hostname(item.url) || item.source_key || item.label || item.id, 1000));
  }
  return [...keys].filter(Boolean);
}

function hasHighRiskAssertion(value) {
  const input = text(value, 2000);
  if (extractCriticalClaims(input).length) return true;
  return /(?:(?:未发现|未涉及|不存在|存在|涉及|新增|发生|受到|列入|被执行|累计|共计).{0,18}(?:行政处罚|诉讼|失信|执行案件|经营异常|重大风险))|(?:(?:行政处罚|诉讼|失信|被执行|经营异常|重大风险).{0,18}(?:未发现|不存在|存在|涉及|新增|\d))/i.test(input);
}

function highRiskSupportErrors(paragraph, citations, path) {
  if (!hasHighRiskAssertion(paragraph.text)) return [];
  if (citations.some(isVerifiedDossierEvidence)) return [];
  const external = citations.filter((item) => !isInternalEvidence(item));
  const errors = [];
  if (independentExternalSources(external).length < 2) {
    errors.push(`${path} 的高风险事实缺少两个独立外部来源`);
  }
  if (!external.some((item) => Number(item.quality_tier || (/专业数据/.test(item.source_kind) ? 1 : 3)) === 1)) {
    errors.push(`${path} 的高风险事实缺少专业或官方来源`);
  }
  for (const claim of extractCriticalClaims(paragraph.text)) {
    const supporters = external.filter((item) => (item.critical_claims || extractCriticalClaims(item.summary)).some((sourceClaim) => (
      sourceClaim.field === claim.field && sourceClaim.normalized_value === claim.normalized_value
    )));
    if (independentExternalSources(supporters).length < 2) {
      errors.push(`${path} 的${claim.field_label}“${claim.value}”未获得双来源一致支持`);
    }
  }
  return errors;
}

export function validateDossierModelAnswer(parsed = {}, evidence = []) {
  const allowed = new Map((evidence || []).map((item) => [String(item.id), item]));
  const errors = [];
  const body = (Array.isArray(parsed.body) ? parsed.body : []).map((paragraph, index) => {
    const requested = [...new Set((paragraph.citation_ids || []).map(String))];
    const citationIds = requested.filter((id) => allowed.has(id));
    const paragraphText = text(paragraph.text, 1400)
      .replace(/^([^：:]{2,18}):/, "$1：");
    if (requested.length !== citationIds.length) errors.push(`body[${index}] 包含无效引用`);
    if (!citationIds.length) errors.push(`body[${index}] 缺少有效引用`);
    const citations = citationIds.map((id) => allowed.get(id));
    if (citations.some(isInternalEvidence)) {
      errors.push(`body[${index}] 使用内部资料支撑外部事实`);
    }
    errors.push(...highRiskSupportErrors({ text: paragraphText }, citations, `body[${index}]`));
    return { text: paragraphText, citation_ids: citationIds };
  }).filter((paragraph) => paragraph.text);
  if (body.length !== DOSSIER_SECTION_TITLES.length) {
    errors.push(`档案正文必须包含 ${DOSSIER_SECTION_TITLES.length} 个有引用的固定章节`);
  }
  DOSSIER_SECTION_TITLES.forEach((title, index) => {
    if (!body[index]?.text.startsWith(`${title}：`)) {
      errors.push(`body[${index}] 必须以“${title}：”开头`);
    }
  });
  return { body, errors };
}

export function validateQaModelAnswer(parsed = {}, evidence = [], options = {}) {
  const allowed = new Map((evidence || []).map((item) => [String(item.id), item]));
  const sourceParagraphs = Array.isArray(parsed.paragraphs)
    ? parsed.paragraphs
    : parsed.answer
      ? [{ text: parsed.answer, citation_ids: parsed.citation_ids || parsed.citation_source_ids || [] }]
      : [];
  const insufficient = Boolean(parsed.insufficient);
  const errors = [];
  const paragraphs = sourceParagraphs.map((paragraph, index) => {
    const requested = [...new Set((paragraph.citation_ids || []).map(String))];
    const citationIds = requested.filter((id) => allowed.has(id));
    if (requested.length !== citationIds.length) errors.push(`paragraphs[${index}] 包含无效引用`);
    if (!insufficient && !citationIds.length) errors.push(`paragraphs[${index}] 缺少有效引用`);
    const normalized = {
      text: text(paragraph.text, 900),
      citation_ids: citationIds,
    };
    if (!insufficient) {
      errors.push(...highRiskSupportErrors(normalized, citationIds.map((id) => allowed.get(id)), `paragraphs[${index}]`));
    }
    return normalized;
  }).filter((paragraph) => paragraph.text);
  if (!paragraphs.length) errors.push("回答正文缺失");
  const answerText = paragraphs.map((paragraph) => paragraph.text).join("\n\n");
  const enumerationRequirements = Array.isArray(options.enumerationRequirements)
    ? options.enumerationRequirements
    : [];
  const normalizedAnswer = qaEnumerationKey(answerText);
  const missingEnumerationItems = insufficient
    ? []
    : enumerationRequirements.filter((item) => (
      !qaEnumerationAliases(item?.label).some((alias) => normalizedAnswer.includes(alias))
    ));
  if (missingEnumerationItems.length) {
    errors.push(`回答遗漏枚举项：${missingEnumerationItems.map((item) => item.label).join("、")}`);
  }
  const usedIds = [...new Set(paragraphs.flatMap((paragraph) => paragraph.citation_ids))];
  return {
    paragraphs,
    text: answerText,
    citation_ids: usedIds,
    citations: usedIds.map((id) => allowed.get(id)),
    insufficient,
    missing_enumeration_items: missingEnumerationItems,
    errors,
  };
}
