import {
  HttpError,
  accepted,
  created,
  fail,
  isOriginAllowed,
  ok,
  parseAllowedOrigins,
  readJson,
  withCors,
  withSecurityHeaders,
} from "../utils/http.js";
import { makeRequestId } from "../utils/ids.js";
import { enforceRateLimit } from "../security/rateLimiter.js";

function route(method, pattern, names, handler, access = method === "GET" ? "viewer" : "member", audit = null) {
  return { method, pattern, names, handler, access, audit };
}

function paramsFrom(match, names) {
  return Object.fromEntries(names.map((name, index) => [name, decodeURIComponent(match[index + 1])]));
}

function listMeta(data, providerMode = "mock") {
  return {
    count: Array.isArray(data) ? data.length : undefined,
    provider_mode: providerMode,
  };
}

function isSalesBusinessPath(pathname) {
  return /^\/api\/(sales-goals|target-enterprises|dossiers|provider-runs|jobs)(?:\/|$)/.test(pathname);
}

function isLegacyDemoPath(pathname) {
  return /^\/api\/(scopes|runs|change-cards|assets)(?:\/|$)/.test(pathname);
}

function isProviderProbePath(pathname) {
  return /^\/api\/providers\/[^/]+\/probe$/.test(pathname);
}

function isPaidOperation(method, pathname) {
  if (method !== "POST") return false;
  return isProviderProbePath(pathname)
    || /\/company-search$/.test(pathname)
    || /\/dossiers$/.test(pathname)
    || /\/qa(?:\/commit-memory)?$/.test(pathname)
    || /\/materials\/(?:import|sync-openviking|feishu-import)$/.test(pathname);
}

function requestClientKey(req, trustProxy = false) {
  if (trustProxy) {
    const forwarded = String(req.headers?.["x-forwarded-for"] || "").split(",")[0].trim();
    if (forwarded) return forwarded.slice(0, 120);
  }
  return String(req.socket?.remoteAddress || "unknown").slice(0, 120);
}

export function createRouter(service, options = {}) {
  const salesService = options.salesService || null;
  const feishuImportTaskService = options.feishuImportTaskService || null;
  const adminStatusService = options.adminStatusService || null;
  const staticFrontend = options.staticFrontend || null;
  const authService = options.authService || null;
  const rateLimiters = options.rateLimiters || null;
  const env = options.env || null;
  const allowedOrigins = parseAllowedOrigins(env?.value?.("ALLOWED_ORIGINS", "") || "");
  const maxBodyBytes = Math.max(1024, env?.number?.("API_MAX_BODY_BYTES", 1024 * 1024) || 1024 * 1024);
  const trustProxy = ["1", "true", "yes", "on"].includes(String(env?.value?.("TRUST_PROXY", "false") || "").toLowerCase());
  const runtimePolicy = options.runtimePolicy || {
    mode: "development",
    ready: true,
    fail_closed: false,
    allow_legacy_demo_api: true,
    blockers: [],
  };
  const providerMode = runtimePolicy.mode === "demo"
    ? "mock"
    : runtimePolicy.mode === "production"
      ? "real"
      : "mixed";
  const freshSalesData = async (read, options = {}) => {
    await salesService?.refreshPersistedState?.(options);
    return read();
  };
  const routes = [
    route("GET", /^\/api\/health$/, [], async () => ({
      data: {
        status: runtimePolicy.ready ? "ok" : "degraded",
        service: "sales-intelligence-workbench-api",
        version: "0.9.0",
        app_mode: runtimePolicy.mode,
        provider_mode: providerMode,
        runtime_ready: runtimePolicy.ready,
      },
      meta: { provider_mode: providerMode, app_mode: runtimePolicy.mode },
    }), "public"),
    route("GET", /^\/api\/auth\/status$/, [], async ({ req, res }) => ({
      data: authService
        ? await authService.sessionStatus(req, res)
        : { enabled: false, authenticated: true, bootstrap_required: false, user: null },
      meta: { provider_mode: "supabase_auth" },
    }), "public"),
    route("POST", /^\/api\/auth\/bootstrap$/, [], async ({ body, res }) => ({
      data: await authService.bootstrap(body, res),
      status: 201,
      meta: { provider_mode: "supabase_auth" },
    }), "public"),
    route("POST", /^\/api\/auth\/login$/, [], async ({ body, res }) => ({
      data: await authService.login(body, res),
      meta: { provider_mode: "supabase_auth" },
    }), "public"),
    route("POST", /^\/api\/auth\/cli-login$/, [], async ({ body }) => ({
      data: await authService.cliLogin(body),
      meta: { provider_mode: "supabase_auth" },
    }), "public"),
    route("POST", /^\/api\/auth\/cli-refresh$/, [], async ({ body }) => ({
      data: await authService.cliRefresh(body),
      meta: { provider_mode: "supabase_auth" },
    }), "public"),
    route("POST", /^\/api\/auth\/refresh$/, [], async ({ req, res }) => ({
      data: await authService.refresh(req, res),
      meta: { provider_mode: "supabase_auth" },
    }), "public"),
    route("POST", /^\/api\/auth\/logout$/, [], async ({ req, res }) => ({
      data: await authService.logout(req, res),
      meta: { provider_mode: "supabase_auth" },
    }), "public"),
    route("POST", /^\/api\/auth\/password\/recover$/, [], async ({ body }) => ({
      data: await authService.requestPasswordRecovery(body),
      meta: { provider_mode: "supabase_auth" },
    }), "public"),
    route("POST", /^\/api\/auth\/password\/update$/, [], async ({ body, req, res }) => ({
      data: await authService.updatePassword(body, req, res),
      meta: { provider_mode: "supabase_auth" },
    }), "public"),
    route("GET", /^\/api\/providers\/status$/, [], async () => ({
      data: service.getProviderStatus(),
      meta: { provider_mode: "mixed" },
    }), "admin"),
    route("GET", /^\/api\/admin\/status$/, [], async () => ({
      data: adminStatusService
        ? await adminStatusService.getStatus()
        : { read_only: true, unavailable: true },
      meta: { provider_mode: providerMode, app_mode: runtimePolicy.mode },
    }), "admin"),
    route("GET", /^\/api\/admin\/audit-events$/, [], async ({ auth, query }) => {
      const data = await authService.listAuditEvents(auth, {
        action: query.get("action") || "",
        entity_type: query.get("entity_type") || "",
        entity_id: query.get("entity_id") || "",
        limit: query.get("limit") || 50,
      });
      return {
        data,
        meta: { ...listMeta(data, "local"), app_mode: runtimePolicy.mode },
      };
    }, "admin"),
    route("GET", /^\/api\/admin\/workspace-export$/, [], async () => {
      await salesService?.assertRuntimeReady?.();
      return {
        data: await freshSalesData(() => salesService.exportWorkspaceData(), { force: true }),
        meta: { provider_mode: "local", app_mode: runtimePolicy.mode },
      };
    }, "owner", ({ auth }) => ({
      action: "workspace.exported",
      entity_type: "workspace",
      entity_id: auth?.principal?.workspace_id || "",
    })),
    route("POST", /^\/api\/providers\/web-search\/probe$/, [], async ({ body }) => ({
      data: await service.probeWebSearch(body),
      meta: { provider_mode: "real" },
    }), "admin", () => ({ action: "provider.probed", entity_type: "provider", entity_id: "web_search" })),
    route("POST", /^\/api\/providers\/datapro\/probe$/, [], async ({ body }) => ({
      data: await service.probeDataPro(body),
      meta: { provider_mode: "real" },
    }), "admin", () => ({ action: "provider.probed", entity_type: "provider", entity_id: "datapro" })),
    route("POST", /^\/api\/providers\/model\/probe$/, [], async ({ body }) => ({
      data: await service.probeModel(body),
      meta: { provider_mode: "real" },
    }), "admin", () => ({ action: "provider.probed", entity_type: "provider", entity_id: "model" })),
    route("POST", /^\/api\/providers\/vision\/probe$/, [], async ({ body }) => ({
      data: await service.probeVision(body),
      meta: { provider_mode: "real" },
    }), "admin", () => ({ action: "provider.probed", entity_type: "provider", entity_id: "vision" })),
    route("POST", /^\/api\/providers\/openviking\/probe$/, [], async ({ body }) => ({
      data: await service.probeOpenViking(body),
      meta: { provider_mode: "real" },
    }), "admin", () => ({ action: "provider.probed", entity_type: "provider", entity_id: "openviking" })),
    route("POST", /^\/api\/providers\/supabase\/probe$/, [], async () => ({
      data: await service.probeSupabase(),
      meta: { provider_mode: "real" },
    }), "admin", () => ({ action: "provider.probed", entity_type: "provider", entity_id: "supabase" })),

    route("GET", /^\/api\/provider-runs$/, [], async ({ query }) => {
      const data = await salesService.listProviderRuns({
        operation: query.get("operation") || "",
        entity_id: query.get("entity_id") || "",
        limit: query.get("limit") || 20,
      });
      return { data, meta: { ...listMeta(data, providerMode), app_mode: runtimePolicy.mode } };
    }, "admin"),
    route("GET", /^\/api\/provider-runs\/([^/]+)$/, ["provider_run_id"], async ({ params }) => ({
      data: await salesService.getProviderRun(params.provider_run_id),
      meta: { provider_mode: providerMode, app_mode: runtimePolicy.mode },
    }), "admin"),
    route("GET", /^\/api\/jobs$/, [], async ({ query }) => {
      const data = await salesService.listPublicJobs({
        job_type: query.get("job_type") || "",
        status: query.get("status") || "",
        entity_id: query.get("entity_id") || "",
        limit: query.get("limit") || 20,
      });
      return { data, meta: { ...listMeta(data, providerMode), app_mode: runtimePolicy.mode } };
    }),
    route("GET", /^\/api\/jobs\/([^/]+)$/, ["job_id"], async ({ params }) => ({
      data: await salesService.getPublicJob(params.job_id),
      meta: { provider_mode: providerMode, app_mode: runtimePolicy.mode },
    })),
    route("POST", /^\/api\/jobs\/([^/]+)\/cancel$/, ["job_id"], async ({ params }) => ({
      data: salesService.publicJob(await salesService.cancelJob(params.job_id)),
      meta: { provider_mode: providerMode, app_mode: runtimePolicy.mode },
    }), "member", ({ params }) => ({
      action: "job.cancelled",
      entity_type: "job",
      entity_id: params.job_id,
    })),
    route("POST", /^\/api\/jobs\/([^/]+)\/retry$/, ["job_id"], async ({ params }) => ({
      data: await salesService.retryJob(params.job_id),
      meta: { provider_mode: providerMode, app_mode: runtimePolicy.mode },
    }), "member", ({ params }) => ({
      action: "job.retried",
      entity_type: "job",
      entity_id: params.job_id,
    })),
    route("GET", /^\/api\/admin\/usage-budget$/, [], async () => ({
      data: await salesService.getPaidWorkflowUsage(),
      meta: { app_mode: runtimePolicy.mode },
    }), "admin"),

    route("GET", /^\/api\/sales-goals$/, [], async () => ({
      data: await freshSalesData(() => salesService.listGoals()),
      meta: { provider_mode: "mixed" },
    })),
    route("POST", /^\/api\/sales-goals$/, [], async ({ body }) => ({
      data: await salesService.createGoal(body),
      status: 201,
      meta: { provider_mode: "mixed" },
    }), "member", ({ result }) => ({
      action: "sales_goal.created",
      entity_type: "sales_goal",
      entity_id: result?.data?.id || "",
    })),
    route("GET", /^\/api\/sales-goals\/([^/]+)\/target-enterprises$/, ["goal_id"], async ({ params }) => ({
      data: await freshSalesData(() => salesService.listTargetEnterprises(params.goal_id)),
      meta: { provider_mode: "mixed" },
    })),
    route("POST", /^\/api\/sales-goals\/([^/]+)\/company-search$/, ["goal_id"], async ({ params, body }) => ({
      data: await salesService.searchCompanies(params.goal_id, body),
      meta: { provider_mode: "mixed" },
    }), "member", ({ params }) => ({
      action: "company_search.executed",
      entity_type: "sales_goal",
      entity_id: params.goal_id,
    })),
    route("POST", /^\/api\/sales-goals\/([^/]+)\/target-enterprises$/, ["goal_id"], async ({ params, body }) => ({
      data: await salesService.addTargetEnterprise(params.goal_id, body),
      status: 201,
      meta: { provider_mode: "mixed" },
    }), "member", ({ params, result }) => ({
      action: "target_enterprise.added",
      entity_type: "target_enterprise",
      entity_id: result?.data?.id || params.goal_id,
    })),
    route("GET", /^\/api\/target-enterprises\/([^/]+)$/, ["enterprise_id"], async ({ params, query }) => ({
      data: await freshSalesData(() => salesService.enterpriseDetail(params.enterprise_id, {
        goal_id: query.get("goal_id") || "",
      })),
      meta: { provider_mode: "mixed" },
    })),
    route("GET", /^\/api\/target-enterprises\/([^/]+)\/progress$/, ["enterprise_id"], async ({ params }) => ({
      data: await freshSalesData(() => salesService.progressView(params.enterprise_id)),
      meta: { provider_mode: "mixed" },
    })),
    route("GET", /^\/api\/target-enterprises\/([^/]+)\/dossiers$/, ["enterprise_id"], async ({ params }) => ({
      data: await freshSalesData(() => salesService.listDossiers(params.enterprise_id)),
      meta: { provider_mode: "mixed" },
    })),
    route("POST", /^\/api\/target-enterprises\/([^/]+)\/dossiers$/, ["enterprise_id"], async ({ params, body, auth }) => {
      if (salesService.asyncJobsEnabled) {
        return {
          data: await salesService.enqueueDossier(params.enterprise_id, body, {
            created_by: auth?.principal?.id || null,
          }),
          status: 202,
          meta: { provider_mode: "mixed", execution_mode: "asynchronous" },
        };
      }
      return {
        data: await salesService.createDossier(params.enterprise_id, body),
        status: 201,
        meta: { provider_mode: "mixed", execution_mode: "synchronous" },
      };
    }, "member", ({ params }) => ({
      action: "dossier.generation_requested",
      entity_type: "target_enterprise",
      entity_id: params.enterprise_id,
    })),
    route("GET", /^\/api\/dossiers\/([^/]+)$/, ["dossier_id"], async ({ params }) => ({
      data: await freshSalesData(() => salesService.dossierDetail(params.dossier_id), { force: true }),
      meta: { provider_mode: "mixed" },
    })),
    route("GET", /^\/api\/target-enterprises\/([^/]+)\/materials$/, ["enterprise_id"], async ({ params }) => ({
      data: await freshSalesData(() => salesService.listMaterials(params.enterprise_id)),
      meta: { provider_mode: "mixed" },
    })),
    route("GET", /^\/api\/target-enterprises\/([^/]+)\/materials\/sources$/, ["enterprise_id"], async ({ params }) => ({
      data: await freshSalesData(() => salesService.listMaterialSyncSources(params.enterprise_id)),
      meta: { provider_mode: "mixed" },
    })),
    route("GET", /^\/api\/target-enterprises\/([^/]+)\/materials\/sync-state$/, ["enterprise_id"], async ({ params, query }) => ({
      data: await freshSalesData(() => salesService.getMaterialSyncState(params.enterprise_id, {
        source_id: query.get("source_id") || "",
        title: query.get("display_name") || query.get("external_id") || "资料同步源",
        source: {
          type: query.get("source_type") || "manual",
          external_id: query.get("external_id") || "",
          checkpoint_key: query.get("checkpoint_key") || "latest",
        },
      })),
      meta: { provider_mode: "mixed" },
    })),
    route("GET", /^\/api\/feishu-import\/status$/, [], async () => ({
      data: feishuImportTaskService?.status?.() || {
        available: false,
        supported_sources: [],
      },
      meta: { provider_mode: "local_cli" },
    }), "viewer"),
    route("POST", /^\/api\/target-enterprises\/([^/]+)\/materials\/feishu-import$/, ["enterprise_id"], async ({ params, body }) => ({
      data: await feishuImportTaskService.start(params.enterprise_id, body),
      status: 202,
      meta: { provider_mode: "local_cli", execution_mode: "asynchronous" },
    }), "member", ({ params, result }) => ({
      action: "feishu_material.import_requested",
      entity_type: "target_enterprise",
      entity_id: params.enterprise_id,
      metadata: { task_id: result?.data?.id || null },
    })),
    route("GET", /^\/api\/target-enterprises\/([^/]+)\/materials\/feishu-import\/([^/]+)$/, ["enterprise_id", "task_id"], async ({ params }) => ({
      data: feishuImportTaskService.get(params.enterprise_id, params.task_id),
      meta: { provider_mode: "local_cli" },
    }), "member"),
    route("POST", /^\/api\/target-enterprises\/([^/]+)\/materials\/import$/, ["enterprise_id"], async ({ params, body }) => ({
      data: await salesService.importMaterial(params.enterprise_id, body),
      status: 201,
      meta: { provider_mode: "mixed" },
    }), "member", ({ params, result }) => ({
      action: "material.imported",
      entity_type: "sales_material",
      entity_id: result?.data?.material?.id || params.enterprise_id,
    })),
    route("POST", /^\/api\/target-enterprises\/([^/]+)\/materials\/source-action$/, ["enterprise_id"], async ({ params, body }) => ({
      data: await salesService.updateMaterialSyncSource(params.enterprise_id, body),
      meta: { provider_mode: "mixed" },
    }), "member", ({ params, result }) => ({
      action: "material_source.updated",
      entity_type: "material_source",
      entity_id: result?.data?.source?.id || params.enterprise_id,
    })),
    route("POST", /^\/api\/target-enterprises\/([^/]+)\/materials\/sync-openviking$/, ["enterprise_id"], async ({ params, body, auth }) => {
      if (salesService.asyncJobsEnabled) {
        const data = await salesService.enqueueMaterialsToOpenViking(params.enterprise_id, {
          idempotency_key: body.idempotency_key || null,
          created_by: auth?.principal?.id || null,
        });
        return {
          data,
          status: data.id ? 202 : 200,
          meta: { provider_mode: "mixed", execution_mode: data.id ? "asynchronous" : "skipped" },
        };
      }
      return {
        data: await salesService.syncMaterialsToOpenViking(params.enterprise_id),
        meta: { provider_mode: "mixed", execution_mode: "synchronous" },
      };
    }, "member", ({ params }) => ({
      action: "openviking.sync_requested",
      entity_type: "target_enterprise",
      entity_id: params.enterprise_id,
    })),
    route("GET", /^\/api\/target-enterprises\/([^/]+)\/qa$/, ["enterprise_id"], async ({ params }) => ({
      data: await freshSalesData(() => salesService.getQa(params.enterprise_id)),
      meta: { provider_mode: "mixed" },
    })),
    route("POST", /^\/api\/target-enterprises\/([^/]+)\/qa$/, ["enterprise_id"], async ({ params, body }) => ({
      data: await salesService.askQuestion(params.enterprise_id, body),
      meta: { provider_mode: "mixed" },
    }), "member", ({ params }) => ({
      action: "qa.answered",
      entity_type: "target_enterprise",
      entity_id: params.enterprise_id,
    })),
    route("POST", /^\/api\/target-enterprises\/([^/]+)\/qa\/commit-memory$/, ["enterprise_id"], async ({ params }) => ({
      data: await salesService.commitQaMemory(params.enterprise_id),
      meta: { provider_mode: "mixed" },
    }), "member", ({ params }) => ({
      action: "qa.memory_committed",
      entity_type: "target_enterprise",
      entity_id: params.enterprise_id,
    })),

    route("GET", /^\/api\/scopes$/, [], async () => {
      const data = service.listScopes();
      return { data, meta: listMeta(data) };
    }),
    route("POST", /^\/api\/scopes$/, [], async ({ body }) => ({
      data: service.createScope(body),
      status: 201,
      meta: { provider_mode: "mock" },
    })),
    route("GET", /^\/api\/scopes\/([^/]+)$/, ["scope_id"], async ({ params }) => ({
      data: service.getScope(params.scope_id),
      meta: { provider_mode: "mock" },
    })),
    route("GET", /^\/api\/scopes\/([^/]+)\/stats$/, ["scope_id"], async ({ params }) => ({
      data: service.getScopeStats(params.scope_id),
      meta: { provider_mode: "mock" },
    })),

    route("GET", /^\/api\/scopes\/([^/]+)\/objects$/, ["scope_id"], async ({ params }) => {
      const data = service.listObjects(params.scope_id);
      return { data, meta: listMeta(data) };
    }),
    route("POST", /^\/api\/scopes\/([^/]+)\/objects$/, ["scope_id"], async ({ params, body }) => ({
      data: service.addObject(params.scope_id, body),
      status: 201,
      meta: { provider_mode: "mock" },
    })),
    route("GET", /^\/api\/scopes\/([^/]+)\/objects\/([^/]+)$/, ["scope_id", "object_id"], async ({ params }) => ({
      data: service.getObject(params.scope_id, params.object_id),
      meta: { provider_mode: "mock" },
    })),
    route("POST", /^\/api\/scopes\/([^/]+)\/discover-objects$/, ["scope_id"], async ({ params, body }) => {
      const data = service.discoverObjects(params.scope_id, body);
      return {
        data,
        meta: {
          ...listMeta(data),
          message: data.length ? undefined : "未发现可核验对象。",
        },
      };
    }),
    route("GET", /^\/api\/scopes\/([^/]+)\/candidates$/, ["scope_id"], async ({ params }) => {
      const data = service.getCandidates(params.scope_id);
      return { data, meta: listMeta(data) };
    }),

    route("POST", /^\/api\/scopes\/([^/]+)\/objects\/([^/]+)\/runs$/, ["scope_id", "object_id"], async ({ params }) => {
      const data = await service.runObject(params.scope_id, params.object_id);
      return {
        data,
        status: 201,
        meta: { provider_mode: data.provider_mode || "mock" },
      };
    }),
    route("GET", /^\/api\/runs\/([^/]+)$/, ["run_id"], async ({ params }) => ({
      data: service.getRun(params.run_id),
      meta: { provider_mode: "mock" },
    })),
    route("GET", /^\/api\/runs\/([^/]+)\/traces$/, ["run_id"], async ({ params }) => {
      const data = service.getRunTraces(params.run_id);
      return { data, meta: listMeta(data) };
    }),
    route("GET", /^\/api\/runs\/([^/]+)\/change-cards$/, ["run_id"], async ({ params }) => {
      const data = service.getRunCards(params.run_id);
      return { data, meta: listMeta(data) };
    }),

    route("POST", /^\/api\/change-cards\/([^/]+)\/actions$/, ["card_id"], async ({ params, body }) => ({
      data: await service.saveCardAction(params.card_id, body),
      meta: { provider_mode: "mixed" },
    })),

    route("GET", /^\/api\/scopes\/([^/]+)\/memory$/, ["scope_id"], async ({ params, query }) => ({
      data: service.getMemory(params.scope_id, { object_id: query.get("object_id") || "" }),
      meta: { provider_mode: "mixed" },
    })),
    route("GET", /^\/api\/scopes\/([^/]+)\/sync-records$/, ["scope_id"], async ({ params, query }) => ({
      data: service.getSyncRecords(params.scope_id, { object_id: query.get("object_id") || "" }),
      meta: { provider_mode: "mixed" },
    })),

    route("GET", /^\/api\/scopes\/([^/]+)\/assets$/, ["scope_id"], async ({ params }) => {
      const data = service.getAssets(params.scope_id);
      return { data, meta: listMeta(data) };
    }),
    route("POST", /^\/api\/scopes\/([^/]+)\/assets$/, ["scope_id"], async ({ params, body }) => ({
      data: await service.generateAsset(params.scope_id, body),
      status: 201,
      meta: { provider_mode: "mixed" },
    })),
    route("GET", /^\/api\/assets\/([^/]+)\/report$/, ["asset_id"], async ({ params }) => ({
      data: service.getReport(params.asset_id),
      meta: { provider_mode: "mock" },
    })),

    route("GET", /^\/api\/scopes\/([^/]+)\/qa$/, ["scope_id"], async ({ params }) => ({
      data: service.getQa(params.scope_id),
      meta: { provider_mode: "mock" },
    })),
    route("POST", /^\/api\/scopes\/([^/]+)\/qa\/messages$/, ["scope_id"], async ({ params, body }) => ({
      data: await service.askQuestion(params.scope_id, body),
      meta: { provider_mode: "mixed" },
    })),
    route("POST", /^\/api\/scopes\/([^/]+)\/qa\/excerpts$/, ["scope_id"], async ({ params, body }) => ({
      data: service.saveExcerpt(params.scope_id, body),
      status: 201,
      meta: { provider_mode: "mixed" },
    })),
  ];

  return async function handle(req, res) {
    const requestId = makeRequestId();
    try {
      const url = new URL(req.url, "http://localhost");
      const isApi = url.pathname.startsWith("/api");
      withSecurityHeaders(res, { api: isApi });
      if (isApi && !isOriginAllowed(req, allowedOrigins)) {
        throw new HttpError(403, "origin_not_allowed", "当前请求来源不在允许列表中。");
      }
      withCors(req, res, allowedOrigins);
      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }
      if (staticFrontend && !url.pathname.startsWith("/api")) {
        const served = await staticFrontend(req, res, url.pathname);
        if (served) return;
      }
      if (!runtimePolicy.allow_legacy_demo_api && isLegacyDemoPath(url.pathname)) {
        throw new HttpError(404, "not_found", "API route was not found.", { method: req.method, path: url.pathname });
      }
      if (runtimePolicy.mode === "demo" && isProviderProbePath(url.pathname)) {
        throw new HttpError(409, "provider_probe_disabled", "Real provider probes are disabled in demo mode.", {
          app_mode: runtimePolicy.mode,
          path: url.pathname,
        });
      }
      const found = routes.find((item) => item.method === req.method && item.pattern.test(url.pathname));
      if (!found) throw new HttpError(404, "not_found", "API route was not found.", { method: req.method, path: url.pathname });

      const clientKey = requestClientKey(req, trustProxy);
      if (rateLimiters?.general) enforceRateLimit(res, rateLimiters.general, clientKey);
      if (/^\/api\/auth\/(?:bootstrap|login|cli-login|cli-refresh|password\/(?:recover|update))$/.test(url.pathname) && rateLimiters?.auth) {
        enforceRateLimit(res, rateLimiters.auth, clientKey, "auth_rate_limit_exceeded");
      }
      let auth = null;
      if (found.access !== "public") {
        if (!authService) throw new HttpError(503, "auth_not_configured", "身份认证尚未完成配置。");
        auth = await authService.authenticateRequest(req, res);
        authService.requireRole(auth, found.access);
      }
      if (runtimePolicy.fail_closed && !runtimePolicy.ready && isSalesBusinessPath(url.pathname)) {
        throw new HttpError(503, "runtime_not_ready", "Production runtime is not ready.");
      }
      if (isSalesBusinessPath(url.pathname)) {
        await salesService?.assertRuntimeReady?.();
      }
      if (req.method !== "GET" && req.method !== "HEAD" && found.access !== "public") {
        authService?.assertCsrf(req, auth);
        if (rateLimiters?.write) enforceRateLimit(res, rateLimiters.write, auth?.principal?.id || clientKey);
      }
      if (isPaidOperation(req.method, url.pathname) && rateLimiters?.paid) {
        enforceRateLimit(res, rateLimiters.paid, auth?.principal?.id || clientKey, "paid_operation_rate_limit_exceeded");
      }

      const match = url.pathname.match(found.pattern);
      const params = paramsFrom(match, found.names);
      const body = req.method === "POST" ? await readJson(req, { maxBytes: maxBodyBytes }) : {};
      const result = await found.handler({ params, body, query: url.searchParams, request_id: requestId, req, res, auth });
      if (found.audit && auth?.principal && authService?.recordAudit) {
        const descriptor = typeof found.audit === "function"
          ? found.audit({ params, body, result, auth })
          : found.audit;
        if (descriptor?.action) {
          await authService.recordAudit(auth, {
            ...descriptor,
            request_id: requestId,
            after: {
              status: result.status || 200,
              ...(descriptor.after || {}),
            },
          });
        }
      }
      const meta = {
        request_id: requestId,
        app_mode: runtimePolicy.mode,
        ...(result.meta || {}),
      };
      if (result.status === 201) created(res, result.data, meta);
      else if (result.status === 202) accepted(res, result.data, meta);
      else ok(res, result.data, meta);
    } catch (error) {
      fail(res, error, requestId);
    }
  };
}
