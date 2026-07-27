import { execFile, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createEnvReader } from "../config/runtimeEnv.js";
import { providerFailure, providerSuccess } from "./providerResult.js";

const execFileAsync = promisify(execFile);

const SNAPSHOT_TABLE = "public.ccc_demo_run_snapshots";

function truthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").toLowerCase());
}

function truncate(text, maxLength = 12000) {
  const value = String(text || "");
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function parseJsonOutput(stdout) {
  const output = String(stdout || "").trim();
  if (!output) return null;
  try {
    return JSON.parse(output);
  } catch {
    return null;
  }
}

function resultRows(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed?.rows)) return parsed.rows;
  return parsed;
}

function isReadOnlySql(query) {
  const normalized = String(query || "")
    .replace(/^\s*(?:--[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*/g, "")
    .trim()
    .toLowerCase();
  return /^(select|with|show|explain)\b/.test(normalized);
}

function sqlString(value) {
  if (value === null || value === undefined) return "null";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlJson(value) {
  return `${sqlString(JSON.stringify(value))}::jsonb`;
}

export class SupabaseProvider {
  constructor(options = {}) {
    this.env = options.env || createEnvReader();
    this.execFile = options.execFile || execFileAsync;
    this.command = this.env.value("SUPABASE_CLI_BIN", "byted-supabase-cli");
    this.timeoutMs = this.env.number("SUPABASE_TIMEOUT_MS", 30000);
    this.workspaceId = this.env.value("SUPABASE_WORKSPACE_ID") || this.env.value("DEFAULT_WORKSPACE_ID");
    this.branchId = this.env.value("SUPABASE_BRANCH_ID");
    this.readOnly = truthy(this.env.value("SUPABASE_READ_ONLY", "true"));
    this.tableEnsured = false;
  }

  isConfigured() {
    return Boolean(
      this.workspaceId
      && this.env.value("VOLCENGINE_ACCESS_KEY")
      && this.env.value("VOLCENGINE_SECRET_KEY")
      && this.command
    );
  }

  isRunEnabled() {
    return truthy(this.env.value("SUPABASE_RUN_ENABLED", "false"));
  }

  async executeSql(query) {
    if (!this.isConfigured()) {
      return providerFailure("supabase", { code: "missing_config", message: "Supabase control-plane SQL is not configured." });
    }
    if (this.readOnly && !isReadOnlySql(query)) {
      return providerFailure("supabase", { code: "read_only", message: "Supabase writes are disabled by SUPABASE_READ_ONLY." });
    }

    const tempDir = await mkdtemp(join(tmpdir(), "ccc-supabase-"));
    const queryFile = join(tempDir, "query.sql");
    await writeFile(queryFile, query, "utf8");
    const startedAt = Date.now();
    try {
      const args = [
        "db",
        "query",
        "--file",
        queryFile,
        "--workspace-id",
        this.workspaceId,
      ];
      if (this.branchId) args.push("--branch-id", this.branchId);
      const { stdout, stderr } = await this.execFile(this.command, args, {
        timeout: this.timeoutMs,
        maxBuffer: 1024 * 1024,
        env: {
          ...process.env,
          VOLCENGINE_ACCESS_KEY: this.env.value("VOLCENGINE_ACCESS_KEY"),
          VOLCENGINE_SECRET_KEY: this.env.value("VOLCENGINE_SECRET_KEY"),
          VOLCENGINE_REGION: this.env.value("VOLCENGINE_REGION", "cn-beijing"),
        },
      });
      const parsed = parseJsonOutput(stdout);
      const providerError = parsed && !Array.isArray(parsed) && parsed.error;
      if (providerError) {
        return providerFailure("supabase", { code: "provider_error", message: truncate(providerError, 2000) }, {
          stdout: truncate(stdout, 2000),
          stderr: truncate(stderr, 2000),
          latency_ms: Date.now() - startedAt,
        });
      }
      return providerSuccess("supabase", {
        rows: resultRows(parsed),
        stdout: truncate(stdout, 2000),
        stderr: truncate(stderr, 2000),
        latency_ms: Date.now() - startedAt,
      });
    } catch (error) {
      return providerFailure("supabase", {
          code: error.code === "ENOENT" ? "missing_cli" : "cli_error",
          message: truncate(error.message, 2000),
      }, {
        stdout: truncate(error.stdout, 2000),
        stderr: truncate(error.stderr, 2000),
        latency_ms: Date.now() - startedAt,
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }

  executeSqlSync(query) {
    if (!this.isConfigured()) {
      return providerFailure("supabase", { code: "missing_config", message: "Supabase control-plane SQL is not configured." });
    }
    if (this.readOnly && !isReadOnlySql(query)) {
      return providerFailure("supabase", { code: "read_only", message: "Supabase writes are disabled by SUPABASE_READ_ONLY." });
    }

    const tempDir = mkdtempSync(join(tmpdir(), "ccc-supabase-"));
    const queryFile = join(tempDir, "query.sql");
    writeFileSync(queryFile, query, "utf8");
    const startedAt = Date.now();
    try {
      const args = [
        "db",
        "query",
        "--file",
        queryFile,
        "--workspace-id",
        this.workspaceId,
      ];
      if (this.branchId) args.push("--branch-id", this.branchId);
      const stdout = execFileSync(this.command, args, {
        timeout: this.timeoutMs,
        maxBuffer: 1024 * 1024,
        encoding: "utf8",
        env: {
          ...process.env,
          VOLCENGINE_ACCESS_KEY: this.env.value("VOLCENGINE_ACCESS_KEY"),
          VOLCENGINE_SECRET_KEY: this.env.value("VOLCENGINE_SECRET_KEY"),
          VOLCENGINE_REGION: this.env.value("VOLCENGINE_REGION", "cn-beijing"),
        },
      });
      const parsed = parseJsonOutput(stdout);
      const providerError = parsed && !Array.isArray(parsed) && parsed.error;
      if (providerError) {
        return providerFailure("supabase", { code: "provider_error", message: truncate(providerError, 2000) }, {
          stdout: truncate(stdout, 2000),
          latency_ms: Date.now() - startedAt,
        });
      }
      return providerSuccess("supabase", {
        rows: resultRows(parsed),
        stdout: truncate(stdout, 2000),
        latency_ms: Date.now() - startedAt,
      });
    } catch (error) {
      return providerFailure("supabase", {
          code: error.code === "ENOENT" ? "missing_cli" : "cli_error",
          message: truncate(error.message, 2000),
      }, {
        stdout: truncate(error.stdout, 2000),
        stderr: truncate(error.stderr, 2000),
        latency_ms: Date.now() - startedAt,
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }

  async probe() {
    const result = await this.executeSql("select 1 as supabase_probe;");
    if (!result.ok) return result;
    return providerSuccess("supabase", {
      rows: result.rows,
      raw_ref: "supabase:execute-sql:probe",
      latency_ms: result.latency_ms,
    });
  }

  async ensureSnapshotTable() {
    if (this.tableEnsured) return providerSuccess("supabase", { skipped: true });
    const result = await this.executeSql(`
      create table if not exists ${SNAPSHOT_TABLE} (
        id text primary key,
        scope_id text not null,
        object_id text not null,
        status text not null,
        provider text,
        provider_mode text,
        card_count integer not null default 0,
        trace_count integer not null default 0,
        run_json jsonb not null,
        created_at timestamptz not null default now(),
        synced_at timestamptz not null default now()
      );
    `);
    if (result.ok) this.tableEnsured = true;
    return result;
  }

  async syncRunSnapshot(run) {
    if (!this.isRunEnabled()) {
      return providerFailure("supabase", { code: "disabled", message: "SUPABASE_RUN_ENABLED is false." }, { skipped: true });
    }

    const ensure = await this.ensureSnapshotTable();
    if (!ensure.ok) return ensure;

    const traceCount = Array.isArray(run.traces) ? run.traces.length : 0;
    const cardCount = Array.isArray(run.cards) ? run.cards.length : 0;
    const query = `
      insert into ${SNAPSHOT_TABLE} (
        id, scope_id, object_id, status, provider, provider_mode, card_count, trace_count, run_json, synced_at
      )
      values (
        ${sqlString(run.id)},
        ${sqlString(run.scope_id)},
        ${sqlString(run.object_id)},
        ${sqlString(run.status)},
        ${sqlString(run.provider)},
        ${sqlString(run.provider_mode)},
        ${cardCount},
        ${traceCount},
        ${sqlJson(run)},
        now()
      )
      on conflict (id) do update set
        scope_id = excluded.scope_id,
        object_id = excluded.object_id,
        status = excluded.status,
        provider = excluded.provider,
        provider_mode = excluded.provider_mode,
        card_count = excluded.card_count,
        trace_count = excluded.trace_count,
        run_json = excluded.run_json,
        synced_at = now()
      returning id, scope_id, object_id, provider_mode, card_count, trace_count, synced_at;
    `;
    const result = await this.executeSql(query);
    if (!result.ok) return result;
    return providerSuccess("supabase", {
      rows: result.rows,
      raw_ref: `supabase:${SNAPSHOT_TABLE}:${run.id}`,
      latency_ms: result.latency_ms,
    });
  }
}

export function createSupabaseProvider(options = {}) {
  return new SupabaseProvider(options);
}
