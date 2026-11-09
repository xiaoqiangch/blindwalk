/**
 * 测试聚合入口。
 *
 * Node 23.11 的 `node --test <目录>` 会把目录当成模块入口来解析（旧版本会自动发现
 * 目录下的测试文件）。这里用 tests/package.json 的 `main: index.mjs` 承接目录入口，
 * 并显式 import 同目录下所有 *.test.mjs。
 *
 * 效果：`node --test account/tests/` 与 `node --test account/tests/*.test.mjs` 都能跑。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const files = fs
  .readdirSync(here)
  .filter((name) => name.endsWith('.test.mjs'))
  .sort();

for (const file of files) {
  await import(pathToFileURL(path.join(here, file)).href);
}
