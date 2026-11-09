/**
 * 盲走 BlindWalk · HarmonyOS ArkUI — 抽盒设置 Sheet（design-system §5.2）
 *
 * 视觉基准：prototype/web/app.js sheetHTML + screenshots/showcase.png（SETUP 屏）
 * 流程：选时长 / 心情 / 区域 →「摇一个盲盒」→ 申请定位权限 + 取一次坐标（失败降级演示）
 *       → 600ms 摇盒 → store.startQuest(origin) → 关闭 sheet 进旅程。
 *
 * 保密：本页不读取 currentPlace，也不展示任何地点名。
 */

import { common } from '@kit.AbilityKit';
import { getStore } from '../core/store';
import { AppSnapshot } from '../core/contract';
import { Area, GeoPoint, Mood, WalkDuration } from '../core/types';
import {
  BwMicroLabel,
  BwPill,
  BwPrimaryButton
} from '../components/Common';
import { bwSleep } from '../components/Async';
import { emptySnapshot, readSnapshot } from '../components/StoreBridge';
import { getCurrentLocationOnce, requestLocationPermission } from '../components/Location';
import {
  BWColor,
  BWFont,
  BWSize,
  BW_DUR_REGULAR,
  BW_EASE
} from '../theme/Theme';

class DurationOption {
  value: WalkDuration;
  main: string;
  sub: string;

  constructor(value: WalkDuration, main: string, sub: string) {
    this.value = value;
    this.main = main;
    this.sub = sub;
  }
}

const DURATIONS: DurationOption[] = [
  new DurationOption(WalkDuration.M15, '15 分钟', '一小圈'),
  new DurationOption(WalkDuration.M30, '30 分钟', '刚好'),
  new DurationOption(WalkDuration.M60, '60 分钟', '走远点')
];

class MoodOption {
  mood: Mood;
  title: string;
  emoji: string;
  subtitle: string;

  constructor(mood: Mood, title: string, emoji: string, subtitle: string) {
    this.mood = mood;
    this.title = title;
    this.emoji = emoji;
    this.subtitle = subtitle;
  }
}

const MOODS: MoodOption[] = [
  new MoodOption(Mood.Drift, '放空', '🌫️', '不想讲话，只想走走'),
  new MoodOption(Mood.Discover, '发现', '🔍', '我想看点没见过的'),
  new MoodOption(Mood.Lively, '热闹', '🥁', '去哪儿都行，人多一点')
];

class AreaOption {
  area: Area;
  label: string;

  constructor(area: Area, label: string) {
    this.area = area;
    this.label = label;
  }
}

const AREAS: AreaOption[] = [
  new AreaOption(Area.Near, '附近'),
  new AreaOption(Area.River, '河边'),
  new AreaOption(Area.OldTown, '老城区')
];

@Component
export struct SetupSheet {
  @Prop winWidth: number = 400;
  @Prop winHeight: number = 800;

  onClose: () => void = () => {
  };
  onStarted: () => void = () => {
  };
  onChanged: () => void = () => {
  };

  @State private snapshot: AppSnapshot = emptySnapshot();
  @State private sheetOffset: number = 60;
  @State private shakeAngle: number = 0;
  @State private isShaking: boolean = false;
  @State private busy: boolean = false;
  @State private statusText: string = '';
  @State private failed: boolean = false;

  aboutToAppear(): void {
    this.load();
    animateTo({ duration: BW_DUR_REGULAR, curve: BW_EASE }, () => {
      this.sheetOffset = 0;
    });
  }

  private load(): void {
    this.snapshot = readSnapshot(this.snapshot);
  }

  private isShort(): boolean {
    return this.winHeight < BWSize.shortHeightBreakpoint;
  }

  private isDurationSelected(duration: WalkDuration): boolean {
    return this.snapshot.selectedDuration === duration;
  }

  private isMoodSelected(mood: Mood): boolean {
    return this.snapshot.selectedMood === mood;
  }

  private isAreaSelected(area: Area): boolean {
    if (area === Area.Near) {
      return this.snapshot.selectedArea === undefined;
    }
    return this.snapshot.selectedArea === area;
  }

  // ============================================================
  // 交互
  // ============================================================

  private selectDuration(duration: WalkDuration): void {
    if (this.busy || this.snapshot.selectedDuration === duration) {
      return;
    }
    getStore().setDuration(duration);
    this.load();
    this.onChanged();
  }

  private selectMood(mood: Mood): void {
    if (this.busy || this.snapshot.selectedMood === mood) {
      return;
    }
    getStore().setMood(mood);
    this.load();
    this.onChanged();
  }

  private selectArea(area: Area): void {
    if (this.busy) {
      return;
    }
    if (area === Area.Near) {
      getStore().setArea();
    } else {
      getStore().setArea(area);
    }
    this.load();
    this.onChanged();
  }

  /** 摇一个盲盒：权限 + 定位 → 摇盒 600ms → startQuest */
  private async shakeAndStart(): Promise<void> {
    if (this.busy) {
      return;
    }
    this.busy = true;
    this.failed = false;
    this.statusText = '正在看附近有什么…';

    // 1. 申请定位权限（拒绝就降级演示，不阻塞）
    const context: common.UIAbilityContext = getContext(this) as common.UIAbilityContext;
    const granted: boolean = await requestLocationPermission(context);

    // 2. 取一次当前位置（6 秒超时）
    let origin: GeoPoint | undefined = undefined;
    if (granted) {
      try {
        origin = await getCurrentLocationOnce(6000);
      } catch (err) {
        origin = undefined;
      }
    }

    const store = getStore();
    if (origin !== undefined) {
      store.setLastKnownOrigin(origin);
      store.setDemoMode(false);
    } else {
      store.setDemoMode(true);
    }

    // 3. 摇盒动画 600ms（±6° 三次）
    this.statusText = origin !== undefined ? '正在摇…' : '定位没开，先用演示模式陪你走';
    this.isShaking = true;
    animateTo({
      duration: 100,
      curve: Curve.EaseInOut,
      iterations: 6,
      playMode: PlayMode.Alternate
    }, () => {
      this.shakeAngle = 6;
    });
    await bwSleep(700);
    this.isShaking = false;
    this.shakeAngle = 0;

    // 4. 抽盒（失败要处理 undefined 分支）
    const result = store.startQuest(origin);
    this.busy = false;
    this.statusText = '';
    if (result === undefined) {
      this.failed = true;
      return;
    }
    this.load();
    this.onChanged();
    this.onStarted();
  }

  // ============================================================
  // 区块
  // ============================================================

  @Builder
  durationSection() {
    Column({ space: 8 }) {
      BwMicroLabel({ text: '时长' })

      Row({ space: 4 }) {
        ForEach(DURATIONS, (item: DurationOption) => {
          Button() {
            Column({ space: 1 }) {
              Text(item.main)
                .fontSize(BWFont.caption)
                .fontWeight(FontWeight.Medium)
                .fontColor(this.isDurationSelected(item.value) ? BWColor.ink : BWColor.ink2)
                .maxLines(1)
              Text(item.sub)
                .fontSize(BWFont.microSm)
                .fontColor(this.isDurationSelected(item.value) ? BWColor.amberDeep : BWColor.ink3)
                .maxLines(1)
            }
            .width('100%')
          }
          .type(ButtonType.Normal)
          .height(46)
          .layoutWeight(1)
          .backgroundColor(this.isDurationSelected(item.value) ? BWColor.paper : Color.Transparent)
          .borderRadius(12)
          .border({
            width: 1,
            color: this.isDurationSelected(item.value) ? BWColor.amberBorder : Color.Transparent,
            radius: 12
          })
          .shadow({
            radius: this.isDurationSelected(item.value) ? 3 : 0,
            color: this.isDurationSelected(item.value) ? BWColor.shadow : Color.Transparent,
            offsetX: 0,
            offsetY: 2
          })
          .onClick(() => {
            this.selectDuration(item.value);
          })
        }, (item: DurationOption) => String(item.value))
      }
      .width('100%')
      .padding(4)
      .backgroundColor(BWColor.paper2)
      .borderRadius(BWSize.cardRadiusSm)
      .border({ width: 1, color: BWColor.line, radius: BWSize.cardRadiusSm })
    }
    .alignItems(HorizontalAlign.Start)
    .width('100%')
  }

  @Builder
  moodSection() {
    Column({ space: 8 }) {
      BwMicroLabel({ text: '心情' })

      Column({ space: 7 }) {
        ForEach(MOODS, (item: MoodOption) => {
          Row({ space: 12 }) {
            Text(item.emoji)
              .fontSize(17)
              .textAlign(TextAlign.Center)
              .width(34)
              .height(34)
              .backgroundColor(this.isMoodSelected(item.mood) ? BWColor.amberSoftStrong : BWColor.paper2)
              .borderRadius(17)

            Column({ space: 1 }) {
              Text(item.title)
                .fontSize(BWFont.caption)
                .fontWeight(FontWeight.Medium)
                .fontColor(BWColor.ink)
              Text(item.subtitle)
                .fontSize(BWFont.micro)
                .fontColor(BWColor.ink3)
            }
            .alignItems(HorizontalAlign.Start)

            Blank()
          }
          .width('100%')
          .padding({ left: 13, right: 13, top: 9, bottom: 9 })
          .backgroundColor(this.isMoodSelected(item.mood) ? '#12E89B4C' : BWColor.paper)
          .borderRadius(BWSize.cardRadiusSm)
          .border({
            width: 1,
            color: this.isMoodSelected(item.mood) ? '#B3E89B4C' : BWColor.line,
            radius: BWSize.cardRadiusSm
          })
          .onClick(() => {
            this.selectMood(item.mood);
          })
        }, (item: MoodOption) => String(item.mood))
      }
      .width('100%')
    }
    .alignItems(HorizontalAlign.Start)
    .width('100%')
  }

  @Builder
  areaSection() {
    Column({ space: 8 }) {
      BwMicroLabel({ text: '区域' })

      Row({ space: 8 }) {
        ForEach(AREAS, (item: AreaOption) => {
          BwPill({
            text: item.label,
            selected: this.isAreaSelected(item.area),
            onTap: () => {
              this.selectArea(item.area);
            }
          })
        }, (item: AreaOption) => item.label)

        Blank()
      }
      .width('100%')
    }
    .alignItems(HorizontalAlign.Start)
    .width('100%')
  }

  @Builder
  actionSection() {
    Column({ space: 4 }) {
      Row() {
        BwPrimaryButton({
          title: '摇一个盲盒',
          enabled: !this.busy,
          onTap: () => {
            this.shakeAndStart();
          }
        })
      }
      .width('100%')
      .rotate({ angle: this.isShaking ? this.shakeAngle : 0 })

      Button() {
        Text(this.busy ? '正在准备…' : '今天不想出门')
          .fontSize(BWFont.bodySm)
          .fontColor(BWColor.ink2)
      }
      .type(ButtonType.Normal)
      .height(42)
      .width('100%')
      .backgroundColor(Color.Transparent)
      .enabled(!this.busy)
      .onClick(() => {
        this.onClose();
      })

      if (this.busy && this.statusText.length > 0) {
        Text(this.statusText)
          .fontSize(BWFont.caption)
          .fontColor(BWColor.ink3)
          .width('100%')
          .textAlign(TextAlign.Center)
      }

      if (this.snapshot.demoMode) {
        Text('演示模式 · 定位不可用时按内置地点抽盒')
          .fontSize(BWFont.micro)
          .fontColor(BWColor.ink3)
          .width('100%')
          .textAlign(TextAlign.Center)
      }

      if (this.failed) {
        Text('这一次没抽到，再试一次。')
          .fontSize(BWFont.caption)
          .fontColor(BWColor.ember)
          .width('100%')
          .textAlign(TextAlign.Center)
      }
    }
    .width('100%')
  }

  build() {
    Stack({ alignContent: Alignment.Bottom }) {
      // 遮罩
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor(BWColor.scrim)
        .onClick(() => {
          if (!this.busy) {
            this.onClose();
          }
        })

      // 半屏 sheet
      Column({ space: 0 }) {
        Row()
          .width(38)
          .height(5)
          .backgroundColor(BWColor.line)
          .borderRadius(3)
          .margin({ top: 10 })

        Scroll() {
          Column({ space: 0 }) {
            Text('这次的盲盒，你想要什么？')
              .fontSize(this.isShort() ? 19 : 22)
              .fontWeight(FontWeight.Bold)
              .fontColor(BWColor.ink)
              .width('100%')
              .maxLines(2)

            Text('选完就出发，目的地保密。')
              .fontSize(BWFont.caption)
              .fontColor(BWColor.ink3)
              .width('100%')
              .margin({ top: 4, bottom: 18 })

            this.durationSection()

            Column() {
              this.moodSection()
            }
            .margin({ top: 15 })

            Column() {
              this.areaSection()
            }
            .margin({ top: 15 })

            Column() {
              this.actionSection()
            }
            .margin({ top: 17 })
          }
          .width('100%')
          .padding({
            left: BWSize.pagePadding,
            right: BWSize.pagePadding,
            top: 10,
            bottom: 22
          })
        }
        .layoutWeight(1)
        .scrollBar(BarState.Off)
      }
      .width('100%')
      .height(this.isShort() ? '96%' : '88%')
      .constraintSize({ maxWidth: BWSize.contentMaxWidth })
      .backgroundColor(BWColor.paper)
      .borderRadius({
        topLeft: BWSize.panelRadius,
        topRight: BWSize.panelRadius,
        bottomLeft: 0,
        bottomRight: 0
      })
      .translate({ y: this.sheetOffset })
      .shadow({ radius: 28, color: BWColor.shadowLift, offsetX: 0, offsetY: -8 })
    }
    .width('100%')
    .height('100%')
  }
}
