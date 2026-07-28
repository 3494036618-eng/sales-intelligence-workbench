import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseRepository } from "../src/repositories/supabaseRepository.js";

test("Supabase repository does not seed demo business data when seeding is disabled", () => {
  const calls = [];
  const repository = new SupabaseRepository({
    seedOnEmpty: false,
    workspaceId: "54768bef-53aa-47d0-a9e3-bbca4593cf58",
    supabaseProvider: {
      executeSqlSync(sql) {
        calls.push(sql);
        if (/schema_migrations/i.test(sql)) return { ok: true, rows: [{ version: "202607280002" }] };
        if (/app_workspaces/i.test(sql)) return { ok: true, rows: [{ id: "54768bef-53aa-47d0-a9e3-bbca4593cf58" }] };
        return { ok: true, rows: [] };
      },
    },
  });

  repository.ensureSalesReady({
    goals: [{ id: "demo-goal", name: "Demo" }],
    companies: { demo: { id: "demo", name: "Demo Company" } },
  });

  assert.equal(calls.length, 2);
  assert.ok(calls.every((sql) => /^select/i.test(sql.trim())));
  assert.ok(calls.every((sql) => !/insert into public\.sales_/i.test(sql)));
});
