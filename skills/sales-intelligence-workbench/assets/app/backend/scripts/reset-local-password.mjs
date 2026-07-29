import fs from "node:fs";

import { createEnvReader } from "../src/config/runtimeEnv.js";
import { createSupabaseDataProvider } from "../src/providers/supabaseDataProvider.js";
import { createAuthService } from "../src/security/authService.js";

const password = fs.readFileSync(0, "utf8").replace(/[\r\n]+$/, "");
if (!password) throw new Error("Password is required on stdin.");

const env = createEnvReader();
const dataProvider = createSupabaseDataProvider({ env });
const authService = createAuthService({ env, dataProvider });
const result = await authService.resetOwnerPassword(password);

console.log(JSON.stringify({
  ok: true,
  updated: result.updated,
  username: result.username,
}, null, 2));
