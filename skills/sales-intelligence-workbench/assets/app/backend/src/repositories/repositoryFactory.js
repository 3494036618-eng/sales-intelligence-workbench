import { createEnvReader } from "../config/runtimeEnv.js";
import { createRuntimePolicy } from "../config/runtimeMode.js";
import { MemoryRepository } from "./memoryRepository.js";
import { SupabaseRepository } from "./supabaseRepository.js";

export function createRepository(options = {}) {
  const env = options.env || createEnvReader();
  const runtimePolicy = options.runtimePolicy || createRuntimePolicy({ env });
  if (runtimePolicy.mode === "demo") {
    return new MemoryRepository(options.seed);
  }
  const mode = String(env.value("REPOSITORY_MODE", "memory")).toLowerCase();
  if (mode === "supabase") {
    return new SupabaseRepository({
      supabaseProvider: options.supabaseProvider,
      workspaceId: env.value("APP_WORKSPACE_ID"),
      seed: options.seed,
      seedOnEmpty: runtimePolicy.allow_fixture_data,
    });
  }
  return new MemoryRepository(options.seed);
}
