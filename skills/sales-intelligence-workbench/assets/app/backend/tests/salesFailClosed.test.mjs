import assert from "node:assert/strict";
import test from "node:test";
import { SalesService } from "../src/services/salesService.js";

const productionPolicy = Object.freeze({
  mode: "production",
  fail_closed: true,
  allow_fixture_data: false,
  allow_provider_fallback: false,
});

const developmentPolicy = Object.freeze({
  mode: "development",
  fail_closed: false,
  allow_fixture_data: false,
  allow_provider_fallback: false,
});

const demoPolicy = Object.freeze({
  mode: "demo",
  fail_closed: false,
  allow_fixture_data: true,
  allow_provider_fallback: true,
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

test("development ignores legacy SALES demo switches", () => {
  const service = new SalesService({
    env: envReader({
      SALES_DEMO_STABLE_MODE: "true",
      SALES_PROFESSIONAL_DEMO_FALLBACK: "true",
      SALES_SKIP_REAL_DATAPRO: "true",
    }),
    runtimePolicy: developmentPolicy,
  });

  assert.equal(service.salesDemoStableMode, false);
  assert.equal(service.salesProfessionalFallback, false);
  assert.equal(service.salesSkipRealDataPro, false);
  assert.deepEqual(service.data.goals, []);
  assert.deepEqual(service.data.companies, {});
});

test("demo is the only default mode that loads sales fixtures", () => {
  const service = new SalesService({
    env: envReader(),
    runtimePolicy: demoPolicy,
  });

  assert.ok(service.data.goals.length > 0);
  assert.ok(service.data.companies.xinlan_auto);
});

test("an empty production repository replaces any in-memory seed", async () => {
  const service = new SalesService({
    env: envReader(),
    runtimePolicy: productionPolicy,
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

test("production refuses to continue when verified professional evidence is unavailable", async () => {
  const service = new SalesService({
    env: envReader(),
    runtimePolicy: productionPolicy,
    ...unavailableProviders(),
  });

  await assert.rejects(
    () => service.collectDossierEvidence({ id: "company-1", name: "测试企业" }),
    (error) => error.status === 503 && error.code === "datapro_unavailable",
  );
});

test("production preserves retryability when public evidence has a transient provider failure", async () => {
  const service = new SalesService({
    env: envReader(),
    runtimePolicy: productionPolicy,
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

test("development returns issues without inventing professional evidence", async () => {
  const service = new SalesService({
    env: envReader(),
    runtimePolicy: developmentPolicy,
    ...unavailableProviders(),
  });

  const evidence = await service.collectDossierEvidence({ id: "company-1", name: "测试企业" });
  assert.deepEqual(evidence.professional, []);
  assert.deepEqual(evidence.public_sources, []);
  assert.ok(evidence.issues.length >= 2);
});

test("production refuses rule-based dossier fallback when the model is disabled", async () => {
  const service = new SalesService({
    env: envReader(),
    runtimePolicy: productionPolicy,
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

test("production business access requires a working persistent repository", async () => {
  const service = new SalesService({
    env: envReader(),
    runtimePolicy: productionPolicy,
  });

  await assert.rejects(
    () => service.assertRuntimeReady(),
    (error) => error.status === 503 && error.code === "supabase_unavailable",
  );
});
