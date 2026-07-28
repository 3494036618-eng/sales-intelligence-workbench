import { seedData } from "../fixtures/demoData.js";
import { createSupabaseProvider } from "../providers/supabaseProvider.js";
import { makeId } from "../utils/ids.js";
import { nowIso } from "../utils/time.js";
import { MemoryRepository } from "./memoryRepository.js";
import { supabaseSchemaSql } from "./supabaseSchema.js";

const clone = (value) => JSON.parse(JSON.stringify(value));
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function sqlString(value) {
  if (value === null || value === undefined || value === "") return "null";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlBoolean(value) {
  return value ? "true" : "false";
}

function sqlNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? String(number) : "null";
}

function sqlJson(value) {
  return `${sqlString(JSON.stringify(value ?? {}))}::jsonb`;
}

function sqlTextArray(values) {
  const items = Array.isArray(values) ? values.map((value) => sqlString(value)) : [];
  return `array[${items.join(", ")}]::text[]`;
}

function payload(row) {
  const value = row?.payload_json;
  if (!value) return {};
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }
  return value;
}

function byCreatedDesc(a, b) {
  return String(b.created_at || "").localeCompare(String(a.created_at || ""));
}

function groupBy(rows, key) {
  const groups = new Map();
  for (const row of rows || []) {
    const value = row[key] || "";
    if (!groups.has(value)) groups.set(value, []);
    groups.get(value).push(row);
  }
  return groups;
}

function salesMaterialMetadata(material = {}) {
  return {
    id: material.id,
    company_id: material.company_id,
    title: material.title || "",
    source_type: material.source_type || "",
    source_url: material.source_url || "",
    source_id: material.source_id || null,
    source_external_id: material.source_external_id || "",
    source_version: material.source_version || "",
    content_hash: material.content_hash || null,
    occurred_at: material.occurred_at || null,
    last_synced_at: material.last_synced_at || null,
    openviking_uri: material.openviking_uri || material.openviking_ref || "",
    openviking_status: material.openviking_status || (material.openviking_uri ? "indexed" : "pending"),
    created_at: material.created_at || null,
    updated_at: material.updated_at || null,
  };
}

export class SupabaseRepository {
  constructor(options = {}) {
    this.provider = options.supabaseProvider || createSupabaseProvider();
    this.workspaceId = String(options.workspaceId || this.provider.env?.value?.("APP_WORKSPACE_ID") || "").trim();
    if (this.workspaceId && !UUID_PATTERN.test(this.workspaceId)) {
      throw new Error("APP_WORKSPACE_ID must be a valid UUID.");
    }
    this.seed = options.seed || seedData;
    this.seedOnEmpty = options.seedOnEmpty !== false;
    this.memory = new MemoryRepository(this.seed);
    this.initialized = false;
    this.salesInitialized = false;
  }

  ensureReady() {
    if (this.initialized) return;
    this.query(supabaseSchemaSql);
    if (this.seedOnEmpty) this.seedIfEmpty();
    this.refreshFromSupabase();
    this.initialized = true;
  }

  query(sql) {
    const result = this.provider.executeSqlSync(sql);
    if (!result.ok) {
      const message = result.error?.message || "Supabase SQL failed.";
      const code = result.error?.code || "supabase_error";
      throw new Error(`${code}: ${message}`);
    }
    return Array.isArray(result.rows) ? result.rows : [];
  }

  seedIfEmpty() {
    const rows = this.query("select count(*)::int as count from public.ccc_scopes;");
    if (Number(rows[0]?.count || 0) > 0) {
      this.seedStateIfMissing();
      return;
    }

    for (const source of Object.values(this.seed.sources || {})) {
      this.persistSource(null, null, source);
    }
    for (const object of Object.values(this.seed.objects || {})) {
      this.persistObject(object);
    }
    for (const scope of this.seed.scopes || []) {
      this.persistScope(scope);
      for (const objectId of scope.object_ids || []) this.persistScopeObject(scope.id, objectId);
    }
    for (const [scopeId, state] of Object.entries(this.seed.scopeState || {})) {
      for (const card of state.confirmed_cards || []) this.persistCard({ ...card, status: card.status || "confirmed" });
      for (const action of state.actions || []) this.persistAction(action);
      for (const asset of state.assets || []) this.persistAsset(asset);
      for (const message of state.qa_messages || []) this.persistQaMessage(message);
      for (const excerpt of state.excerpts || []) this.persistExcerpt(excerpt);
      this.persistCandidates(scopeId, state.candidates || []);
    }
  }

  rowExists(table, id) {
    const rows = this.query(`select 1 as exists from public.${table} where id = ${sqlString(id)} limit 1;`);
    return rows.length > 0;
  }

  seedStateIfMissing() {
    for (const [scopeId, state] of Object.entries(this.seed.scopeState || {})) {
      for (const card of state.confirmed_cards || []) {
        if (!this.rowExists("ccc_change_cards", card.id)) this.persistCard({ ...card, status: card.status || "confirmed" });
      }
      for (const action of state.actions || []) {
        if (!this.rowExists("ccc_user_actions", action.id)) this.persistAction(action);
      }
      for (const asset of state.assets || []) {
        if (!this.rowExists("ccc_assets", asset.id)) this.persistAsset(asset);
      }
      for (const message of state.qa_messages || []) {
        if (!this.rowExists("ccc_qa_messages", message.id)) this.persistQaMessage(message);
      }
      for (const excerpt of state.excerpts || []) {
        if (!this.rowExists("ccc_qa_excerpts", excerpt.id)) this.persistExcerpt(excerpt);
      }
      if ((state.candidates || []).length) this.persistCandidates(scopeId, state.candidates);
    }
  }

  ensureSalesReady(seed) {
    if (this.salesInitialized) return;
    if (!this.workspaceId) throw new Error("APP_WORKSPACE_ID is required for Supabase sales persistence.");
    const migrations = this.query("select version from public.schema_migrations where version = '202607280002' limit 1;");
    if (!migrations.length) throw new Error("Supabase security boundary migration is not applied.");
    const workspaces = this.query(`select id from public.app_workspaces where id = ${sqlString(this.workspaceId)}::uuid limit 1;`);
    if (!workspaces.length) throw new Error(`Application workspace is not initialized: ${this.workspaceId}`);
    this.salesInitialized = true;
    if (!this.seedOnEmpty) return;
    try {
      this.seedSalesIfEmpty(seed);
    } catch (error) {
      this.salesInitialized = false;
      throw error;
    }
  }

  seedSalesIfEmpty(seed) {
    const rows = this.query(`select count(*)::int as count from public.sales_goals where workspace_id = ${sqlString(this.workspaceId)}::uuid;`);
    if (Number(rows[0]?.count || 0) > 0) return;

    for (const company of Object.values(seed?.companies || {})) this.persistSalesCompany(company);
    for (const goal of seed?.goals || []) {
      this.persistSalesGoal(goal);
      for (const companyId of goal.company_ids || []) {
        const company = seed.companies?.[companyId];
        if (company) this.persistSalesTargetEnterprise(goal.id, company);
      }
    }
    for (const dossier of Object.values(seed?.dossiers || {})) this.persistSalesDossier(dossier);
    for (const material of Object.values(seed?.materials || {})) {
      this.persistSalesMaterial(material);
      this.persistSalesOpenVikingRef({
        company_id: material.company_id,
        related_type: "material",
        related_id: material.id,
        ref_kind: "resource",
        uri: material.openviking_uri || "",
        summary: material.title,
        payload_json: salesMaterialMetadata(material),
      });
    }
  }

  getSalesState(seed) {
    this.ensureSalesReady(seed);

    const workspace = `${sqlString(this.workspaceId)}::uuid`;
    const goalRows = this.query(`select * from public.sales_goals where workspace_id = ${workspace} and deleted_at is null order by created_at asc;`);
    const companyRows = this.query(`select * from public.sales_companies where workspace_id = ${workspace} and deleted_at is null order by created_at asc;`);
    const targetRows = this.query(`select * from public.sales_target_enterprises where workspace_id = ${workspace} and deleted_at is null order by created_at asc;`);
    const progressRows = this.query(`select * from public.sales_progress_snapshots where workspace_id = ${workspace} order by created_at desc;`);
    const dossierRows = this.query(`select * from public.sales_dossier_records where workspace_id = ${workspace} and deleted_at is null order by created_at desc;`);
    const citationRows = this.query(`select * from public.sales_dossier_citations where workspace_id = ${workspace} order by created_at asc;`);
    const materialRows = this.query(`select * from public.sales_materials where workspace_id = ${workspace} and deleted_at is null order by updated_at desc;`);
    const refRows = this.query(`select * from public.sales_openviking_refs where workspace_id = ${workspace} order by created_at asc;`);
    const syncSourceRows = this.query(`select * from public.sync_sources where workspace_id = ${workspace} order by updated_at desc;`);
    const syncCheckpointRows = this.query(`select * from public.sync_checkpoints where workspace_id = ${workspace} order by updated_at desc;`);
    const jobRows = this.query(`select * from public.jobs where workspace_id = ${workspace} order by created_at desc;`);

    const progressByCompany = new Map();
    for (const row of progressRows) {
      if (!progressByCompany.has(row.company_id)) {
        progressByCompany.set(row.company_id, {
          label: row.label,
          summary: row.summary,
          evidence: row.evidence,
          updated_at: row.created_at,
        });
      }
    }

    const companies = {};
    for (const row of companyRows) {
      const saved = payload(row);
      companies[row.id] = {
        ...saved,
        id: row.id,
        name: row.name,
        initial: row.initial,
        industry: row.industry,
        location: row.location,
        tags: Array.isArray(row.tags) ? row.tags : saved.tags || [],
        progress: progressByCompany.get(row.id) || saved.progress || null,
        dossier_ids: [],
        material_ids: [],
        qa_session_id: saved.qa_session_id || `sales-${row.id}`,
        created_at: row.created_at,
        updated_at: row.updated_at,
      };
    }

    const targetCompanyIdsByGoal = groupBy(targetRows, "goal_id");
    const seedGoalOrder = new Map((seed?.goals || []).map((goal, index) => [goal.id, index]));
    const goals = goalRows.map((row) => {
      const saved = payload(row);
      return {
        ...saved,
        id: row.id,
        name: row.name,
        description: row.description,
        keywords: Array.isArray(row.keywords) ? row.keywords : saved.keywords || [],
        company_ids: (targetCompanyIdsByGoal.get(row.id) || []).map((target) => target.company_id).filter((id) => companies[id]),
        candidate_ids: saved.candidate_ids || [],
        created_at: row.created_at,
        updated_at: row.updated_at,
      };
    }).sort((a, b) => {
      const aOrder = seedGoalOrder.has(a.id) ? seedGoalOrder.get(a.id) : Number.MAX_SAFE_INTEGER;
      const bOrder = seedGoalOrder.has(b.id) ? seedGoalOrder.get(b.id) : Number.MAX_SAFE_INTEGER;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return String(b.created_at || "").localeCompare(String(a.created_at || ""));
    });

    const citationsByDossier = groupBy(citationRows, "dossier_id");
    const dossiers = {};
    for (const row of dossierRows) {
      const saved = payload(row);
      const citations = (citationsByDossier.get(row.id) || []).map((citationRow) => ({
        ...payload(citationRow),
        id: citationRow.citation_no,
        label: citationRow.label,
        source_kind: citationRow.source_kind,
        url: citationRow.url || "",
      })).sort((a, b) => Number(a.id) - Number(b.id));
      dossiers[row.id] = {
        ...saved,
        id: row.id,
        company_id: row.company_id,
        title: row.title,
        summary: row.summary,
        memory_summary: row.memory_summary,
        provider_run_id: row.provider_run_id || saved.provider_run_id || null,
        version_no: Number(row.version_no || saved.version_no || 1),
        previous_dossier_id: row.previous_dossier_id || saved.previous_dossier_id || null,
        evidence_hash: row.evidence_hash || saved.evidence_hash || null,
        dossier_fingerprint: row.dossier_fingerprint || saved.dossier_fingerprint || null,
        change_status: row.change_status || saved.change_status || "initial",
        data_as_of: row.data_as_of || saved.data_as_of || row.created_at,
        generated_at: row.generated_at || saved.generated_at || row.created_at,
        evidence_pack: Array.isArray(row.evidence_pack_json)
          ? row.evidence_pack_json
          : saved.evidence_pack || [],
        created_at: row.created_at,
        body: saved.body || [],
        citations: citations.length ? citations : saved.citations || [],
      };
      if (companies[row.company_id]) companies[row.company_id].dossier_ids.push(row.id);
    }

    const materials = {};
    for (const row of materialRows) {
      const saved = payload(row);
      materials[row.id] = {
        id: row.id,
        company_id: row.company_id,
        title: row.title,
        source_type: row.source_type || saved.source_type || "",
        source_url: row.source_url || saved.source_url || "",
        source_id: row.source_id || saved.source_id || null,
        source_external_id: saved.source_external_id || "",
        source_version: row.source_version || saved.source_version || "",
        content_hash: row.content_hash || saved.content_hash || null,
        summary: "",
        text: "",
        source_items: [],
        occurred_at: row.occurred_at || saved.occurred_at || null,
        last_synced_at: row.last_synced_at || saved.last_synced_at || null,
        updated_at: row.updated_at,
        created_at: row.created_at,
        openviking_uri: row.openviking_uri || saved.openviking_uri || "",
        openviking_status: row.openviking_status || saved.openviking_status || (row.openviking_uri ? "indexed" : "pending"),
      };
      if (companies[row.company_id] && !companies[row.company_id].material_ids.includes(row.id)) companies[row.company_id].material_ids.push(row.id);
    }

    for (const row of refRows.filter((item) => item.related_type === "material")) {
      const saved = payload(row);
      const id = row.related_id || saved.id || row.id;
      const seedMaterial = seed?.materials?.[id] || {};
      const existing = materials[id] || {};
      const memoryImported = row.ref_kind === "memory_import";
      materials[id] = {
        ...existing,
        id,
        company_id: row.company_id,
        title: saved.title || existing.title || seedMaterial.title || row.summary,
        source_type: saved.source_type || existing.source_type || seedMaterial.source_type || "",
        source_url: saved.source_url || existing.source_url || seedMaterial.source_url || "",
        source_id: saved.source_id || existing.source_id || seedMaterial.source_id || null,
        source_external_id: saved.source_external_id || existing.source_external_id || "",
        source_version: saved.source_version || existing.source_version || "",
        content_hash: saved.content_hash || existing.content_hash || null,
        summary: "",
        text: "",
        source_items: [],
        updated_at: saved.updated_at || existing.updated_at || seedMaterial.updated_at || row.created_at,
        openviking_uri: memoryImported ? row.uri : existing.openviking_uri || row.uri,
        openviking_status: memoryImported ? "indexed" : existing.openviking_status || (row.uri ? "indexed" : "pending"),
      };
      if (companies[row.company_id] && !companies[row.company_id].material_ids.includes(id)) companies[row.company_id].material_ids.push(id);
    }

    const qa_messages = {};

    const sync_sources = Object.fromEntries(syncSourceRows.map((row) => [row.id, {
      ...payload(row),
      id: row.id,
      source_type: row.source_type,
      external_id: row.external_id,
      display_name: row.display_name || "",
      status: row.status,
      config: payload(row).config || row.config_json || {},
      last_synced_at: row.last_synced_at || null,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }]));
    const sync_checkpoints = Object.fromEntries(syncCheckpointRows.map((row) => [row.id, {
      ...payload(row),
      id: row.id,
      source_id: row.source_id,
      checkpoint_key: row.checkpoint_key,
      checkpoint_value: row.checkpoint_value || "",
      content_hash: row.content_hash || null,
      last_success_at: row.last_success_at || null,
      error: row.error_json || null,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }]));

    const jobs = Object.fromEntries(jobRows.map((row) => [row.id, this.jobView(row)]));

    return { goals, companies, dossiers, materials, qa_messages, sync_sources, sync_checkpoints, jobs };
  }

  refreshFromSupabase() {
    const scopeRows = this.query("select * from public.ccc_scopes order by created_at desc;");
    const objectRows = this.query("select * from public.ccc_objects order by created_at asc;");
    const scopeObjectRows = this.query("select * from public.ccc_scope_objects order by created_at asc;");
    const sourceRows = this.query("select * from public.ccc_sources order by created_at asc;");
    const baselineRows = this.query("select * from public.ccc_baselines order by created_at desc;");
    const candidateRows = this.query("select * from public.ccc_candidates order by created_at desc;");
    const runRows = this.query("select * from public.ccc_runs order by created_at desc;");
    const stepRows = this.query("select * from public.ccc_run_steps order by started_at asc;");
    const traceRows = this.query("select * from public.ccc_trace_records order by created_at asc;");
    const cardRows = this.query("select * from public.ccc_change_cards order by created_at desc;");
    const cardSourceRows = this.query("select * from public.ccc_change_card_sources;");
    const actionRows = this.query("select * from public.ccc_user_actions order by created_at desc;");
    const memoryRows = this.query("select * from public.ccc_memory_records order by created_at desc;");
    const syncRows = this.query("select * from public.ccc_sync_records order by created_at desc;");
    const assetRows = this.query("select * from public.ccc_assets order by created_at desc;");
    const qaRows = this.query("select * from public.ccc_qa_messages order by created_at asc;");
    const excerptRows = this.query("select * from public.ccc_qa_excerpts order by created_at desc;");

    const sources = {};
    for (const row of sourceRows) {
      sources[row.id] = {
        ...payload(row),
        id: row.id,
        type: row.type,
        label: row.label,
        url: row.url,
        summary: row.summary,
        provider: row.provider,
        provider_mode: row.provider_mode,
        raw_ref: row.raw_ref,
        retrieved_at: row.retrieved_at,
        credibility: row.credibility,
        created_at: row.created_at,
        updated_at: row.updated_at,
      };
    }

    const objects = {};
    for (const row of objectRows) {
      objects[row.id] = {
        ...payload(row),
        id: row.id,
        name: row.name,
        object_type: row.object_type,
        summary: row.summary,
        primary_source: row.primary_source,
        is_custom: row.is_custom,
        source_ids: [],
        baseline: [],
        planned_cards: payload(row).planned_cards || [],
        created_at: row.created_at,
        updated_at: row.updated_at,
      };
    }
    for (const row of sourceRows) {
      if (row.object_id && objects[row.object_id] && !objects[row.object_id].source_ids.includes(row.id)) {
        objects[row.object_id].source_ids.push(row.id);
      }
    }
    for (const row of baselineRows) {
      if (!objects[row.object_id]) continue;
      const item = {
        ...payload(row),
        id: row.id,
        dimension: row.dimension,
        title: row.title,
        value: row.value,
        created_from_card_id: row.created_from_card_id,
        provider: row.provider,
        provider_mode: row.provider_mode,
        created_at: row.created_at,
      };
      objects[row.object_id].baseline.push(item);
    }

    const scopes = scopeRows.map((row) => ({
      ...payload(row),
      id: row.id,
      name: row.name,
      description: row.description,
      is_demo: row.is_demo,
      last_run_at: row.last_run_at,
      last_run_label: row.last_run_label,
      object_ids: scopeObjectRows.filter((item) => item.scope_id === row.id).map((item) => item.object_id),
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));

    const cardSources = groupBy(cardSourceRows, "card_id");
    const cards = cardRows.map((row) => ({
      ...payload(row),
      id: row.id,
      run_id: row.run_id,
      scope_id: row.scope_id,
      object_id: row.object_id,
      dimension: row.dimension,
      title: row.title,
      before: row.before,
      after: row.after,
      confidence: row.confidence,
      status: row.status,
      provider: row.provider,
      provider_mode: row.provider_mode,
      raw_ref: row.raw_ref,
      confirmed_at: row.confirmed_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
      source_ids: cardSources.get(row.id)?.map((item) => item.source_id) || payload(row).source_ids || [],
    }));

    const stepsByRun = groupBy(stepRows, "run_id");
    const tracesByRun = groupBy(traceRows, "run_id");
    const cardsByRun = groupBy(cards, "run_id");
    const runs = runRows.map((row) => ({
      ...payload(row),
      id: row.id,
      scope_id: row.scope_id,
      object_id: row.object_id,
      status: row.status,
      mode: row.mode,
      provider: row.provider,
      provider_mode: row.provider_mode,
      started_at: row.started_at,
      finished_at: row.finished_at,
      error_message: row.error_message,
      steps: (stepsByRun.get(row.id) || []).map((step) => ({ ...payload(step), ...step, payload_json: undefined })),
      traces: (tracesByRun.get(row.id) || []).map((trace) => ({ ...payload(trace), ...trace, payload_json: undefined })),
      cards: cardsByRun.get(row.id) || [],
    }));

    const scopeState = {};
    for (const scope of scopes) {
      scopeState[scope.id] = {
        candidates: candidateRows.filter((row) => row.scope_id === scope.id).map((row) => ({ ...payload(row), tracked: row.tracked })),
        runs: runs.filter((run) => run.scope_id === scope.id).sort(byCreatedDesc),
        confirmed_cards: cards.filter((card) => card.scope_id === scope.id && card.status === "confirmed").sort(byCreatedDesc),
        actions: actionRows.filter((row) => row.scope_id === scope.id).map((row) => ({ ...payload(row), ...row, payload_json: undefined })),
        memory_records: memoryRows.filter((row) => row.scope_id === scope.id).map((row) => ({ ...payload(row), ...row, payload_json: undefined })),
        sync_records: syncRows.filter((row) => row.scope_id === scope.id).map((row) => ({ ...payload(row), ...row, payload_json: undefined })),
        assets: assetRows.filter((row) => row.scope_id === scope.id).map((row) => ({ ...payload(row), ...row, payload_json: undefined })),
        qa_messages: qaRows.filter((row) => row.scope_id === scope.id).map((row) => ({ ...payload(row), ...row, payload_json: undefined })),
        excerpts: excerptRows.filter((row) => row.scope_id === scope.id).map((row) => ({ ...payload(row), ...row, payload_json: undefined })),
      };
    }

    this.memory = new MemoryRepository({
      sources,
      objects,
      scopes,
      scopeState,
      topicCandidates: this.seed.topicCandidates || {},
    });
  }

  persistScope(scope) {
    this.query(`
      insert into public.ccc_scopes (id, name, description, is_demo, last_run_at, last_run_label, created_at, updated_at, payload_json)
      values (
        ${sqlString(scope.id)},
        ${sqlString(scope.name)},
        ${sqlString(scope.description)},
        ${sqlBoolean(scope.is_demo)},
        ${sqlString(scope.last_run_at)},
        ${sqlString(scope.last_run_label)},
        ${sqlString(scope.created_at || nowIso())},
        ${sqlString(scope.updated_at || nowIso())},
        ${sqlJson(scope)}
      )
      on conflict (id) do update set
        name = excluded.name,
        description = excluded.description,
        is_demo = excluded.is_demo,
        last_run_at = excluded.last_run_at,
        last_run_label = excluded.last_run_label,
        updated_at = excluded.updated_at,
        payload_json = excluded.payload_json;
    `);
  }

  persistObject(object) {
    this.query(`
      insert into public.ccc_objects (id, name, object_type, summary, primary_source, is_custom, created_at, updated_at, payload_json)
      values (
        ${sqlString(object.id)},
        ${sqlString(object.name)},
        ${sqlString(object.object_type)},
        ${sqlString(object.summary)},
        ${sqlString(object.primary_source)},
        ${sqlBoolean(object.is_custom)},
        ${sqlString(object.created_at || nowIso())},
        ${sqlString(object.updated_at || nowIso())},
        ${sqlJson(object)}
      )
      on conflict (id) do update set
        name = excluded.name,
        object_type = excluded.object_type,
        summary = excluded.summary,
        primary_source = excluded.primary_source,
        is_custom = excluded.is_custom,
        updated_at = excluded.updated_at,
        payload_json = excluded.payload_json;
    `);
    for (const baseline of object.baseline || []) this.persistBaseline(object.id, baseline);
    for (const sourceId of object.source_ids || []) {
      const source = this.memory?.sources?.[sourceId] || this.seed.sources?.[sourceId];
      if (source) this.persistSource(null, object.id, source);
    }
  }

  persistScopeObject(scopeId, objectId) {
    this.query(`
      insert into public.ccc_scope_objects (scope_id, object_id, status, payload_json)
      values (${sqlString(scopeId)}, ${sqlString(objectId)}, 'active', ${sqlJson({ scope_id: scopeId, object_id: objectId })})
      on conflict (scope_id, object_id) do update set status = excluded.status, payload_json = excluded.payload_json;
    `);
  }

  persistSource(scopeId, objectId, source) {
    this.query(`
      insert into public.ccc_sources (
        id, scope_id, object_id, type, label, url, summary, provider, provider_mode, raw_ref,
        retrieved_at, credibility, created_at, updated_at, payload_json
      )
      values (
        ${sqlString(source.id)},
        ${sqlString(scopeId || source.scope_id)},
        ${sqlString(objectId || source.object_id)},
        ${sqlString(source.type)},
        ${sqlString(source.label)},
        ${sqlString(source.url)},
        ${sqlString(source.summary || source.snippet)},
        ${sqlString(source.provider)},
        ${sqlString(source.provider_mode)},
        ${sqlString(source.raw_ref)},
        ${sqlString(source.retrieved_at)},
        ${sqlString(source.credibility)},
        ${sqlString(source.created_at || nowIso())},
        ${sqlString(source.updated_at || nowIso())},
        ${sqlJson(source)}
      )
      on conflict (id) do update set
        scope_id = coalesce(excluded.scope_id, public.ccc_sources.scope_id),
        object_id = coalesce(excluded.object_id, public.ccc_sources.object_id),
        type = excluded.type,
        label = excluded.label,
        url = excluded.url,
        summary = excluded.summary,
        provider = excluded.provider,
        provider_mode = excluded.provider_mode,
        raw_ref = excluded.raw_ref,
        retrieved_at = excluded.retrieved_at,
        credibility = excluded.credibility,
        updated_at = excluded.updated_at,
        payload_json = excluded.payload_json;
    `);
  }

  persistBaseline(objectId, baseline) {
    this.query(`
      insert into public.ccc_baselines (
        id, scope_id, object_id, dimension, title, value, created_from_card_id,
        provider, provider_mode, created_at, payload_json
      )
      values (
        ${sqlString(baseline.id)},
        ${sqlString(baseline.scope_id)},
        ${sqlString(baseline.object_id || objectId)},
        ${sqlString(baseline.dimension)},
        ${sqlString(baseline.title)},
        ${sqlString(baseline.value)},
        ${sqlString(baseline.created_from_card_id)},
        ${sqlString(baseline.provider)},
        ${sqlString(baseline.provider_mode)},
        ${sqlString(baseline.created_at || nowIso())},
        ${sqlJson(baseline)}
      )
      on conflict (id) do update set
        dimension = excluded.dimension,
        title = excluded.title,
        value = excluded.value,
        created_from_card_id = excluded.created_from_card_id,
        provider = excluded.provider,
        provider_mode = excluded.provider_mode,
        payload_json = excluded.payload_json;
    `);
  }

  persistCandidates(scopeId, candidates) {
    const inserts = (candidates || []).map((candidate) => `
      insert into public.ccc_candidates (id, scope_id, object_id, reason, tracked, payload_json)
      values (
        ${sqlString(`${scopeId}:${candidate.id}`)},
        ${sqlString(scopeId)},
        ${sqlString(candidate.id)},
        ${sqlString(candidate.reason)},
        ${sqlBoolean(candidate.tracked)},
        ${sqlJson(candidate)}
      )
      on conflict (id) do update set
        reason = excluded.reason,
        tracked = excluded.tracked,
        payload_json = excluded.payload_json;
    `).join("\n");
    this.query(`delete from public.ccc_candidates where scope_id = ${sqlString(scopeId)}; ${inserts}`);
  }

  persistRun(run) {
    this.query(`
      insert into public.ccc_runs (
        id, scope_id, object_id, status, mode, provider, provider_mode, started_at, finished_at, error_message, created_at, payload_json
      )
      values (
        ${sqlString(run.id)},
        ${sqlString(run.scope_id)},
        ${sqlString(run.object_id)},
        ${sqlString(run.status)},
        ${sqlString(run.mode)},
        ${sqlString(run.provider)},
        ${sqlString(run.provider_mode)},
        ${sqlString(run.started_at)},
        ${sqlString(run.finished_at)},
        ${sqlString(run.error_message)},
        ${sqlString(run.finished_at || run.started_at || nowIso())},
        ${sqlJson(run)}
      )
      on conflict (id) do update set
        status = excluded.status,
        provider = excluded.provider,
        provider_mode = excluded.provider_mode,
        finished_at = excluded.finished_at,
        error_message = excluded.error_message,
        payload_json = excluded.payload_json;
    `);
    for (const step of run.steps || []) this.persistRunStep(run, step);
    for (const trace of run.traces || []) this.persistTrace(run, trace);
    for (const card of run.cards || []) this.persistCard(card);
  }

  persistRunStep(run, step) {
    this.query(`
      insert into public.ccc_run_steps (
        id, run_id, scope_id, object_id, step_key, label, status, summary, provider,
        provider_mode, started_at, finished_at, payload_json
      )
      values (
        ${sqlString(step.id)},
        ${sqlString(run.id)},
        ${sqlString(run.scope_id)},
        ${sqlString(run.object_id)},
        ${sqlString(step.step_key)},
        ${sqlString(step.label)},
        ${sqlString(step.status)},
        ${sqlString(step.summary)},
        ${sqlString(step.provider)},
        ${sqlString(step.provider_mode)},
        ${sqlString(step.started_at)},
        ${sqlString(step.finished_at)},
        ${sqlJson(step)}
      )
      on conflict (id) do update set status = excluded.status, summary = excluded.summary, payload_json = excluded.payload_json;
    `);
  }

  persistTrace(run, trace) {
    this.query(`
      insert into public.ccc_trace_records (
        id, run_id, scope_id, object_id, provider, provider_mode, tool_name, input_summary,
        output_summary, status, raw_ref, trace_id, latency_ms, created_at, payload_json
      )
      values (
        ${sqlString(trace.id)},
        ${sqlString(trace.run_id || run.id)},
        ${sqlString(run.scope_id)},
        ${sqlString(run.object_id)},
        ${sqlString(trace.provider)},
        ${sqlString(trace.provider_mode)},
        ${sqlString(trace.tool_name)},
        ${sqlString(trace.input_summary)},
        ${sqlString(trace.output_summary)},
        ${sqlString(trace.status)},
        ${sqlString(trace.raw_ref)},
        ${sqlString(trace.trace_id)},
        ${sqlNumber(trace.latency_ms)},
        ${sqlString(trace.created_at || nowIso())},
        ${sqlJson(trace)}
      )
      on conflict (id) do update set status = excluded.status, output_summary = excluded.output_summary, payload_json = excluded.payload_json;
    `);
  }

  persistCard(card) {
    const status = card.status || (card.confirmed_at ? "confirmed" : "pending");
    const payloadCard = { ...card, status };
    this.query(`
      insert into public.ccc_change_cards (
        id, run_id, scope_id, object_id, dimension, title, "before", "after", confidence,
        status, provider, provider_mode, raw_ref, confirmed_at, created_at, updated_at, payload_json
      )
      values (
        ${sqlString(card.id)},
        ${sqlString(card.run_id)},
        ${sqlString(card.scope_id)},
        ${sqlString(card.object_id)},
        ${sqlString(card.dimension)},
        ${sqlString(card.title)},
        ${sqlString(card.before)},
        ${sqlString(card.after)},
        ${sqlString(card.confidence)},
        ${sqlString(status)},
        ${sqlString(card.provider)},
        ${sqlString(card.provider_mode)},
        ${sqlString(card.raw_ref)},
        ${sqlString(card.confirmed_at)},
        ${sqlString(card.created_at || nowIso())},
        ${sqlString(card.updated_at || nowIso())},
        ${sqlJson(payloadCard)}
      )
      on conflict (id) do update set
        status = excluded.status,
        title = excluded.title,
        "before" = excluded."before",
        "after" = excluded."after",
        confidence = excluded.confidence,
        confirmed_at = excluded.confirmed_at,
        updated_at = excluded.updated_at,
        payload_json = excluded.payload_json;
      delete from public.ccc_change_card_sources where card_id = ${sqlString(card.id)};
      ${(card.source_ids || []).map((sourceId) => `
        insert into public.ccc_change_card_sources (card_id, source_id)
        values (${sqlString(card.id)}, ${sqlString(sourceId)})
        on conflict (card_id, source_id) do nothing;
      `).join("\n")}
    `);
  }

  persistLatestRunCard(scopeId, objectId, cardId) {
    const { card } = this.memory.findLatestCard(scopeId, objectId, cardId);
    if (card) this.persistCard(card);
  }

  persistAction(action) {
    this.query(`
      insert into public.ccc_user_actions (
        id, scope_id, object_id, card_id, action_type, note, provider, provider_mode, created_at, payload_json
      )
      values (
        ${sqlString(action.id)},
        ${sqlString(action.scope_id)},
        ${sqlString(action.object_id)},
        ${sqlString(action.card_id)},
        ${sqlString(action.action_type)},
        ${sqlString(action.note)},
        ${sqlString(action.provider)},
        ${sqlString(action.provider_mode)},
        ${sqlString(action.created_at || nowIso())},
        ${sqlJson(action)}
      )
      on conflict (id) do update set note = excluded.note, payload_json = excluded.payload_json;
    `);
  }

  persistMemoryRecord(record) {
    this.query(`
      insert into public.ccc_memory_records (
        id, scope_id, object_id, card_id, action_id, provider, provider_mode, status,
        raw_ref, summary, latency_ms, error_code, created_at, payload_json
      )
      values (
        ${sqlString(record.id)}, ${sqlString(record.scope_id)}, ${sqlString(record.object_id)},
        ${sqlString(record.card_id)}, ${sqlString(record.action_id)}, ${sqlString(record.provider)},
        ${sqlString(record.provider_mode)}, ${sqlString(record.status)}, ${sqlString(record.raw_ref)},
        ${sqlString(record.summary)}, ${sqlNumber(record.latency_ms)}, ${sqlString(record.error_code)},
        ${sqlString(record.created_at || nowIso())}, ${sqlJson(record)}
      )
      on conflict (id) do update set status = excluded.status, summary = excluded.summary, payload_json = excluded.payload_json;
    `);
  }

  persistSyncRecord(record) {
    this.query(`
      insert into public.ccc_sync_records (
        id, scope_id, object_id, run_id, provider, provider_mode, status, raw_ref,
        summary, latency_ms, error_code, created_at, payload_json
      )
      values (
        ${sqlString(record.id)}, ${sqlString(record.scope_id)}, ${sqlString(record.object_id)},
        ${sqlString(record.run_id)}, ${sqlString(record.provider)}, ${sqlString(record.provider_mode)},
        ${sqlString(record.status)}, ${sqlString(record.raw_ref)}, ${sqlString(record.summary)},
        ${sqlNumber(record.latency_ms)}, ${sqlString(record.error_code)}, ${sqlString(record.created_at || nowIso())},
        ${sqlJson(record)}
      )
      on conflict (id) do update set status = excluded.status, summary = excluded.summary, payload_json = excluded.payload_json;
    `);
  }

  persistAsset(asset) {
    this.query(`
      insert into public.ccc_assets (
        id, scope_id, object_id, type, title, status, text, image_url, storage_bucket,
        storage_path, provider, provider_mode, raw_ref, created_at, payload_json
      )
      values (
        ${sqlString(asset.id)}, ${sqlString(asset.scope_id)}, ${sqlString(asset.object_id)},
        ${sqlString(asset.type)}, ${sqlString(asset.title)}, ${sqlString(asset.status)},
        ${sqlString(asset.text)}, ${sqlString(asset.image_url)}, ${sqlString(asset.storage_bucket)},
        ${sqlString(asset.storage_path)}, ${sqlString(asset.provider)}, ${sqlString(asset.provider_mode)},
        ${sqlString(asset.raw_ref)}, ${sqlString(asset.created_at || nowIso())}, ${sqlJson(asset)}
      )
      on conflict (id) do update set status = excluded.status, image_url = excluded.image_url, payload_json = excluded.payload_json;
    `);
  }

  persistQaMessage(message) {
    this.query(`
      insert into public.ccc_qa_messages (
        id, scope_id, role, text, provider, provider_mode, raw_ref, created_at, payload_json
      )
      values (
        ${sqlString(message.id)}, ${sqlString(message.scope_id)}, ${sqlString(message.role)},
        ${sqlString(message.text)}, ${sqlString(message.provider)}, ${sqlString(message.provider_mode)},
        ${sqlString(message.raw_ref)}, ${sqlString(message.created_at || nowIso())}, ${sqlJson(message)}
      )
      on conflict (id) do update set text = excluded.text, payload_json = excluded.payload_json;
    `);
  }

  persistExcerpt(excerpt) {
    this.query(`
      insert into public.ccc_qa_excerpts (
        id, scope_id, title, text, status, provider, provider_mode, created_at, payload_json
      )
      values (
        ${sqlString(excerpt.id)}, ${sqlString(excerpt.scope_id)}, ${sqlString(excerpt.title)},
        ${sqlString(excerpt.text)}, ${sqlString(excerpt.status)}, ${sqlString(excerpt.provider)},
        ${sqlString(excerpt.provider_mode)}, ${sqlString(excerpt.created_at || nowIso())}, ${sqlJson(excerpt)}
      )
      on conflict (id) do update set text = excluded.text, payload_json = excluded.payload_json;
    `);
  }

  persistSalesGoal(goal) {
    this.ensureSalesReady({ goals: [], companies: {}, dossiers: {}, materials: {}, qa_messages: {} });
    this.query(`
      insert into public.sales_goals (id, workspace_id, name, description, keywords, created_at, updated_at, payload_json)
      values (
        ${sqlString(goal.id)},
        ${sqlString(this.workspaceId)}::uuid,
        ${sqlString(goal.name)},
        ${sqlString(goal.description)},
        ${sqlJson(goal.keywords || [])},
        ${sqlString(goal.created_at || nowIso())},
        ${sqlString(goal.updated_at || nowIso())},
        ${sqlJson(goal)}
      )
      on conflict (id) do update set
        name = excluded.name,
        description = excluded.description,
        keywords = excluded.keywords,
        updated_at = excluded.updated_at,
        payload_json = excluded.payload_json
      where public.sales_goals.workspace_id = excluded.workspace_id;
    `);
  }

  persistSalesCompany(company) {
    this.ensureSalesReady({ goals: [], companies: {}, dossiers: {}, materials: {}, qa_messages: {} });
    this.query(`
      insert into public.sales_companies (id, workspace_id, name, initial, industry, location, tags, created_at, updated_at, payload_json)
      values (
        ${sqlString(company.id)},
        ${sqlString(this.workspaceId)}::uuid,
        ${sqlString(company.name)},
        ${sqlString(company.initial)},
        ${sqlString(company.industry)},
        ${sqlString(company.location)},
        ${sqlJson(company.tags || [])},
        ${sqlString(company.created_at || nowIso())},
        ${sqlString(company.updated_at || nowIso())},
        ${sqlJson(company)}
      )
      on conflict (id) do update set
        name = excluded.name,
        initial = excluded.initial,
        industry = excluded.industry,
        location = excluded.location,
        tags = excluded.tags,
        updated_at = excluded.updated_at,
        payload_json = excluded.payload_json
      where public.sales_companies.workspace_id = excluded.workspace_id;
    `);
    if (company.progress) this.persistSalesProgress(company.id, company.progress);
  }

  persistSalesProgress(companyId, progress) {
    const createdAt = progress.updated_at || nowIso();
    this.query(`
      insert into public.sales_progress_snapshots (id, workspace_id, company_id, label, summary, evidence, created_at, payload_json)
      values (
        ${sqlString(`${companyId}:${createdAt}`)},
        ${sqlString(this.workspaceId)}::uuid,
        ${sqlString(companyId)},
        ${sqlString(progress.label)},
        ${sqlString(progress.summary)},
        ${sqlString(progress.evidence)},
        ${sqlString(createdAt)},
        ${sqlJson(progress)}
      )
      on conflict (id) do update set
        label = excluded.label,
        summary = excluded.summary,
        evidence = excluded.evidence,
        payload_json = excluded.payload_json
      where public.sales_progress_snapshots.workspace_id = excluded.workspace_id;
    `);
  }

  persistSalesTargetEnterprise(goalId, company) {
    this.persistSalesCompany(company);
    this.query(`
      insert into public.sales_target_enterprises (id, workspace_id, goal_id, company_id, status, created_at, updated_at, payload_json)
      values (
        ${sqlString(`${goalId}:${company.id}`)},
        ${sqlString(this.workspaceId)}::uuid,
        ${sqlString(goalId)},
        ${sqlString(company.id)},
        ${sqlString(company.progress?.label || "新商机")},
        ${sqlString(nowIso())},
        ${sqlString(nowIso())},
        ${sqlJson({ goal_id: goalId, company_id: company.id, status: company.progress?.label || "新商机" })}
      )
      on conflict (workspace_id, goal_id, company_id) do update set
        status = excluded.status,
        updated_at = excluded.updated_at,
        payload_json = excluded.payload_json;
    `);
  }

  persistSalesSearchResults(goalId, query, companies) {
    const inserts = (companies || []).map((company) => `
      insert into public.sales_company_search_results (id, workspace_id, goal_id, company_id, query, reason, created_at, payload_json)
      values (
        ${sqlString(makeId("sales_search"))},
        ${sqlString(this.workspaceId)}::uuid,
        ${sqlString(goalId)},
        ${sqlString(company.id)},
        ${sqlString(query)},
        ${sqlString(company.reason || "")},
        ${sqlString(nowIso())},
        ${sqlJson(company)}
      );
    `).join("\n");
    if (inserts.trim()) this.query(inserts);
  }

  persistSalesDossier(dossier) {
    this.query(`
      insert into public.sales_dossier_records (
        id, workspace_id, company_id, title, summary, memory_summary, provider_run_id,
        version_no, previous_dossier_id, evidence_hash, dossier_fingerprint, change_status,
        data_as_of, generated_at, evidence_pack_json, created_at, updated_at, payload_json
      )
      values (
        ${sqlString(dossier.id)},
        ${sqlString(this.workspaceId)}::uuid,
        ${sqlString(dossier.company_id)},
        ${sqlString(dossier.title)},
        ${sqlString(dossier.summary)},
        ${sqlString(dossier.memory_summary)},
        ${sqlString(dossier.provider_run_id)},
        ${sqlNumber(dossier.version_no || 1)},
        ${sqlString(dossier.previous_dossier_id)},
        ${sqlString(dossier.evidence_hash)},
        ${sqlString(dossier.dossier_fingerprint)},
        ${sqlString(dossier.change_status || "initial")},
        ${sqlString(dossier.data_as_of)},
        ${sqlString(dossier.generated_at || dossier.created_at || nowIso())},
        ${sqlJson(dossier.evidence_pack || [])},
        ${sqlString(dossier.created_at || nowIso())},
        ${sqlString(dossier.updated_at || dossier.created_at || nowIso())},
        ${sqlJson(dossier)}
      )
      on conflict (id) do update set
        title = excluded.title,
        summary = excluded.summary,
        memory_summary = excluded.memory_summary,
        provider_run_id = excluded.provider_run_id,
        version_no = excluded.version_no,
        previous_dossier_id = excluded.previous_dossier_id,
        evidence_hash = excluded.evidence_hash,
        dossier_fingerprint = excluded.dossier_fingerprint,
        change_status = excluded.change_status,
        data_as_of = excluded.data_as_of,
        generated_at = excluded.generated_at,
        evidence_pack_json = excluded.evidence_pack_json,
        updated_at = excluded.updated_at,
        deleted_at = null,
        payload_json = excluded.payload_json
      where public.sales_dossier_records.workspace_id = excluded.workspace_id;

      delete from public.sales_dossier_citations
      where workspace_id = ${sqlString(this.workspaceId)}::uuid and dossier_id = ${sqlString(dossier.id)};
      ${(dossier.citations || []).map((citation) => `
        insert into public.sales_dossier_citations (
          id, workspace_id, dossier_id, citation_no, label, source_kind, url, created_at, payload_json
        )
        values (
          ${sqlString(`${dossier.id}:${citation.id}`)},
          ${sqlString(this.workspaceId)}::uuid,
          ${sqlString(dossier.id)},
          ${sqlString(citation.id)},
          ${sqlString(citation.label)},
          ${sqlString(citation.source_kind)},
          ${sqlString(citation.url || "")},
          ${sqlString(nowIso())},
          ${sqlJson(citation)}
        )
        on conflict (id) do update set
          label = excluded.label,
          source_kind = excluded.source_kind,
          url = excluded.url,
          payload_json = excluded.payload_json
        where public.sales_dossier_citations.workspace_id = excluded.workspace_id;
      `).join("\n")}
    `);
  }

  persistSalesMaterial(material) {
    const metadata = salesMaterialMetadata(material);
    this.query(`
      insert into public.sales_materials (
        id, workspace_id, company_id, title, source_type, source_url, source_id, source_version,
        content_hash, summary, occurred_at, openviking_uri, openviking_status, last_synced_at,
        created_at, updated_at, payload_json
      )
      values (
        ${sqlString(material.id)},
        ${sqlString(this.workspaceId)}::uuid,
        ${sqlString(material.company_id)},
        ${sqlString(material.title)},
        ${sqlString(material.source_type || "")},
        ${sqlString(material.source_url || "")},
        ${sqlString(material.source_id || null)},
        ${sqlString(material.source_version || "")},
        ${sqlString(material.content_hash || "")},
        ${sqlString("")},
        ${sqlString(material.occurred_at || null)},
        ${sqlString(material.openviking_uri || material.openviking_ref || "")},
        ${sqlString(material.openviking_status || (material.openviking_uri ? "indexed" : "pending"))},
        ${sqlString(material.last_synced_at || null)},
        ${sqlString(material.created_at || material.updated_at || nowIso())},
        ${sqlString(material.updated_at || nowIso())},
        ${sqlJson(metadata)}
      )
      on conflict (id) do update set
        company_id = excluded.company_id,
        title = excluded.title,
        source_type = excluded.source_type,
        source_url = excluded.source_url,
        source_id = excluded.source_id,
        source_version = excluded.source_version,
        content_hash = excluded.content_hash,
        summary = excluded.summary,
        occurred_at = excluded.occurred_at,
        openviking_uri = excluded.openviking_uri,
        openviking_status = excluded.openviking_status,
        last_synced_at = excluded.last_synced_at,
        updated_at = excluded.updated_at,
        payload_json = excluded.payload_json
      where public.sales_materials.workspace_id = excluded.workspace_id;
    `);
  }

  softDeleteSalesMaterial(materialId, deletedAt = nowIso()) {
    this.query(`
      update public.sales_materials
      set deleted_at = ${sqlString(deletedAt)}, updated_at = ${sqlString(deletedAt)}
      where workspace_id = ${sqlString(this.workspaceId)}::uuid
        and id = ${sqlString(materialId)};
    `);
  }

  persistSyncSource(source) {
    this.query(`
      insert into public.sync_sources (
        id, workspace_id, source_type, external_id, display_name, status, config_json,
        last_synced_at, created_at, updated_at
      )
      values (
        ${sqlString(source.id)},
        ${sqlString(this.workspaceId)}::uuid,
        ${sqlString(source.source_type)},
        ${sqlString(source.external_id)},
        ${sqlString(source.display_name || "")},
        ${sqlString(source.status || "active")},
        ${sqlJson(source.config || source.config_json || {})},
        ${sqlString(source.last_synced_at || null)},
        ${sqlString(source.created_at || nowIso())},
        ${sqlString(source.updated_at || nowIso())}
      )
      on conflict (id) do update set
        source_type = excluded.source_type,
        external_id = excluded.external_id,
        display_name = excluded.display_name,
        status = excluded.status,
        config_json = excluded.config_json,
        last_synced_at = excluded.last_synced_at,
        updated_at = excluded.updated_at
      where public.sync_sources.workspace_id = excluded.workspace_id;
    `);
  }

  persistSyncCheckpoint(checkpoint) {
    const id = checkpoint.id || `${checkpoint.source_id}:${checkpoint.checkpoint_key || "latest"}`;
    this.query(`
      insert into public.sync_checkpoints (
        id, workspace_id, source_id, checkpoint_key, checkpoint_value, content_hash,
        last_success_at, error_json, created_at, updated_at
      )
      values (
        ${sqlString(id)},
        ${sqlString(this.workspaceId)}::uuid,
        ${sqlString(checkpoint.source_id)},
        ${sqlString(checkpoint.checkpoint_key || "latest")},
        ${sqlString(checkpoint.checkpoint_value || "")},
        ${sqlString(checkpoint.content_hash || null)},
        ${sqlString(checkpoint.last_success_at || null)},
        ${checkpoint.error || checkpoint.error_json ? sqlJson(checkpoint.error || checkpoint.error_json) : "null"},
        ${sqlString(checkpoint.created_at || nowIso())},
        ${sqlString(checkpoint.updated_at || nowIso())}
      )
      on conflict (id) do update set
        checkpoint_value = excluded.checkpoint_value,
        content_hash = excluded.content_hash,
        last_success_at = excluded.last_success_at,
        error_json = excluded.error_json,
        updated_at = excluded.updated_at
      where public.sync_checkpoints.workspace_id = excluded.workspace_id;
    `);
  }

  persistSalesOpenVikingRef(record) {
    const id = record.id || (record.related_id
      ? `${record.company_id || "global"}:${record.related_type || "ref"}:${record.related_id}:${record.ref_kind || "ref"}`
      : makeId("sales_ov"));
    this.query(`
      insert into public.sales_openviking_refs (
        id, workspace_id, company_id, related_type, related_id, ref_kind, uri, summary, created_at, payload_json
      )
      values (
        ${sqlString(id)},
        ${sqlString(this.workspaceId)}::uuid,
        ${sqlString(record.company_id)},
        ${sqlString(record.related_type)},
        ${sqlString(record.related_id)},
        ${sqlString(record.ref_kind)},
        ${sqlString(record.uri)},
        ${sqlString(record.summary)},
        ${sqlString(record.created_at || nowIso())},
        ${sqlJson(record.payload_json || record)}
      )
      on conflict (id) do update set
        company_id = excluded.company_id,
        related_type = excluded.related_type,
        related_id = excluded.related_id,
        ref_kind = excluded.ref_kind,
        uri = excluded.uri,
        summary = excluded.summary,
        payload_json = excluded.payload_json
      where public.sales_openviking_refs.workspace_id = excluded.workspace_id;
    `);
  }

  persistJob(job) {
    this.ensureSalesReady({ goals: [], companies: {}, dossiers: {}, materials: {}, qa_messages: {} });
    this.query(`
      insert into public.jobs (
        id, workspace_id, job_type, status, entity_type, entity_id, idempotency_key,
        attempt_count, max_attempts, scheduled_at, started_at, finished_at,
        error_json, payload_json, is_paid, stage, progress, worker_id,
        lease_expires_at, heartbeat_at, cancel_requested_at, created_by, created_at, updated_at
      )
      values (
        ${sqlString(job.id)},
        ${sqlString(this.workspaceId)}::uuid,
        ${sqlString(job.job_type)},
        ${sqlString(job.status || "queued")},
        ${sqlString(job.entity_type)},
        ${sqlString(job.entity_id)},
        ${sqlString(job.idempotency_key)},
        ${sqlNumber(job.attempt_count || 0)},
        ${sqlNumber(job.max_attempts || 3)},
        ${sqlString(job.scheduled_at)},
        ${sqlString(job.started_at)},
        ${sqlString(job.finished_at)},
        ${job.error || job.error_json ? sqlJson(job.error || job.error_json) : "null"},
        ${sqlJson(job)},
        ${sqlBoolean(Boolean(job.is_paid))},
        ${sqlString(job.stage || job.status || "queued")},
        ${sqlNumber(Math.max(0, Math.min(Number(job.progress || 0), 100)))},
        ${sqlString(job.worker_id)},
        ${sqlString(job.lease_expires_at)},
        ${sqlString(job.heartbeat_at)},
        ${sqlString(job.cancel_requested_at)},
        ${job.created_by ? `${sqlString(job.created_by)}::uuid` : "null"},
        ${sqlString(job.created_at || nowIso())},
        ${sqlString(job.updated_at || nowIso())}
      )
      on conflict (id) do update set
        job_type = excluded.job_type,
        status = excluded.status,
        entity_type = excluded.entity_type,
        entity_id = excluded.entity_id,
        idempotency_key = excluded.idempotency_key,
        attempt_count = excluded.attempt_count,
        max_attempts = excluded.max_attempts,
        scheduled_at = excluded.scheduled_at,
        started_at = excluded.started_at,
        finished_at = excluded.finished_at,
        error_json = excluded.error_json,
        payload_json = excluded.payload_json,
        is_paid = excluded.is_paid,
        stage = excluded.stage,
        progress = excluded.progress,
        worker_id = excluded.worker_id,
        lease_expires_at = excluded.lease_expires_at,
        heartbeat_at = excluded.heartbeat_at,
        cancel_requested_at = excluded.cancel_requested_at,
        updated_at = excluded.updated_at
      where public.jobs.workspace_id = excluded.workspace_id;
    `);
    return clone(job);
  }

  enqueueJob(job) {
    this.ensureSalesReady({ goals: [], companies: {}, dossiers: {}, materials: {}, qa_messages: {} });
    const rows = this.query(`
      select public.enqueue_sales_job(
        ${sqlString(this.workspaceId)}::uuid,
        ${sqlJson(job)}
      ) as result;
    `);
    return this.jobView(rows[0]?.result || job);
  }

  claimNextJob(workerId, jobTypes, leaseSeconds) {
    this.ensureSalesReady({ goals: [], companies: {}, dossiers: {}, materials: {}, qa_messages: {} });
    const rows = this.query(`
      select public.claim_sales_job(
        ${sqlString(this.workspaceId)}::uuid,
        ${sqlString(workerId)},
        ${sqlTextArray(jobTypes)},
        ${sqlNumber(Number(leaseSeconds || 600))}::integer
      ) as result;
    `);
    return rows[0]?.result ? this.jobView(rows[0].result) : null;
  }

  heartbeatJob(jobId, workerId, stage, progress, leaseSeconds) {
    this.ensureSalesReady({ goals: [], companies: {}, dossiers: {}, materials: {}, qa_messages: {} });
    const rows = this.query(`
      select public.heartbeat_sales_job(
        ${sqlString(this.workspaceId)}::uuid,
        ${sqlString(jobId)},
        ${sqlString(workerId)},
        ${sqlString(stage)},
        ${sqlNumber(Number(progress || 1))}::integer,
        ${sqlNumber(Number(leaseSeconds || 600))}::integer
      ) as result;
    `);
    return this.jobView(rows[0]?.result || {});
  }

  releaseJobClaim(jobId, workerId, error, options = {}) {
    this.ensureSalesReady({ goals: [], companies: {}, dossiers: {}, materials: {}, qa_messages: {} });
    const rows = this.query(`
      select public.release_sales_job_claim(
        ${sqlString(this.workspaceId)}::uuid,
        ${sqlString(jobId)},
        ${sqlString(workerId)},
        ${error ? sqlJson(error) : "null"}::jsonb,
        ${sqlBoolean(Boolean(options.retry))},
        ${sqlNumber(Number(options.delay_seconds || 0))}::integer
      ) as result;
    `);
    return rows[0]?.result ? this.jobView(rows[0].result) : null;
  }

  requestJobCancellation(jobId) {
    this.ensureSalesReady({ goals: [], companies: {}, dossiers: {}, materials: {}, qa_messages: {} });
    const rows = this.query(`
      select public.request_cancel_sales_job(
        ${sqlString(this.workspaceId)}::uuid,
        ${sqlString(jobId)}
      ) as result;
    `);
    return this.jobView(rows[0]?.result || {});
  }

  acknowledgeJobCancellation(jobId, workerId) {
    this.ensureSalesReady({ goals: [], companies: {}, dossiers: {}, materials: {}, qa_messages: {} });
    const rows = this.query(`
      select public.acknowledge_cancel_sales_job(
        ${sqlString(this.workspaceId)}::uuid,
        ${sqlString(jobId)},
        ${sqlString(workerId)}
      ) as result;
    `);
    return this.jobView(rows[0]?.result || {});
  }

  retryQueuedJob(jobId) {
    this.ensureSalesReady({ goals: [], companies: {}, dossiers: {}, materials: {}, qa_messages: {} });
    const rows = this.query(`
      select public.retry_sales_job(
        ${sqlString(this.workspaceId)}::uuid,
        ${sqlString(jobId)}
      ) as result;
    `);
    return this.jobView(rows[0]?.result || {});
  }

  reservePaidWorkflow(job, reservationId, limits) {
    this.ensureSalesReady({ goals: [], companies: {}, dossiers: {}, materials: [], qa_messages: {} });
    const rows = this.query(`
      select public.reserve_paid_workflow(
        ${sqlString(this.workspaceId)}::uuid,
        ${sqlJson(job)},
        ${sqlString(reservationId)},
        ${sqlNumber(limits.max_concurrent)}::integer,
        ${sqlNumber(limits.daily_limit)}::integer,
        ${sqlString(limits.timezone)},
        ${sqlNumber(limits.stale_after_seconds)}::integer
      ) as result;
    `);
    const result = rows[0]?.result || {};
    return { job: result.job || job, budget: result.budget || null };
  }

  finishPaidWorkflow(job, reservationId) {
    this.ensureSalesReady({ goals: [], companies: {}, dossiers: {}, materials: [], qa_messages: {} });
    const rows = this.query(`
      select public.finish_paid_workflow(
        ${sqlString(this.workspaceId)}::uuid,
        ${sqlJson(job)},
        ${sqlString(reservationId)}
      ) as result;
    `);
    return rows[0]?.result || clone(job);
  }

  getPaidWorkflowUsage(timezone) {
    this.ensureSalesReady({ goals: [], companies: {}, dossiers: {}, materials: [], qa_messages: {} });
    const rows = this.query(`
      select public.get_paid_workflow_usage(
        ${sqlString(this.workspaceId)}::uuid,
        ${sqlString(timezone)}
      ) as result;
    `);
    return rows[0]?.result || {};
  }

  listJobs(filters = {}) {
    this.ensureSalesReady({ goals: [], companies: {}, dossiers: {}, materials: {}, qa_messages: {} });
    const clauses = [`workspace_id = ${sqlString(this.workspaceId)}::uuid`];
    if (filters.job_type) clauses.push(`job_type = ${sqlString(filters.job_type)}`);
    if (filters.status) clauses.push(`status = ${sqlString(filters.status)}`);
    if (filters.entity_id) clauses.push(`entity_id = ${sqlString(filters.entity_id)}`);
    const requestedLimit = Number(filters.limit || 20);
    const limit = Math.max(1, Math.min(Number.isFinite(requestedLimit) ? requestedLimit : 20, 100));
    return this.query(`
      select * from public.jobs
      where ${clauses.join(" and ")}
      order by created_at desc
      limit ${limit};
    `).map((row) => this.jobView(row));
  }

  getJob(jobId) {
    this.ensureSalesReady({ goals: [], companies: {}, dossiers: {}, materials: {}, qa_messages: {} });
    const rows = this.query(`
      select * from public.jobs
      where workspace_id = ${sqlString(this.workspaceId)}::uuid and id = ${sqlString(jobId)}
      limit 1;
    `);
    return rows.length ? this.jobView(rows[0]) : null;
  }

  jobView(row) {
    const saved = payload(row);
    return {
      ...saved,
      id: row.id,
      job_type: row.job_type,
      status: row.status,
      entity_type: row.entity_type || "",
      entity_id: row.entity_id || "",
      idempotency_key: row.idempotency_key || null,
      attempt_count: Number(row.attempt_count || 0),
      max_attempts: Number(row.max_attempts || 3),
      scheduled_at: row.scheduled_at || null,
      started_at: row.started_at || null,
      finished_at: row.finished_at || null,
      error: row.error_json || saved.error || null,
      is_paid: Boolean(row.is_paid || saved.is_paid),
      stage: row.stage || saved.stage || row.status,
      progress: Number(row.progress ?? saved.progress ?? (row.status === "succeeded" ? 100 : 0)),
      worker_id: row.worker_id || saved.worker_id || null,
      lease_expires_at: row.lease_expires_at || saved.lease_expires_at || null,
      heartbeat_at: row.heartbeat_at || saved.heartbeat_at || null,
      cancel_requested_at: row.cancel_requested_at || saved.cancel_requested_at || null,
      created_by: row.created_by || saved.created_by || null,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  persistProviderRun(run) {
    this.ensureSalesReady({ goals: [], companies: {}, dossiers: {}, materials: {}, qa_messages: {} });
    this.query(`
      insert into public.provider_runs (
        id, workspace_id, job_id, operation, status, app_mode, entity_type, entity_id,
        started_at, finished_at, duration_ms, result_ref, error_json, payload_json
      )
      values (
        ${sqlString(run.id)},
        ${sqlString(this.workspaceId)}::uuid,
        ${sqlString(run.job_id)},
        ${sqlString(run.operation)},
        ${sqlString(run.status)},
        ${sqlString(run.app_mode)},
        ${sqlString(run.entity_type)},
        ${sqlString(run.entity_id)},
        ${sqlString(run.started_at)},
        ${sqlString(run.finished_at)},
        ${sqlNumber(run.duration_ms)},
        ${sqlString(run.result_ref)},
        ${run.error ? sqlJson(run.error) : "null"},
        ${sqlJson(run)}
      )
      on conflict (id) do update set
        job_id = excluded.job_id,
        operation = excluded.operation,
        status = excluded.status,
        app_mode = excluded.app_mode,
        entity_type = excluded.entity_type,
        entity_id = excluded.entity_id,
        started_at = excluded.started_at,
        finished_at = excluded.finished_at,
        duration_ms = excluded.duration_ms,
        result_ref = excluded.result_ref,
        error_json = excluded.error_json,
        payload_json = excluded.payload_json,
        updated_at = now()
      where public.provider_runs.workspace_id = excluded.workspace_id;

      ${(run.steps || []).map((step) => `
        insert into public.provider_run_steps (
          id, workspace_id, provider_run_id, sequence, provider, operation, status,
          input_summary, output_summary, request_id, raw_ref, usage_json, attempts,
          started_at, finished_at, latency_ms, error_json
        )
        values (
          ${sqlString(step.id)},
          ${sqlString(this.workspaceId)}::uuid,
          ${sqlString(run.id)},
          ${sqlNumber(step.sequence)},
          ${sqlString(step.provider)},
          ${sqlString(step.operation)},
          ${sqlString(step.status)},
          ${sqlString(step.input_summary)},
          ${sqlString(step.output_summary)},
          ${sqlString(step.request_id)},
          ${sqlString(step.raw_ref)},
          ${step.usage ? sqlJson(step.usage) : "null"},
          ${sqlNumber(step.attempts || 1)},
          ${sqlString(step.started_at)},
          ${sqlString(step.finished_at)},
          ${sqlNumber(step.latency_ms)},
          ${step.error ? sqlJson(step.error) : "null"}
        )
        on conflict (id) do update set
          sequence = excluded.sequence,
          provider = excluded.provider,
          operation = excluded.operation,
          status = excluded.status,
          input_summary = excluded.input_summary,
          output_summary = excluded.output_summary,
          request_id = excluded.request_id,
          raw_ref = excluded.raw_ref,
          usage_json = excluded.usage_json,
          attempts = excluded.attempts,
          started_at = excluded.started_at,
          finished_at = excluded.finished_at,
          latency_ms = excluded.latency_ms,
          error_json = excluded.error_json,
          updated_at = now()
        where public.provider_run_steps.workspace_id = excluded.workspace_id;
      `).join("\n")}
    `);
    return clone(run);
  }

  listProviderRuns(filters = {}) {
    this.ensureSalesReady({ goals: [], companies: {}, dossiers: {}, materials: {}, qa_messages: {} });
    const clauses = [`workspace_id = ${sqlString(this.workspaceId)}::uuid`];
    if (filters.operation) clauses.push(`operation = ${sqlString(filters.operation)}`);
    if (filters.entity_id) clauses.push(`entity_id = ${sqlString(filters.entity_id)}`);
    const requestedLimit = Number(filters.limit || 20);
    const limit = Math.max(1, Math.min(Number.isFinite(requestedLimit) ? requestedLimit : 20, 100));
    const runs = this.query(`
      select * from public.provider_runs
      where ${clauses.join(" and ")}
      order by started_at desc
      limit ${limit};
    `);
    if (!runs.length) return [];
    const runIds = runs.map((run) => sqlString(run.id)).join(", ");
    const steps = this.query(`
      select * from public.provider_run_steps
      where workspace_id = ${sqlString(this.workspaceId)}::uuid
        and provider_run_id in (${runIds})
      order by provider_run_id, sequence;
    `);
    const stepsByRun = groupBy(steps, "provider_run_id");
    return runs.map((row) => this.providerRunView(row, stepsByRun.get(row.id) || []));
  }

  getProviderRun(runId) {
    this.ensureSalesReady({ goals: [], companies: {}, dossiers: {}, materials: {}, qa_messages: {} });
    const rows = this.query(`
      select * from public.provider_runs
      where workspace_id = ${sqlString(this.workspaceId)}::uuid and id = ${sqlString(runId)}
      limit 1;
    `);
    if (!rows.length) return null;
    const steps = this.query(`
      select * from public.provider_run_steps
      where workspace_id = ${sqlString(this.workspaceId)}::uuid and provider_run_id = ${sqlString(runId)}
      order by sequence;
    `);
    return this.providerRunView(rows[0], steps);
  }

  providerRunView(row, stepRows = []) {
    const saved = payload(row);
    return {
      ...saved,
      id: row.id,
      operation: row.operation,
      status: row.status,
      app_mode: row.app_mode,
      entity_type: row.entity_type || "",
      entity_id: row.entity_id || "",
      job_id: row.job_id || saved.job_id || null,
      started_at: row.started_at,
      finished_at: row.finished_at,
      duration_ms: row.duration_ms,
      result_ref: row.result_ref,
      error: row.error_json || saved.error || null,
      steps: stepRows.map((step) => ({
        id: step.id,
        sequence: step.sequence,
        provider: step.provider,
        operation: step.operation,
        status: step.status,
        input_summary: step.input_summary || "",
        output_summary: step.output_summary || "",
        request_id: step.request_id,
        raw_ref: step.raw_ref,
        usage: step.usage_json,
        attempts: step.attempts,
        started_at: step.started_at,
        finished_at: step.finished_at,
        latency_ms: step.latency_ms,
        error: step.error_json,
      })),
    };
  }

  listScopes() {
    this.ensureReady();
    return this.memory.listScopes();
  }

  getScope(scopeId) {
    this.ensureReady();
    return this.memory.getScope(scopeId);
  }

  getScopeRaw(scopeId) {
    this.ensureReady();
    return this.memory.getScopeRaw(scopeId);
  }

  createScope(input) {
    this.ensureReady();
    const scope = this.memory.createScope(input);
    this.persistScope(this.memory.getScopeRaw(scope.id));
    return scope;
  }

  scopeView(scope) {
    this.ensureReady();
    return this.memory.scopeView(scope);
  }

  getScopeStats(scopeId) {
    this.ensureReady();
    return this.memory.getScopeStats(scopeId);
  }

  getCatalogObject(objectId) {
    this.ensureReady();
    return this.memory.getCatalogObject(objectId);
  }

  sourceView(scopeId, objectId, sourceId) {
    this.ensureReady();
    return this.memory.sourceView(scopeId, objectId, sourceId);
  }

  sourceList(scopeId, objectId, sourceIds) {
    this.ensureReady();
    return this.memory.sourceList(scopeId, objectId, sourceIds);
  }

  addObjectSources(scopeId, objectId, sources) {
    this.ensureReady();
    const saved = this.memory.addObjectSources(scopeId, objectId, sources);
    for (const source of saved) this.persistSource(scopeId, objectId, source);
    const object = this.memory.getCatalogObject(objectId);
    if (object) this.persistObject(object);
    return saved;
  }

  objectSummary(scopeId, objectId) {
    this.ensureReady();
    return this.memory.objectSummary(scopeId, objectId);
  }

  listObjects(scopeId) {
    this.ensureReady();
    return this.memory.listObjects(scopeId);
  }

  hasObject(scopeId, objectId) {
    this.ensureReady();
    return this.memory.hasObject(scopeId, objectId);
  }

  addObject(scopeId, objectId) {
    this.ensureReady();
    const detail = this.memory.addObject(scopeId, objectId);
    const scope = this.memory.getScopeRaw(scopeId);
    const object = this.memory.getCatalogObject(objectId);
    if (scope) this.persistScope(scope);
    if (object) this.persistObject(object);
    this.persistScopeObject(scopeId, objectId);
    this.persistCandidates(scopeId, this.memory.getCandidates(scopeId));
    return detail;
  }

  baselineView(scopeId, objectId, baseline) {
    this.ensureReady();
    return this.memory.baselineView(scopeId, objectId, baseline);
  }

  cardView(scopeId, card) {
    this.ensureReady();
    return this.memory.cardView(scopeId, card);
  }

  runView(run) {
    this.ensureReady();
    return this.memory.runView(run);
  }

  objectDetail(scopeId, objectId) {
    this.ensureReady();
    return this.memory.objectDetail(scopeId, objectId);
  }

  setCandidates(scopeId, candidates) {
    this.ensureReady();
    const result = this.memory.setCandidates(scopeId, candidates);
    this.persistCandidates(scopeId, result);
    return result;
  }

  getCandidates(scopeId) {
    this.ensureReady();
    return this.memory.getCandidates(scopeId);
  }

  getTopicCandidates(key) {
    this.ensureReady();
    return this.memory.getTopicCandidates(key);
  }

  listCatalogObjects() {
    this.ensureReady();
    return this.memory.listCatalogObjects();
  }

  createCustomObject(input) {
    this.ensureReady();
    const object = this.memory.createCustomObject(input);
    if (object) this.persistObject(object);
    return object;
  }

  addRun(scopeId, run) {
    this.ensureReady();
    const view = this.memory.addRun(scopeId, run);
    const raw = this.memory.getRunRaw(run.id);
    if (raw) this.persistRun(raw);
    const scope = this.memory.getScopeRaw(scopeId);
    if (scope) this.persistScope(scope);
    return view;
  }

  getRun(runId) {
    this.ensureReady();
    return this.memory.getRun(runId);
  }

  getRunRaw(runId) {
    this.ensureReady();
    return this.memory.getRunRaw(runId);
  }

  getLatestRun(scopeId, objectId) {
    this.ensureReady();
    return this.memory.getLatestRun(scopeId, objectId);
  }

  getRunTraces(runId) {
    this.ensureReady();
    return this.memory.getRunTraces(runId);
  }

  getRunCards(runId) {
    this.ensureReady();
    return this.memory.getRunCards(runId);
  }

  findLatestCard(scopeId, objectId, cardId) {
    this.ensureReady();
    return this.memory.findLatestCard(scopeId, objectId, cardId);
  }

  addAction(scopeId, action) {
    this.ensureReady();
    const result = this.memory.addAction(scopeId, action);
    this.persistLatestRunCard(scopeId, action.object_id, action.card_id);
    this.persistAction(action);
    return result;
  }

  addMemoryRecord(scopeId, record) {
    this.ensureReady();
    const result = this.memory.addMemoryRecord(scopeId, record);
    this.persistMemoryRecord(record);
    return result;
  }

  getMemoryRecords(scopeId, objectId = "") {
    this.ensureReady();
    return this.memory.getMemoryRecords(scopeId, objectId);
  }

  addSyncRecord(scopeId, record) {
    this.ensureReady();
    const result = this.memory.addSyncRecord(scopeId, record);
    this.persistSyncRecord(record);
    return result;
  }

  getSyncRecords(scopeId, objectId = "") {
    this.ensureReady();
    return this.memory.getSyncRecords(scopeId, objectId);
  }

  addConfirmedCard(scopeId, card) {
    this.ensureReady();
    this.memory.addConfirmedCard(scopeId, card);
    this.persistCard(card);
    const object = this.memory.getCatalogObject(card.object_id);
    if (object) this.persistObject(object);
  }

  getAssets(scopeId) {
    this.ensureReady();
    return this.memory.getAssets(scopeId);
  }

  addAsset(scopeId, asset) {
    this.ensureReady();
    const result = this.memory.addAsset(scopeId, asset);
    this.persistAsset(asset);
    return result;
  }

  findAsset(assetId) {
    this.ensureReady();
    return this.memory.findAsset(assetId);
  }

  getConfirmedCards(scopeId, objectId = "") {
    this.ensureReady();
    return this.memory.getConfirmedCards(scopeId, objectId);
  }

  getReport(assetId) {
    this.ensureReady();
    return this.memory.getReport(assetId);
  }

  getQa(scopeId) {
    this.ensureReady();
    return this.memory.getQa(scopeId);
  }

  addQaMessage(scopeId, message) {
    this.ensureReady();
    const result = this.memory.addQaMessage(scopeId, message);
    this.persistQaMessage(message);
    return result;
  }

  findQaMessage(scopeId, messageId) {
    this.ensureReady();
    return this.memory.findQaMessage(scopeId, messageId);
  }

  addExcerpt(scopeId, excerpt) {
    this.ensureReady();
    const result = this.memory.addExcerpt(scopeId, excerpt);
    this.persistExcerpt(excerpt);
    const asset = this.memory.findAsset(excerpt.id)?.asset;
    if (asset) this.persistAsset(asset);
    return result;
  }
}
