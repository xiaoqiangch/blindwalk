/**
 * 盲走 BlindWalk · HarmonyOS ArkUI — 揭晓 Reveal（design-system §5.4）
 *
 * 视觉基准：prototype/web/app.js revealOpenHTML / revealCardHTML + screenshots/showcase.png
 * 两段：
 * 1. 开盒（1.2s，深色 ink 舞台：盒子抖动 → 盒盖弹飞 + 暖光 + 纸屑）→「这次，城市选了这个地方。」
 * 2. 卡片（稀有度 + 编号 + 类别 emoji + 地点名 + 区域/类别/地址 + 为什么是这里 + 小任务 + 收进图鉴/分享）
 *
 * 保密：只有本页（到达后）才展示 currentPlace.name / address / category。
 */

import { getStore } from '../core/store';
import { AppSnapshot, CollectResult } from '../core/contract';
import { Achievement, Place } from '../core/types';
import {
  BwHairline,
  BwMicroLabel,
  BwRarityBadge,
  BwToastBar
} from '../components/Common';
import { emptyPlace, emptySnapshot, readSnapshot } from '../components/StoreBridge';
import {
  BWColor,
  BWFont,
  BWSize,
  areaWord
} from '../theme/Theme';
import { clockHHMM } from '../components/Format';

const PARTICLE_INDEXES: number[] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

@Component
export struct RevealView {
  @Prop winWidth: number = 400;
  @Prop winHeight: number = 800;

  /** 收录完成 → 回图鉴（Index 切 tab） */
  onGoCards: () => void = () => {
  };
  onChanged: () => void = () => {
  };

  @State private snapshot: AppSnapshot = emptySnapshot();
  @State private showCard: boolean = false;
  @State private boxShake: number = 0;
  @State private lidUp: boolean = false;
  @State private lightOn: boolean = false;
  @State private particlesOut: boolean = false;
  @State private particlesFade: boolean = false;
  @State private hasCollected: boolean = false;
  @State private collecting: boolean = false;
  @State private taskDone: boolean = false;
  @State private toastText: string = '';
  @State private toastIcon: string = '✨';
  @State private achievementText: string = '';

  private stageTimers: number[] = [];
  private toastTimer: number = -1;

  aboutToAppear(): void {
    this.load();
    this.playOpening();
  }

  aboutToDisappear(): void {
    for (let i = 0; i < this.stageTimers.length; i++) {
      clearTimeout(this.stageTimers[i]);
    }
    this.stageTimers = [];
    if (this.toastTimer >= 0) {
      clearTimeout(this.toastTimer);
      this.toastTimer = -1;
    }
  }

  private load(): void {
    this.snapshot = readSnapshot(this.snapshot);
  }

  private place(): Place | undefined {
    return this.snapshot.currentPlace;
  }

  private placeSafe(): Place {
    const place: Place | undefined = this.snapshot.currentPlace;
    return place === undefined ? emptyPlace() : place;
  }

  private isShort(): boolean {
    return this.winHeight < BWSize.shortHeightBreakpoint;
  }

  private serialText(): string {
    const serial: string | undefined = this.snapshot.revealSerial;
    return 'No.' + (serial === undefined ? '----' : serial);
  }

  private placeMeta(place: Place): string {
    let meta: string = areaWord(place.area) + ' · ' + place.category;
    if (place.address !== undefined && place.address.length > 0) {
      meta = meta + ' · ' + place.address;
    }
    if (place.source === 'osm' || place.source === 'geo' || place.source === 'apple') {
      meta = meta + ' · 真实地点';
    }
    return meta;
  }

  // ============================================================
  // 开盒动画
  // ============================================================

  private playOpening(): void {
    // 盒子抖动 600ms（±6° 三次）
    animateTo({
      duration: 100,
      curve: Curve.EaseInOut,
      iterations: 6,
      playMode: PlayMode.Alternate
    }, () => {
      this.boxShake = 6;
    });

    // 盒盖弹开 + 暖光 + 纸屑
    this.stageTimers.push(setTimeout(() => {
      animateTo({ duration: 450, curve: Curve.Friction }, () => {
        this.lidUp = true;
        this.lightOn = true;
        this.particlesOut = true;
      });
    }, 700));

    // 纸屑淡出
    this.stageTimers.push(setTimeout(() => {
      animateTo({ duration: 520, curve: Curve.EaseOut }, () => {
        this.particlesFade = true;
      });
    }, 1050));

    // 1.2s 后切到卡片（先让 store 进入 revealed 态）
    this.stageTimers.push(setTimeout(() => {
      getStore().confirmReveal();
      this.load();
      animateTo({ duration: 520, curve: Curve.EaseOut }, () => {
        this.showCard = true;
      });
    }, 1200));
  }

  // ============================================================
  // Toast
  // ============================================================

  private showToast(text: string, icon: string): void {
    this.toastText = text;
    this.toastIcon = icon;
    if (this.toastTimer >= 0) {
      clearTimeout(this.toastTimer);
    }
    this.toastTimer = setTimeout(() => {
      this.toastText = '';
      this.toastTimer = -1;
    }, 2600);
  }

  private showAchievement(achievement: Achievement): void {
    this.achievementText = '成就解锁 · ' + achievement.name;
    this.stageTimers.push(setTimeout(() => {
      this.achievementText = '';
    }, 3400));
  }

  // ============================================================
  // 交互
  // ============================================================

  private collectCard(): void {
    if (this.collecting) {
      return;
    }
    if (this.hasCollected) {
      this.onGoCards();
      return;
    }

    const result: CollectResult | undefined = getStore().collectCurrentPlace();
    if (result === undefined) {
      this.showToast('这张卡已经在图鉴里了。', '✓');
      this.hasCollected = true;
      this.onChanged();
      return;
    }

    this.hasCollected = true;
    this.load();
    this.onChanged();

    // 卡片缩小飞向 Tab 图鉴，飞完再落回原位
    animateTo({ duration: 520, curve: Curve.Friction }, () => {
      this.collecting = true;
    });
    this.stageTimers.push(setTimeout(() => {
      animateTo({ duration: 420, curve: Curve.EaseOut }, () => {
        this.collecting = false;
      });
    }, 620));

    this.showToast('已收录 · 惊喜值 +' + result.xpGained, '✨');

    // 成就 toast 延后 600ms
    if (result.newAchievements.length > 0) {
      this.stageTimers.push(setTimeout(() => {
        this.showAchievement(result.newAchievements[0]);
      }, 640));
    }
  }

  private shareToCircle(): void {
    if (this.collecting) {
      return;
    }
    // 契约里没有 share API：不假装已发布，温柔地兜底。
    this.showToast('这一版先把惊喜留给自己。', '🫶');
  }

  private toggleTaskDone(): void {
    if (this.collecting) {
      return;
    }
    this.taskDone = !this.taskDone;
  }

  // ============================================================
  // 开盒舞台
  // ============================================================

  @Builder
  particlePiece(index: number) {
    Row()
      .width(5 + (index % 3) * 2)
      .height(7 + (index % 3) * 2)
      .backgroundColor(index % 2 === 0 ? BWColor.amber : BWColor.ember)
      .borderRadius(1.5)
      .rotate({ angle: index * 30 + (this.particlesOut ? 150 : 0) })
      .translate({
        x: this.particlesOut
          ? Math.cos(index / 12 * Math.PI * 2) * (100 + (index % 3) * 28)
          : Math.cos(index / 12 * Math.PI * 2) * 12,
        y: this.particlesOut
          ? Math.sin(index / 12 * Math.PI * 2) * (100 + (index % 3) * 28)
          : Math.sin(index / 12 * Math.PI * 2) * 12
      })
      .opacity(this.particlesFade ? 0 : (this.particlesOut ? 1 : 0))
  }

  @Builder
  openingStage() {
    Stack({ alignContent: Alignment.Center }) {
      // 深色舞台 + 暖光
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor(BWColor.stage)

      Circle()
        .width(300)
        .height(300)
        .fill(this.lightOn ? '#73E89B4C' : '#00E89B4C')
        .blur(46)
        .translate({ y: -this.winHeight * 0.08 })

      Column({ space: 26 }) {
        Stack({ alignContent: Alignment.Center }) {
          // 纸屑
          ForEach(PARTICLE_INDEXES, (index: number) => {
            this.particlePiece(index)
          }, (index: number) => String(index))

          // 盒盖
          Row()
            .width(156)
            .height(35)
            .backgroundColor(BWColor.kraftLid)
            .borderRadius(5)
            .border({ width: 1.8, color: '#E6171410', radius: 5 })
            .rotate({ angle: this.lidUp ? -26 : 0 })
            .translate({ x: this.lidUp ? 36 : 0, y: this.lidUp ? -148 : -38 })

          // 盒体
          Column() {
            Text('?')
              .fontSize(50)
              .fontWeight(FontWeight.Bold)
              .fontColor(BWColor.ink)
          }
          .width(140)
          .height(92)
          .justifyContent(FlexAlign.Center)
          .backgroundColor(BWColor.kraftBody)
          .borderRadius(8)
          .border({ width: 1.8, color: '#E6171410', radius: 8 })
          .translate({ y: 26 })
        }
        .width(320)
        .height(246)
        .rotate({ angle: this.lidUp ? 0 : this.boxShake })

        Text('这次，城市选了这个地方。')
          .fontSize(BWFont.bodySm)
          .fontColor(this.lightOn ? BWColor.creamOnStage : BWColor.creamOnStageDim)
          .textAlign(TextAlign.Center)
          .padding({ left: 40, right: 40 })
      }
      .width('100%')
      .translate({ y: -30 })
    }
    .width('100%')
    .height('100%')
  }

  // ============================================================
  // 卡片舞台
  // ============================================================

  @Builder
  stageBar() {
    Row() {
      Text(clockHHMM())
        .fontSize(13)
        .fontWeight(FontWeight.Medium)
        .fontColor(BWColor.creamOnStage)

      Blank()

      if (this.hasCollected) {
        Text('✕')
          .fontSize(BWFont.caption)
          .fontColor(BWColor.creamOnStageDim)
          .textAlign(TextAlign.Center)
          .width(30)
          .height(30)
          .backgroundColor(BWColor.stageClose)
          .borderRadius(15)
          .border({ width: 1, color: BWColor.stageCloseBorder, radius: 15 })
          .onClick(() => {
            this.onGoCards();
          })
      }
    }
    .width('100%')
    .height(46)
    .padding({ left: BWSize.pagePadding, right: BWSize.pagePadding })
  }

  @Builder
  taskCard(place: Place) {
    Row({ space: 10 }) {
      Column({ space: 4 }) {
        Row({ space: 3 }) {
          Text('🎯')
            .fontSize(BWFont.micro)
          BwMicroLabel({ text: '小任务：' })
        }
        Text(place.task)
          .fontSize(BWFont.caption)
          .fontColor(BWColor.ink)
          .lineHeight(21)
          .layoutWeight(1)
      }
      .alignItems(HorizontalAlign.Start)
      .layoutWeight(1)

      Text(this.taskDone ? '已完成' : '完成后点一下')
        .fontSize(BWFont.micro)
        .fontColor(this.taskDone ? BWColor.teal : BWColor.ink3)
        .onClick(() => {
          this.toggleTaskDone();
        })
    }
    .width('100%')
    .padding({ left: 12, right: 12, top: 10, bottom: 10 })
    .backgroundColor(BWColor.paper2)
    .borderRadius(BWSize.cardRadiusSm)
    .border({ width: 1, color: BWColor.line, radius: BWSize.cardRadiusSm })
  }

  @Builder
  revealCard(place: Place) {
    Column({ space: 0 }) {
      Row() {
        Text(this.serialText())
          .fontSize(BWFont.micro)
          .fontWeight(FontWeight.Medium)
          .fontColor(BWColor.ink3)
          .letterSpacing(1)
        Blank()
        BwRarityBadge({ rarity: place.rarity })
      }
      .width('100%')
      .padding({ bottom: 13 })

      Column({ space: 7 }) {
        Text(place.emoji)
          .fontSize(46)
        Text(place.name)
          .fontSize(BWFont.title)
          .fontWeight(FontWeight.Bold)
          .fontColor(BWColor.ink)
          .textAlign(TextAlign.Center)
          .maxLines(2)
        Text(this.placeMeta(place))
          .fontSize(BWFont.micro)
          .fontColor(BWColor.ink3)
          .textAlign(TextAlign.Center)
          .maxLines(2)
      }
      .width('100%')
      .padding({ bottom: 11 })

      BwHairline()

      Column({ space: 6 }) {
        BwMicroLabel({ text: '为什么是这里：' })
        Text(place.why)
          .fontSize(BWFont.caption)
          .fontColor(BWColor.ink2)
          .lineHeight(21)
      }
      .alignItems(HorizontalAlign.Start)
      .width('100%')
      .padding({ top: 12, bottom: 12 })

      BwHairline()

      Column() {
        this.taskCard(place)
      }
      .margin({ top: 12 })

      Row({ space: 8 }) {
        Button() {
          Text(this.hasCollected ? '去看看图鉴' : '收进图鉴')
            .fontSize(BWFont.bodySm)
            .fontWeight(FontWeight.Medium)
            .fontColor(BWColor.ink)
            .maxLines(1)
        }
        .type(ButtonType.Capsule)
        .height(46)
        .layoutWeight(1)
        .backgroundColor(BWColor.amber)
        .shadow({ radius: 12, color: BWColor.shadow, offsetX: 0, offsetY: 6 })
        .onClick(() => {
          this.collectCard();
        })

        Button() {
          Text('分享')
            .fontSize(BWFont.bodySm)
            .fontWeight(FontWeight.Medium)
            .fontColor(BWColor.ink2)
        }
        .type(ButtonType.Capsule)
        .height(46)
        .width(96)
        .backgroundColor(Color.Transparent)
        .border({ width: 1, color: BWColor.line, radius: BWSize.chipRadius })
        .onClick(() => {
          this.shareToCircle();
        })
      }
      .width('100%')
      .margin({ top: 14 })

      if (this.hasCollected) {
        Text('它现在是你的了。')
          .fontSize(BWFont.micro)
          .fontColor(BWColor.ink3)
          .width('100%')
          .textAlign(TextAlign.Center)
          .margin({ top: 9 })
      }
    }
    .width('100%')
    .padding({ left: 20, right: 20, top: 17, bottom: 18 })
    .backgroundColor(BWColor.paper)
    .borderRadius(BWSize.cardRadius)
    .shadow({ radius: 32, color: '#4D171410', offsetX: 0, offsetY: 20 })
    .rotate({ angle: -1.2 })
    .scale({
      x: this.collecting ? 0.26 : 1,
      y: this.collecting ? 0.26 : 1
    })
    .opacity(this.collecting ? 0 : 1)
    .translate({ y: this.collecting ? 250 : 0 })
  }

  @Builder
  cardStage() {
    Stack({ alignContent: Alignment.TopStart }) {
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor(BWColor.stage)

      Circle()
        .width(360)
        .height(360)
        .fill('#14E89C4C')
        .blur(60)
        .translate({ x: this.winWidth * 0.25, y: -80 })

      Column({ space: 0 }) {
        this.stageBar()

        Scroll() {
          Column({ space: 0 }) {
            this.revealCard(this.placeSafe())

            Text('这个地点，只为你亮一次。')
              .fontSize(BWFont.micro)
              .fontColor(BWColor.creamOnStageDim)
              .textAlign(TextAlign.Center)
              .width('100%')
              .margin({ top: 14 })
          }
          .width('100%')
          .constraintSize({ maxWidth: 460 })
          .padding({ left: 26, right: 26, top: 12, bottom: 30 })
        }
        .layoutWeight(1)
        .scrollBar(BarState.Off)
      }
      .width('100%')
      .height('100%')
    }
    .width('100%')
    .height('100%')
  }

  @Builder
  emptyStage() {
    Column({ space: 10 }) {
      Text('今晚的盲盒还没准备好。')
        .fontSize(BWFont.body)
        .fontColor(BWColor.creamOnStage)
      Text('再走一会儿。')
        .fontSize(BWFont.caption)
        .fontColor(BWColor.creamOnStageDim)
    }
    .width('100%')
    .height('100%')
    .justifyContent(FlexAlign.Center)
    .backgroundColor(BWColor.stage)
  }

  build() {
    Stack({ alignContent: Alignment.TopStart }) {
      if (this.showCard) {
        if (this.place() === undefined) {
          this.emptyStage()
        } else {
          this.cardStage()
        }
      } else {
        this.openingStage()
      }

      // 底部 toast 堆叠
      Column({ space: 8 }) {
        if (this.achievementText.length > 0) {
          BwToastBar({
            text: this.achievementText,
            icon: '🏅',
            amber: true
          })
        }
        if (this.toastText.length > 0) {
          BwToastBar({
            text: this.toastText,
            icon: this.toastIcon,
            amber: false
          })
        }
      }
      .width('100%')
      .height('100%')
      .padding({ left: BWSize.pagePadding, right: BWSize.pagePadding, bottom: 40 })
      .justifyContent(FlexAlign.End)
      .hitTestBehavior(HitTestMode.None)
    }
    .width('100%')
    .height('100%')
  }
}
