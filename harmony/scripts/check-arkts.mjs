#!/usr/bin/env node
/**
 * 盲走 BlindWalk · HarmonyOS ArkTS 静态自检
 *
 * 本机没有 DevEco Studio / hvigor / ohpm，无法编译 .hap；这个脚本做的是
 * 「离线能验证的部分」，尽量把装 DevEco 后才暴露的低级错误提前拦掉：
 *
 *   1. 所有 .ets 里 import 的**相对路径**都存在（@kit.* / @ohos.* 等外部模块跳过）
 *   2. 没有 `any` 类型标注、没有 `console.log` 残留
 *   3. 每个 ForEach 都有第三个参数（keyGenerator）
 *   4. 带 @Entry 的 pages 都在 main_pages.json 里注册（且注册的页面文件存在）
 *   5. $string: / $color: / $media: / $profile: 引用的资源都存在
 *   6. 产品保密规则：JourneyView 不出现 currentPlace.name
 *   7. 工程契约：core/store.ts 导出 initStore / getStore
 *   8. 功能对齐：parity.md 的关键常量/入口存在（三档/硬帽/失败文案/迷雾参数）
 *   9. 反虚构兜底：真实模式下不得调用 startQuest()（内置地点抽盒）
 *
 * 用法：node harmony/scripts/check-arkts.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HARMONY = path.resolve(HERE, '..');
const ETS_ROOT = path.join(HARMONY, 'entry', 'src', 'main', 'ets');
const ENTRY_MAIN = path.join(HARMONY, 'entry', 'src', 'main');
const RES_BASE = path.join(ENTRY_MAIN, 'resources', 'base');
const RES_ZH = path.join(ENTRY_MAIN, 'resources', 'zh_CN');
const APP_SCOPE = path.join(HARMONY, 'AppScope');
const MAIN_PAGES = path.join(RES_BASE, 'profile', 'main_pages.json');

const failures = [];
const passes = [];

function rel(file) {
  return path.relative(HARMONY, file);
}

function fail(section, message) {
  failures.push({ section, message });
}

function pass(section, message) {
  passes.push({ section, message });
}

function walkFiles(dir, predicate) {
  const result = [];
  if (!fs.existsSync(dir)) return result;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...walkFiles(full, predicate));
    } else if (!predicate || predicate(full)) {
      result.push(full);
    }
  }
  return result;
}

const etsFiles = walkFiles(ETS_ROOT, (file) => file.endsWith('.ets')).sort();
const sourceText = new Map();
for (const file of etsFiles) {
  sourceText.set(file, fs.readFileSync(file, 'utf8'));
}

// ============================================================
// 1) 相对 import 路径存在
// ============================================================

function resolveImport(fromFile, spec) {
  const base = path.resolve(path.dirname(fromFile), spec);
  const candidates = [
    base,
    `${base}.ets`,
    `${base}.ts`,
    `${base}.d.ets`,
    `${base}.d.ts`,
    path.join(base, 'index.ets'),
    path.join(base, 'index.ts'),
    `${base}.json`
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return undefined;
}

function checkImports() {
  const externalPrefixes = ['@kit.', '@ohos.', '@huawei.', 'node:', 'fs', 'path'];
  let checked = 0;
  for (const file of etsFiles) {
    const text = sourceText.get(file);
    const importRe = /import\s+(?:type\s+)?[\s\S]*?from\s*['"]([^'"]+)['"]/g;
    const sideEffectRe = /import\s*['"]([^'"]+)['"]/g;
    const specs = new Set();
    let match;
    while ((match = importRe.exec(text)) !== null) specs.add(match[1]);
    while ((match = sideEffectRe.exec(text)) !== null) specs.add(match[1]);

    for (const spec of specs) {
      if (externalPrefixes.some((prefix) => spec === prefix || spec.startsWith(prefix))) continue;
      if (!spec.startsWith('.')) {
        fail('import 路径', `${rel(file)} → 非相对路径 import '${spec}'（ArkTS 页面/组件应使用相对路径）`);
        continue;
      }
      checked += 1;
      if (resolveImport(file, spec) === undefined) {
        fail('import 路径', `${rel(file)} → '${spec}' 解析失败（文件不存在）`);
      }
    }
  }
  pass('import 路径', `${etsFiles.length} 个 .ets，检查 ${checked} 条相对 import`);
}

// ============================================================
// 2) 禁止 any / console.log
// ============================================================

function checkStrictSyntax() {
  let anyCount = 0;
  let consoleCount = 0;
  const anyPatterns = [/:\s*any\b/, /<\s*any\s*>/, /\bas\s+any\b/, /\bany\s*\[\s*\]/];
  for (const file of etsFiles) {
    const lines = sourceText.get(file).split('\n');
    lines.forEach((line, index) => {
      for (const pattern of anyPatterns) {
        if (pattern.test(line)) {
          anyCount += 1;
          fail('ArkTS 严格模式', `${rel(file)}:${index + 1} 出现 any → ${line.trim()}`);
        }
      }
      if (/console\.log\s*\(/.test(line)) {
        consoleCount += 1;
        fail('ArkTS 严格模式', `${rel(file)}:${index + 1} 残留 console.log`);
      }
    });
  }
  if (anyCount === 0) pass('ArkTS 严格模式', '没有 any 类型标注');
  if (consoleCount === 0) pass('ArkTS 严格模式', '没有 console.log 残留');
}

// ============================================================
// 3) ForEach 必须带 keyGenerator
// ============================================================

function checkForEach() {
  let total = 0;
  for (const file of etsFiles) {
    const text = sourceText.get(file);
    const re = /ForEach\s*\(/g;
    let match;
    while ((match = re.exec(text)) !== null) {
      total += 1;
      const open = match.index + match[0].length - 1;
      let depth = 0;
      let brace = 0;
      let bracket = 0;
      let commas = 0;
      let close = -1;
      for (let i = open; i < text.length; i += 1) {
        const ch = text[i];
        if (ch === '(') depth += 1;
        else if (ch === ')') {
          depth -= 1;
          if (depth === 0) {
            close = i;
            break;
          }
        } else if (ch === '{') brace += 1;
        else if (ch === '}') brace -= 1;
        else if (ch === '[') bracket += 1;
        else if (ch === ']') bracket -= 1;
        else if (ch === ',' && depth === 1 && brace === 0 && bracket === 0) commas += 1;
      }
      const line = text.slice(0, match.index).split('\n').length;
      if (close < 0) {
        fail('ForEach key', `${rel(file)}:${line} ForEach 括号未闭合`);
      } else if (commas < 2) {
        fail('ForEach key', `${rel(file)}:${line} ForEach 缺少第三个参数（keyGenerator）`);
      }
    }
  }
  pass('ForEach key', `检查 ${total} 个 ForEach，全部带 keyGenerator`);
}

// ============================================================
// 4) @Entry page 在 main_pages.json 注册
// ============================================================

function checkEntryPages() {
  const pagesDir = path.join(ETS_ROOT, 'pages');
  const pageFiles = walkFiles(pagesDir, (file) => file.endsWith('.ets'));
  const entryPages = [];
  for (const file of pageFiles) {
    if (/@Entry\b/.test(sourceText.get(file) || fs.readFileSync(file, 'utf8'))) {
      entryPages.push(`pages/${path.basename(file, '.ets')}`);
    }
  }
  let registered = [];
  if (!fs.existsSync(MAIN_PAGES)) {
    fail('@Entry 注册', '缺少 resources/base/profile/main_pages.json');
  } else {
    try {
      const json = JSON.parse(fs.readFileSync(MAIN_PAGES, 'utf8'));
      registered = Array.isArray(json.src) ? json.src : [];
    } catch (error) {
      fail('@Entry 注册', `main_pages.json 不是合法 JSON：${error.message}`);
    }
  }
  for (const page of entryPages) {
    if (!registered.includes(page)) {
      fail('@Entry 注册', `${page} 带 @Entry 但未在 main_pages.json 注册`);
    }
  }
  for (const page of registered) {
    const pageFile = path.join(ETS_ROOT, `${page}.ets`);
    if (!fs.existsSync(pageFile)) {
      fail('@Entry 注册', `main_pages.json 注册了 ${page}，但 ${rel(pageFile)} 不存在`);
    }
  }
  if (entryPages.length === 0) fail('@Entry 注册', 'pages/ 下没有任何 @Entry 页面');
  pass('@Entry 注册', `${entryPages.length} 个 @Entry 页面，main_pages.json 共 ${registered.length} 条`);
}

// ============================================================
// 5) 资源引用存在
// ============================================================

function readResourceNames(file, section) {
  if (!fs.existsSync(file)) return [];
  try {
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    const list = json[section];
    if (!Array.isArray(list)) return [];
    return list.map((item) => item.name).filter((name) => typeof name === 'string');
  } catch (error) {
    fail('资源引用', `${rel(file)} 解析失败：${error.message}`);
    return [];
  }
}

function mediaNames(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => !name.startsWith('.'))
    .map((name) => name.replace(/\.[^.]+$/, ''));
}

function profileNames() {
  return walkFiles(path.join(RES_BASE, 'profile'), (file) => file.endsWith('.json'))
    .map((file) => path.basename(file, '.json'));
}

function checkResources() {
  const strings = new Set([
    ...readResourceNames(path.join(RES_BASE, 'element', 'string.json'), 'string'),
    ...readResourceNames(path.join(RES_ZH, 'element', 'string.json'), 'string'),
    ...readResourceNames(path.join(APP_SCOPE, 'resources', 'base', 'element', 'string.json'), 'string')
  ]);
  const colors = new Set([
    ...readResourceNames(path.join(RES_BASE, 'element', 'color.json'), 'color'),
    ...readResourceNames(path.join(RES_ZH, 'element', 'color.json'), 'color'),
    ...readResourceNames(path.join(APP_SCOPE, 'resources', 'base', 'element', 'color.json'), 'color')
  ]);
  const medias = new Set([
    ...mediaNames(path.join(RES_BASE, 'media')),
    ...mediaNames(path.join(APP_SCOPE, 'resources', 'base', 'media'))
  ]);
  const profiles = new Set(profileNames());

  const filesToScan = [
    ...etsFiles,
    ...walkFiles(ENTRY_MAIN, (file) => file.endsWith('.json5')),
    ...walkFiles(APP_SCOPE, (file) => file.endsWith('.json5'))
  ];
  const refPatterns = [
    { kind: 'string', set: strings, re: /\$string:([A-Za-z0-9_]+)/g },
    { kind: 'color', set: colors, re: /\$color:([A-Za-z0-9_]+)/g },
    { kind: 'media', set: medias, re: /\$media:([A-Za-z0-9_]+)/g },
    { kind: 'profile', set: profiles, re: /\$profile:([A-Za-z0-9_]+)/g },
    { kind: 'string', set: strings, re: /\$r\(\s*['"]app\.string\.([A-Za-z0-9_]+)['"]\s*\)/g },
    { kind: 'color', set: colors, re: /\$r\(\s*['"]app\.color\.([A-Za-z0-9_]+)['"]\s*\)/g },
    { kind: 'media', set: medias, re: /\$r\(\s*['"]app\.media\.([A-Za-z0-9_]+)['"]\s*\)/g },
    { kind: 'profile', set: profiles, re: /\$r\(\s*['"]app\.profile\.([A-Za-z0-9_]+)['"]\s*\)/g }
  ];

  let refCount = 0;
  for (const file of filesToScan) {
    const text = fs.readFileSync(file, 'utf8');
    for (const pattern of refPatterns) {
      pattern.re.lastIndex = 0;
      let match;
      while ((match = pattern.re.exec(text)) !== null) {
        refCount += 1;
        const name = match[1];
        if (!pattern.set.has(name)) {
          fail('资源引用', `${rel(file)} 引用了不存在的 $${pattern.kind}:${name}`);
        }
      }
    }
  }
  pass('资源引用', `检查 ${refCount} 处资源引用（string ${strings.size} / color ${colors.size} / media ${medias.size} / profile ${profiles.size}）`);
}

// ============================================================
// 6) 保密规则：JourneyView 不出现目的地名称
// ============================================================

function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function checkSecretRule() {
  const journeyFile = path.join(ETS_ROOT, 'views', 'JourneyView.ets');
  if (!fs.existsSync(journeyFile)) {
    fail('保密规则', '缺少 views/JourneyView.ets');
    return;
  }
  const rawText = sourceText.get(journeyFile) || fs.readFileSync(journeyFile, 'utf8');
  const text = stripComments(rawText);
  const forbidden = [
    /currentPlace\s*\.\s*name/,
    /currentPlace\s*\?\.\s*name/,
    /\.currentPlace\s*\)\s*\.\s*name/,
    /place\s*\(\s*\)\s*\.\s*name/
  ];
  for (const pattern of forbidden) {
    if (pattern.test(text)) {
      fail('保密规则', `JourneyView.ets 出现目的地名称引用（${pattern}），到达前不得展示 name`);
    }
  }
  if (!text.includes('目的地保密中')) {
    fail('保密规则', 'JourneyView.ets 缺少「目的地保密中」文案');
  }
  pass('保密规则', 'JourneyView 无 currentPlace.name；保留「目的地保密中」文案');
}

// ============================================================
// 7) 工程契约：core/store.ts 导出 initStore / getStore
// ============================================================

function checkStoreContract() {
  const storeFile = path.join(ETS_ROOT, 'core', 'store.ts');
  if (!fs.existsSync(storeFile)) {
    fail('工程契约', '缺少 core/store.ts（逻辑层）');
    return;
  }
  const text = fs.readFileSync(storeFile, 'utf8');
  if (!/export\s+async\s+function\s+initStore\s*\(/.test(text) && !/export\s+function\s+initStore\s*\(/.test(text)) {
    fail('工程契约', 'core/store.ts 未导出 initStore()');
  }
  if (!/export\s+function\s+getStore\s*\(\s*\)/.test(text)) {
    fail('工程契约', 'core/store.ts 未导出 getStore()');
  }
  if (text.includes('export interface BlindWalkStoreApi') === false) {
    // 接口在 contract.ts，这里只做存在性提示
  }
  pass('工程契约', 'core/store.ts 导出 initStore() / getStore()');
}

// ============================================================
// 8) 功能对齐：parity.md 关键常量 / 入口存在
// ============================================================

function readCoreFile(name) {
  return path.join(ETS_ROOT, 'core', name);
}

function coreText(name) {
  const file = readCoreFile(name);
  if (!fs.existsSync(file)) return '';
  return fs.readFileSync(file, 'utf8');
}

function expectIn(section, file, text, needles) {
  let missing = 0;
  for (const needle of needles) {
    if (!text.includes(needle)) {
      fail(section, `${file} 缺少 ${needle}`);
      missing += 1;
    }
  }
  return missing;
}

function checkParity() {
  const parity = coreText('parity.ts');
  if (parity.length === 0) {
    fail('功能对齐', '缺少 core/parity.ts（parity.md §2 的唯一实现）');
    return;
  }
  let missing = expectIn('功能对齐', 'core/parity.ts', parity, [
    'LANDMARK_KEYWORDS',
    'POI_NEVER_WORDS',
    'POI_SOFT_BAD_WORDS',
    'HARD_MAX_METERS',
    'HARD_MAX_SCALE',
    'DEDUPE_METERS',
    'PER_CATEGORY_LIMIT',
    'tierParams',
    'pickCandidate',
    'trimDiverse',
    'SEARCH_FAIL_TITLE'
  ]);
  if (missing === 0) pass('功能对齐', 'core/parity.ts 含三档/硬帽/黑名单/去重/多样性/失败文案');

  const fog = coreText('fog.ts');
  if (fog.length === 0) {
    fail('功能对齐', '缺少 core/fog.ts（parity.md §3 的迷雾路径）');
    return;
  }
  const fogMissing = expectIn('功能对齐', 'core/fog.ts', fog, [
    'FOG_AHEAD_MAX: number = 260',
    'FOG_BEHIND_MAX: number = 140',
    'FOG_FADE_METERS: number = 46',
    '#C9A98A',
    '#E89B4C',
    'CHEVRON_SPACING_METERS: number = 55',
    'OFF_ROUTE_THRESHOLD_METERS: number = 18',
    'FOG_HIDE_REMAINING_METERS: number = 60',
    'NEARBY_COPY'
  ]);

  const providers = coreText('providers.ts');
  if (providers.length === 0) {
    fail('功能对齐', '缺少 core/providers.ts（多数据源）');
  } else {
    expectIn('功能对齐', 'core/providers.ts', providers, [
      'restapi.amap.com/v3/place/around',
      'api.map.baidu.com/place/v2/search',
      'overpass',
      'zh.wikipedia.org',
      'wgs84ToGcj02',
      'bd09ToWgs84',
      'AMAP_PAGE_SIZE: number = 25',
      'AMAP_MAX_PAGES: number = 3',
      'BAIDU_PAGE_SIZE: number = 20'
    ]);
  }

  const mapkeys = coreText('mapkeys.ts');
  if (mapkeys.length === 0) {
    fail('功能对齐', '缺少 core/mapkeys.ts（Key 下发）');
  } else {
    expectIn('功能对齐', 'core/mapkeys.ts', mapkeys, [
      'xiaoqiangch.github.io/blindwalk/mapkeys.json',
      '/api/public/mapkeys',
      'MAPKEYS_CACHE_TTL_MS'
    ]);
    if (mapkeys.includes('demo-key-1234')) {
      fail('功能对齐', 'core/mapkeys.ts 里写死了真实 Key（必须由后台下发）');
    }
  }

  const account = coreText('account.ts');
  if (account.length === 0) {
    fail('功能对齐', '缺少 core/account.ts（账号）');
  } else {
    expectIn('功能对齐', 'core/account.ts', account, [
      'http://127.0.0.1:8803',
      '/api/auth/register',
      '/api/auth/login',
      '/api/auth/logout',
      '/api/auth/me',
      '/api/me/profile',
      '/api/me',
      'extractCookie'
    ]);
  }

  if (fogMissing === 0) pass('功能对齐', 'core/fog.ts 含前后可见/渐隐/线色/箭头/离路/隐藏常量');
  pass('功能对齐', 'core/providers.ts / core/mapkeys.ts / core/account.ts 契约齐全');
}

// ============================================================
// 9) 反虚构兜底：真实模式不得调用 startQuest()
// ============================================================

function checkNoFakeFallback() {
  const setupFile = path.join(ETS_ROOT, 'views', 'SetupSheet.ets');
  if (!fs.existsSync(setupFile)) {
    fail('反虚构兜底', '缺少 views/SetupSheet.ets');
    return;
  }
  const rawText = fs.readFileSync(setupFile, 'utf8');
  const text = stripComments(rawText);

  // startQuest() 只允许出现在「显式演示模式」函数里（函数名 startDemoExplicitly）
  const callPattern = /startQuest\s*\(/g;
  const matches = [];
  let match;
  while ((match = callPattern.exec(text)) !== null) {
    matches.push(match.index);
  }
  if (matches.length === 0) {
    fail('反虚构兜底', 'SetupSheet.ets 没有 startQuest 调用？演示入口应保留');
    return;
  }
  for (const index of matches) {
    const before = text.slice(Math.max(0, index - 700), index);
    if (!before.includes('startDemoExplicitly')) {
      fail('反虚构兜底',
        'SetupSheet.ets 在非演示入口调用了 startQuest()（内置地点抽盒），违反 parity.md §2「绝不虚构兜底」');
    }
  }

  // 真实入口必须存在
  if (!text.includes('startQuestWithPlace')) {
    fail('反虚构兜底', 'SetupSheet.ets 没有调用 startQuestWithPlace()（真实模式必须用它）');
  }
  if (!text.includes('prepareQuest')) {
    fail('反虚构兜底', 'SetupSheet.ets 没有调用 prepareQuest()（三档真实搜索入口）');
  }
  if (!text.includes('BwSearchFailedPanel')) {
    fail('反虚构兜底', 'SetupSheet.ets 没有失败面板（找不到真实地点必须明确告知）');
  }
  if (!text.includes('BwLocationBlockedPanel')) {
    fail('反虚构兜底', 'SetupSheet.ets 没有定位受阻面板');
  }
  pass('反虚构兜底', '真实模式只走 startQuestWithPlace；startQuest() 仅限显式演示');
}

// ============================================================
// 输出
// ============================================================

const sections = [
  ['import 路径', checkImports],
  ['ArkTS 严格模式', checkStrictSyntax],
  ['ForEach key', checkForEach],
  ['@Entry 注册', checkEntryPages],
  ['资源引用', checkResources],
  ['保密规则', checkSecretRule],
  ['工程契约', checkStoreContract],
  ['功能对齐', checkParity],
  ['反虚构兜底', checkNoFakeFallback]
];

console.log('═══ 盲走 BlindWalk · HarmonyOS ArkTS 静态自检 ═══');
console.log(`工程：${HARMONY}`);
console.log(`扫描 ${etsFiles.length} 个 .ets 文件\n`);

for (const [name, run] of sections) {
  const before = failures.length;
  try {
    run();
  } catch (error) {
    fail(name, `检查器异常：${error.stack || error.message}`);
  }
  const newFailures = failures.slice(before);
  if (newFailures.length === 0) {
    console.log(`✅ ${name}`);
  } else {
    console.log(`❌ ${name}（${newFailures.length} 个问题）`);
    for (const item of newFailures) {
      console.log(`   · ${item.message}`);
    }
  }
}

console.log('');
const sectionPasses = new Map();
for (const item of passes) {
  sectionPasses.set(item.section, (sectionPasses.get(item.section) || 0) + 1);
}
for (const [section, detail] of sectionPasses) {
  console.log(`   ${section}：${detail}`);
}

console.log('');
if (failures.length === 0) {
  console.log(`✅ 全部通过：${etsFiles.length} 个 .ets 文件，0 error（.hap 编译仍需 DevEco Studio）`);
  process.exit(0);
} else {
  console.log(`❌ 静态检查失败：${failures.length} 个问题`);
  process.exit(1);
}
