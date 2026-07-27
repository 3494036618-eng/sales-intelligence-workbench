import { randomUUID } from "node:crypto";
import { ProviderRunStore } from "../src/observability/providerRunStore.js";
import { createSupabaseProvider } from "../src/providers/supabaseProvider.js";
import { SupabaseRepository } from "../src/repositories/supabaseRepository.js";

const emptySeed = Object.freeze({ goals: [], companies: {}, dossiers: {}, materials: {}, qa_messages: {} });
const provider = createSupabaseProvider();
const suffix = `${Date.now()}_${randomUUID().slice(0, 8)}`;
const workspaceA = randomUUID();
const workspaceB = randomUUID();
const workspaceIds = [workspaceA, workspaceB];

function sqlString(value) {
  if (value === null || value === undefined || value === "") return "null";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function assertOk(condition, message) {
  if (!condition) throw new Error(`Stage 2 smoke assertion failed: ${message}`);
}

function executeSql(sql) {
  const result = provider.executeSqlSync(sql);
  if (!result.ok) throw new Error(result.error?.message || "Supabase SQL failed.");
  return result.rows || [];
}

function repositoryFor(workspaceId) {
  return new SupabaseRepository({
    supabaseProvider: provider,
    workspaceId,
    seedOnEmpty: false,
  });
}

if (!provider.isConfigured()) {
  throw new Error("Supabase is not configured. Check AK/SK, SUPABASE_WORKSPACE_ID and SUPABASE_CLI_BIN.");
}
if (!provider.isRunEnabled()) {
  throw new Error("SUPABASE_RUN_ENABLED is not true. Refusing to run the write/read smoke test.");
}
if (provider.readOnly) {
  throw new Error("SUPABASE_READ_ONLY must be false for the Stage 2 smoke test.");
}

let report = null;
let primaryError = null;
try {
  executeSql(`
    insert into public.app_workspaces (id, slug, name, plan_mode)
    values
      (${sqlString(workspaceA)}::uuid, ${sqlString(`stage2-a-${suffix}`)}, 'Stage 2 smoke tenant A', 'standard'),
      (${sqlString(workspaceB)}::uuid, ${sqlString(`stage2-b-${suffix}`)}, 'Stage 2 smoke tenant B', 'standard');
  `);

  const repoA = repositoryFor(workspaceA);
  const repoB = repositoryFor(workspaceB);
  repoA.ensureSalesReady(emptySeed);
  repoB.ensureSalesReady(emptySeed);

  const now = new Date().toISOString();
  const goalA = { id: `s2_${suffix}_goal_a`, name: "Stage 2 目标 A", keywords: ["隔离测试"], created_at: now, updated_at: now };
  const goalB = { id: `s2_${suffix}_goal_b`, name: "Stage 2 目标 B", keywords: ["隔离测试"], created_at: now, updated_at: now };
  const companyA = {
    id: `s2_${suffix}_company_a`,
    name: "星澜智造 Stage2 测试企业",
    initial: "星",
    industry: "测试行业 A",
    tags: ["仅用于自动化测试"],
    qa_session_id: `sales-s2-${suffix}-a`,
    created_at: now,
    updated_at: now,
  };
  const companyB = {
    ...companyA,
    id: `s2_${suffix}_company_b`,
    industry: "测试行业 B",
    qa_session_id: `sales-s2-${suffix}-b`,
  };

  repoA.persistSalesGoal(goalA);
  repoB.persistSalesGoal(goalB);
  repoA.persistSalesTargetEnterprise(goalA.id, companyA);
  repoA.persistSalesTargetEnterprise(goalA.id, companyA);
  repoB.persistSalesTargetEnterprise(goalB.id, companyB);

  companyA.location = "更新后的测试区域";
  companyA.updated_at = new Date().toISOString();
  repoA.persistSalesCompany(companyA);

  const archivedCompany = {
    ...companyA,
    id: `s2_${suffix}_archived`,
    name: "归档测试企业 Stage2",
    qa_session_id: `sales-s2-${suffix}-archived`,
  };
  repoA.persistSalesCompany(archivedCompany);
  executeSql(`
    update public.sales_companies
    set deleted_at = now()
    where workspace_id = ${sqlString(workspaceA)}::uuid and id = ${sqlString(archivedCompany.id)};
  `);

  const storeA = new ProviderRunStore({ repository: repoA, failOnPersistenceError: true });
  const run = await storeA.startRun({
    operation: "stage2_supabase_smoke",
    app_mode: "development",
    entity_type: "target_enterprise",
    entity_id: companyA.id,
  });
  const step = await storeA.startStep(run.id, {
    provider: "supabase",
    operation: "write_read_isolation",
    input_summary: "使用两个临时租户验证写入、读取、去重和隔离。",
  });
  await storeA.finishStep(run.id, step.id, {
    ok: true,
    output_summary: "临时租户数据已写入。",
    request_id: `stage2-${suffix}`,
    usage: { total_tokens: 0 },
  });
  await storeA.completeRun(run.id, { result_ref: `stage2-smoke:${suffix}` });

  const dossier = {
    id: `s2_${suffix}_dossier`,
    company_id: companyA.id,
    provider_run_id: run.id,
    title: "Stage 2 测试档案",
    summary: "仅用于验证持久化和关联关系。",
    memory_summary: "仅用于自动化测试，执行后删除。",
    body: [{ text: "隔离测试正文。", citation_ids: ["1"] }],
    citations: [{ id: "1", label: "Stage 2 自动化测试来源", source_kind: "测试", url: "" }],
    created_at: now,
  };
  repoA.persistSalesDossier(dossier);
  repoA.persistSalesMaterial({
    id: `s2_${suffix}_material`,
    company_id: companyA.id,
    title: "Stage 2 测试资料",
    source_type: "automated_test",
    content_hash: `stage2-${suffix}`,
    summary: "执行后自动清理。",
    created_at: now,
    updated_at: now,
  });
  repoA.persistSalesOpenVikingRef({
    id: `s2_${suffix}_openviking`,
    company_id: companyA.id,
    related_type: "dossier",
    related_id: dossier.id,
    ref_kind: "smoke_test",
    uri: `viking://stage2-smoke/${suffix}`,
    summary: "OpenViking 引用字段持久化测试。",
    created_at: now,
  });
  repoA.persistSalesQaMessage(companyA, {
    id: `s2_${suffix}_qa`,
    role: "assistant",
    text: "Stage 2 问答持久化测试。",
    provider_run_id: run.id,
    created_at: now,
  });

  const stateA = repoA.getSalesState(emptySeed);
  const stateB = repoB.getSalesState(emptySeed);
  const persistedStore = new ProviderRunStore({ repository: repoA, failOnPersistenceError: true });
  const persistedRun = await persistedStore.get(run.id);
  const persistedRunList = await persistedStore.list({ operation: "stage2_supabase_smoke", limit: 5 });
  const counts = executeSql(`
    select
      (select count(*)::int from public.sales_target_enterprises where workspace_id = ${sqlString(workspaceA)}::uuid and goal_id = ${sqlString(goalA.id)} and company_id = ${sqlString(companyA.id)}) as tenant_a_target_count,
      (select count(*)::int from public.sales_companies where workspace_id = ${sqlString(workspaceA)}::uuid and normalized_name = lower(btrim(${sqlString(companyA.name)}))) as tenant_a_same_name_count,
      (select count(*)::int from public.sales_companies where workspace_id = ${sqlString(workspaceB)}::uuid and normalized_name = lower(btrim(${sqlString(companyB.name)}))) as tenant_b_same_name_count,
      (select count(*)::int from public.sales_companies where workspace_id = ${sqlString(workspaceA)}::uuid and id = ${sqlString(archivedCompany.id)} and deleted_at is not null) as soft_deleted_count,
      (select count(*)::int from public.sales_dossier_records where workspace_id = ${sqlString(workspaceA)}::uuid and id = ${sqlString(dossier.id)} and provider_run_id = ${sqlString(run.id)}) as linked_dossier_count;
  `)[0];

  assertOk(Object.keys(stateA.companies).includes(companyA.id), "tenant A cannot read its company");
  assertOk(!Object.keys(stateA.companies).includes(companyB.id), "tenant A can read tenant B data");
  assertOk(!Object.keys(stateA.companies).includes(archivedCompany.id), "soft-deleted company is visible");
  assertOk(Object.keys(stateB.companies).includes(companyB.id), "tenant B cannot read its company");
  assertOk(!Object.keys(stateB.companies).includes(companyA.id), "tenant B can read tenant A data");
  assertOk(stateA.companies[companyA.id]?.location === "更新后的测试区域", "company update was not persisted");
  assertOk(Number(counts.tenant_a_target_count) === 1, "duplicate target was created");
  assertOk(Number(counts.tenant_a_same_name_count) === 1, "tenant A company name count is incorrect");
  assertOk(Number(counts.tenant_b_same_name_count) === 1, "same company name must be allowed in a different tenant");
  assertOk(Number(counts.soft_deleted_count) === 1, "soft delete was not persisted");
  assertOk(Number(counts.linked_dossier_count) === 1, "dossier is not linked to its provider run");
  assertOk(persistedRun?.status === "succeeded", "provider run was not reloaded from Supabase");
  assertOk(persistedRun?.steps?.length === 1, "provider run steps were not reloaded");
  assertOk(persistedRunList.some((item) => item.id === run.id), "provider run list does not include the persisted run");

  const missingWorkspaceRepo = repositoryFor(randomUUID());
  let failedClosed = false;
  try {
    missingWorkspaceRepo.ensureSalesReady(emptySeed);
  } catch (error) {
    failedClosed = /Application workspace is not initialized/.test(error.message);
  }
  assertOk(failedClosed, "repository did not fail closed for an unknown application workspace");

  report = {
    ok: true,
    test_run: suffix,
    verified: {
    migrations_required: "202607210006",
      create_read_update_soft_delete: true,
      duplicate_target_prevented: true,
      cross_tenant_same_name_supported: true,
      tenant_isolation: true,
      provider_run_persisted_and_reloaded: true,
      dossier_provider_run_linked: true,
      unknown_workspace_failed_closed: true,
    },
  };
} catch (error) {
  primaryError = error;
  throw error;
} finally {
  const cleanup = provider.executeSqlSync(`
    delete from public.app_workspaces
    where id in (${workspaceIds.map((id) => `${sqlString(id)}::uuid`).join(", ")});
  `);
  if (!cleanup.ok) {
    const cleanupError = new Error(`Stage 2 smoke cleanup failed: ${cleanup.error?.message || "unknown error"}`);
    if (!primaryError) throw cleanupError;
    console.error(cleanupError.message);
  } else {
    const remaining = executeSql(`
      select count(*)::int as count
      from public.app_workspaces
      where id in (${workspaceIds.map((id) => `${sqlString(id)}::uuid`).join(", ")});
    `);
    assertOk(Number(remaining[0]?.count || 0) === 0, "temporary workspaces were not cleaned up");
    if (report) report.cleanup_verified = true;
  }
}

console.log(JSON.stringify(report, null, 2));
