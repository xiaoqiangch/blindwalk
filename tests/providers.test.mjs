import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

// 纯解析 / 纯函数测试：不依赖网络、不需要浏览器。
// providers.js 是 ES5 IIFE，挂 window.BW_PROVIDERS；这里用 vm 造一个最小浏览器沙箱。

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(path.join(HERE, '..', 'providers.js'), 'utf8');

/**
 * 每个测试拿一个全新的 providers 实例（互不影响 Key / 报告状态）。
 * @param {{storage?: Object<string,string>, withDocument?: boolean}} options
 */
function loadProviders(options = {}) {
  const storage = new Map();
  if (options.storage) {
    Object.keys(options.storage).forEach((key) => storage.set(key, options.storage[key]));
  }

  const localStorage = {
    getItem(key) {
      return storage.has(key) ? storage.get(key) : null;
    },
    setItem(key, value) {
      storage.set(key, String(value));
    },
    removeItem(key) {
      storage.delete(key);
    }
  };

  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    Promise,
    localStorage
  };
  if (options.withDocument) {
    sandbox.document = {
      head: { appendChild() {} },
      getElementsByTagName() { return [{ appendChild() {} }]; },
      createElement() { return {}; }
    };
  }
  // root 判定：typeof window !== 'undefined' → 用 window；这里让 window === sandbox
  sandbox.window = sandbox;

  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox, { filename: 'providers.js' });
  assert.ok(sandbox.BW_PROVIDERS, 'window.BW_PROVIDERS 未挂载');
  return { api: sandbox.BW_PROVIDERS, storage, sandbox };
}

/** vm 沙箱里创建的对象/数组与测试环境不同 realm，deepStrictEqual 会比较原型；用 JSON 比较更稳 */
function jsonEqual(actual, expected, message) {
  assert.equal(JSON.stringify(actual), JSON.stringify(expected), message);
}

/** 用被测 API 自己生成各家的原始坐标（避免手写常量出错） */
function fixtureCoordinate(api, index) {
  const wgs = { lat: 31.2283 + index * 0.004, lon: 121.4714 + index * 0.004 };
  return {
    wgs,
    gcj: api.wgs84ToGcj02(wgs.lat, wgs.lon),
    bd: api.wgs84ToBd09(wgs.lat, wgs.lon)
  };
}

// ============================================================
// 坐标转换
// ============================================================

test('坐标转换：WGS84↔GCJ02 往返误差 < 3 米；境外坐标原样返回', () => {
  const { api } = loadProviders();
  const wgs = { lat: 31.2304, lon: 121.4737 };

  const gcj = api.wgs84ToGcj02(wgs.lat, wgs.lon);
  // 上海 GCJ-02 相对 WGS-84 大约偏移几百米
  assert.ok(Math.abs(gcj.lat - wgs.lat) > 0.001, 'GCJ 偏移应明显');
  assert.ok(Math.abs(gcj.lon - wgs.lon) > 0.001, 'GCJ 偏移应明显');

  const back = api.gcj02ToWgs84(gcj.lat, gcj.lon);
  assert.ok(Math.abs(back.lat - wgs.lat) < 0.00003, '往返 lat 误差应 < 3m');
  assert.ok(Math.abs(back.lon - wgs.lon) < 0.00003, '往返 lon 误差应 < 3m');

  const foreign = api.wgs84ToGcj02(48.8566, 2.3522);
  assert.equal(foreign.lat, 48.8566);
  assert.equal(foreign.lon, 2.3522);
});

test('坐标转换：WGS84↔BD09 往返误差 < 5 米', () => {
  const { api } = loadProviders();
  const wgs = { lat: 31.2304, lon: 121.4737 };
  const bd = api.wgs84ToBd09(wgs.lat, wgs.lon);
  assert.ok(Math.abs(bd.lat - wgs.lat) > 0.001, 'BD-09 偏移应明显');
  const back = api.bd09ToWgs84(bd.lat, bd.lon);
  assert.ok(Math.abs(back.lat - wgs.lat) < 0.00005, '往返 lat 误差应 < 5m');
  assert.ok(Math.abs(back.lon - wgs.lon) < 0.00005, '往返 lon 误差应 < 5m');
});

// ============================================================
// parseAmap
// ============================================================

test('parseAmap：字段映射 / 类别 / 图片 / 坐标 GCJ→WGS', () => {
  const { api } = loadProviders();
  const first = fixtureCoordinate(api, 0);
  const second = fixtureCoordinate(api, 1);

  const json = {
    status: '1',
    info: 'OK',
    pois: [
      {
        id: 'B0FFH1',
        name: '星巴克(南京东路店)',
        location: first.gcj.lon.toFixed(6) + ',' + first.gcj.lat.toFixed(6),
        type: '餐饮服务;咖啡厅;咖啡厅',
        address: '南京东路 100 号',
        photos: [{ title: '', url: 'https://img.example/cafe.jpg' }]
      },
      {
        id: 'B0FFH2',
        name: '人民公园',
        location: second.gcj.lon.toFixed(6) + ',' + second.gcj.lat.toFixed(6),
        type: '风景名胜;公园;公园',
        address: [],
        photos: []
      },
      { id: 'B0FFH3', name: '', location: first.gcj.lon + ',' + first.gcj.lat, type: '公园' }
    ]
  };

  const list = api.parseAmap(json);
  assert.equal(list.length, 2, '空名字应被丢弃');

  assert.equal(list[0].source, 'amap');
  assert.equal(list[0].id, 'amap-B0FFH1');
  assert.equal(list[0].name, '星巴克(南京东路店)');
  assert.equal(list[0].category, 'cafe');
  assert.equal(list[0].address, '南京东路 100 号');
  assert.equal(list[0].photoUrl, 'https://img.example/cafe.jpg');
  assert.equal(list[0].photoCredit, '高德地图');
  assert.ok(Math.abs(list[0].lat - first.wgs.lat) < 0.00005, '高德坐标应转换为 WGS-84');
  assert.ok(Math.abs(list[0].lon - first.wgs.lon) < 0.00005);

  assert.equal(list[1].category, 'park');
  assert.equal(list[1].address, null);
  assert.equal(list[1].photoUrl, null);
  assert.equal(list[1].photoCredit, null);
});

test('parseAmap：status 非 1 / 坏数据返回空数组', () => {
  const { api } = loadProviders();
  assert.equal(api.parseAmap({ status: '0', info: 'INVALID_USER_KEY', pois: [] }).length, 0);
  assert.equal(api.parseAmap({ status: '1', pois: 'oops' }).length, 0);
  assert.equal(api.parseAmap(null).length, 0);
  assert.equal(api.parseAmap('not json').length, 0);
});

// ============================================================
// parseBaidu
// ============================================================

test('parseBaidu：字段映射 / 类别 / 图片 / 坐标 BD→WGS', () => {
  const { api } = loadProviders();
  const first = fixtureCoordinate(api, 0);
  const second = fixtureCoordinate(api, 1);

  const json = {
    status: 0,
    message: 'ok',
    results: [
      {
        uid: 'b1',
        name: '上海博物馆',
        location: { lat: first.bd.lat, lng: first.bd.lon },
        address: '人民大道 201 号',
        detail_info: { tag: '博物馆', image_url: 'https://img.example/museum.jpg' }
      },
      {
        uid: 'b2',
        name: '静安寺',
        location: { lat: second.bd.lat, lng: second.bd.lon },
        address: '',
        detail_info: { tag: '寺庙' }
      }
    ]
  };

  const list = api.parseBaidu(json);
  assert.equal(list.length, 2);

  assert.equal(list[0].source, 'baidu');
  assert.equal(list[0].id, 'baidu-b1');
  assert.equal(list[0].name, '上海博物馆');
  assert.equal(list[0].category, 'museum');
  assert.equal(list[0].address, '人民大道 201 号');
  assert.equal(list[0].photoUrl, 'https://img.example/museum.jpg');
  assert.equal(list[0].photoCredit, '百度地图');
  assert.ok(Math.abs(list[0].lat - first.wgs.lat) < 0.00005, '百度坐标应转换为 WGS-84');
  assert.ok(Math.abs(list[0].lon - first.wgs.lon) < 0.00005);

  assert.equal(list[1].category, 'temple');
  assert.equal(list[1].address, null);
  assert.equal(list[1].photoUrl, null);
});

test('parseBaidu：status 非 0 / 坏数据返回空数组', () => {
  const { api } = loadProviders();
  assert.equal(api.parseBaidu({ status: 1, message: 'Invalid AK', results: [] }).length, 0);
  assert.equal(api.parseBaidu({ status: 0, results: 'oops' }).length, 0);
  assert.equal(api.parseBaidu(undefined).length, 0);
});

// ============================================================
// mapCategory
// ============================================================

test('mapCategory：17 类映射（原始类别 / 名称 / 兜底）', () => {
  const { api } = loadProviders();
  const cases = [
    ['餐饮服务;咖啡厅;咖啡厅', '', 'cafe'],
    ['', '星巴克咖啡', 'cafe'],
    ['', '新华书店', 'bookstore'],
    ['', '社区图书馆', 'library'],
    ['风景名胜;公园;公园', '', 'park'],
    ['', '网红长椅', 'bench'],
    ['', '苏州河乍浦路桥', 'bridge'],
    ['', '田子坊涂鸦墙', 'art'],
    ['', '外滩观景平台', 'viewpoint'],
    ['', '静安寺', 'temple'],
    ['', '上海音乐厅', 'venue'],
    ['', '全家便利店', 'convenience'],
    ['', '徐家汇花园', 'garden'],
    ['', '历史建筑旧址', 'historic'],
    ['', '菜市场', 'market'],
    ['', '南京东路步行街广场', 'plaza'],
    ['', '未知地点', 'plaza']
  ];
  cases.forEach(([raw, name, expected]) => {
    assert.equal(api.mapCategory(raw, name), expected, 'mapCategory(' + raw + ',' + name + ')');
  });
});

// ============================================================
// dedupe / sortByDistance
// ============================================================

test('dedupe：同名合并保留有图 + 有地址；近距离合并；远的不同名保留', () => {
  const { api } = loadProviders();
  const origin = { lat: 31.2304, lon: 121.4737 };
  const list = [
    {
      id: 'amap-1', name: '星巴克（南京东路店）', lat: origin.lat, lon: origin.lon,
      category: 'cafe', address: null, photoUrl: 'https://img.example/cafe.jpg',
      photoCredit: '高德地图', source: 'amap'
    },
    {
      id: 'osm-1', name: '星巴克(南京东路店)', lat: origin.lat + 0.00001, lon: origin.lon + 0.00001,
      category: 'cafe', address: '南京东路 100 号', photoUrl: null,
      photoCredit: null, source: 'osm'
    },
    {
      id: 'osm-2', name: '人民公园', lat: origin.lat + 0.002, lon: origin.lon + 0.002,
      category: 'park', address: null, photoUrl: null, photoCredit: null, source: 'osm'
    },
    {
      id: 'wiki-2', name: '人民公园（上海）', lat: origin.lat + 0.00201, lon: origin.lon + 0.00201,
      category: 'park', address: null, photoUrl: 'https://img.example/park.jpg',
      photoCredit: 'Wikimedia Commons', source: 'wiki'
    },
    {
      id: 'far-1', name: '完全不同的地方', lat: origin.lat + 0.02, lon: origin.lon + 0.02,
      category: 'plaza', address: null, photoUrl: null, photoCredit: null, source: 'osm'
    },
    // 无效坐标应被丢弃
    { id: 'bad', name: '坏数据', lat: null, lon: null, category: 'plaza', source: 'osm' }
  ];

  const deduped = api.dedupe(list, 30);
  assert.equal(deduped.length, 3, '两条星巴克 + 两条人民公园 + 一个远处点');

  const starbucks = deduped.filter((item) => item.name.indexOf('星巴克') === 0)[0];
  assert.equal(starbucks.photoUrl, 'https://img.example/cafe.jpg', '优先保留有图的');
  assert.equal(starbucks.address, '南京东路 100 号', '应补齐另一条的地址');

  const park = deduped.filter((item) => item.name.indexOf('人民公园') === 0)[0];
  assert.equal(park.source, 'wiki', '有图的条目质量更高，应保留');
  assert.equal(park.photoUrl, 'https://img.example/park.jpg');
});

test('dedupe：距离 < 30m 的不同名也合并；半径参数可覆盖阈值', () => {
  const { api } = loadProviders();
  const base = { lat: 31.2304, lon: 121.4737 };
  const list = [
    { id: 'a', name: '甲地', lat: base.lat, lon: base.lon, category: 'park', address: 'A 路 1 号', photoUrl: null, source: 'osm' },
    // 与 a 相距约 11m（0.0001° 纬度）
    { id: 'b', name: '乙地', lat: base.lat + 0.0001, lon: base.lon, category: 'park', address: null, photoUrl: 'https://img.example/b.jpg', source: 'amap' }
  ];
  assert.equal(api.dedupe(list, 30).length, 1, '30m 内应合并');
  assert.equal(api.dedupe(list, 5).length, 2, '阈值 5m 时不应合并');
});

test('sortByDistance：按距离升序并带 distance；半径过滤留 10% 容差', () => {
  const { api } = loadProviders();
  const origin = { lat: 31.2304, lon: 121.4737 };
  const list = [
    { id: 'far', name: '远', lat: origin.lat + 0.01, lon: origin.lon, category: 'park', source: 'osm' },
    { id: 'near', name: '近', lat: origin.lat + 0.001, lon: origin.lon, category: 'park', source: 'osm' },
    { id: 'mid', name: '中', lat: origin.lat + 0.004, lon: origin.lon, category: 'park', source: 'osm' }
  ];

  const sorted = api.sortByDistance(list, origin.lat, origin.lon);
  jsonEqual(sorted.map((item) => item.id), ['near', 'mid', 'far']);
  assert.ok(sorted[0].distance < sorted[1].distance && sorted[1].distance < sorted[2].distance);
  assert.equal(typeof sorted[0].distance, 'number');

  // 半径 300m：near(111m) / mid(445m) 保留，far(1112m) 去掉
  const filtered = api.sortByDistance(list, origin.lat, origin.lon, 300);
  jsonEqual(filtered.map((item) => item.id), ['near']);
});

// ============================================================
// status / keys
// ============================================================

test('status：无 Key 时默认只启用 osm + wiki，高德/百度给出原因', () => {
  const { api } = loadProviders();
  const status = api.status();
  jsonEqual(status.keys, { amap: '', baidu: '' });

  const byId = {};
  status.sources.forEach((source) => { byId[source.id] = source; });
  assert.equal(byId.amap.enabled, false);
  assert.equal(byId.amap.reason, '未配置 Key');
  assert.equal(byId.baidu.enabled, false);
  assert.equal(byId.baidu.reason, '未配置 Key');
  assert.equal(byId.osm.enabled, true);
  assert.equal(byId.wiki.enabled, true);
  assert.equal(byId.osm.reason, '');
});

test('setKeys / getKeys：脱敏返回 + localStorage 持久化（明文只存在本地）', () => {
  const first = loadProviders();
  const returned = first.api.setKeys({ amap: '  demo-amap-key  ', baidu: '' });
  jsonEqual(returned, { amap: '***', baidu: '' });
  jsonEqual(first.api.getKeys(), { amap: '***', baidu: '' });

  const raw = first.storage.get('bw.keys.v1');
  assert.ok(raw, '应写入 localStorage');
  assert.ok(raw.indexOf('demo-amap-key') >= 0, 'Key 只保存在本地 localStorage');

  const status = first.api.status();
  const amap = status.sources.filter((source) => source.id === 'amap')[0];
  assert.equal(amap.enabled, true);
  assert.equal(amap.reason, '');

  // 模拟「刷新页面」：带旧 localStorage 重新加载
  const second = loadProviders({ storage: { 'bw.keys.v1': raw } });
  jsonEqual(second.api.getKeys(), { amap: '***', baidu: '' });

  // 清空
  second.api.setKeys({ amap: '', baidu: '' });
  jsonEqual(second.api.getKeys(), { amap: '', baidu: '' });
});

// ============================================================
// nearby：参数校验 / 无 Key 时的降级行为
// ============================================================

test('nearby：非法坐标直接 reject；无 Key 默认只尝试 osm + wiki', async () => {
  const { api } = loadProviders();

  await assert.rejects(
    () => api.nearby({ lat: 'not-a-number', lon: 121.47 }),
    /lat/
  );

  // 沙箱里没有 fetch / document，OSM 与 Wiki 会立刻失败；nearby 不应抛错，应返回空数组并写报告
  const list = await api.nearby({ lat: 31.2304, lon: 121.4737, radius: 1200, limit: 10 });
  assert.equal(list.length, 0);

  const report = api.lastReport();
  assert.ok(report.at > 0);
  jsonEqual(report.sources.map((source) => source.id), ['osm', 'wiki']);
  report.sources.forEach((source) => {
    assert.equal(source.ok, false);
    assert.ok(source.error.length > 0);
  });
});

test('nearby：显式 sources 会过滤未知源；未配置 Key 的高德被跳过但不影响其它源', async () => {
  const { api } = loadProviders();
  const list = await api.nearby({
    lat: 31.2304,
    lon: 121.4737,
    sources: ['amap', 'nonsense', 'osm']
  });
  assert.equal(list.length, 0);
  const report = api.lastReport();
  jsonEqual(report.sources.map((source) => source.id), ['amap', 'osm']);
  const amap = report.sources[0];
  assert.equal(amap.ok, false);
  assert.equal(amap.error, '未配置 Key');
});
