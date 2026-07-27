import path from "node:path";
import { paths, run } from "./lib.mjs";

process.stdout.write("将发起模型、DataPro、联网搜索、OpenViking 和 Supabase 的最小只读真实请求，可能产生少量 AFP/Token。\n");
const result = run(process.execPath, [path.join(paths.skillRoot, "scripts", "doctor.mjs"), "--live"], {
  allowFailure: true,
});
if (result.status !== 0) process.exitCode = result.status;
