import assert from "node:assert/strict";
import test from "node:test";
import { SalesService } from "../src/services/salesService.js";

const strictRuntimePolicy = Object.freeze({
  fail_closed: true,
});

const permissiveTestPolicy = Object.freeze({
  fail_closed: false,
});

function envReader(values = {}) {
  return {
    value(name, fallback = "") {
      return Object.hasOwn(values, name) ? values[name] : fallback;
    },
  };
}

function unavailableProviders() {
  return {
    dataProProvider: {
      maxSources: 1,
      isRunEnabled: () => true,
      callTool: async () => ({ ok: false, error: { code: "temporarily_unavailable" } }),
    },
    webSearchProvider: {
      isRunEnabled: () => true,
      search: async () => ({ ok: false, error: { code: "temporarily_unavailable" }, results: [] }),
    },
  };
}

test("the runtime starts with no business data", () => {
  const service = new SalesService({
    env: envReader(),
    runtimePolicy: permissiveTestPolicy,
  });

  assert.deepEqual(service.data.goals, []);
  assert.deepEqual(service.data.companies, {});
});

test("test data is loaded only when a test explicitly injects a seed", () => {
  const seed = {
    goals: [{ id: "goal-1", name: "Test goal" }],
    companies: {},
    dossiers: {},
    materials: {},
    qa_messages: {},
  };
  const service = new SalesService({
    env: envReader(),
    runtimePolicy: permissiveTestPolicy,
    seed,
  });

  assert.deepEqual(service.data.goals, seed.goals);
});

test("an empty persistent repository replaces injected test data", async () => {
  const service = new SalesService({
    env: envReader(),
    runtimePolicy: strictRuntimePolicy,
    seed: {
      goals: [{ id: "seed-goal", name: "Seed" }],
      companies: { seed: { id: "seed", name: "Seed Company" } },
      dossiers: {},
      materials: {},
      qa_messages: {},
    },
    repository: {
      getSalesState() {
        return {
          goals: [],
          companies: {},
          dossiers: {},
          materials: {},
          qa_messages: {},
        };
      },
    },
  });

  await service.assertRuntimeReady();
  assert.deepEqual(service.data.goals, []);
  assert.deepEqual(service.data.companies, {});
  assert.equal(service.persistence.enabled, true);
});

test("the runtime refuses to continue when verified professional evidence is unavailable", async () => {
  const service = new SalesService({
    env: envReader(),
    runtimePolicy: strictRuntimePolicy,
    ...unavailableProviders(),
  });

  await assert.rejects(
    () => service.collectDossierEvidence({ id: "company-1", name: "测试企业" }),
    (error) => error.status === 503 && error.code === "datapro_unavailable",
  );
});

test("the runtime preserves retryability when public evidence has a transient provider failure", async () => {
  const service = new SalesService({
    env: envReader(),
    runtimePolicy: strictRuntimePolicy,
    dataProProvider: {
      maxSources: 1,
      isRunEnabled: () => true,
      callTool: async () => ({
        ok: true,
        summary: "已核验的企业专业资料",
        raw_ref: "datapro:test",
      }),
    },
    webSearchProvider: {
      isRunEnabled: () => true,
      search: async () => ({
        ok: false,
        error: {
          code: "10500",
          category: "upstream",
          retryable: true,
        },
        results: [],
      }),
    },
  });

  await assert.rejects(
    () => service.collectDossierEvidence({ id: "company-1", name: "测试企业" }),
    (error) => (
      error.status === 503
      && error.code === "web_search_unavailable"
      && error.retryable === true
      && error.details.retryable === true
    ),
  );
});

test("a unit-test policy can inspect issues without inventing professional evidence", async () => {
  const service = new SalesService({
    env: envReader(),
    runtimePolicy: permissiveTestPolicy,
    ...unavailableProviders(),
  });

  const evidence = await service.collectDossierEvidence({ id: "company-1", name: "测试企业" });
  assert.deepEqual(evidence.professional, []);
  assert.deepEqual(evidence.public_sources, []);
  assert.ok(evidence.issues.length >= 2);
});

test("the runtime refuses rule-based dossier fallback when the model is disabled", async () => {
  const service = new SalesService({
    env: envReader(),
    runtimePolicy: strictRuntimePolicy,
    modelProvider: { isRunEnabled: () => false },
  });

  await assert.rejects(
    () => service.generateDossierWithModel(
      { name: "测试企业", industry: "测试行业", location: "测试地区" },
      { professional: [{ label: "企业工商数据库", summary: "已核验事实" }], public_sources: [] },
      [],
    ),
    (error) => error.status === 503 && error.code === "model_unavailable",
  );
});

test("business access requires a working persistent repository", async () => {
  const service = new SalesService({
    env: envReader(),
    runtimePolicy: strictRuntimePolicy,
  });

  await assert.rejects(
    () => service.assertRuntimeReady(),
    (error) => error.status === 503 && error.code === "supabase_unavailable",
  );
});
