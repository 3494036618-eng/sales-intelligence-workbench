import assert from "node:assert/strict";
import test from "node:test";
import { createRuntimePolicy, resolveAppMode } from "../src/config/runtimeMode.js";
import { createRepository } from "../src/repositories/repositoryFactory.js";
import { MemoryRepository } from "../src/repositories/memoryRepository.js";

function envReader(values = {}) {
  return {
    value(name, fallback = "") {
      return Object.hasOwn(values, name) ? values[name] : fallback;
    },
    hasAny(names) {
      return names.some((name) => Boolean(this.value(name)));
    },
    hasAll(names) {
      return names.every((name) => Boolean(this.value(name)));
    },
  };
}

test("runtime mode defaults to development and rejects unknown values", () => {
  assert.equal(resolveAppMode(), "development");
  assert.equal(resolveAppMode("prod"), "production");
  assert.throws(() => resolveAppMode("recording-ish"), /APP_MODE must be one of/);
});

test("demo is the only mode that enables fixtures and provider fallback", () => {
  const demo = createRuntimePolicy({ env: envReader({ APP_MODE: "demo" }) });
  const development = createRuntimePolicy({ env: envReader({ APP_MODE: "development" }) });

  assert.equal(demo.allow_fixture_data, true);
  assert.equal(demo.allow_provider_fallback, true);
  assert.equal(development.allow_fixture_data, false);
  assert.equal(development.allow_provider_fallback, false);
});

test("demo forces an in-memory repository even when Supabase is requested", () => {
  const env = envReader({ APP_MODE: "demo", REPOSITORY_MODE: "supabase" });
  const runtimePolicy = createRuntimePolicy({ env });
  const repository = createRepository({
    env,
    runtimePolicy,
    supabaseProvider: {
      isConfigured: () => true,
      isRunEnabled: () => true,
    },
  });

  assert.ok(repository instanceof MemoryRepository);
});

test("production reports blockers for memory storage, disabled providers, and demo flags", () => {
  const policy = createRuntimePolicy({
    env: envReader({
      APP_MODE: "production",
      REPOSITORY_MODE: "memory",
      SALES_DEMO_STABLE_MODE: "true",
    }),
  });

  assert.equal(policy.ready, false);
  assert.equal(policy.fail_closed, true);
  assert.match(policy.blockers.join(" | "), /REPOSITORY_MODE=supabase/);
  assert.match(policy.blockers.join(" | "), /DataPro/);
  assert.match(policy.blockers.join(" | "), /web search/);
  assert.match(policy.blockers.join(" | "), /model provider/);
  assert.match(policy.blockers.join(" | "), /SALES_\* demo flags/);
});

test("fully configured production policy is structurally ready", () => {
  const policy = createRuntimePolicy({
    env: envReader({
      APP_MODE: "production",
      REPOSITORY_MODE: "supabase",
      SUPABASE_READ_ONLY: "false",
      SUPABASE_API_URL: "https://supabase.example.test",
      SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
      APP_WORKSPACE_ID: "54768bef-53aa-47d0-a9e3-bbca4593cf58",
      HTTP_AUTH_ENABLED: "true",
      AGENT_PLAN_API_KEY: "test-key",
      DATAPRO_RUN_ENABLED: "true",
      WEB_SEARCH_RUN_ENABLED: "true",
      MODEL_RUN_ENABLED: "true",
      OPENVIKING_BASE_URL: "https://openviking.example.test",
      OPENVIKING_RUN_ENABLED: "true",
    }),
  });

  assert.equal(policy.ready, true);
  assert.deepEqual(policy.blockers, []);
});

test("production blocks startup when HTTP authentication is disabled", () => {
  const policy = createRuntimePolicy({
    env: envReader({
      APP_MODE: "production",
      REPOSITORY_MODE: "supabase",
      SUPABASE_READ_ONLY: "false",
      SUPABASE_API_URL: "https://supabase.example.test",
      SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
      APP_WORKSPACE_ID: "54768bef-53aa-47d0-a9e3-bbca4593cf58",
      DATAPRO_API_KEY: "test-key",
      DATAPRO_RUN_ENABLED: "true",
      WEB_SEARCH_API_KEY: "test-key",
      WEB_SEARCH_RUN_ENABLED: "true",
      MODEL_API_KEY: "test-key",
      MODEL_RUN_ENABLED: "true",
      OPENVIKING_CLI: "/usr/bin/true",
      OPENVIKING_RUN_ENABLED: "true",
    }),
  });

  assert.equal(policy.ready, false);
  assert.match(policy.blockers.join(" | "), /HTTP_AUTH_ENABLED=true/);
});

test("production rejects disabled or malformed paid workflow protection", () => {
  const policy = createRuntimePolicy({
    env: envReader({
      APP_MODE: "production",
      PAID_WORKFLOW_MAX_CONCURRENCY: "0",
      PAID_WORKFLOW_DAILY_LIMIT: "0",
      PAID_WORKFLOW_STALE_AFTER_SECONDS: "0",
      PAID_WORKFLOW_BUDGET_TIMEZONE: "Mars/Olympus",
    }),
  });

  const blockers = policy.blockers.join(" | ");
  assert.match(blockers, /PAID_WORKFLOW_MAX_CONCURRENCY/);
  assert.match(blockers, /PAID_WORKFLOW_DAILY_LIMIT/);
  assert.match(blockers, /PAID_WORKFLOW_STALE_AFTER_SECONDS/);
  assert.match(blockers, /PAID_WORKFLOW_BUDGET_TIMEZONE/);
});

test("production requires the persistent worker queue and a valid lease", () => {
  const policy = createRuntimePolicy({
    env: envReader({
      APP_MODE: "production",
      ASYNC_JOBS_ENABLED: "false",
      JOB_WORKER_LEASE_SECONDS: "30",
    }),
  });

  const blockers = policy.blockers.join(" | ");
  assert.match(blockers, /ASYNC_JOBS_ENABLED=true/);
  assert.match(blockers, /JOB_WORKER_LEASE_SECONDS >= 60/);
});

test("production requires a valid provider circuit breaker", () => {
  const policy = createRuntimePolicy({
    env: envReader({
      APP_MODE: "production",
      PROVIDER_CIRCUIT_BREAKER_ENABLED: "false",
      PROVIDER_CIRCUIT_BREAKER_FAILURE_THRESHOLD: "0",
      PROVIDER_CIRCUIT_BREAKER_COOLDOWN_SECONDS: "0",
    }),
  });

  const blockers = policy.blockers.join(" | ");
  assert.match(blockers, /PROVIDER_CIRCUIT_BREAKER_ENABLED=true/);
  assert.match(blockers, /PROVIDER_CIRCUIT_BREAKER_FAILURE_THRESHOLD/);
  assert.match(blockers, /PROVIDER_CIRCUIT_BREAKER_COOLDOWN_SECONDS/);
});

test("proxied production requires secure cookies and matching HTTPS auth origins", () => {
  const required = {
    APP_MODE: "production",
    REPOSITORY_MODE: "supabase",
    SUPABASE_READ_ONLY: "false",
    SUPABASE_API_URL: "https://supabase.example.test",
    SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
    APP_WORKSPACE_ID: "54768bef-53aa-47d0-a9e3-bbca4593cf58",
    HTTP_AUTH_ENABLED: "true",
    AGENT_PLAN_API_KEY: "test-key",
    DATAPRO_RUN_ENABLED: "true",
    WEB_SEARCH_RUN_ENABLED: "true",
    MODEL_RUN_ENABLED: "true",
    OPENVIKING_BASE_URL: "https://openviking.example.test",
    OPENVIKING_RUN_ENABLED: "true",
    TRUST_PROXY: "true",
  };

  const unsafe = createRuntimePolicy({
    env: envReader({
      ...required,
      AUTH_COOKIE_SECURE: "false",
      AUTH_REDIRECT_URL: "http://sales.example.test/",
      ALLOWED_ORIGINS: "http://sales.example.test",
    }),
  });
  const blockers = unsafe.blockers.join(" | ");
  assert.match(blockers, /AUTH_COOKIE_SECURE=true/);
  assert.match(blockers, /HTTPS AUTH_REDIRECT_URL/);
  assert.match(blockers, /HTTPS ALLOWED_ORIGINS/);

  const mismatched = createRuntimePolicy({
    env: envReader({
      ...required,
      AUTH_COOKIE_SECURE: "true",
      AUTH_REDIRECT_URL: "https://sales.example.test/",
      ALLOWED_ORIGINS: "https://other.example.test",
    }),
  });
  assert.match(mismatched.blockers.join(" | "), /must include the AUTH_REDIRECT_URL origin/);

  const safe = createRuntimePolicy({
    env: envReader({
      ...required,
      AUTH_COOKIE_SECURE: "true",
      AUTH_REDIRECT_URL: "https://sales.example.test/",
      ALLOWED_ORIGINS: "https://sales.example.test",
    }),
  });
  assert.equal(safe.ready, true);
});
