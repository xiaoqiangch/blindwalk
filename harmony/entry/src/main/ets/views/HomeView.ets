/**
 * 步迷 Walkaholic · HarmonyOS ArkUI — 今日 Home（design-system §5.1）
 *
 * 视觉基准：prototype/web/app.js homeHTML + screenshots/showcase.png
 * 结构：顶栏 → 大头文案 → 今晚的盲盒主卡 → 统计 → 好友在走 → 上一次的惊喜 → 惊喜社区入口
 *
 * 宽屏（折叠屏展开态 / 平板，≥600vp）走双列 + 内容限宽 620vp（docs/foldable.md）。
 * 保密规则：本页不读取 currentPlace.name；「上一次的惊喜」只用已收录（已揭晓）卡片的地点名。
 */

import { promptAction } from '@kit.ArkUI';
import { AppSnapshot } from '../core/contract';
import { Place, PlaceCard, QuestSession, WalkDuration } from '../core/types';
import {
  WaAvatar,
  WaMicroLabel,
  WaPrimaryButton,
  WaStatsRow,
  StatItem
} from '../components/Common';
import { WaBoxArt } from '../components/BoxArt';
import { categorySymbol } from '../components/WaSymbol';
import {
  activeSession,
  emptySnapshot,
  explorableSurpriseCount,
  latestCard,
  mySurpriseCount,
  myFoundSurpriseCount,
  placeOf,
  readSnapshot
} from '../components/StoreBridge';
import { WAColor, WAFont, WASize } from '../theme/Theme';
import { greeting, kilometers, relativeDay } from '../components/Format';

class FriendInfo {
  name: string;
  emoji: string;
  online: boolean;

  constructor(name: string, emoji: string, online: boolean) {
    this.name = name;
    this.emoji = emoji;
    this.online = online;
  }
}

const FRIENDS: FriendInfo[] = [
  new FriendInfo('小满', 'person_2', false),
  new FriendInfo('阿岛', 'headphones_fill', false),
  new FriendInfo('77', 'sun_max', true),
  new FriendInfo('老陈', 'leaf_fill', false)
];

@Component
export struct HomeView {
  /** Index 每次状态变化后 +1，本页收到后重读 snapshot */
  @Prop @Watch('onRevisionChanged') revision: number = 0;
  @Prop winWidth: number = 400;
  @Prop winHeight: number = 800;

  onOpenSetup: () => void = () => {
  };
  /** 打开埋惊喜面板（首页「埋下一个」/「我的惊喜」） */
  onOpenBury: () => void = () => {
  };
  onOpenJourney: () => void = () => {
  };
  onOpenCards: () => void = () => {
  };

  @State private snapshot: AppSnapshot = emptySnapshot();

  aboutToAppear(): void {
    this.load();
  }

  onRevisionChanged(propName: string): void {
    this.load();
  }

  private load(): void {
    this.snapshot = readSnapshot(this.snapshot);
  }

  private isWide(): boolean {
    return this.winWidth >= WASize.wideBreakpoint;
  }

  private isShort(): boolean {
    return this.winHeight < WASize.shortHeightBreakpoint;
  }

  private sessionRemaining(): number {
    const session: QuestSession | undefined = activeSession(this.snapshot);
    if (session === undefined) {
      return 0;
    }
    return session.remainingMeters;
  }

  private hasActiveSession(): boolean {
    return activeSession(this.snapshot) !== undefined;
  }

  private hasLastSurprise(): boolean {
    const card: PlaceCard | undefined = latestCard(this.snapshot.profile);
    if (card === undefined) {
      return false;
    }
    return placeOf(this.snapshot, card.placeID) !== undefined;
  }

  private latestSymbol(): string {
    const card: PlaceCard | undefined = latestCard(this.snapshot.profile);
    if (card === undefined) {
      return 'pin';
    }
    const place: Place | undefined = placeOf(this.snapshot, card.placeID);
    return place === undefined ? 'pin' : categorySymbol(place.category);
  }

  private latestName(): string {
    const card: PlaceCard | undefined = latestCard(this.snapshot.profile);
    if (card === undefined) {
      return '一张回忆卡';
    }
    const place: Place | undefined = placeOf(this.snapshot, card.placeID);
    return place === undefined ? '一张回忆卡' : place.name;
  }

  private latestDayText(): string {
    const card: PlaceCard | undefined = latestCard(this.snapshot.profile);
    return card === undefined ? '' : relativeDay(card.collectedAt);
  }

  private selectedDurationMinutes(): number {
    return this.snapshot.selectedDuration === WalkDuration.M15
      ? 15
      : (this.snapshot.selectedDuration === WalkDuration.M60 ? 60 : 30);
  }

  private durationRadiusMeters(): number {
    const duration: WalkDuration = this.snapshot.selectedDuration;
    if (duration === WalkDuration.M15) {
      return 900;
    }
    if (duration === WalkDuration.M60) {
      return 3000;
    }
    return 1600;
  }

  private statsItems(): StatItem[] {
    const items: StatItem[] = [];
    const weekly: StatItem = {
      value: String(this.snapshot.profile.weeklySurprise),
      label: '本周惊喜值'
    };
    const cards: StatItem = {
      value: String(this.snapshot.profile.cards.length),
      label: '收集卡片'
    };
    const streak: StatItem = {
      value: String(this.snapshot.profile.streakDays),
      label: '连续天数'
    };
    items.push(weekly);
    items.push(cards);
    items.push(streak);
    return items;
  }

  /** 寻宝列表页尚未移植：只有这里还是提示 */
  private showSeekSoon(): void {
    promptAction.showToast({ message: '寻宝列表还在做，先从图鉴的「附近的惊喜」进', duration: 2400 });
  }

  // ============================================================
  // 区块
  // ============================================================

  @Builder
  topBar() {
    Row({ space: 8 }) {
      Text(greeting(this.snapshot.profile.name))
        .fontSize(WAFont.titleSm)
        .fontWeight(FontWeight.Medium)
        .fontColor(WAColor.ink)
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
        .layoutWeight(1)

      // parity.md §7：演示模式必须显式标注「演示模式 · 内置地点」
      if (this.snapshot.demoMode) {
        Row({ space: 5 }) {
          Circle()
            .width(5)
            .height(5)
            .fill(WAColor.amberDeep)
          Text('演示模式 · 内置地点')
            .fontSize(WAFont.microSm)
            .fontWeight(FontWeight.Medium)
            .fontColor(WAColor.amberDeep)
            .maxLines(1)
        }
        .padding({ left: 9, right: 9, top: 4, bottom: 4 })
        .backgroundColor(WAColor.amberSoft)
        .borderRadius(WASize.chipRadius)
      }

      Row({ space: 4 }) {
        SymbolGlyph($r('sys.symbol.flame'))
          .fontSize(WAFont.captionSm)
          .fontColor([WAColor.ink2])
          .renderingStrategy(SymbolRenderingStrategy.SINGLE)
          .fontSize(WAFont.captionSm)
        Text(this.snapshot.profile.streakDays + ' 天')
          .fontSize(WAFont.captionSm)
          .fontWeight(FontWeight.Medium)
          .fontColor(WAColor.ink)
      }
      .height(28)
      .padding({ left: 10, right: 10 })
      .backgroundColor(WAColor.paper)
      .borderRadius(WASize.chipRadius)
      .border({ width: 1, color: WAColor.line, radius: WASize.chipRadius })
    }
    .width('100%')
  }

  @Builder
  heroText() {
    Column({ space: 6 }) {
      Text('今天，想去哪儿？')
        .fontSize(this.isShort() ? 22 : WAFont.hero)
        .fontWeight(FontWeight.Bold)
        .fontColor(WAColor.ink)
        .maxLines(1)

      Text('不用选。让城市替你选。')
        .fontSize(WAFont.bodySm)
        .fontColor(WAColor.ink2)
    }
    .alignItems(HorizontalAlign.Start)
    .width('100%')
    .margin({ top: 17, bottom: 16 })
  }

  @Builder
  resumeChip() {
    Row({ space: 3 }) {
      Text('继续 · ' + this.sessionRemaining() + ' m')
        .fontSize(WAFont.captionSm)
        .fontWeight(FontWeight.Medium)
        .fontColor(WAColor.ink2)
      Text('›')
        .fontSize(WAFont.caption)
        .fontColor(WAColor.ink2)
    }
    .height(24)
    .padding({ left: 10, right: 10 })
    .backgroundColor(WAColor.paperHalf)
    .borderRadius(WASize.chipRadius)
    .border({ width: 1, color: WAColor.line, radius: WASize.chipRadius })
    .onClick(() => {
      this.onOpenJourney();
    })
  }

  @Builder
  blindBoxCard() {
    Column({ space: 0 }) {
      Row() {
        WaMicroLabel({ text: '今日盲盒' })
        Blank()
        if (this.hasActiveSession()) {
          this.resumeChip()
        }
      }
      .width('100%')
      .constraintSize({ minHeight: 24 })

      Row() {
        WaBoxArt({ artSize: this.isShort() ? 86 : 112 })
      }
      .width('100%')
      .justifyContent(FlexAlign.Center)
      .margin({ top: 2, bottom: 8 })

      WaPrimaryButton({
        title: '开一个盲盒',
        onTap: () => {
          this.onOpenSetup();
        }
      })

      Row() {
        Blank()
        Text('预计 ' + this.selectedDurationMinutes() + ' 分钟 · ' +
          kilometers(this.durationRadiusMeters()) + ' 内')
          .fontSize(WAFont.micro)
          .fontColor(WAColor.ink3)
      }
      .width('100%')
      .margin({ top: 8 })
    }
    .width('100%')
    .padding({ left: 18, right: 18, top: 15, bottom: 14 })
    .backgroundColor(WAColor.paper)
    .borderRadius(WASize.cardRadius)
    .border({ width: 1, color: WAColor.inkSoft, radius: WASize.cardRadius })
    .shadow({ radius: 12, color: WAColor.shadowSoft, offsetX: 0, offsetY: 2 })
  }

  @Builder
  statsRow() {
    WaStatsRow({ items: this.statsItems(), roomy: !this.isShort() })
  }

  @Builder
  friendsRow() {
    Row({ space: 14 }) {
      Row({ space: -7 }) {
        ForEach(FRIENDS, (friend: FriendInfo) => {
          WaAvatar({
            iconName: friend.emoji,
            boxSize: 42,
            onlineDot: friend.online,
            name: friend.name
          })
        }, (friend: FriendInfo) => friend.name)
      }

      Column({ space: 1 }) {
        Text('3 个朋友')
          .fontSize(WAFont.caption)
          .fontWeight(FontWeight.Medium)
          .fontColor(WAColor.ink2)
        Text('今晚也在散步')
          .fontSize(WAFont.caption)
          .fontColor(WAColor.ink3)
      }
      .alignItems(HorizontalAlign.Start)

      Blank()
    }
    .width('100%')
  }

  @Builder
  lastSurpriseSection() {
    if (this.hasLastSurprise()) {
      Row({ space: 12 }) {
        Stack({ alignContent: Alignment.Center }) {
          SymbolGlyph($r('sys.symbol.' + this.latestSymbol()))
            .fontSize(WASize.iconSize)
            .fontColor([WAColor.ink2])
            .renderingStrategy(SymbolRenderingStrategy.SINGLE)
        }
        .width(46)
        .height(56)
        .backgroundColor(WAColor.paper2)
        .borderRadius(WASize.cardRadiusXs)

        Column({ space: 2 }) {
          WaMicroLabel({ text: '上一次的惊喜' })
          Text(this.latestName())
            .fontSize(WAFont.bodySm)
            .fontWeight(FontWeight.Medium)
            .fontColor(WAColor.ink)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
          Text(this.latestDayText())
            .fontSize(WAFont.captionSm)
            .fontColor(WAColor.ink3)
        }
        .alignItems(HorizontalAlign.Start)
        .layoutWeight(1)

        Text('›')
          .fontSize(WAFont.caption)
          .fontColor(WAColor.ink3)
      }
      .width('100%')
      .padding({ left: 10, right: 14, top: 10, bottom: 10 })
      .backgroundColor(WAColor.paper)
      .borderRadius(WASize.cardRadius)
      .border({ width: 1, color: WAColor.line, radius: WASize.cardRadius })
      .shadow({ radius: WASize.cardRadius, color: WAColor.shadowSoft, offsetX: 0, offsetY: 8 })
      .onClick(() => {
        this.onOpenCards();
      })
    } else {
      Column({ space: 4 }) {
        Text('第一盒还没开。')
          .fontSize(WAFont.bodySm)
          .fontWeight(FontWeight.Medium)
          .fontColor(WAColor.ink)
        Text('城市已经准备好了。')
          .fontSize(WAFont.caption)
          .fontColor(WAColor.ink3)
      }
      .alignItems(HorizontalAlign.Start)
      .width('100%')
      .padding({ left: 18, right: 18, top: 15, bottom: 15 })
      .backgroundColor(WAColor.paperHalf)
      .borderRadius(WASize.cardRadius)
      .border({ width: 1, color: WAColor.line, style: BorderStyle.Dashed, radius: WASize.cardRadius })
    }
  }

  @Builder
  surpriseHub() {
    Column({ space: 0 }) {
      Row({ space: 8 }) {
        WaMicroLabel({ text: '惊喜社区' })
        Blank()
        Text('我埋了 ' + mySurpriseCount(this.snapshot) + ' · 被找到 ' +
          myFoundSurpriseCount(this.snapshot))
          .fontSize(WAFont.micro)
          .fontColor(WAColor.ink3)
          .maxLines(1)
      }
      .width('100%')

      Text('留一张照片给陌生人，或者去找到别人的。')
        .fontSize(WAFont.caption)
        .fontColor(WAColor.ink2)
        .lineHeight(20)
        .width('100%')
        .margin({ top: 7 })

      Row({ space: 8 }) {
        Button() {
          Text('埋下一个')
            .fontSize(WAFont.caption)
            .fontWeight(FontWeight.Medium)
            .fontColor(WAColor.ink)
        }
        .type(ButtonType.Capsule)
        .height(36)
        .layoutWeight(1)
        .backgroundColor(WAColor.amberSoftStrong)
        .border({ width: 1, color: WAColor.amberBorder, radius: WASize.chipRadius })
        .onClick(() => {
          this.onOpenBury();
        })

        Button() {
          Text(explorableSurpriseCount(this.snapshot) > 0
            ? '去寻宝 · ' + explorableSurpriseCount(this.snapshot) + ' 个在等你'
            : '去寻宝')
            .fontSize(WAFont.caption)
            .fontWeight(FontWeight.Medium)
            .fontColor(WAColor.ink2)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
        }
        .type(ButtonType.Capsule)
        .height(36)
        .layoutWeight(1)
        .backgroundColor(WAColor.paper2)
        .border({ width: 1, color: WAColor.line, radius: WASize.chipRadius })
        .onClick(() => {
          this.showSeekSoon();
        })
      }
      .width('100%')
      .margin({ top: 13 })

      Row({ space: 3 }) {
        Text('我的惊喜')
          .fontSize(WAFont.micro)
          .fontColor(WAColor.ink3)
        Text('›')
          .fontSize(WAFont.micro)
          .fontColor(WAColor.ink3)
      }
      .margin({ top: 10 })
      .onClick(() => {
        this.onOpenBury();
      })
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
    .padding({ left: 18, right: 18, top: 16, bottom: 15 })
    .backgroundColor(WAColor.paper)
    .borderRadius(WASize.cardRadius)
    .border({ width: 1, color: WAColor.line, radius: WASize.cardRadius })
    .shadow({ radius: 14, color: WAColor.shadowSoft, offsetX: 0, offsetY: 9 })
  }

  // ============================================================
  // 布局
  // ============================================================

  @Builder
  wideContent() {
    Column({ space: 0 }) {
      this.topBar()
      this.heroText()

      Row({ space: 22 }) {
        Column({ space: 0 }) {
          this.blindBoxCard()

          Column() {
            this.lastSurpriseSection()
          }
          .margin({ top: 18 })
        }
        .layoutWeight(1)
        .alignItems(HorizontalAlign.Start)

        Column({ space: 0 }) {
          this.statsRow()

          Column() {
            this.friendsRow()
          }
          .margin({ top: 22 })

          Column() {
            this.surpriseHub()
          }
          .margin({ top: 22 })
        }
        .layoutWeight(1)
        .alignItems(HorizontalAlign.Start)
      }
      .width('100%')
      .alignItems(VerticalAlign.Top)
    }
    .width('100%')
  }

  @Builder
  narrowContent() {
    Column({ space: 0 }) {
      this.topBar()
      this.heroText()
      this.blindBoxCard()

      Column() {
        this.statsRow()
      }
      .margin({ top: 20 })

      Column() {
        this.friendsRow()
      }
      .margin({ top: 22 })

      Column() {
        this.lastSurpriseSection()
      }
      .margin({ top: 20 })

      Column() {
        this.surpriseHub()
      }
      .margin({ top: 20 })
    }
    .width('100%')
  }

  build() {
    Stack({ alignContent: Alignment.TopStart }) {
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor(WAColor.cream)

      Scroll() {
        Column({ space: 0 }) {
          if (this.isWide()) {
            this.wideContent()
          } else {
            this.narrowContent()
          }
        }
        .width('100%')
        .constraintSize({ maxWidth: WASize.contentMaxWidth })
        .padding({ left: WASize.pagePadding, right: WASize.pagePadding, top: 6, bottom: 26 })
      }
      .width('100%')
      .height('100%')
      .scrollBar(BarState.Off)
      .edgeEffect(EdgeEffect.Spring)
    }
    .width('100%')
    .height('100%')
  }
}
