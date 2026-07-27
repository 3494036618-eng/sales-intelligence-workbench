export const supabaseSchemaSql = `
create table if not exists public.ccc_scopes (
  id text primary key,
  name text not null,
  description text,
  is_demo boolean not null default false,
  last_run_at timestamptz,
  last_run_label text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  payload_json jsonb not null default '{}'::jsonb
);

create table if not exists public.ccc_objects (
  id text primary key,
  name text not null,
  object_type text not null,
  summary text,
  primary_source text,
  is_custom boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  payload_json jsonb not null default '{}'::jsonb
);

create table if not exists public.ccc_scope_objects (
  scope_id text not null,
  object_id text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  payload_json jsonb not null default '{}'::jsonb,
  primary key (scope_id, object_id)
);

create table if not exists public.ccc_sources (
  id text primary key,
  scope_id text,
  object_id text,
  type text,
  label text,
  url text,
  summary text,
  provider text,
  provider_mode text,
  raw_ref text,
  retrieved_at timestamptz,
  credibility text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  payload_json jsonb not null default '{}'::jsonb
);

create table if not exists public.ccc_baselines (
  id text primary key,
  scope_id text,
  object_id text not null,
  dimension text,
  title text,
  value text,
  created_from_card_id text,
  provider text,
  provider_mode text,
  created_at timestamptz not null default now(),
  payload_json jsonb not null default '{}'::jsonb
);

create table if not exists public.ccc_candidates (
  id text primary key,
  scope_id text not null,
  object_id text not null,
  reason text,
  tracked boolean not null default false,
  created_at timestamptz not null default now(),
  payload_json jsonb not null default '{}'::jsonb
);

create table if not exists public.ccc_runs (
  id text primary key,
  scope_id text not null,
  object_id text not null,
  status text not null,
  mode text,
  provider text,
  provider_mode text,
  started_at timestamptz,
  finished_at timestamptz,
  error_message text,
  created_at timestamptz not null default now(),
  payload_json jsonb not null default '{}'::jsonb
);

create table if not exists public.ccc_run_steps (
  id text primary key,
  run_id text not null,
  scope_id text not null,
  object_id text not null,
  step_key text,
  label text,
  status text,
  summary text,
  provider text,
  provider_mode text,
  started_at timestamptz,
  finished_at timestamptz,
  payload_json jsonb not null default '{}'::jsonb
);

create table if not exists public.ccc_trace_records (
  id text primary key,
  run_id text,
  scope_id text,
  object_id text,
  provider text not null,
  provider_mode text,
  tool_name text,
  input_summary text,
  output_summary text,
  status text,
  raw_ref text,
  trace_id text,
  latency_ms integer,
  created_at timestamptz not null default now(),
  payload_json jsonb not null default '{}'::jsonb
);

create table if not exists public.ccc_change_cards (
  id text primary key,
  run_id text,
  scope_id text not null,
  object_id text not null,
  dimension text,
  title text,
  before text,
  after text,
  confidence text,
  status text not null default 'pending',
  provider text,
  provider_mode text,
  raw_ref text,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  payload_json jsonb not null default '{}'::jsonb
);

create table if not exists public.ccc_change_card_sources (
  card_id text not null,
  source_id text not null,
  primary key (card_id, source_id)
);

create table if not exists public.ccc_user_actions (
  id text primary key,
  scope_id text not null,
  object_id text not null,
  card_id text,
  action_type text not null,
  note text,
  provider text,
  provider_mode text,
  created_at timestamptz not null default now(),
  payload_json jsonb not null default '{}'::jsonb
);

create table if not exists public.ccc_memory_records (
  id text primary key,
  scope_id text not null,
  object_id text not null,
  card_id text,
  action_id text,
  provider text,
  provider_mode text,
  status text,
  raw_ref text,
  summary text,
  latency_ms integer,
  error_code text,
  created_at timestamptz not null default now(),
  payload_json jsonb not null default '{}'::jsonb
);

create table if not exists public.ccc_sync_records (
  id text primary key,
  scope_id text not null,
  object_id text,
  run_id text,
  provider text,
  provider_mode text,
  status text,
  raw_ref text,
  summary text,
  latency_ms integer,
  error_code text,
  created_at timestamptz not null default now(),
  payload_json jsonb not null default '{}'::jsonb
);

create table if not exists public.ccc_assets (
  id text primary key,
  scope_id text not null,
  object_id text,
  type text not null,
  title text,
  status text,
  text text,
  image_url text,
  storage_bucket text,
  storage_path text,
  provider text,
  provider_mode text,
  raw_ref text,
  created_at timestamptz not null default now(),
  payload_json jsonb not null default '{}'::jsonb
);

create table if not exists public.ccc_qa_messages (
  id text primary key,
  scope_id text not null,
  role text not null,
  text text not null,
  provider text,
  provider_mode text,
  raw_ref text,
  created_at timestamptz not null default now(),
  payload_json jsonb not null default '{}'::jsonb
);

create table if not exists public.ccc_qa_excerpts (
  id text primary key,
  scope_id text not null,
  title text,
  text text,
  status text,
  provider text,
  provider_mode text,
  created_at timestamptz not null default now(),
  payload_json jsonb not null default '{}'::jsonb
);

create table if not exists public.sales_goals (
  id text primary key,
  name text not null,
  description text,
  keywords jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  payload_json jsonb not null default '{}'::jsonb
);

create table if not exists public.sales_companies (
  id text primary key,
  name text not null,
  initial text,
  industry text,
  location text,
  tags jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  payload_json jsonb not null default '{}'::jsonb
);

create table if not exists public.sales_target_enterprises (
  id text primary key,
  goal_id text not null,
  company_id text not null,
  status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  payload_json jsonb not null default '{}'::jsonb,
  unique(goal_id, company_id)
);

create table if not exists public.sales_company_search_results (
  id text primary key,
  goal_id text not null,
  company_id text not null,
  query text,
  reason text,
  created_at timestamptz not null default now(),
  payload_json jsonb not null default '{}'::jsonb
);

create table if not exists public.sales_progress_snapshots (
  id text primary key,
  company_id text not null,
  label text,
  summary text,
  evidence text,
  created_at timestamptz not null default now(),
  payload_json jsonb not null default '{}'::jsonb
);

create table if not exists public.sales_dossier_records (
  id text primary key,
  company_id text not null,
  title text,
  summary text,
  memory_summary text,
  created_at timestamptz not null default now(),
  payload_json jsonb not null default '{}'::jsonb
);

create table if not exists public.sales_dossier_citations (
  id text primary key,
  dossier_id text not null,
  citation_no text not null,
  label text,
  source_kind text,
  url text,
  created_at timestamptz not null default now(),
  payload_json jsonb not null default '{}'::jsonb
);

create table if not exists public.sales_materials (
  id text primary key,
  company_id text not null,
  title text not null,
  source_type text,
  source_url text,
  summary text,
  occurred_at timestamptz,
  openviking_uri text,
  openviking_status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  payload_json jsonb not null default '{}'::jsonb
);

create table if not exists public.sales_qa_messages (
  id text primary key,
  company_id text not null,
  session_id text,
  role text not null,
  text text not null,
  created_at timestamptz not null default now(),
  payload_json jsonb not null default '{}'::jsonb
);

create table if not exists public.sales_openviking_refs (
  id text primary key,
  company_id text,
  related_type text,
  related_id text,
  ref_kind text,
  uri text,
  summary text,
  created_at timestamptz not null default now(),
  payload_json jsonb not null default '{}'::jsonb
);

create index if not exists ccc_scope_objects_scope_idx on public.ccc_scope_objects(scope_id);
create index if not exists ccc_sources_object_idx on public.ccc_sources(scope_id, object_id);
create index if not exists ccc_baselines_object_idx on public.ccc_baselines(scope_id, object_id);
create index if not exists ccc_runs_scope_object_idx on public.ccc_runs(scope_id, object_id, created_at desc);
create index if not exists ccc_trace_records_run_idx on public.ccc_trace_records(run_id);
create index if not exists ccc_change_cards_run_idx on public.ccc_change_cards(run_id);
create index if not exists ccc_change_cards_scope_object_idx on public.ccc_change_cards(scope_id, object_id);
create index if not exists ccc_assets_scope_idx on public.ccc_assets(scope_id);
create index if not exists ccc_qa_messages_scope_idx on public.ccc_qa_messages(scope_id, created_at);
create index if not exists sales_target_enterprises_goal_idx on public.sales_target_enterprises(goal_id, updated_at desc);
create index if not exists sales_company_search_goal_idx on public.sales_company_search_results(goal_id, created_at desc);
create index if not exists sales_dossier_company_idx on public.sales_dossier_records(company_id, created_at desc);
create index if not exists sales_dossier_citations_idx on public.sales_dossier_citations(dossier_id);
create index if not exists sales_materials_company_idx on public.sales_materials(company_id, updated_at desc);
create index if not exists sales_qa_company_idx on public.sales_qa_messages(company_id, created_at);
create index if not exists sales_openviking_refs_company_idx on public.sales_openviking_refs(company_id, created_at desc);
`;
