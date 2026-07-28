import assert from "node:assert/strict";
import test from "node:test";

import { ModelProvider } from "../src/providers/modelProvider.js";

function env(values = {}) {
  return {
    value(name, fallback = "") {
      return Object.hasOwn(values, name) ? values[name] : fallback;
    },
    number(name, fallback) {
      const parsed = Number(Object.hasOwn(values, name) ? values[name] : fallback);
      return Number.isFinite(parsed) ? parsed : fallback;
    },
  };
}

test("model timeout defaults to 90 seconds for structured generation", () => {
  const provider = new ModelProvider({ env: env() });
  assert.equal(provider.timeoutMs, 90_000);
});

test("model timeout is configurable and bounded", () => {
  assert.equal(new ModelProvider({ env: env({ MODEL_TIMEOUT_MS: "120000" }) }).timeoutMs, 120_000);
  assert.equal(new ModelProvider({ env: env({ MODEL_TIMEOUT_MS: "1000" }) }).timeoutMs, 5_000);
  assert.equal(new ModelProvider({ env: env({ MODEL_TIMEOUT_MS: "600000" }) }).timeoutMs, 300_000);
});

test("structured model calls use the Agent Plan Responses API and normalize usage", async () => {
  let captured;
  const provider = new ModelProvider({
    env: env({
      AGENT_PLAN_API_KEY: "test-agent-plan-key",
      MODEL_BASE_URL: "https://ark.example.test/api/plan/v3",
      MODEL_NAME: "ark-code-latest",
      MODEL_RUN_ENABLED: "true",
    }),
    fetchImpl: async (url, options) => {
      captured = { url, options, body: JSON.parse(options.body) };
      return new Response(JSON.stringify({
        id: "resp_test_1",
        model: "glm-test",
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: "{\"ok\":true,\"message\":\"ready\"}" }],
          },
        ],
        usage: {
          input_tokens: 24,
          output_tokens: 8,
          total_tokens: 32,
          output_tokens_details: { reasoning_tokens: 0 },
        },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  });

  const result = await provider.callJson({
    operation: "test",
    system: "Only JSON.",
    payload: { task: "probe" },
    maxTokens: 80,
  });

  assert.equal(captured.url, "https://ark.example.test/api/plan/v3/responses");
  assert.equal(captured.options.headers.Authorization, "Bearer test-agent-plan-key");
  assert.equal(captured.body.model, "ark-code-latest");
  assert.equal(captured.body.instructions, "Only JSON.");
  assert.equal(captured.body.input, JSON.stringify({ task: "probe" }));
  assert.equal(captured.body.max_output_tokens, 80);
  assert.deepEqual(captured.body.thinking, { type: "disabled" });
  assert.deepEqual(captured.body.text, { format: { type: "json_object" } });
  assert.equal(Object.hasOwn(captured.body, "messages"), false);
  assert.equal(Object.hasOwn(captured.body, "max_tokens"), false);
  assert.equal(result.ok, true);
  assert.deepEqual(result.parsed, { ok: true, message: "ready" });
  assert.deepEqual(result.usage, {
    prompt_tokens: 24,
    completion_tokens: 8,
    total_tokens: 32,
    reasoning_tokens: 0,
  });
});

test("structured model calls extract the first balanced JSON value from surrounding text", async () => {
  const provider = new ModelProvider({
    env: env({
      AGENT_PLAN_API_KEY: "test-agent-plan-key",
      MODEL_BASE_URL: "https://ark.example.test/api/plan/v3",
      MODEL_NAME: "ark-code-latest",
      MODEL_RUN_ENABLED: "true",
    }),
    fetchImpl: async () => new Response(JSON.stringify({
      id: "resp_balanced_json",
      output_text: [
        "以下是结果：",
        "```json",
        "{\"message\":\"正文中的 } 和 ] 不应提前结束\",\"items\":[1,2]}",
        "```",
        "以上为结构化结果。",
      ].join("\n"),
    }), { status: 200, headers: { "Content-Type": "application/json" } }),
  });

  const result = await provider.callJson({
    operation: "test",
    system: "Only JSON.",
    payload: { task: "probe" },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.parsed, {
    message: "正文中的 } 和 ] 不应提前结束",
    items: [1, 2],
  });
});

test("invalid structured output is retained only as bounded in-memory repair input", async () => {
  const malformed = `{"title":"档案","body":[{"text":"未闭合`;
  const provider = new ModelProvider({
    env: env({
      AGENT_PLAN_API_KEY: "test-agent-plan-key",
      MODEL_BASE_URL: "https://ark.example.test/api/plan/v3",
      MODEL_NAME: "ark-code-latest",
      MODEL_RUN_ENABLED: "true",
    }),
    fetchImpl: async () => new Response(JSON.stringify({
      id: "resp_invalid_json",
      output_text: malformed,
    }), { status: 200, headers: { "Content-Type": "application/json" } }),
  });

  const result = await provider.callJson({
    operation: "test",
    system: "Only JSON.",
    payload: { task: "probe" },
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "invalid_json");
  assert.equal(result.invalid_content, malformed);
  assert.equal(result.raw_ref, "model:resp_invalid_json");
});
