/**
 * 盲走 BlindWalk · HarmonyOS ArkUI — 图鉴 Cards（design-system §5.5 + parity: 附近惊喜）
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

import { AppSnapshot } from '../core/contract';
import { Area, Place, PlaceCard, Rarity } from '../core/types';
import {
  HINT_EMPTY_CTA,
  HINT_FOOTER,
  HINT_TITLE_SUFFIX,
  NearHint,
  nearbyHintCountText,
  nearbyHints
} from '../core/hints';
import {
  BwHairline,
  BwMicroLabel,
  BwPill,
  BwRarityBadge
} from '../components/Common';
import {
  emptySnapshot,
  hiddenCardCount,
  placeOf,
  rareCardCount,
  readSnapshot,
  sortedCards
} from '../components/StoreBridge';
import {
  BWColor,
  BWFont,
  BWSize,
  areaWord,
  rarityColor
} from '../theme/Theme';
import { formatShortDate } from '../components/Format';

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

  @State private snapshot: AppSnapshot = emptySnapshot();
  @State private filter: CardFilter = CardFilter.All;
  @State private selectedPlaceID: string = '';

  aboutToAppear(): void {
    this.load();
  }

  onRevisionChanged(propName: string): void {
    this.load();
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
    if (this.winHeight < BWSize.shortHeightBreakpoint) {
      return 4;
    }
    if (this.winWidth >= BWSize.wideBreakpoint) {
      return 5;
    }
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
    return this.winHeight < BWSize.shortHeightBreakpoint ? 112 : 128;
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
      Text('回忆册')
        .fontSize(BWFont.hero)
        .fontWeight(FontWeight.Bold)
        .fontColor(BWColor.ink)

      Blank()

      Text('☰')
        .fontSize(BWFont.body)
        .fontColor(BWColor.ink2)
        .textAlign(TextAlign.Center)
        .width(36)
        .height(36)
        .backgroundColor(BWColor.paper)
        .borderRadius(18)
        .border({ width: 1, color: BWColor.line, radius: 18 })
        .onClick(() => {
          this.cycleFilter();
        })
    }
    .width('100%')
  }

  @Builder
  statsLine() {
    Row({ space: 6 }) {
      Text('已收集')
        .fontSize(BWFont.captionSm)
        .fontColor(BWColor.ink3)
      Text(String(this.snapshot.profile.cards.length) + '/' + String(this.snapshot.places.length))
        .fontSize(BWFont.captionSm)
        .fontWeight(FontWeight.Bold)
        .fontColor(BWColor.ink)
      Text('·')
        .fontSize(BWFont.captionSm)
        .fontColor(BWColor.ink3)
      Text('稀有')
        .fontSize(BWFont.captionSm)
        .fontColor(BWColor.ink3)
      Text(String(rareCardCount(this.snapshot)))
        .fontSize(BWFont.captionSm)
        .fontWeight(FontWeight.Bold)
        .fontColor(BWColor.ink)
      Text('·')
        .fontSize(BWFont.captionSm)
        .fontColor(BWColor.ink3)
      Text('隐藏')
        .fontSize(BWFont.captionSm)
        .fontColor(BWColor.ink3)
      Text(String(hiddenCardCount(this.snapshot)))
        .fontSize(BWFont.captionSm)
        .fontWeight(FontWeight.Bold)
        .fontColor(BWColor.ink)
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
          .fontSize(BWFont.caption)
          .fontWeight(FontWeight.Bold)
          .fontColor(BWColor.ink)
        Text(nearbyHintCountText(this.nearbyHintList().length))
          .fontSize(BWFont.microSm)
          .fontColor(BWColor.ink3)
          .maxLines(1)
        Blank()
      }
      .width('100%')

      if (this.nearbyHintList().length === 0) {
        // 空状态：CTA 去埋一个
        Button() {
          Text(HINT_EMPTY_CTA)
            .fontSize(BWFont.caption)
            .fontWeight(FontWeight.Medium)
            .fontColor(BWColor.amberDeep)
            .textAlign(TextAlign.Center)
            .width('100%')
        }
        .type(ButtonType.Normal)
        .height(42)
        .width('100%')
        .backgroundColor('#0DE89B4C')
        .borderRadius(BWSize.cardRadiusXs)
        .border({
          width: 1,
          color: '#59E89B4C',
          radius: BWSize.cardRadiusXs,
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
    .backgroundColor(BWColor.paper)
    .borderRadius(BWSize.cardRadius)
    .border({ width: 1, color: BWColor.line, radius: BWSize.cardRadius })
    .shadow({ radius: 12, color: BWColor.shadowSoft, offsetX: 0, offsetY: 6 })
  }

  /** 一张隐晦提示卡：emoji + 「距离分档 · 有人留下一张照片」+ 氛围句 + 底部提示 */
  @Builder
  hintCard(hint: NearHint) {
    Row({ space: 10 }) {
      // 作者 emoji：三端唯一允许的社交信息
      Text(hint.emoji)
        .fontSize(BWFont.titleMd)
        .textAlign(TextAlign.Center)
        .width(32)
        .height(32)
        .backgroundColor(BWColor.amberSoft)
        .borderRadius(10)

      Column({ space: 2 }) {
        Text(hint.distanceText + ' · ' + HINT_TITLE_SUFFIX)
          .fontSize(BWFont.caption)
          .fontWeight(FontWeight.Medium)
          .fontColor(BWColor.ink)
          .maxLines(2)
          .width('100%')

        Text(hint.atmosphere)
          .fontSize(BWFont.captionSm)
          .fontColor(BWColor.ink2)
          .maxLines(2)
          .lineHeight(18)
          .width('100%')

        Text(HINT_FOOTER)
          .fontSize(BWFont.microSm)
          .fontColor(BWColor.ink3)
          .maxLines(1)
          .width('100%')
      }
      .layoutWeight(1)
      .alignItems(HorizontalAlign.Start)

      Text('›')
        .fontSize(BWFont.caption)
        .fontColor(BWColor.ink3)
    }
    .width('100%')
    .alignItems(VerticalAlign.Top)
    .padding({ left: 12, right: 12, top: 11, bottom: 11 })
    .backgroundColor(BWColor.paper)
    .borderRadius(BWSize.cardRadiusXs)
    .border({ width: 1, color: '#2EE89B4C', radius: BWSize.cardRadiusXs })
    .onClick(() => {
      // 只把 id 交出去；其余信息（区域/线索/照片）由探寻页按距离决定是否给
      this.onOpenSeek(hint.id);
    })
  }

  @Builder
  filterRow() {
    Row({ space: 8 }) {
      ForEach(FILTERS, (info: FilterInfo) => {
        BwPill({
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
  lockedCell() {
    Stack({ alignContent: Alignment.Center }) {
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor('#80FBF4E9')
        .borderRadius(BWSize.cardRadiusSm)
        .border({
          width: 1,
          color: BWColor.line,
          style: BorderStyle.Dashed,
          radius: BWSize.cardRadiusSm
        })

      Column({ space: 5 }) {
        Text('?')
          .fontSize(26)
          .fontWeight(FontWeight.Bold)
          .fontColor('#B3A69C8C')
        Text('未解锁')
          .fontSize(BWFont.microSm)
          .fontColor(BWColor.ink3)
      }
    }
    .width('100%')
    .height('100%')
  }

  @Builder
  collectedCell(place: Place, card: PlaceCard) {
    Column({ space: 0 }) {
      Text(place.emoji)
        .fontSize(26)
        .width('100%')

      Text(place.name)
        .fontSize(BWFont.captionSm)
        .fontWeight(FontWeight.Medium)
        .fontColor(BWColor.ink)
        .maxLines(2)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
        .width('100%')
        .margin({ top: 4 })

      Blank()

      Row() {
        Text(formatShortDate(card.collectedAt))
          .fontSize(BWFont.microSm)
          .fontColor(BWColor.ink3)

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
    .backgroundColor(BWColor.paper)
    .borderRadius(BWSize.cardRadiusSm)
    .border({ width: 1, color: BWColor.line, radius: BWSize.cardRadiusSm })
    .shadow({ radius: 8, color: BWColor.shadowSoft, offsetX: 0, offsetY: 4 })
  }

  @Builder
  cardCell(place: Place) {
    Column() {
      if (this.cardFor(place.id) !== undefined) {
        this.collectedCell(place, this.cardFor(place.id) as PlaceCard)
      } else {
        this.lockedCell()
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
        .backgroundColor(BWColor.scrim)
        .onClick(() => {
          this.selectedPlaceID = '';
        })

      Scroll() {
        Column({ space: 14 }) {
          Row() {
            BwMicroLabel({ text: '图鉴 · ' + areaWord(place.area) })
            Blank()
            BwRarityBadge({ rarity: place.rarity })
          }
          .width('100%')

          Column({ space: 6 }) {
            Text(place.emoji)
              .fontSize(40)
            Text(place.name)
              .fontSize(BWFont.title)
              .fontWeight(FontWeight.Bold)
              .fontColor(BWColor.ink)
              .textAlign(TextAlign.Center)
              .maxLines(2)

            if (this.cardFor(place.id) !== undefined) {
              Text(this.cardSerialText(place.id) + ' · ' + this.cardDateText(place.id))
                .fontSize(BWFont.micro)
                .fontColor(BWColor.ink3)
            }
          }
          .width('100%')

          BwHairline()

          Text(place.why)
            .fontSize(BWFont.caption)
            .fontColor(BWColor.ink2)
            .lineHeight(21)
            .width('100%')

          Column({ space: 6 }) {
            BwMicroLabel({ text: '🎯 小任务' })
            Text(place.task)
              .fontSize(BWFont.caption)
              .fontColor(BWColor.ink)
              .lineHeight(20)

            if (this.cardFor(place.id) !== undefined) {
              Text(this.isTaskDone(place.id) ? '已完成' : '还没打卡')
                .fontSize(BWFont.micro)
                .fontColor(this.isTaskDone(place.id) ? BWColor.teal : BWColor.ink3)
            }
          }
          .alignItems(HorizontalAlign.Start)
          .width('100%')
          .padding(14)
          .backgroundColor(BWColor.paper2)
          .borderRadius(BWSize.cardRadiusSm)

          Button() {
            Text('关闭')
              .fontSize(BWFont.bodySm)
              .fontColor(BWColor.ink2)
          }
          .type(ButtonType.Capsule)
          .height(42)
          .width('100%')
          .backgroundColor(BWColor.paper2)
          .border({ width: 1, color: BWColor.line, radius: BWSize.chipRadius })
          .onClick(() => {
            this.selectedPlaceID = '';
          })
        }
        .width('100%')
        .padding(20)
        .backgroundColor(BWColor.paper)
        .borderRadius(BWSize.cardRadius)
        .border({ width: 1, color: BWColor.line, radius: BWSize.cardRadius })
        .shadow({ radius: 24, color: BWColor.shadowLift, offsetX: 0, offsetY: 16 })
      }
      .width('100%')
      .constraintSize({ maxWidth: 420 })
      .padding({ left: 32, right: 32 })
      .scrollBar(BarState.Off)
    }
    .width('100%')
    .height('100%')
  }

  build() {
    Stack({ alignContent: Alignment.TopStart }) {
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor(BWColor.cream)

      Scroll() {
        Column({ space: 0 }) {
          this.header()

          Column() {
            this.statsLine()
          }
          .margin({ top: 8 })

          // 附近的惊喜：隐晦提示（点一下开始探寻）
          Column() {
            this.nearbyHintsSection()
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
        .constraintSize({ maxWidth: BWSize.contentMaxWidth })
        .padding({
          left: BWSize.pagePadding,
          right: BWSize.pagePadding,
          top: 8,
          bottom: 24
        })
      }
      .width('100%')
      .height('100%')
      .scrollBar(BarState.Off)

      if (this.selectedPlace() !== undefined) {
        this.detailOverlay(this.selectedPlace() as Place)
      }
    }
    .width('100%')
    .height('100%')
  }
}
