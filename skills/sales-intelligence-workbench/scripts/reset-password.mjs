import path from "node:path";

import {
  assertInstalledApp,
  paths,
  run,
  runtimeEnvironment,
} from "./lib.mjs";

async function promptSecret(label) {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
    throw new Error("当前终端不支持隐藏输入；请在交互式终端运行本命令。");
  }
  return new Promise((resolve, reject) => {
    let value = "";
    const cleanup = () => {
      process.stdin.off("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
    };
    const onData = (chunk) => {
      for (const character of String(chunk)) {
        if (character === "\u0003") {
          cleanup();
          reject(new Error("已取消密码重置。"));
          return;
        }
        if (character === "\r" || character === "\n") {
          cleanup();
          resolve(value);
          return;
        }
        if (character === "\u007f" || character === "\b") {
          if (value) {
            value = [...value].slice(0, -1).join("");
            process.stdout.write("\b \b");
          }
          continue;
        }
        if (character >= " ") {
          value += character;
          process.stdout.write("*");
        }
      }
    };
    process.stdout.write(label);
    process.stdin.setEncoding("utf8");
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", onData);
  });
}

assertInstalledApp();
const password = await promptSecret("设置新密码：");
const confirmation = await promptSecret("再次输入新密码：");
if (password !== confirmation) throw new Error("两次输入的密码不一致。");
if (password.length < 10 || password.length > 256) {
  throw new Error("密码长度需要为 10 至 256 个字符。");
}

run(process.execPath, [
  path.join(paths.installedApp, "backend", "scripts", "reset-local-password.mjs"),
], {
  cwd: path.join(paths.installedApp, "backend"),
  env: runtimeEnvironment(),
  stdio: ["pipe", "inherit", "inherit"],
  input: `${password}\n`,
});

process.stdout.write("本机管理员密码已更新，请使用用户名和新密码登录。\n");
