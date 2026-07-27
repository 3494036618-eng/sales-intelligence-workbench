import { makeId } from "../utils/ids.js";
import { nowIso } from "../utils/time.js";

const clone = (value) => JSON.parse(JSON.stringify(value));

export const mockDiscoveryProvider = {
  discoverObjects(repository, scopeId, query, mode = "broad") {
    const text = String(query || "").trim().toLowerCase();
    if (!text) return [];

    const exact = repository
      .listCatalogObjects()
      .filter((object) => object.name.toLowerCase().includes(text) || text.includes(object.name.toLowerCase()))
      .map((object) => ({ object_id: object.id, reason: "按名称精确匹配到可核验对象" }));

    let candidates = exact;
    if (!candidates.length && mode === "broad") {
      if (/视频|影像|video|生成/.test(text)) candidates = repository.getTopicCandidates("video");
      if (/文档|协作|docs|notion|飞书|知识库/.test(text)) candidates = repository.getTopicCandidates("docs");
    }
    if (!candidates.length) return [];

    return candidates
      .map((candidate) => {
        const object = repository.getCatalogObject(candidate.object_id);
        if (!object) return null;
        return {
          id: object.id,
          name: object.name,
          object_type: object.object_type,
          summary: object.summary,
          primary_source: object.primary_source,
          source_ids: clone(object.source_ids),
          sources: repository.sourceList(scopeId, object.id, object.source_ids),
          reason: candidate.reason,
          tracked: repository.hasObject(scopeId, object.id),
          provider: "fixture",
          provider_mode: "mock",
          raw_ref: `fixture:topicCandidates.${object.id}`,
        };
      })
      .filter(Boolean);
  },
};

export const mockDataProvider = {
  queryStructuredFacts(object) {
    return {
      provider: "fixture",
      provider_mode: "mock",
      evidence: object.object_type === "company" ? object.source_ids.filter((id) => id.toLowerCase().includes("biz") || id.toLowerCase().includes("ip")) : [],
      summary: object.object_type === "company" ? "返回 fixture 专业数据候选。" : "产品对象跳过专业数据。",
    };
  },
};

export const mockSourceProvider = {
  collectSources(object) {
    return {
      provider: "fixture",
      provider_mode: "mock",
      evidence: clone(object.source_ids),
      summary: `返回 ${object.source_ids.length} 条 fixture 来源。`,
    };
  },
};

export const mockAgentProvider = {
  generateChangeCards(scopeId, object, runId, repository) {
    return (object.planned_cards || [])
      .filter((card) => (card.source_ids || []).length > 0)
      .map((card) => ({
        ...clone(card),
        run_id: runId,
        scope_id: scopeId,
        object_id: object.id,
        status: "pending",
        provider: "fixture",
        provider_mode: "mock",
        raw_ref: `fixture:objects.${object.id}.planned_cards.${card.id}`,
        created_at: nowIso(),
        updated_at: nowIso(),
        sources: repository.sourceList(scopeId, object.id, card.source_ids),
      }));
  },
};

export const mockMemoryProvider = {
  retrieveMemory() {
    return {
      provider: "fixture",
      provider_mode: "mock",
      evidence: [],
      summary: "第一版未接入记忆 provider。",
    };
  },
  saveMemory() {
    return {
      id: makeId("memory_ref"),
      provider: "fixture",
      provider_mode: "mock",
      status: "skipped",
    };
  },
};

export function createMockProviders() {
  return {
    discovery: mockDiscoveryProvider,
    data: mockDataProvider,
    source: mockSourceProvider,
    agent: mockAgentProvider,
    memory: mockMemoryProvider,
  };
}
