import http from "node:http";
import { fileURLToPath } from "node:url";
import { getProviderStatus } from "./config/providerConfig.js";
import { createEnvReader } from "./config/runtimeEnv.js";
import { createRuntimePolicy } from "./config/runtimeMode.js";
import { createRepository } from "./repositories/repositoryFactory.js";
import { createMockProviders } from "./providers/mockProviders.js";
import { createWebSearchProvider } from "./providers/webSearchProvider.js";
import { createModelProvider } from "./providers/modelProvider.js";
import { createDataProProvider } from "./providers/dataProProvider.js";
import { createOpenVikingProvider } from "./providers/openVikingProvider.js";
import { createSupabaseDataProvider } from "./providers/supabaseDataProvider.js";
import { createSupabaseProvider } from "./providers/supabaseProvider.js";
import { createVisionProvider } from "./providers/visionProvider.js";
import { SupabaseDataRepository } from "./repositories/supabaseDataRepository.js";
import { SupabaseRepository } from "./repositories/supabaseRepository.js";
import { DemoService } from "./services/demoService.js";
import { AdminStatusService } from "./services/adminStatusService.js";
import { FeishuImportTaskService } from "./services/feishuImportTaskService.js";
import { SalesService } from "./services/salesService.js";
import { createRouter } from "./routes/index.js";
import { createStaticFrontend } from "./frontend/staticFrontend.js";
import { createAuthService } from "./security/authService.js";
import { createRateLimiters } from "./security/rateLimiter.js";

const defaultFrontendDir = fileURLToPath(new URL("../../frontend/", import.meta.url));

export function createRuntimeContext(options = {}) {
  const env = options.env || createEnvReader();
  const runtimePolicy = options.runtimePolicy || createRuntimePolicy({ env });
  const providers = createMockProviders();
  const webSearchProvider = createWebSearchProvider({ env });
  const modelProvider = createModelProvider({ env });
  const dataProProvider = createDataProProvider({ env });
  const openVikingProvider = createOpenVikingProvider({ env });
  const supabaseProvider = createSupabaseProvider({ env });
  const supabaseDataProvider = createSupabaseDataProvider({ env });
  const visionProvider = createVisionProvider({ env });
  const repository = createRepository({ env, runtimePolicy, supabaseProvider });
  const providerStatus = () => getProviderStatus({ env, runtimePolicy });
  const service = new DemoService(repository, providers, {
    getProviderStatus: providerStatus,
    webSearchProvider,
    modelProvider,
    dataProProvider,
    openVikingProvider,
    supabaseProvider,
    supabaseDataProvider,
    visionProvider,
  });
  const salesRepository = !runtimePolicy.is_demo && supabaseDataProvider.isConfigured()
    ? new SupabaseDataRepository({
      env,
      supabaseDataProvider,
      workspaceId: env.value("APP_WORKSPACE_ID"),
    })
    : typeof repository.getSalesState === "function"
      ? repository
      : !runtimePolicy.is_demo && supabaseProvider.isConfigured() && supabaseProvider.isRunEnabled()
      ? new SupabaseRepository({
        supabaseProvider,
        workspaceId: env.value("APP_WORKSPACE_ID"),
        seedOnEmpty: runtimePolicy.allow_fixture_data,
      })
      : null;
  const salesService = new SalesService({ env, runtimePolicy, dataProProvider, webSearchProvider, modelProvider, openVikingProvider, repository: salesRepository });
  const feishuImportTaskService = new FeishuImportTaskService({
    env,
    runtimePolicy,
    salesService,
  });
  const adminStatusService = new AdminStatusService({ env, runtimePolicy, getProviderStatus: providerStatus });
  const authService = options.authService || createAuthService({ env, dataProvider: supabaseDataProvider });
  const rateLimiters = options.rateLimiters || createRateLimiters(env);
  return {
    env,
    runtimePolicy,
    providers,
    providerStatus,
    repository,
    salesRepository,
    service,
    salesService,
    feishuImportTaskService,
    adminStatusService,
    authService,
    rateLimiters,
  };
}

export function createApp(options = {}) {
  const context = options.context || createRuntimeContext(options);
  const {
    env,
    runtimePolicy,
    service,
    salesService,
    feishuImportTaskService,
    adminStatusService,
    authService,
    rateLimiters,
  } = context;
  const staticFrontend = createStaticFrontend({
    rootDir: env.value("FRONTEND_DIR", defaultFrontendDir),
  });
  const router = createRouter(service, {
    salesService,
    feishuImportTaskService,
    adminStatusService,
    runtimePolicy,
    staticFrontend,
    authService,
    rateLimiters,
    env,
  });
  const server = http.createServer(router);
  server.runtimeContext = context;
  return server;
}
