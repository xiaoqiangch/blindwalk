/**
 * 盲走 BlindWalk · HarmonyOS ArkUI — 今日 Home（design-system §5.1）
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
  BwAvatar,
  BwMicroLabel,
  BwPrimaryButton,
  BwStatsRow,
  StatItem
} from '../components/Common';
import { BwBoxArt } from '../components/BoxArt';
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
import { BWColor, BWFont, BWSize } from '../theme/Theme';
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
  new FriendInfo('小满', '🐱', false),
  new FriendInfo('阿岛', '🎧', false),
  new FriendInfo('77', '🌙', true),
  new FriendInfo('老陈', '🍜', false)
];

@Component
export struct HomeView {
  /** Index 每次状态变化后 +1，本页收到后重读 snapshot */
  @Prop @Watch('onRevisionChanged') revision: number = 0;
  @Prop winWidth: number = 400;
  @Prop winHeight: number = 800;

  onOpenSetup: () => void = () => {
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
    return this.winWidth >= BWSize.wideBreakpoint;
  }

  private isShort(): boolean {
    return this.winHeight < BWSize.shortHeightBreakpoint;
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

  private latestEmoji(): string {
    const card: PlaceCard | undefined = latestCard(this.snapshot.profile);
    if (card === undefined) {
      return '🃏';
    }
    const place: Place | undefined = placeOf(this.snapshot, card.placeID);
    return place === undefined ? '🃏' : place.emoji;
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

  private showSurpriseSoon(): void {
    promptAction.showToast({ message: '埋惊喜 / 寻惊喜即将开放', duration: 2000 });
  }

  // ============================================================
  // 区块
  // ============================================================

  @Builder
  topBar() {
    Row({ space: 8 }) {
      Text(greeting(this.snapshot.profile.name))
        .fontSize(BWFont.titleSm)
        .fontWeight(FontWeight.Medium)
        .fontColor(BWColor.ink)
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
        .layoutWeight(1)

      if (this.snapshot.demoMode) {
        Row({ space: 3 }) {
          Text('●')
            .fontSize(7)
            .fontColor(BWColor.amberDeep)
          Text('演示')
            .fontSize(BWFont.microSm)
            .fontWeight(FontWeight.Medium)
            .fontColor(BWColor.amberDeep)
        }
        .padding({ left: 8, right: 8, top: 4, bottom: 4 })
        .backgroundColor(BWColor.amberSoft)
        .borderRadius(BWSize.chipRadius)
      }

      Row({ space: 4 }) {
        Text('🔥')
          .fontSize(BWFont.captionSm)
        Text(this.snapshot.profile.streakDays + ' 天')
          .fontSize(BWFont.captionSm)
          .fontWeight(FontWeight.Medium)
          .fontColor(BWColor.ink)
      }
      .height(28)
      .padding({ left: 10, right: 10 })
      .backgroundColor(BWColor.paper)
      .borderRadius(BWSize.chipRadius)
      .border({ width: 1, color: BWColor.line, radius: BWSize.chipRadius })
    }
    .width('100%')
  }

  @Builder
  heroText() {
    Column({ space: 6 }) {
      Text('今天，想去哪儿？')
        .fontSize(this.isShort() ? 22 : BWFont.hero)
        .fontWeight(FontWeight.Bold)
        .fontColor(BWColor.ink)
        .maxLines(1)

      Text('不用选。让城市替你选。')
        .fontSize(BWFont.bodySm)
        .fontColor(BWColor.ink2)
    }
    .alignItems(HorizontalAlign.Start)
    .width('100%')
    .margin({ top: 17, bottom: 16 })
  }

  @Builder
  resumeChip() {
    Row({ space: 3 }) {
      Text('继续 · ' + this.sessionRemaining() + ' m')
        .fontSize(BWFont.captionSm)
        .fontWeight(FontWeight.Medium)
        .fontColor(BWColor.ink2)
      Text('›')
        .fontSize(BWFont.caption)
        .fontColor(BWColor.ink2)
    }
    .height(24)
    .padding({ left: 10, right: 10 })
    .backgroundColor(BWColor.paperHalf)
    .borderRadius(BWSize.chipRadius)
    .border({ width: 1, color: BWColor.line, radius: BWSize.chipRadius })
    .onClick(() => {
      this.onOpenJourney();
    })
  }

  @Builder
  blindBoxCard() {
    Column({ space: 0 }) {
      Row() {
        BwMicroLabel({ text: '今日盲盒' })
        Blank()
        if (this.hasActiveSession()) {
          this.resumeChip()
        }
      }
      .width('100%')
      .constraintSize({ minHeight: 24 })

      Row() {
        BwBoxArt({ size: this.isShort() ? 86 : 112 })
      }
      .width('100%')
      .justifyContent(FlexAlign.Center)
      .margin({ top: 2, bottom: 8 })

      BwPrimaryButton({
        title: '开一个盲盒',
        onTap: () => {
          this.onOpenSetup();
        }
      })

      Row() {
        Blank()
        Text('预计 ' + this.selectedDurationMinutes() + ' 分钟 · ' +
          kilometers(this.durationRadiusMeters()) + ' 内')
          .fontSize(BWFont.micro)
          .fontColor(BWColor.ink3)
      }
      .width('100%')
      .margin({ top: 8 })
    }
    .width('100%')
    .padding({ left: 18, right: 18, top: 15, bottom: 14 })
    .linearGradient({
      angle: 135,
      colors: [
        [BWColor.kraftTop, 0.0],
        [BWColor.kraftMid, 0.5],
        [BWColor.kraftBottom, 1.0]
      ]
    })
    .borderRadius(BWSize.cardRadius)
    .border({ width: 1, color: BWColor.inkSoft, radius: BWSize.cardRadius })
    .shadow({ radius: 20, color: BWColor.shadow, offsetX: 0, offsetY: 12 })
  }

  @Builder
  statsRow() {
    BwStatsRow({ items: this.statsItems(), roomy: !this.isShort() })
  }

  @Builder
  friendsRow() {
    Row({ space: 14 }) {
      Row({ space: -7 }) {
        ForEach(FRIENDS, (friend: FriendInfo) => {
          BwAvatar({
            emoji: friend.emoji,
            size: 42,
            onlineDot: friend.online,
            name: friend.name
          })
        }, (friend: FriendInfo) => friend.name)
      }

      Column({ space: 1 }) {
        Text('3 个朋友')
          .fontSize(BWFont.caption)
          .fontWeight(FontWeight.Medium)
          .fontColor(BWColor.ink2)
        Text('今晚也在散步')
          .fontSize(BWFont.caption)
          .fontColor(BWColor.ink3)
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
        Text(this.latestEmoji())
          .fontSize(20)
          .textAlign(TextAlign.Center)
          .width(46)
          .height(56)
          .backgroundColor(BWColor.kraftTop)
          .borderRadius(BWSize.cardRadiusXs)
          .border({ width: 1, color: BWColor.inkSoft, radius: BWSize.cardRadiusXs })

        Column({ space: 2 }) {
          BwMicroLabel({ text: '上一次的惊喜' })
          Text(this.latestName())
            .fontSize(BWFont.bodySm)
            .fontWeight(FontWeight.Medium)
            .fontColor(BWColor.ink)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
          Text(this.latestDayText())
            .fontSize(BWFont.captionSm)
            .fontColor(BWColor.ink3)
        }
        .alignItems(HorizontalAlign.Start)
        .layoutWeight(1)

        Text('›')
          .fontSize(BWFont.caption)
          .fontColor(BWColor.ink3)
      }
      .width('100%')
      .padding({ left: 10, right: 14, top: 10, bottom: 10 })
      .backgroundColor(BWColor.paper)
      .borderRadius(20)
      .border({ width: 1, color: BWColor.line, radius: 20 })
      .shadow({ radius: 12, color: BWColor.shadowSoft, offsetX: 0, offsetY: 8 })
      .onClick(() => {
        this.onOpenCards();
      })
    } else {
      Column({ space: 4 }) {
        Text('第一盒还没开。')
          .fontSize(BWFont.bodySm)
          .fontWeight(FontWeight.Medium)
          .fontColor(BWColor.ink)
        Text('城市已经准备好了。')
          .fontSize(BWFont.caption)
          .fontColor(BWColor.ink3)
      }
      .alignItems(HorizontalAlign.Start)
      .width('100%')
      .padding({ left: 18, right: 18, top: 15, bottom: 15 })
      .backgroundColor(BWColor.paperHalf)
      .borderRadius(20)
      .border({ width: 1, color: BWColor.line, style: BorderStyle.Dashed, radius: 20 })
    }
  }

  @Builder
  surpriseHub() {
    Column({ space: 0 }) {
      Row({ space: 8 }) {
        BwMicroLabel({ text: '惊喜社区' })
        Blank()
        Text('我埋了 ' + mySurpriseCount(this.snapshot) + ' · 被找到 ' +
          myFoundSurpriseCount(this.snapshot))
          .fontSize(BWFont.micro)
          .fontColor(BWColor.ink3)
          .maxLines(1)
      }
      .width('100%')

      Text('留一张照片给陌生人，或者去找到别人的。')
        .fontSize(BWFont.caption)
        .fontColor(BWColor.ink2)
        .lineHeight(20)
        .width('100%')
        .margin({ top: 7 })

      Row({ space: 8 }) {
        Button() {
          Text('埋下一个')
            .fontSize(BWFont.caption)
            .fontWeight(FontWeight.Medium)
            .fontColor(BWColor.ink)
        }
        .type(ButtonType.Capsule)
        .height(36)
        .layoutWeight(1)
        .backgroundColor(BWColor.amberSoftStrong)
        .border({ width: 1, color: BWColor.amberBorder, radius: BWSize.chipRadius })
        .onClick(() => {
          this.showSurpriseSoon();
        })

        Button() {
          Text(explorableSurpriseCount(this.snapshot) > 0
            ? '去寻宝 · ' + explorableSurpriseCount(this.snapshot) + ' 个在等你'
            : '去寻宝')
            .fontSize(BWFont.caption)
            .fontWeight(FontWeight.Medium)
            .fontColor(BWColor.ink2)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
        }
        .type(ButtonType.Capsule)
        .height(36)
        .layoutWeight(1)
        .backgroundColor(BWColor.paper2)
        .border({ width: 1, color: BWColor.line, radius: BWSize.chipRadius })
        .onClick(() => {
          this.showSurpriseSoon();
        })
      }
      .width('100%')
      .margin({ top: 13 })

      Row({ space: 3 }) {
        Text('我的惊喜')
          .fontSize(BWFont.micro)
          .fontColor(BWColor.ink3)
        Text('›')
          .fontSize(BWFont.micro)
          .fontColor(BWColor.ink3)
      }
      .margin({ top: 10 })
      .onClick(() => {
        this.showSurpriseSoon();
      })
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
    .padding({ left: 18, right: 18, top: 16, bottom: 15 })
    .backgroundColor(BWColor.paper)
    .borderRadius(BWSize.cardRadius)
    .border({ width: 1, color: BWColor.line, radius: BWSize.cardRadius })
    .shadow({ radius: 14, color: BWColor.shadowSoft, offsetX: 0, offsetY: 9 })
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
        .backgroundColor(BWColor.cream)

      Scroll() {
        Column({ space: 0 }) {
          if (this.isWide()) {
            this.wideContent()
          } else {
            this.narrowContent()
          }
        }
        .width('100%')
        .constraintSize({ maxWidth: BWSize.contentMaxWidth })
        .padding({ left: BWSize.pagePadding, right: BWSize.pagePadding, top: 6, bottom: 26 })
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
