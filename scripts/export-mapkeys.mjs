#!/usr/bin/env node
// 从后台 SQLite 读出地图 Key，输出 mapkeys.json 结构（给 PWA 用）。
// 用法：node scripts/export-mapkeys.mjs [db路径] > mapkeys.json
// 注意：输出内容是明文 Key，只应写进 gh-pages 快照，绝不要提交主仓。
import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";

const dbPath = process.argv[2] || "admin/data/walkaholic.db";
if (!existsSync(dbPath)) {
  process.stderr.write(`[export-mapkeys] 找不到 ${dbPath}\n`);
  process.exit(2);
}

let rows = [];
try {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  rows = db.prepare("SELECT key, value, updated_at FROM app_keys").all();
  db.close();
} catch (err) {
  process.stderr.write(`[export-mapkeys] 读取失败：${err.message}\n`);
  process.exit(3);
}

const keys = { amap: "", baidu: "" };
let version = 0;
for (const r of rows) {
  if (r.key === "amap" || r.key === "baidu") {
    keys[r.key] = r.value || "";
    version = Math.max(version, Number(r.updated_at) || 0);
  }
}

process.stdout.write(JSON.stringify({ keys, version: String(version || 0) }, null, 2) + "\n");
