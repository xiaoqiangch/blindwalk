/**
 * 步迷 Walkaholic · HarmonyOS ArkUI — 图鉴 Cards（design-system §5.5 + parity: 附近惊喜）
 *
 * 视觉基准：prototype/web/app.js cardsHTML（Web v46）+ screenshots/showcase.png（CARDS 屏）
 * 结构：回忆册 header + 筛选图标 → 统计条 → **附近的惊喜（隐晦提示）** → 筛选 chips → 卡片网格
 * 点击已解锁卡 → 居中放大查看（卡片 + 小任务 + 关闭）
 *
 * ## 附近的惊喜（对齐 Web v46 / iOS CardsView.nearbyHintsSection）
 * 只给「距离分档 + 氛围句 + 作者 emoji」，**绝不**给区域名 / 作者提示 / 照片 / 坐标。
 * 点卡片 → 回调 `onOpenSeek(id)`，由 Index 打开探寻面板（线索要靠走近才解锁）。
 * 保密逻辑全部在 `core/hints.ts`（纯 TS，有单测断言）。
 *
 * 响应式：手机 3 列 / 折叠态（矮屏）4 列 / 展开态（宽屏）5 列（docs/foldable.md）。
 */

import { AppSnapshot, KeyValueStore } from '../core/contract';
import { Area, GeoPoint, Place, PlaceCard, Rarity } from '../core/types';
import { distance as distanceBetween } from '../core/geo';
import { readAccountConfig } from '../core/account';
import {
  HINT_EMPTY_CTA,
  HINT_FOOTER,
  HINT_TITLE_SUFFIX,
  NearHint,
  nearbyHintCountText,
  nearbyHints
} from '../core/hints';
import {
  WaHairline,
  WaMicroLabel,
  WaPill,
  WaRarityBadge
} from '../components/Common';
import {
  emptySnapshot,
  hiddenCardCount,
  isNearbyExplored,
  nearbyDistance,
  placeOf,
  rareCardCount,
  readSnapshot,
  sortedCards,
  unexploredNearbyCount
} from '../components/StoreBridge';
import {
  WAColor,
  WAFont,
  WASize,
  areaWord,
  rarityColor
} from '../theme/Theme';
import { formatShortDate } from '../components/Format';
import { categorySymbol } from '../components/WaSymbol';

enum CardFilter {
  All = 'all',
  Rare = 'rare',
  Hidden = 'hidden',
  Area = 'area'
}

class FilterInfo {
  value: CardFilter;
  label: string;

  constructor(value: CardFilter, label: string) {
    this.value = value;
    this.label = label;
  }
}

const FILTERS: FilterInfo[] = [
  new FilterInfo(CardFilter.All, '全部'),
  new FilterInfo(CardFilter.Rare, '稀有'),
  new FilterInfo(CardFilter.Hidden, '隐藏'),
  new FilterInfo(CardFilter.Area, '本区')
];

@Component
export struct CardsView {
  @Prop @Watch('onRevisionChanged') revision: number = 0;
  @Prop winWidth: number = 400;
  @Prop winHeight: number = 800;

  onChanged: () => void = () => {
  };
  /** 点「附近的惊喜」卡片 → 由 Index 打开探寻面板 */
  onOpenSeek: (surpriseID: string) => void = () => {
  };
  /** 空状态 CTA：去埋一个（由 Index 决定去哪） */
  onOpenBury: () => void = () => {
  };
  /** 点击「附近未探索的兴趣点」→ 由 Index 用该地点开始一次旅程 */
  onExplorePlace: (placeID: string) => void = () => {
  };

  @State private snapshot: AppSnapshot = emptySnapshot();
  @State private filter: CardFilter = CardFilter.All;
  @State private selectedPlaceID: string = '';

  /** 账号服务地址（远端到达照片的 URL 前缀；未登录为空串） */
  kv: KeyValueStore | undefined = undefined;
  private accountBaseUrl: string = '';

  aboutToAppear(): void {
    this.load();
    this.loadAccountBase();
  }

  onRevisionChanged(propName: string): void {
    this.load();
  }

  private loadAccountBase(): void {
    if (this.kv === undefined) {
      this.accountBaseUrl = '';
      return;
    }
    try {
      const config = readAccountConfig(this.kv);
      this.accountBaseUrl = config.baseUrl.replace(/\/+$/, '');
    } catch (err) {
      this.accountBaseUrl = '';
    }
  }

  private load(): void {
    this.snapshot = readSnapshot(this.snapshot);
  }

  // ============================================================
  // 数据
  // ============================================================

  private cardFor(placeID: string): PlaceCard | undefined {
    for (let i = 0; i < this.snapshot.profile.cards.length; i++) {
      if (this.snapshot.profile.cards[i].placeID === placeID) {
        return this.snapshot.profile.cards[i];
      }
    }
    return undefined;
  }

  private isCollected(placeID: string): boolean {
    return this.cardFor(placeID) !== undefined;
  }

  private latestArea(): Area {
    const cards: PlaceCard[] = sortedCards(this.snapshot.profile);
    if (cards.length === 0) {
      return Area.Near;
    }
    const place: Place | undefined = placeOf(this.snapshot, cards[0].placeID);
    return place === undefined ? Area.Near : place.area;
  }

  /** 附近惊喜的隐晦提示（最多 3 条，按距离排序；保密逻辑在 core/hints.ts） */
  private nearbyHintList(): NearHint[] {
    return nearbyHints(
      this.snapshot.explorableSurprises,
      this.snapshot.lastKnownOrigin,
      this.snapshot.profile.name
    );
  }

  private hasLocation(): boolean {
    return this.snapshot.lastKnownOrigin !== undefined;
  }

  /** 附近兴趣点：未探索在前（按距离升序），已探索在后 */
  private nearbyPlaceList(): Place[] {
    const list: Place[] = this.snapshot.nearbyPlaces.slice();
    list.sort((first: Place, second: Place): number => {
      const exploredFirst: boolean = isNearbyExplored(this.snapshot, first);
      const exploredSecond: boolean = isNearbyExplored(this.snapshot, second);
      if (exploredFirst !== exploredSecond) {
        return exploredFirst ? 1 : -1;
      }
      const metersFirst: number = nearbyDistance(this.snapshot, first);
      const metersSecond: number = nearbyDistance(this.snapshot, second);
      if (metersFirst < 0 && metersSecond < 0) return 0;
      if (metersFirst < 0) return 1;
      if (metersSecond < 0) return -1;
      return metersFirst - metersSecond;
    });
    return list;
  }

  private matchesFilter(place: Place): boolean {
    switch (this.filter) {
      case CardFilter.Rare:
        return place.rarity !== Rarity.Common;
      case CardFilter.Hidden:
        return place.rarity === Rarity.Hidden;
      case CardFilter.Area:
        return place.area === this.latestArea();
      default:
        return true;
    }
  }

  private visiblePlaces(): Place[] {
    const result: Place[] = [];
    for (let i = 0; i < this.snapshot.places.length; i++) {
      const place: Place = this.snapshot.places[i];
      if (this.matchesFilter(place)) {
        result.push(place);
      }
    }
    result.sort((first: Place, second: Place): number => {
      const cardFirst: PlaceCard | undefined = this.cardFor(first.id);
      const cardSecond: PlaceCard | undefined = this.cardFor(second.id);
      if (cardFirst !== undefined && cardSecond !== undefined) {
        return cardSecond.collectedAt - cardFirst.collectedAt;
      }
      if (cardFirst !== undefined) {
        return -1;
      }
      if (cardSecond !== undefined) {
        return 1;
      }
      return 0;
    });
    return result;
  }

  private columnCount(): number {
    if (this.winHeight < WASize.shortHeightBreakpoint) {
      return 4;
    }
    if (this.winWidth >= WASize.wideBreakpoint) {
      return 5;
    }
    return 3;
  }

  private isWide(): boolean {
    return this.winWidth >= WASize.wideBreakpoint;
  }

  /** 展开态：左右分屏时每栏更窄，列数相应减少 */
  private wideColumnCount(): number {
    return 3;
  }

  private cardWidth(): string {
    const columns: number = this.columnCount();
    if (columns >= 5) {
      return '18.4%';
    }
    if (columns === 4) {
      return '23.4%';
    }
    return '31.4%';
  }

  private cardHeight(): number {
    return this.winHeight < WASize.shortHeightBreakpoint ? 112 : 128;
  }

  private selectedPlace(): Place | undefined {
    if (this.selectedPlaceID.length === 0) {
      return undefined;
    }
    return placeOf(this.snapshot, this.selectedPlaceID);
  }

  private cardSerialText(placeID: string): string {
    const card: PlaceCard | undefined = this.cardFor(placeID);
    return card === undefined ? '' : 'No.' + card.serial;
  }

  private cardDateText(placeID: string): string {
    const card: PlaceCard | undefined = this.cardFor(placeID);
    return card === undefined ? '' : formatShortDate(card.collectedAt);
  }

  private isTaskDone(placeID: string): boolean {
    const card: PlaceCard | undefined = this.cardFor(placeID);
    return card === undefined ? false : card.taskDone;
  }

  /** 有没有到达实拍（本地或远端） */
  private hasCardPhoto(placeID: string): boolean {
    const card: PlaceCard | undefined = this.cardFor(placeID);
    if (card === undefined) return false;
    const hasLocal: boolean = card.photoName !== undefined && card.photoName.length > 0;
    const hasRemote: boolean = card.photoRemotePath !== undefined && card.photoRemotePath.length > 0;
    return hasLocal || hasRemote;
  }

  /** 本地照片 URI（优先），否则用远端路径拼出来的 URL */
  private cardPhotoUri(placeID: string): string {
    const card: PlaceCard | undefined = this.cardFor(placeID);
    if (card === undefined) return '';
    if (card.photoName !== undefined && card.photoName.length > 0) return card.photoName;
    return this.cardPhotoRemote(placeID);
  }

  /** 远端照片 URL（需要账号服务地址） */
  private cardPhotoRemote(placeID: string): string {
    const card: PlaceCard | undefined = this.cardFor(placeID);
    if (card === undefined) return '';
    if (card.photoRemotePath === undefined || card.photoRemotePath.length === 0) return '';
    if (this.accountBaseUrl.length === 0) return '';
    return this.accountBaseUrl + card.photoRemotePath;
  }

  private cycleFilter(): void {
    const order: CardFilter[] = [CardFilter.All, CardFilter.Rare, CardFilter.Hidden, CardFilter.Area];
    let nextIndex: number = 0;
    for (let i = 0; i < order.length; i++) {
      if (order[i] === this.filter) {
        nextIndex = (i + 1) % order.length;
      }
    }
    this.filter = order[nextIndex];
  }

  // ============================================================
  // 区块
  // ============================================================

  @Builder
  header() {
    Row() {
      Text('图鉴')
        .fontSize(WAFont.hero)
        .fontWeight(FontWeight.Bold)
        .fontColor(WAColor.ink)

      Blank()

      Stack({ alignContent: Alignment.Center }) {
        SymbolGlyph($r('sys.symbol.square_grid_2x2'))
          .fontSize(WASize.iconSizeSm)
          .fontColor([WAColor.ink2])
          .renderingStrategy(SymbolRenderingStrategy.SINGLE)
      }
      .width(36)
      .height(36)
      .backgroundColor(WAColor.paper2)
      .borderRadius(18)
      .onClick(() => {
        this.cycleFilter();
      })
    }
    .width('100%')
  }

  /** 未解锁的地点（收藏进度卡用） */
  private remainingPlaces(): Place[] {
    const result: Place[] = [];
    for (let i = 0; i < this.snapshot.places.length; i += 1) {
      const place: Place = this.snapshot.places[i];
      if (this.cardFor(place.id) === undefined) result.push(place);
    }
    return result;
  }

  /** 最近的未解锁地点（有定位才有） */
  private nearestRemaining(): Place | undefined {
    const remaining: Place[] = this.remainingPlaces();
    const origin: GeoPoint | undefined = this.snapshot.lastKnownOrigin;
    if (origin === undefined) return undefined;
    let best: Place | undefined = undefined;
    let bestMeters: number = -1;
    for (let i = 0; i < remaining.length; i += 1) {
      const coordinate = remaining[i].coordinate;
      if (coordinate === undefined) continue;
      const meters: number = distanceBetween(origin, coordinate);
      if (bestMeters < 0 || meters < bestMeters) {
        bestMeters = meters;
        best = remaining[i];
      }
    }
    return best;
  }

  private distanceCopy(place: Place): string {
    const origin: GeoPoint | undefined = this.snapshot.lastKnownOrigin;
    if (origin === undefined || place.coordinate === undefined) return '位置未知';
    const meters: number = Math.round(distanceBetween(origin, place.coordinate));
    if (meters >= 1000) return (meters / 1000).toFixed(1) + ' 公里';
    return String(meters) + ' 米';
  }

  /** 「只差一张」标题：把收集进度写成一句人话（与 iOS headlineForRemaining 一致） */
  private almostThereHeadline(remaining: number): string {
    if (remaining === 1) return '只差一张';
    if (remaining <= 3) return '还差 ' + String(remaining) + ' 张就集齐';
    return '这一带还有 ' + String(remaining) + ' 个没去过';
  }

  /**
   * 收集进度卡：只差一张 / 还差 N 张，并给最近的未解锁地点一个「现在就走」。
   * 未解锁的地点不显示地名（保密），只给距离。
   */
  @Builder
  almostThereCard() {
    Column({ space: 10 }) {
      Row({ space: 8 }) {
        Text(this.almostThereHeadline(this.remainingPlaces().length))
          .fontSize(WAFont.caption)
          .fontWeight(FontWeight.Bold)
          .fontColor(WAColor.ink)
          .layoutWeight(1)
        Text(String(this.snapshot.profile.cards.length) + '/' + String(this.snapshot.places.length))
          .fontSize(WAFont.microSm)
          .fontColor(WAColor.ink2)
      }
      .width('100%')

      Stack({ alignContent: Alignment.Start }) {
        Row()
          .width('100%')
          .height(4)
          .backgroundColor(WAColor.line)
          .borderRadius(2)
        Row()
          .width(this.collectionProgressPercent() + '%')
          .height(4)
          .backgroundColor(WAColor.amber)
          .borderRadius(2)
      }
      .width('100%')

      if (this.remainingPlaces().length === 0) {
        Text('这一带的真实地点都被你走过了。换个城市，或者去远处漫游一次。')
          .fontSize(WAFont.microSm)
          .fontColor(WAColor.ink2)
          .lineHeight(17)
          .width('100%')
      } else if (this.nearestRemaining() !== undefined) {
        Row({ space: 6 }) {
          SymbolGlyph($r('sys.symbol.figure_walk'))
            .fontSize(WAFont.caption)
            .fontColor([WAColor.amber])
            .renderingStrategy(SymbolRenderingStrategy.SINGLE)
          Text('最近的一张：' + this.distanceCopy(this.nearestRemaining() as Place) + ' · 现在就走')
            .fontSize(WAFont.captionSm)
            .fontWeight(FontWeight.Medium)
            .fontColor(WAColor.amber)
            .layoutWeight(1)
          Text('→')
            .fontSize(WAFont.microSm)
            .fontColor(WAColor.amber)
        }
        .width('100%')
        .onClick(() => {
          const target: Place | undefined = this.nearestRemaining();
          if (target !== undefined) this.onExplorePlace(target.id);
        })
      } else {
        Text('开一个盲盒，路上遇到的都会收进来。')
          .fontSize(WAFont.microSm)
          .fontColor(WAColor.ink2)
          .layoutWeight(1)
      }
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
    .padding(14)
    .backgroundColor(WAColor.amberSoft)
    .borderRadius(WASize.cardRadius)
    .border({ width: 1, color: WAColor.amberBorder, radius: WASize.cardRadius })
  }

  private collectionProgressPercent(): number {
    const total: number = this.snapshot.places.length;
    if (total <= 0) return 0;
    const collected: number = this.snapshot.profile.cards.length;
    const value: number = Math.min(100, (collected / total) * 100);
    return Math.max(3, value);
  }

  @Builder
  statsLine() {
    Row({ space: 6 }) {
      Text('已收集')
        .fontSize(WAFont.captionSm)
        .fontColor(WAColor.ink3)
      Text(String(this.snapshot.profile.cards.length) + '/' + String(this.snapshot.places.length))
        .fontSize(WAFont.captionSm)
        .fontWeight(FontWeight.Bold)
        .fontColor(WAColor.ink)
      Text('·')
        .fontSize(WAFont.captionSm)
        .fontColor(WAColor.ink3)
      Text('稀有')
        .fontSize(WAFont.captionSm)
        .fontColor(WAColor.ink3)
      Text(String(rareCardCount(this.snapshot)))
        .fontSize(WAFont.captionSm)
        .fontWeight(FontWeight.Bold)
        .fontColor(WAColor.ink)
      Text('·')
        .fontSize(WAFont.captionSm)
        .fontColor(WAColor.ink3)
      Text('隐藏')
        .fontSize(WAFont.captionSm)
        .fontColor(WAColor.ink3)
      Text(String(hiddenCardCount(this.snapshot)))
        .fontSize(WAFont.captionSm)
        .fontWeight(FontWeight.Bold)
        .fontColor(WAColor.ink)
      Blank()
    }
    .width('100%')
  }

  /**
   * 附近的惊喜（隐晦提示）
   * 保密：这里**只**读 core/hints.ts 产出的 NearHint，不碰 BuriedSurprise 的
   * areaWord / hints / photoUri / location —— 那会让提示变成剧透。
   */
  @Builder
  nearbyHintsSection() {
    Column({ space: 8 }) {
      // 标题行
      Row({ space: 6 }) {
        Text('附近的惊喜')
          .fontSize(WAFont.caption)
          .fontWeight(FontWeight.Bold)
          .fontColor(WAColor.ink)
        Text(nearbyHintCountText(this.nearbyHintList().length))
          .fontSize(WAFont.microSm)
          .fontColor(WAColor.ink3)
          .maxLines(1)
        Blank()
      }
      .width('100%')

      if (this.nearbyHintList().length === 0) {
        // 空状态：CTA 去埋一个
        Button() {
          Text(HINT_EMPTY_CTA)
            .fontSize(WAFont.caption)
            .fontWeight(FontWeight.Medium)
            .fontColor(WAColor.amberDeep)
            .textAlign(TextAlign.Center)
            .width('100%')
        }
        .type(ButtonType.Normal)
        .height(42)
        .width('100%')
        .backgroundColor('#0DE89B4C')
        .borderRadius(WASize.cardRadiusXs)
        .border({
          width: 1,
          color: '#59E89B4C',
          radius: WASize.cardRadiusXs,
          style: BorderStyle.Dashed
        })
        .onClick(() => {
          this.onOpenBury();
        })
      } else {
        ForEach(this.nearbyHintList(), (hint: NearHint) => {
          this.hintCard(hint)
        }, (hint: NearHint) => hint.id)
      }
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
    .padding(14)
    .backgroundColor(WAColor.paper)
    .borderRadius(WASize.cardRadius)
    .border({ width: 1, color: WAColor.line, radius: WASize.cardRadius })
    .shadow({ radius: 12, color: WAColor.shadowSoft, offsetX: 0, offsetY: 6 })
  }

  /** 一张隐晦提示卡：emoji + 「距离分档 · 有人留下一张照片」+ 氛围句 + 底部提示 */
  @Builder
  hintCard(hint: NearHint) {
    Row({ space: 10 }) {
      // 作者 emoji：三端唯一允许的社交信息
      Text(hint.emoji)
        .fontSize(WAFont.titleMd)
        .textAlign(TextAlign.Center)
        .width(32)
        .height(32)
        .backgroundColor(WAColor.amberSoft)
        .borderRadius(10)

      Column({ space: 2 }) {
        Text(hint.distanceText + ' · ' + HINT_TITLE_SUFFIX)
          .fontSize(WAFont.caption)
          .fontWeight(FontWeight.Medium)
          .fontColor(WAColor.ink)
          .maxLines(2)
          .width('100%')

        Text(hint.atmosphere)
          .fontSize(WAFont.captionSm)
          .fontColor(WAColor.ink2)
          .maxLines(2)
          .lineHeight(18)
          .width('100%')

        Text(HINT_FOOTER)
          .fontSize(WAFont.microSm)
          .fontColor(WAColor.ink3)
          .maxLines(1)
          .width('100%')
      }
      .layoutWeight(1)
      .alignItems(HorizontalAlign.Start)

      Text('›')
        .fontSize(WAFont.caption)
        .fontColor(WAColor.ink3)
    }
    .width('100%')
    .alignItems(VerticalAlign.Top)
    .padding({ left: 12, right: 12, top: 11, bottom: 11 })
    .backgroundColor(WAColor.paper)
    .borderRadius(WASize.cardRadiusXs)
    .border({ width: 1, color: '#2EE89B4C', radius: WASize.cardRadiusXs })
    .onClick(() => {
      // 只把 id 交出去；其余信息（区域/线索/照片）由探寻页按距离决定是否给
      this.onOpenSeek(hint.id);
    })
  }

  /**
   * 附近的兴趣点（真实数据源）。
   *
   * 展示规则：
   *   - 未探索：显示「?」+ 类别 + 距离 + 方向，点击开始探索；
   *   - 已探索（已收录）：显示类别图标 + 地点名 + 收录日期，点击看详情。
   * 保密：未探索条目**只给类别与距离**，绝不给地点名。
   */
  @Builder
  nearbyPoiSection() {
    Column({ space: 8 }) {
      Row({ space: 6 }) {
        Text('附近的兴趣点')
          .fontSize(WAFont.caption)
          .fontWeight(FontWeight.Bold)
          .fontColor(WAColor.ink)
        Text(String(unexploredNearbyCount(this.snapshot)) + ' 个待探索')
          .fontSize(WAFont.microSm)
          .fontColor(WAColor.ink3)
        Blank()
      }
      .width('100%')

      if (this.snapshot.nearbyPlaces.length === 0) {
        Row({ space: 6 }) {
          SymbolGlyph($r('sys.symbol.magnifyingglass'))
            .fontSize(WAFont.caption)
            .fontColor([WAColor.ink3])
            .renderingStrategy(SymbolRenderingStrategy.SINGLE)
          Text(this.hasLocation() ? '正在搜附近…（没找到就下拉重试）' : '需要先定位才能列出附近')
            .fontSize(WAFont.captionSm)
            .fontColor(WAColor.ink3)
        }
        .width('100%')
        .padding({ top: 6, bottom: 6 })
      } else {
        Flex({ wrap: FlexWrap.Wrap, justifyContent: FlexAlign.SpaceBetween }) {
          ForEach(this.nearbyPlaceList(), (place: Place) => {
            this.poiCell(place)
          }, (place: Place) => place.id)
        }
        .width('100%')
      }
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
    .padding(14)
    .backgroundColor(WAColor.paper)
    .borderRadius(WASize.cardRadius)
    .border({ width: 1, color: WAColor.line, radius: WASize.cardRadius })
  }

  /** 单个兴趣点：未探索显示 ?，已探索显示真实信息 */
  @Builder
  poiCell(place: Place) {
    Column({ space: 0 }) {
      if (isNearbyExplored(this.snapshot, place)) {
        SymbolGlyph($r('sys.symbol.' + categorySymbol(place.category)))
          .fontSize(22)
          .fontColor([WAColor.ink2])
          .renderingStrategy(SymbolRenderingStrategy.SINGLE)
          .width('100%')

        Text(place.name)
          .fontSize(WAFont.captionSm)
          .fontWeight(FontWeight.Medium)
          .fontColor(WAColor.ink)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .width('100%')
          .margin({ top: 4 })
      } else {
        // 未探索：问号 + 类别（不含地点名）
        Text('?')
          .fontSize(22)
          .fontWeight(FontWeight.Bold)
          .fontColor(WAColor.ink3)
          .width('100%')

        Text(place.category)
          .fontSize(WAFont.captionSm)
          .fontWeight(FontWeight.Medium)
          .fontColor(WAColor.ink2)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .width('100%')
          .margin({ top: 4 })
      }

      Blank()

      Row({ space: 3 }) {
        SymbolGlyph($r('sys.symbol.pin'))
          .fontSize(WAFont.micro)
          .fontColor([WAColor.ink3])
          .renderingStrategy(SymbolRenderingStrategy.SINGLE)

        Text(this.poiDistanceText(place))
          .fontSize(WAFont.microSm)
          .fontColor(WAColor.ink3)
          .maxLines(1)
      }
      .width('100%')
    }
    .width(this.cardWidth())
    .height(this.cardHeight())
    .padding(10)
    .margin({ bottom: 10 })
    .backgroundColor(isNearbyExplored(this.snapshot, place) ? WAColor.paper : WAColor.paper2)
    .borderRadius(WASize.cardRadiusSm)
    .border({
      width: 1,
      color: WAColor.line,
      radius: WASize.cardRadiusSm,
      style: isNearbyExplored(this.snapshot, place) ? BorderStyle.Solid : BorderStyle.Dashed
    })
    .onClick(() => {
      if (isNearbyExplored(this.snapshot, place)) {
        this.selectedPlaceID = place.id;
      } else {
        this.onExplorePlace(place.id);
      }
    })
  }

  /** 兴趣点距离文案 */
  private poiDistanceText(place: Place): string {
    const meters: number = nearbyDistance(this.snapshot, place);
    if (meters < 0) {
      return '位置未知';
    }
    if (meters >= 1000) {
      return (meters / 1000).toFixed(1) + ' km';
    }
    return String(meters) + ' m';
  }

  @Builder
  filterRow() {
    Row({ space: 8 }) {
      ForEach(FILTERS, (info: FilterInfo) => {
        WaPill({
          text: info.label,
          selected: this.filter === info.value,
          onTap: () => {
            this.filter = info.value;
          }
        })
      }, (info: FilterInfo) => info.value)
      Blank()
    }
    .width('100%')
  }

  @Builder
  lockedCell(place: Place) {
    Stack({ alignContent: Alignment.Center }) {
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor('#80FBF4E9')
        .borderRadius(WASize.cardRadiusSm)
        .border({
          width: 1,
          color: WAColor.line,
          style: BorderStyle.Dashed,
          radius: WASize.cardRadiusSm
        })

      Column({ space: 5 }) {
        Text('?')
          .fontSize(26)
          .fontWeight(FontWeight.Bold)
          .fontColor('#B3A69C8C')
        // 未解锁：只给类别，不给地名（走过去才知道是哪）
        Text('是个「' + place.category + '」')
          .fontSize(WAFont.microSm)
          .fontColor(WAColor.ink3)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .padding({ left: 6, right: 6 })
      }
    }
    .width('100%')
    .height('100%')
  }

  @Builder
  collectedCell(place: Place, card: PlaceCard) {
    Column({ space: 0 }) {
      SymbolGlyph($r('sys.symbol.' + categorySymbol(place.category)))
        .fontSize(26)
        .fontColor([WAColor.ink2])
        .renderingStrategy(SymbolRenderingStrategy.SINGLE)
        .width('100%')

      Text(place.name)
        .fontSize(WAFont.captionSm)
        .fontWeight(FontWeight.Medium)
        .fontColor(WAColor.ink)
        .maxLines(2)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
        .width('100%')
        .margin({ top: 4 })

      Blank()

      Row() {
        Text(formatShortDate(card.collectedAt))
          .fontSize(WAFont.microSm)
          .fontColor(WAColor.ink3)

        Blank()

        Circle()
          .width(5)
          .height(5)
          .fill(rarityColor(place.rarity))
      }
      .width('100%')
    }
    .width('100%')
    .height('100%')
    .padding(10)
    .backgroundColor(WAColor.paper)
    .borderRadius(WASize.cardRadiusSm)
    .border({ width: 1, color: WAColor.line, radius: WASize.cardRadiusSm })
    .shadow({ radius: 8, color: WAColor.shadowSoft, offsetX: 0, offsetY: 4 })
  }

  @Builder
  cardCell(place: Place) {
    Column() {
      if (this.cardFor(place.id) !== undefined) {
        this.collectedCell(place, this.cardFor(place.id) as PlaceCard)
      } else {
        this.lockedCell(place)
      }
    }
    .width(this.cardWidth())
    .height(this.cardHeight())
    .margin({ bottom: 10 })
    .onClick(() => {
      if (this.isCollected(place.id)) {
        this.selectedPlaceID = place.id;
      }
    })
  }

  @Builder
  grid() {
    Flex({ wrap: FlexWrap.Wrap, justifyContent: FlexAlign.SpaceBetween }) {
      ForEach(this.visiblePlaces(), (place: Place) => {
        this.cardCell(place)
      }, (place: Place) => place.id)
    }
    .width('100%')
  }

  // ============================================================
  // 放大查看
  // ============================================================

  @Builder
  detailOverlay(place: Place) {
    Stack({ alignContent: Alignment.Center }) {
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor(WAColor.scrim)
        .onClick(() => {
          this.selectedPlaceID = '';
        })

      Scroll() {
        Column({ space: 14 }) {
          Row() {
            WaMicroLabel({ text: '图鉴 · ' + areaWord(place.area) })
            Blank()
            WaRarityBadge({ rarity: place.rarity })
          }
          .width('100%')

          Column({ space: 6 }) {
            SymbolGlyph($r('sys.symbol.' + categorySymbol(place.category)))
              .fontSize(40)
              .fontColor([WAColor.amber])
              .renderingStrategy(SymbolRenderingStrategy.SINGLE)
            Text(place.name)
              .fontSize(WAFont.title)
              .fontWeight(FontWeight.Bold)
              .fontColor(WAColor.ink)
              .textAlign(TextAlign.Center)
              .maxLines(2)

            if (this.cardFor(place.id) !== undefined) {
              Text(this.cardSerialText(place.id) + ' · ' + this.cardDateText(place.id))
                .fontSize(WAFont.micro)
                .fontColor(WAColor.ink3)
            }
          }
          .width('100%')

          WaHairline()

          // 到达实拍：本地优先（离线也有），否则提示登录后同步
          if (this.hasCardPhoto(place.id)) {
            Column({ space: 6 }) {
              WaMicroLabel({ text: '你拍的' })
              Image(this.cardPhotoUri(place.id))
                .width('100%')
                .height(180)
                .objectFit(ImageFit.Cover)
                .borderRadius(WASize.cardRadiusSm)
                .border({ width: 1, color: WAColor.line, radius: WASize.cardRadiusSm })
                .alt($r('app.media.app_icon'))
              if (this.cardPhotoRemote(place.id).length > 0) {
                Text('已上传 · 换机可找回')
                  .fontSize(WAFont.microSm)
                  .fontColor(WAColor.teal)
                  .width('100%')
                  .textAlign(TextAlign.End)
              }
            }
            .width('100%')
            .alignItems(HorizontalAlign.Start)
          }

          Text(place.why)
            .fontSize(WAFont.caption)
            .fontColor(WAColor.ink2)
            .lineHeight(21)
            .width('100%')

          Column({ space: 6 }) {
            WaMicroLabel({ text: '小任务' })
            Text(place.task)
              .fontSize(WAFont.caption)
              .fontColor(WAColor.ink)
              .lineHeight(20)

            if (this.cardFor(place.id) !== undefined) {
              Text(this.isTaskDone(place.id) ? '已完成' : '还没打卡')
                .fontSize(WAFont.micro)
                .fontColor(this.isTaskDone(place.id) ? WAColor.teal : WAColor.ink3)
            }
          }
          .alignItems(HorizontalAlign.Start)
          .width('100%')
          .padding(14)
          .backgroundColor(WAColor.paper2)
          .borderRadius(WASize.cardRadiusSm)

          Button() {
            Text('关闭')
              .fontSize(WAFont.bodySm)
              .fontColor(WAColor.ink2)
          }
          .type(ButtonType.Capsule)
          .height(42)
          .width('100%')
          .backgroundColor(WAColor.paper2)
          .border({ width: 1, color: WAColor.line, radius: WASize.chipRadius })
          .onClick(() => {
            this.selectedPlaceID = '';
          })
        }
        .width('100%')
        .padding(20)
        .backgroundColor(WAColor.paper)
        .borderRadius(WASize.cardRadius)
        .border({ width: 1, color: WAColor.line, radius: WASize.cardRadius })
        .shadow({ radius: 16, color: WAColor.shadow, offsetX: 0, offsetY: 4 })
      }
      .width('100%')
      .constraintSize({ maxWidth: 420 })
      .padding({ left: 32, right: 32 })
      .scrollBar(BarState.Off)
    }
    .width('100%')
    .height('100%')
  }

  /** 左栏：统计 + 附近的惊喜 + 附近的兴趣点（折叠屏展开态） */
  @Builder
  wideLeftPane() {
    Column({ space: 0 }) {
      this.statsLine()

      Column() {
        this.almostThereCard()
      }
      .margin({ top: 12 })

      Column() {
        this.nearbyHintsSection()
      }
      .margin({ top: 12 })

      Column() {
        this.nearbyPoiSection()
      }
      .margin({ top: 12 })
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
  }

  /** 右栏：筛选 + 图鉴网格 */
  @Builder
  wideRightPane() {
    Column({ space: 0 }) {
      this.filterRow()

      Column() {
        this.grid()
      }
      .margin({ top: 12 })
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
  }

  build() {
    Stack({ alignContent: Alignment.TopStart }) {
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor(WAColor.cream)

      Scroll() {
        Column({ space: 0 }) {
          this.header()

          if (this.isWide()) {
            // 折叠屏展开态：左右分屏（同一个 Scroll 内，两列各自独立排布）
            Row({ space: 20 }) {
              Column() {
                this.wideLeftPane()
              }
              .layoutWeight(1)
              .alignItems(HorizontalAlign.Start)
              .padding({ top: 8 })

              Column() {
                this.wideRightPane()
              }
              .layoutWeight(1)
              .alignItems(HorizontalAlign.Start)
              .padding({ top: 8 })
            }
            .width('100%')
            .alignItems(VerticalAlign.Top)
          } else {
            Column({ space: 0 }) {
              Column() {
                this.statsLine()
              }
              .margin({ top: 8 })

              // 收集进度：只差一张 / 还差 N 张（点击最近的一张直接出发）
              Column() {
                this.almostThereCard()
              }
              .margin({ top: 12 })

              // 附近的惊喜：隐晦提示（点一下开始探寻）
              Column() {
                this.nearbyHintsSection()
              }
              .margin({ top: 12 })

              // 附近的兴趣点（未探索 = 问号，点击开始探索）
              Column() {
                this.nearbyPoiSection()
              }
              .margin({ top: 12 })

              Column() {
                this.filterRow()
              }
              .margin({ top: 12 })

              Column() {
                this.grid()
              }
              .margin({ top: 14 })
            }
            .width('100%')
          }
        }
        .width('100%')
        .constraintSize({ maxWidth: this.isWide() ? '100%' : WASize.contentMaxWidth })
        .padding({
          left: WASize.pagePadding,
          right: WASize.pagePadding,
          top: 8,
          bottom: 24
        })
      }
      .width('100%')
      .layoutWeight(1)
      .scrollBar(BarState.Off)

      if (this.selectedPlace() !== undefined) {
        this.detailOverlay(this.selectedPlace() as Place)
      }
    }
    .width('100%')
    .height('100%')
  }
}
