import { existsSync } from "node:fs";
import { join } from "node:path";
import { createEnvReader } from "./runtimeEnv.js";

export const APP_MODES = Object.freeze(["development", "production", "demo"]);

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
const MODE_ALIASES = new Map([
  ["dev", "development"],
  ["prod", "production"],
]);

function isEnabled(value) {
  return TRUE_VALUES.has(String(value || "").trim().toLowerCase());
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function validTimeZone(value) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function parseAbsoluteUrl(value) {
  try {
    return new URL(String(value || "").trim());
  } catch {
    return null;
  }
}

function parseOrigins(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map(parseAbsoluteUrl);
}

export function resolveAppMode(value = "development") {
  const normalized = String(value || "development").trim().toLowerCase();
  const mode = MODE_ALIASES.get(normalized) || normalized;
  if (!APP_MODES.includes(mode)) {
    throw new Error(`APP_MODE must be one of: ${APP_MODES.join(", ")}. Received: ${value}`);
  }
  return mode;
}

export function createRuntimePolicy(options = {}) {
  const env = options.env || createEnvReader();
  const mode = resolveAppMode(env.value("APP_MODE", "development"));
  const repositoryMode = String(env.value("REPOSITORY_MODE", "memory")).trim().toLowerCase();
  const isProduction = mode === "production";
  const isDemo = mode === "demo";
  const legacyDemoFlags = {
    sales_demo_stable_mode: isEnabled(env.value("SALES_DEMO_STABLE_MODE", "false")),
    sales_professional_demo_fallback: isEnabled(env.value("SALES_PROFESSIONAL_DEMO_FALLBACK", "false")),
    sales_skip_real_datapro: isEnabled(env.value("SALES_SKIP_REAL_DATAPRO", "false")),
  };
  const providerRuns = {
    datapro: isEnabled(env.value("DATAPRO_RUN_ENABLED", "false")),
    web_search: isEnabled(env.value("WEB_SEARCH_RUN_ENABLED", "false")),
    model: isEnabled(env.value("MODEL_RUN_ENABLED", "false")),
    openviking: isEnabled(env.value("OPENVIKING_RUN_ENABLED", "false")),
  };
  const blockers = [];
  const httpAuthEnabled = isEnabled(env.value("HTTP_AUTH_ENABLED", "false"));
  const paidWorkflowLimits = Object.freeze({
    max_concurrent: positiveInteger(env.value("PAID_WORKFLOW_MAX_CONCURRENCY", "2"), 0),
    daily_limit: positiveInteger(env.value("PAID_WORKFLOW_DAILY_LIMIT", "100"), 0),
    timezone: String(env.value("PAID_WORKFLOW_BUDGET_TIMEZONE", "Asia/Shanghai") || "").trim(),
    stale_after_seconds: positiveInteger(env.value("PAID_WORKFLOW_STALE_AFTER_SECONDS", "1800"), 0),
  });
  const asyncJobsEnabled = isEnabled(env.value("ASYNC_JOBS_ENABLED", isProduction ? "true" : "false"));
  const providerCircuitBreaker = Object.freeze({
    enabled: isEnabled(env.value("PROVIDER_CIRCUIT_BREAKER_ENABLED", isProduction ? "true" : "false")),
    failure_threshold: positiveInteger(env.value("PROVIDER_CIRCUIT_BREAKER_FAILURE_THRESHOLD", "5"), 0),
    cooldown_seconds: positiveInteger(env.value("PROVIDER_CIRCUIT_BREAKER_COOLDOWN_SECONDS", "60"), 0),
  });

  if (isProduction) {
    if (repositoryMode !== "supabase") blockers.push("production requires REPOSITORY_MODE=supabase");
    if (isEnabled(env.value("SUPABASE_READ_ONLY", "false"))) blockers.push("production requires SUPABASE_READ_ONLY=false");
    if (!env.hasAll(["SUPABASE_API_URL", "SUPABASE_SERVICE_ROLE_KEY", "APP_WORKSPACE_ID"])) {
      blockers.push("production Supabase Data API configuration is incomplete");
    }
    if (!httpAuthEnabled) blockers.push("production requires HTTP_AUTH_ENABLED=true");
    if (!paidWorkflowLimits.max_concurrent) blockers.push("production requires PAID_WORKFLOW_MAX_CONCURRENCY > 0");
    if (!paidWorkflowLimits.daily_limit) blockers.push("production requires PAID_WORKFLOW_DAILY_LIMIT > 0");
    if (!paidWorkflowLimits.stale_after_seconds) blockers.push("production requires PAID_WORKFLOW_STALE_AFTER_SECONDS > 0");
    if (!asyncJobsEnabled) blockers.push("production requires ASYNC_JOBS_ENABLED=true");
    if (!providerCircuitBreaker.enabled) blockers.push("production requires PROVIDER_CIRCUIT_BREAKER_ENABLED=true");
    if (!providerCircuitBreaker.failure_threshold) {
      blockers.push("production requires PROVIDER_CIRCUIT_BREAKER_FAILURE_THRESHOLD > 0");
    }
    if (!providerCircuitBreaker.cooldown_seconds) {
      blockers.push("production requires PROVIDER_CIRCUIT_BREAKER_COOLDOWN_SECONDS > 0");
    }
    if (positiveInteger(env.value("JOB_WORKER_LEASE_SECONDS", "600"), 0) < 60) {
      blockers.push("production requires JOB_WORKER_LEASE_SECONDS >= 60");
    }
    if (!validTimeZone(paidWorkflowLimits.timezone)) blockers.push("production PAID_WORKFLOW_BUDGET_TIMEZONE is invalid");
    const host = String(env.value("HOST", "127.0.0.1")).trim().toLowerCase();
    const loopbackOnly = ["127.0.0.1", "::1", "localhost"].includes(host);
    const trustProxy = isEnabled(env.value("TRUST_PROXY", "false"));
    const secureCookie = isEnabled(env.value("AUTH_COOKIE_SECURE", "false"));
    if ((!loopbackOnly || trustProxy) && !secureCookie) {
      blockers.push("public or proxied production requires AUTH_COOKIE_SECURE=true");
    }
    if (trustProxy) {
      const redirectUrl = parseAbsoluteUrl(env.value("AUTH_REDIRECT_URL", ""));
      const allowedOrigins = parseOrigins(env.value("ALLOWED_ORIGINS", ""));
      if (!redirectUrl || redirectUrl.protocol !== "https:") {
        blockers.push("proxied production requires an HTTPS AUTH_REDIRECT_URL");
      }
      if (!allowedOrigins.length || allowedOrigins.some((origin) => !origin || origin.protocol !== "https:")) {
        blockers.push("proxied production requires explicit HTTPS ALLOWED_ORIGINS");
      } else if (redirectUrl && !allowedOrigins.some((origin) => origin.origin === redirectUrl.origin)) {
        blockers.push("proxied production ALLOWED_ORIGINS must include the AUTH_REDIRECT_URL origin");
      }
    }
    if (!env.hasAny(["DATAPRO_API_KEY", "AGENT_PLAN_API_KEY"]) || !providerRuns.datapro) {
      blockers.push("production requires an enabled DataPro provider");
    }
    if (!env.hasAny(["WEB_SEARCH_API_KEY", "AGENT_PLAN_API_KEY", "ASK_ECHO_SEARCH_INFINITY_API_KEY"]) || !providerRuns.web_search) {
      blockers.push("production requires an enabled web search provider");
    }
    if (!env.hasAny(["MODEL_API_KEY", "AGENT_PLAN_API_KEY", "ARK_API_KEY", "VOLCENGINE_ARK_API_KEY"]) || !providerRuns.model) {
      blockers.push("production requires an enabled model provider");
    }
    const openVikingCli = env.value("OPENVIKING_CLI") || (process.env.HOME ? join(process.env.HOME, "bin", "ov") : "");
    const openVikingCliConfig = env.value("OPENVIKING_CLI_CONFIG")
      || (process.env.HOME ? join(process.env.HOME, ".openviking", "ovcli.conf") : "");
    const openVikingConfigured = (
      env.hasAny(["OPENVIKING_API_KEY", "OPENVIKING_BEARER_TOKEN"])
      && env.hasAny(["OPENVIKING_BASE_URL"])
    )
      || Boolean(openVikingCliConfig && existsSync(openVikingCliConfig))
      || Boolean(env.value("OPENVIKING_CLI") && openVikingCli && existsSync(openVikingCli));
    if (!openVikingConfigured || !providerRuns.openviking) {
      blockers.push("production requires an enabled OpenViking provider");
    }
    if (Object.values(legacyDemoFlags).some(Boolean)) {
      blockers.push("production does not allow SALES_* demo flags");
    }
  }

  return Object.freeze({
    mode,
    is_production: isProduction,
    is_development: mode === "development",
    is_demo: isDemo,
    fail_closed: isProduction,
    allow_fixture_data: isDemo,
    allow_provider_fallback: isDemo,
    allow_frontend_fallback: isDemo,
    allow_legacy_demo_api: !isProduction,
    repository_mode: repositoryMode,
    provider_runs: Object.freeze(providerRuns),
    paid_workflow_limits: paidWorkflowLimits,
    provider_circuit_breaker: providerCircuitBreaker,
    async_jobs_enabled: asyncJobsEnabled,
    http_auth_enabled: httpAuthEnabled,
    legacy_demo_flags: Object.freeze(legacyDemoFlags),
    blockers: Object.freeze(blockers),
    ready: blockers.length === 0,
  });
}

export function publicRuntimePolicy(policy) {
  return {
    mode: policy.mode,
    ready: policy.ready,
    fail_closed: policy.fail_closed,
    fixture_data_enabled: policy.allow_fixture_data,
    provider_fallback_enabled: policy.allow_provider_fallback,
    repository_mode: policy.repository_mode,
    blockers: [...policy.blockers],
  };
}
