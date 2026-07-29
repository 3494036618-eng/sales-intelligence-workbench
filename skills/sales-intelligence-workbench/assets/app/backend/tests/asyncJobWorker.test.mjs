import assert from "node:assert/strict";
import test from "node:test";

import { SalesService } from "../src/services/salesService.js";
import { JobWorker } from "../src/workers/jobWorker.js";

function envReader(values = {}) {
  return {
    value(name, fallback = "") {
      return Object.hasOwn(values, name) ? values[name] : fallback;
    },
  };
}

function salesState() {
  return {
    goals: [{ id: "goal-1", name: "测试目标", company_ids: ["company-1"] }],
    companies: {
      "company-1": {
        id: "company-1",
        name: "测试科技有限公司",
        dossier_ids: [],
        material_ids: [],
        qa_session_id: "sales-company-1",
      },
    },
    dossiers: {},
    materials: {},
    qa_messages: {},
    sync_sources: {},
    sync_checkpoints: {},
    jobs: {},
  };
}

const strictRuntimePolicy = Object.freeze({
  fail_closed: true,
});

const permissiveTestPolicy = Object.freeze({
  fail_closed: false,
});

test("enqueueing a dossier persists a queued job without reserving paid capacity", async () => {
  const calls = [];
  const repository = {
    async getSalesState() {
      return salesState();
    },
    async enqueueJob(job) {
      calls.push({ operation: "enqueue", job });
      return job;
    },
  };
  const paidWorkflowGuard = {
    async reserve() {
      calls.push({ operation: "reserve" });
      throw new Error("paid capacity must not be reserved while enqueueing");
    },
  };
  const service = new SalesService({
    env: envReader({ ASYNC_JOBS_ENABLED: "true", APP_WORKSPACE_ID: "workspace-test" }),
    runtimePolicy: strictRuntimePolicy,
    repository,
    paidWorkflowGuard,
  });

  await service.assertRuntimeReady();
  const job = await service.enqueueDossier("company-1", { idempotency_key: "request-1" }, {
    created_by: "11111111-1111-4111-8111-111111111111",
  });

  assert.equal(job.status, "queued");
  assert.equal(job.stage_label, "等待执行");
  assert.equal(job.progress, 0);
  assert.equal(calls.filter((call) => call.operation === "enqueue").length, 1);
  assert.equal(calls.filter((call) => call.operation === "reserve").length, 0);
  assert.equal(Object.hasOwn(job, "request"), false);
  assert.equal(Object.hasOwn(job, "created_by"), false);
  assert.equal(Object.hasOwn(job, "reservation_id"), false);
});

test("enqueueing reports a queue failure instead of returning a local-only queued job", async () => {
  const repository = {
    async getSalesState() {
      return salesState();
    },
    async enqueueJob() {
      throw new Error("rpc unavailable");
    },
  };
  const service = new SalesService({
    env: envReader({ ASYNC_JOBS_ENABLED: "true", APP_WORKSPACE_ID: "workspace-test" }),
    runtimePolicy: permissiveTestPolicy,
    repository,
  });

  await service.assertRuntimeReady();
  await assert.rejects(
    service.enqueueDossier("company-1"),
    (error) => error?.status === 503 && error?.code === "job_queue_unavailable",
  );
  assert.deepEqual(service.data.jobs, {});
});

test("API service can refresh dossier data written by a separate worker process", async () => {
  let persisted = salesState();
  let reads = 0;
  const repository = {
    async getSalesState() {
      reads += 1;
      return structuredClone(persisted);
    },
  };
  const service = new SalesService({
    env: envReader({ ASYNC_JOBS_ENABLED: "true", APP_WORKSPACE_ID: "workspace-test" }),
    runtimePolicy: strictRuntimePolicy,
    repository,
  });

  await service.assertRuntimeReady();
  assert.deepEqual(service.listDossiers("company-1"), []);

  persisted = salesState();
  persisted.companies["company-1"].dossier_ids = ["dossier-worker-1"];
  persisted.dossiers["dossier-worker-1"] = {
    id: "dossier-worker-1",
    company_id: "company-1",
    title: "测试科技有限公司企业档案",
    summary: "后台 Worker 已生成并持久化最新企业档案。",
    body: [{ text: "企业情况已更新。", citation_ids: ["source-1"] }],
    citations: [{ id: "source-1", label: "企业工商数据库", source_kind: "专业数据集", url: "" }],
    version_no: 1,
    change_status: "initial",
    data_as_of: "2026-07-24T00:00:00.000Z",
    generated_at: "2026-07-24T06:00:00.000Z",
    created_at: "2026-07-24T06:00:00.000Z",
  };

  await service.refreshPersistedState({ force: true });

  assert.equal(reads, 2);
  assert.equal(service.listDossiers("company-1")[0].id, "dossier-worker-1");
  assert.equal(service.dossierDetail("dossier-worker-1").version_no, 1);
});

test("worker claims one job, reports progress and executes it once", async () => {
  const calls = [];
  let claimed = false;
  let current = null;
  const repository = {
    async claimNextJob(workerId, jobTypes, leaseSeconds) {
      calls.push({ operation: "claim", workerId, jobTypes, leaseSeconds });
      if (claimed) return null;
      claimed = true;
      current = {
        id: "job-1",
        job_type: "sales_dossier_generation",
        entity_id: "company-1",
        status: "running",
        stage: "starting",
        progress: 1,
        worker_id: workerId,
      };
      return current;
    },
    async heartbeatJob(jobId, workerId, stage, progress) {
      calls.push({ operation: "heartbeat", jobId, workerId, stage, progress });
      current = { ...current, stage, progress };
      return current;
    },
    async getJob() {
      return current;
    },
    async releaseJobClaim() {
      calls.push({ operation: "release" });
    },
  };
  const salesService = {
    async assertRuntimeReady() {},
    async executeQueuedJob(job, options) {
      calls.push({ operation: "execute", job });
      await options.report_progress("generating_dossier", 70);
      current = { ...current, status: "succeeded", stage: "succeeded", progress: 100 };
      return { action: "created" };
    },
  };
  const worker = new JobWorker({
    repository,
    salesService,
    env: envReader({ JOB_WORKER_POLL_MS: "100", JOB_WORKER_LEASE_SECONDS: "600" }),
    workerId: "worker-test",
    logger: { info() {}, error() {} },
  });

  await worker.assertReady();
  const result = await worker.runOnce();

  assert.equal(result.status, "succeeded");
  assert.equal(calls.filter((call) => call.operation === "execute").length, 1);
  assert.ok(calls.some((call) => call.operation === "heartbeat" && call.stage === "generating_dossier"));
  assert.equal(calls.some((call) => call.operation === "release"), false);
});

test("worker requeues an unreserved task after a retryable claim failure", async () => {
  const calls = [];
  const job = {
    id: "job-retry",
    job_type: "sales_dossier_generation",
    entity_id: "company-1",
    status: "running",
    stage: "starting",
    progress: 1,
    worker_id: "worker-test",
  };
  const repository = {
    async claimNextJob() {
      return job;
    },
    async heartbeatJob(jobId, workerId, stage, progress) {
      return { ...job, id: jobId, worker_id: workerId, stage, progress };
    },
    async getJob() {
      return job;
    },
    async releaseJobClaim(jobId, workerId, error, options) {
      calls.push({ jobId, workerId, error, options });
      return { ...job, status: "queued" };
    },
  };
  const salesService = {
    async assertRuntimeReady() {},
    async executeQueuedJob() {
      const error = new Error("capacity reached");
      error.code = "paid_workflow_concurrency_exceeded";
      throw error;
    },
  };
  const worker = new JobWorker({
    repository,
    salesService,
    env: envReader(),
    workerId: "worker-test",
    logger: { info() {}, error() {} },
  });

  const result = await worker.runOnce();
  assert.equal(result.status, "queued");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.retry, true);
  assert.equal(calls[0].options.delay_seconds, 30);
});

test("running cancellation keeps the lease until the worker reaches a safe checkpoint", async () => {
  const calls = [];
  let current = {
    id: "job-cancel",
    job_type: "sales_dossier_generation",
    entity_id: "company-1",
    status: "running",
    stage: "generating_dossier",
    progress: 70,
    worker_id: "worker-test",
    is_paid: true,
    reservation_id: "reservation-test",
  };
  const initial = salesState();
  initial.jobs[current.id] = current;
  const repository = {
    async getSalesState() {
      return initial;
    },
    async getJob() {
      return current;
    },
    async requestJobCancellation() {
      calls.push("request");
      current = {
        ...current,
        stage: "cancelling",
        cancel_requested_at: "2026-07-23T12:00:00.000Z",
      };
      return current;
    },
    async acknowledgeJobCancellation(jobId, workerId) {
      calls.push({ operation: "acknowledge", jobId, workerId });
      current = {
        ...current,
        status: "cancelled",
        stage: "cancelled",
        worker_id: null,
        lease_expires_at: null,
      };
      return current;
    },
  };
  const service = new SalesService({
    env: envReader({ ASYNC_JOBS_ENABLED: "true", APP_WORKSPACE_ID: "workspace-test" }),
    runtimePolicy: strictRuntimePolicy,
    repository,
  });

  await service.assertRuntimeReady();
  const requested = await service.cancelJob(current.id);
  assert.equal(requested.status, "running");
  assert.equal(requested.stage, "cancelling");
  assert.equal(requested.worker_id, "worker-test");

  await assert.rejects(
    () => service.assertJobActive(current.id),
    (error) => error.code === "job_cancelled",
  );
  assert.equal(current.status, "cancelled");
  assert.deepEqual(calls, [
    "request",
    { operation: "acknowledge", jobId: "job-cancel", workerId: "worker-test" },
  ]);
});
