import assert from "node:assert/strict";
import test from "node:test";
import { DataProProvider } from "../src/providers/dataProProvider.js";
import { ModelProvider } from "../src/providers/modelProvider.js";
import { OpenVikingProvider } from "../src/providers/openVikingProvider.js";
import { VisionProvider } from "../src/providers/visionProvider.js";
import { WebSearchProvider } from "../src/providers/webSearchProvider.js";

function envReader(values = {}) {
  return {
    value(name, fallback = "") {
      return Object.hasOwn(values, name) ? values[name] : fallback;
    },
    number(name, fallback = 0) {
      const value = Number(Object.hasOwn(values, name) ? values[name] : fallback);
      return Number.isFinite(value) ? value : fallback;
    },
  };
}

test("one Agent Plan key configures every plan-backed provider", () => {
  const env = envReader({
    AGENT_PLAN_API_KEY: "shared-agent-plan-key",
    OPENVIKING_BASE_URL: "https://openviking.example.test",
    OPENVIKING_CLI: "/definitely/not/an/openviking-cli",
  });

  assert.equal(new ModelProvider({ env }).apiKey, "shared-agent-plan-key");
  assert.equal(new DataProProvider({ env }).apiKey, "shared-agent-plan-key");
  assert.equal(new WebSearchProvider({ env }).apiKey, "shared-agent-plan-key");
  assert.equal(new OpenVikingProvider({ env }).apiKey, "shared-agent-plan-key");
  assert.equal(new OpenVikingProvider({ env }).isConfigured(), true);
  assert.equal(new VisionProvider({ env }).apiKey, "shared-agent-plan-key");
});

test("capability-specific keys remain optional overrides", () => {
  const env = envReader({
    AGENT_PLAN_API_KEY: "shared-agent-plan-key",
    MODEL_API_KEY: "model-override",
    DATAPRO_API_KEY: "datapro-override",
    WEB_SEARCH_API_KEY: "search-override",
    OPENVIKING_API_KEY: "openviking-override",
    VISION_API_KEY: "vision-override",
  });

  assert.equal(new ModelProvider({ env }).apiKey, "model-override");
  assert.equal(new DataProProvider({ env }).apiKey, "datapro-override");
  assert.equal(new WebSearchProvider({ env }).apiKey, "search-override");
  assert.equal(new OpenVikingProvider({ env }).apiKey, "openviking-override");
  assert.equal(new VisionProvider({ env }).apiKey, "vision-override");
});

test("OpenViking does not report a missing CLI command as configured", () => {
  const provider = new OpenVikingProvider({
    env: envReader({ OPENVIKING_CLI: "/definitely/not/an/openviking-cli" }),
    cliConfig: {},
  });

  assert.equal(provider.isConfigured(), false);
});
