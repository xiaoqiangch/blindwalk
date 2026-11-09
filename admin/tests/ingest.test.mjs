import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildOverpassQuery,
  buildWikipediaUrl,
  cleanWikiTitle,
  dedupeCandidates,
  fetchCandidates,
  fetchOverpassCandidates,
  fetchWikipediaCandidates,
  guessCategoryFromTitle,
  isLoadablePhotoUrl,
  isUsableWikiTitle,
  parseOverpassResponse,
  parseWikipediaResponse
} from '../server/ingest.mjs';

// ============================================================
// 固定 fixture（不依赖网络）
// ============================================================

const WIKI_THUMB = 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/1a/x.jpg/800px-x.jpg';

const wikiFixture = {
  query: {
    pages: {
      '101': {
        pageid: 101,
        title: '上海音乐厅',
        coordinates: [{ lat: 31.2288, lon: 121.4733 }],
        thumbnail: { source: WIKI_THUMB },
        extract: '原名南京大戏院，1930 年建成，是上海第一座由中国建筑师设计的西方古典风格剧场。'
      },
      '102': {
        pageid: 102,
        title: '人民公园 (上海市)',
        coordinates: [{ lat: 31.232, lon: 121.472 }],
        thumbnail: { source: WIKI_THUMB },
        extract: '人民公园是上海市中心的一座公园，旁边是人民广场。'
      },
      '103': {
        pageid: 103,
        title: '黄浦区',
        coordinates: [{ lat: 31.23, lon: 121.48 }],
        thumbnail: { source: WIKI_THUMB },
        extract: '黄浦区是上海市的一个市辖区。'
      },
      '104': {
        pageid: 104,
        title: '南京东路站',
        coordinates: [{ lat: 31.238, lon: 121.475 }],
        thumbnail: { source: WIKI_THUMB },
        extract: '南京东路站是上海地铁的一个车站。'
      },
      '105': {
        pageid: 105,
        title: '南京东路',
        coordinates: [{ lat: 31.238, lon: 121.476 }],
        thumbnail: { source: WIKI_THUMB },
        extract: '南京东路是上海的一条商业街。'
      },
      '106': {
        pageid: 106,
        title: '外滩',
        coordinates: [{ lat: 31.24, lon: 121.49 }],
        thumbnail: { source: WIKI_THUMB },
        extract: '外滩位于黄浦江畔，是上海的地标区域，沿岸有历史建筑群。'
      },
      '107': {
        pageid: 107,
        title: '没有图片的地点',
        coordinates: [{ lat: 31.231, lon: 121.474 }],
        extract: '这个条目没有缩略图。'
      },
      '108': {
        pageid: 108,
        title: '没有坐标的地点',
        thumbnail: { source: WIKI_THUMB },
        extract: '这个条目没有坐标。'
      },
      '109': {
        pageid: 109,
        title: '上海博物馆',
        coordinates: [{ lat: 31.2303, lon: 121.4707 }],
        thumbnail: { source: WIKI_THUMB },
        extract: '上海博物馆是一座大型的中国古代艺术博物馆，馆藏丰富。'
      },
      '110': {
        pageid: 110,
        title: '东方明珠',
        coordinates: [{ lat: 31.2397, lon: 121.4998 }],
        thumbnail: { source: WIKI_THUMB },
        extract: '东方明珠是上海的电视塔，塔上有观景台，可以看见很远的城市。'
      }
    }
  }
};

const overpassFixture = {
  elements: [
    { type: 'node', id: 1, lat: 31.2304, lon: 121.4737, tags: { name: '星巴克咖啡', amenity: 'cafe' } },
    {
      type: 'node', id: 2, lat: 31.2312, lon: 121.4748,
      tags: { name: '旧书店', shop: 'books', 'addr:street': '福州路', 'addr:district': '黄浦区' }
    },
    { type: 'node', id: 3, lat: 31.232, lon: 121.475, tags: { name: '某纪念碑', historic: 'monument' } },
    { type: 'node', id: 4, lat: 31.233, lon: 121.476, tags: { amenity: 'restaurant' } },
    { type: 'node', id: 5, lat: 31.233, lon: 121.476, tags: { name: '无名小馆', amenity: 'restaurant' } },
    { type: 'node', id: 6, lat: 31.2352, lon: 121.4802, tags: { name: '人民广场', place: 'square' } },
    { type: 'node', id: 7, lat: 31.223, lon: 121.445, tags: { name: '静安寺', amenity: 'place_of_worship' } }
  ]
};

const origin = { lat: 31.2304, lon: 121.4737 };

// ============================================================
// 标题过滤 / 清洗 / 类别
// ============================================================

test('维基标题：去括号消歧义、过滤行政区/地铁/道路', () => {
  assert.equal(cleanWikiTitle('大世界 (上海市)'), '大世界');
  assert.equal(cleanWikiTitle('上海博物馆（人民广场）'), '上海博物馆');
  assert.equal(cleanWikiTitle('  外滩  '), '外滩');

  assert.equal(isUsableWikiTitle('外滩'), true);
  assert.equal(isUsableWikiTitle('上海音乐厅'), true);
  assert.equal(isUsableWikiTitle('人民公园 (上海市)'), true);
  assert.equal(isUsableWikiTitle('黄浦区'), false);
  assert.equal(isUsableWikiTitle('江苏省'), false);
  assert.equal(isUsableWikiTitle('上海'), false);
  assert.equal(isUsableWikiTitle('南京东路站'), false);
  assert.equal(isUsableWikiTitle('南京东路'), false);
  assert.equal(isUsableWikiTitle('延安高架'), false);
  assert.equal(isUsableWikiTitle(''), false);
});

test('图片 URL 只接受可直连的维基缩略图', () => {
  assert.equal(isLoadablePhotoUrl(WIKI_THUMB), true);
  assert.equal(isLoadablePhotoUrl('https://upload.wikimedia.org/a.png'), true);
  assert.equal(isLoadablePhotoUrl('http://upload.wikimedia.org/a.png'), false);
  assert.equal(isLoadablePhotoUrl('https://example.com/a.png'), false);
  assert.equal(isLoadablePhotoUrl(''), false);
});

test('类别推断（复用 geo.js 的思路，映射到契约类别）', () => {
  assert.equal(guessCategoryFromTitle('人民公园', ''), 'park');
  assert.equal(guessCategoryFromTitle('外滩', '黄浦江畔'), 'river');
  assert.equal(guessCategoryFromTitle('外白渡桥', ''), 'bridge');
  assert.equal(guessCategoryFromTitle('上海音乐厅', ''), 'venue');
  assert.equal(guessCategoryFromTitle('上海博物馆', ''), 'museum');
  assert.equal(guessCategoryFromTitle('静安寺', ''), 'temple');
  assert.equal(guessCategoryFromTitle('武康大楼', '上海的历史建筑'), 'historic');
  assert.equal(guessCategoryFromTitle('田子坊', '老式里弄'), 'historic');
  assert.equal(guessCategoryFromTitle('星巴克咖啡', ''), 'cafe');
  assert.equal(guessCategoryFromTitle('上海图书馆', ''), 'library');
  assert.equal(guessCategoryFromTitle('人民广场', ''), 'plaza');
  assert.equal(guessCategoryFromTitle('人民广场', '旁边是人民公园，也有地铁站'), 'plaza');
  assert.equal(guessCategoryFromTitle('国际饭店', '位于南京西路，靠近地铁站'), 'historic');
  assert.equal(guessCategoryFromTitle('天蟾逸夫舞台', ''), 'venue');
  assert.equal(guessCategoryFromTitle('东方明珠塔', '观景'), 'viewpoint');
});

// ============================================================
// 维基 / Overpass 纯解析
// ============================================================

test('parseWikipediaResponse：过滤 + 名称清洗 + 类别 + 图片 + 摘要', () => {
  const items = parseWikipediaResponse(wikiFixture, origin);
  const names = items.map((item) => item.name);
  assert.deepEqual(names.slice().sort(), ['上海博物馆', '上海音乐厅', '人民公园', '外滩', '东方明珠'].sort());
  assert.equal(items.length, 5);

  const music = items.find((item) => item.name === '上海音乐厅');
  assert.ok(music);
  assert.equal(music.category, 'venue');
  assert.equal(music.source, 'wikipedia');
  assert.equal(music.photoCredit, 'Wikimedia Commons');
  assert.equal(music.photoUrl, WIKI_THUMB);
  assert.equal(music.lat, 31.2288);
  assert.ok(music.summary.length <= 120);
  assert.equal(music.address, null);

  const park = items.find((item) => item.name === '人民公园');
  assert.equal(park.category, 'park');
  assert.equal(park.photoCredit, 'Wikimedia Commons');

  // 按距离由近到远（上海音乐厅最近，约 178m）
  assert.equal(items[0].name, '上海音乐厅');
});

test('parseOverpassResponse：白名单类别 + 地址拼接 + 无名/不支持跳过', () => {
  const items = parseOverpassResponse(overpassFixture, origin);
  const names = items.map((item) => item.name);
  assert.deepEqual(names.slice().sort(), ['人民广场', '星巴克咖啡', '旧书店', '某纪念碑', '静安寺'].sort());

  const cafe = items.find((item) => item.name === '星巴克咖啡');
  assert.equal(cafe.category, 'cafe');
  assert.equal(cafe.source, 'osm');
  assert.equal(cafe.photoUrl, null);

  const bookstore = items.find((item) => item.name === '旧书店');
  assert.equal(bookstore.category, 'bookstore');
  assert.equal(bookstore.address, '黄浦区 · 福州路');

  const historic = items.find((item) => item.name === '某纪念碑');
  assert.equal(historic.category, 'historic');

  const temple = items.find((item) => item.name === '静安寺');
  assert.equal(temple.category, 'temple');
  assert.equal(items.some((item) => item.name === '无名小馆'), false);
});

test('批内去重：同名 / 30m 内只保留一个', () => {
  const deduped = dedupeCandidates([
    { name: '外滩', lat: 31.24, lon: 121.49 },
    { name: ' 外滩 ', lat: 31.25, lon: 121.5 },
    { name: '另一个点', lat: 31.24001, lon: 121.49001 },
    { name: '远处', lat: 31.3, lon: 121.6 }
  ]);
  assert.equal(deduped.length, 2);
  assert.deepEqual(deduped.map((item) => item.name), ['外滩', '远处']);
});

test('URL / QL 构造与契约参数一致', () => {
  const url = buildWikipediaUrl(31.2304, 121.4737, 1200);
  assert.ok(url.startsWith('https://zh.wikipedia.org/w/api.php?'));
  const params = new URL(url).searchParams;
  assert.equal(params.get('generator'), 'geosearch');
  assert.equal(params.get('ggscoord'), '31.2304|121.4737');
  assert.equal(params.get('ggsradius'), '1200');
  assert.equal(params.get('ggslimit'), '20');
  assert.equal(params.get('prop'), 'pageimages|coordinates|extracts');
  assert.equal(params.get('exchars'), '120');

  const query = buildOverpassQuery(31.2304, 121.4737, 1200);
  assert.ok(query.includes('[out:json]'));
  assert.ok(query.includes('node["amenity"="cafe"](around:1200,31.2304,121.4737);'));
  assert.ok(query.includes('node["shop"="books"]'));
  assert.ok(query.includes('node["historic"]'));
});

// ============================================================
// 抓取编排（注入 fake fetch，不依赖网络）
// ============================================================

function jsonResponse(payload) {
  return {
    ok: true,
    status: 200,
    json: async () => payload
  };
}

test('fetchCandidates：维基够 5 条时只用维基，不发 OSM 请求', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    return jsonResponse(wikiFixture);
  };
  const result = await fetchCandidates({ ...origin, radius: 1200, limit: 10, fetchImpl });
  assert.equal(result.source, 'wikipedia');
  assert.equal(calls.length, 1, '只应请求一次维基');
  assert.ok(result.items.length >= 4);
  assert.ok(result.items.every((item) => item.source === 'wikipedia'));
});

test('fetchCandidates：维基少时用 Overpass 补齐（source = mixed）', async () => {
  const smallWiki = {
    query: {
      pages: {
        '1': {
          title: '上海音乐厅',
          coordinates: [{ lat: 31.2288, lon: 121.4733 }],
          thumbnail: { source: WIKI_THUMB },
          extract: '剧场。'
        }
      }
    }
  };
  const calls = [];
  const fetchImpl = async (url) => {
    const value = String(url);
    calls.push(value);
    if (value.includes('wikipedia.org')) return jsonResponse(smallWiki);
    return jsonResponse(overpassFixture);
  };
  const result = await fetchCandidates({ ...origin, radius: 1200, limit: 10, fetchImpl });
  assert.equal(result.source, 'mixed');
  assert.ok(result.items.some((item) => item.source === 'wikipedia'));
  assert.ok(result.items.some((item) => item.source === 'osm'));
  assert.ok(calls.some((value) => value.includes('overpass')));
});

test('fetchCandidates：维基失败 → 只用 Overpass（source = osm）', async () => {
  const fetchImpl = async (url) => {
    if (String(url).includes('wikipedia.org')) throw new Error('wiki down');
    return jsonResponse(overpassFixture);
  };
  const result = await fetchCandidates({ ...origin, radius: 1200, limit: 10, fetchImpl });
  assert.equal(result.source, 'osm');
  assert.ok(result.items.length > 0);
  assert.ok(result.items.every((item) => item.source === 'osm'));
});

test('Overpass 镜像容错：第一个失败后换第二个', async () => {
  let count = 0;
  const fetchImpl = async (url) => {
    count += 1;
    if (count === 1) throw new Error('mirror down');
    return jsonResponse(overpassFixture);
  };
  const items = await fetchOverpassCandidates(31.2304, 121.4737, 1200, fetchImpl);
  assert.ok(items.length > 0);
  assert.ok(count >= 2);
});

test('fetchWikipediaCandidates：网络失败返回空数组（不抛）', async () => {
  const items = await fetchWikipediaCandidates(31.2304, 121.4737, 1200, async () => {
    throw new Error('offline');
  });
  assert.deepEqual(items, []);
});
