/**
 * 盲走 BlindWalk · HarmonyOS ArkUI — 抽盒设置 Sheet（design-system §5.2 + parity.md）
 *
 * 视觉基准：prototype/web/app.js sheetHTML + screenshots/showcase.png（SETUP 屏）
 *
 * 流程（严格按 docs/parity.md §1 §2）：
 *   选时长/心情/区域 →「摇一个盲盒」
 *     → 申请定位 + 取一次坐标（拒绝/超时 → **定位受阻面板**，不偷偷用虚构地点）
 *     → 地图 Key 下发 + 策展 pois.json
 *     → 三档放宽真实搜索（高德/百度/OSM/维基）
 *     → 成功：startQuestWithPlace（真实来源 + 真实坐标）
 *     → 失败：**明确失败面板**（扩大范围 / 换个位置 / 显式选演示）
 *
 * 产品红线：真实模式下**绝不虚构兜底**。演示模式只能由用户点按钮显式进入。
 * 保密：本页不读取 currentPlace，也不展示任何地点名。
 */

import { common } from '@kit.AbilityKit';
import { getStore } from '../core/store';
import { AppSnapshot, DataSourceStatus, KeyValueStore } from '../core/contract';
import { Area, GeoPoint, Mood, Place, WalkDuration } from '../core/types';
import { SourceReport } from '../core/http';
import { HttpClient } from '../core/http';
import {
  QuestFlowDeps,
  QuestStartResult,
  prepareQuest,
  toDataSourceStatus
} from '../core/flow';
import {
  BwMicroLabel,
  BwPill,
  BwPrimaryButton
} from '../components/Common';
import { bwSleep, bwToast } from '../components/Async';
import { emptySnapshot, readSnapshot } from '../components/StoreBridge';
import { getCurrentLocationOnce, requestLocationPermission } from '../components/Location';
import {
  BwLocationBlockedPanel,
  BwManualLocationSheet,
  BwSearchFailedPanel
} from '../components/SearchPanels';
import { geocodeAddress } from '../core/geocode';
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
  new MoodOption(Mood.Drift, '放空', 'leaf_fill', '不想讲话，只想走走'),
  new MoodOption(Mood.Discover, '发现', 'magnifyingglass', '我想看点没见过的'),
  new MoodOption(Mood.Lively, '热闹', 'headphones_fill', '去哪儿都行，人多一点')
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

  /** 由 Index 注入：平台依赖（http / preferences / rawfile） */
  http: HttpClient | undefined = undefined;
  kv: KeyValueStore | undefined = undefined;
  readBundledKeys: () => string | undefined = () => undefined;
  adminBase: string = 'http://127.0.0.1:8802';

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

  /** 定位受阻（denied / timeout / no-fix）；空串 = 正常 */
  @State private locationBlockedReason: string = '';
  /** 真实搜索失败；空串 = 没有失败 */
  @State private searchFailedReason: string = '';
  /** 失败面板要展示的源回报 */
  @State private searchReports: SourceReport[] = [];
  /** 上次搜索命中的档位（0/1/2） */
  @State private searchTier: number = 0;
  /** 手动位置弹层 */
  @State private manualOpen: boolean = false;
  /** 当前用于搜索的位置（定位失败后可被手动输入替换） */
  @State private manualOrigin: GeoPoint | undefined = undefined;

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

  /** 组装平台依赖（http / kv 由 Index 注入） */
  private deps(): QuestFlowDeps | undefined {
    if (this.http === undefined || this.kv === undefined) return undefined;
    const deps: QuestFlowDeps = {
      http: this.http,
      kv: this.kv,
      readBundledKeys: this.readBundledKeys,
      adminBase: this.adminBase,
      now: (): number => Date.now()
    };
    return deps;
  }

  /**
   * 摇一个盲盒（真实模式主流程）。
   *
   * 关键：任何一步失败都**停在面板上**，绝不静默变成虚构地点。
   */
  private async shakeAndStart(): Promise<void> {
    if (this.busy) {
      return;
    }
    this.busy = true;
    this.failed = false;
    this.searchFailedReason = '';
    this.locationBlockedReason = '';
    this.statusText = '正在取你的位置…';

    // ---------- 1. 定位（拒绝 / 超时 → 明确面板） ----------
    let origin: GeoPoint | undefined = this.manualOrigin;
    if (origin === undefined) {
      const context: common.UIAbilityContext = getContext(this) as common.UIAbilityContext;
      const granted: boolean = await requestLocationPermission(context);
      if (!granted) {
        this.busy = false;
        this.statusText = '';
        this.locationBlockedReason = 'denied';
        return;
      }
      try {
        origin = await getCurrentLocationOnce(6000);
      } catch (err) {
        origin = undefined;
      }
    }
    if (origin === undefined) {
      this.busy = false;
      this.statusText = '';
      this.locationBlockedReason = 'timeout';
      return;
    }

    const store = getStore();
    store.setLastKnownOrigin(origin);
    store.setDemoMode(false);

    // ---------- 2. 摇盒动画（600ms，与设计稿一致） ----------
    this.statusText = '正在看附近有什么…';
    this.isShaking = true;
    animateTo({
      duration: 100,
      curve: Curve.EaseInOut,
      iterations: 6,
      playMode: PlayMode.Alternate
    }, () => {
      this.shakeAngle = 6;
    });

    // ---------- 3. 真实搜索（Key 下发 + 策展优先 + 三档放宽） ----------
    const deps: QuestFlowDeps | undefined = this.deps();
    let result: QuestStartResult | undefined = undefined;
    if (deps !== undefined) {
      try {
        result = await prepareQuest(deps, {
          origin: origin,
          mood: this.snapshot.selectedMood,
          duration: this.snapshot.selectedDuration,
          startTier: this.searchTier >= 2 ? 2 : 0
        }, Math.random());
      } catch (err) {
        result = undefined;
      }
    }

    await bwSleep(400);
    this.isShaking = false;
    this.shakeAngle = 0;
    this.busy = false;
    this.statusText = '';

    // 依赖缺失（Index 没注入）也不该静默继续
    if (deps === undefined || result === undefined) {
      this.searchFailedReason = 'network';
      this.searchReports = [];
      return;
    }

    // 数据源状态始终记录下来（设置页 / 失败面板都能看到）
    const status: DataSourceStatus = toDataSourceStatus(
      result.keySource, result.keys, result.reports, Date.now(), result.curatedCount
    );
    store.setDataSourceStatus(status);
    this.searchReports = result.reports;
    this.searchTier = result.tier;

    // ---------- 4. 失败：明确面板，绝不虚构 ----------
    if (result.place === undefined) {
      this.searchFailedReason = result.failReason.length > 0 ? result.failReason : 'no-real-place';
      this.onChanged();
      return;
    }

    // ---------- 5. 成功：用真实地点开始旅程 ----------
    const place: Place = result.place;
    const started = store.startQuestWithPlace(place, origin);
    if (started === undefined) {
      // store 的闸门拦下了不合规地点（理论上不会发生，兜底也不编造）
      this.searchFailedReason = 'not-real';
      this.onChanged();
      return;
    }
    if (place.source === 'curated') {
      bwToast('这是编辑精选的地点');
    } else if (result.poolSize > 0) {
      bwToast('附近找到 ' + String(result.poolSize) + ' 个真实地点');
    }
    this.load();
    this.onChanged();
    this.onStarted();
  }

  /** 显式进入演示模式（只在用户点按钮时发生） */
  private startDemoExplicitly(): void {
    const store = getStore();
    store.setDemoMode(true);
    this.locationBlockedReason = '';
    this.searchFailedReason = '';
    this.searchTier = 0;
    const result = store.startQuest();
    if (result === undefined) {
      this.failed = true;
      this.onChanged();
      return;
    }
    bwToast('演示模式 · 内置地点');
    this.load();
    this.onChanged();
    this.onStarted();
  }

  /** 扩大范围再找：从最宽档重来一次 */
  private searchWider(): void {
    this.searchTier = 2;
    this.searchFailedReason = '';
    this.shakeAndStart();
  }

  /** 手动位置：弹层输入地址/坐标 → 用它重新搜索 */
  private async submitManualLocation(query: string): Promise<void> {
    const deps: QuestFlowDeps | undefined = this.deps();
    if (deps === undefined) {
      this.manualOpen = false;
      return;
    }
    const hit = await geocodeAddress(deps.http, query);
    this.manualOpen = false;
    if (hit === undefined) {
      bwToast('没查到这个地方，再试试');
      return;
    }
    this.manualOrigin = hit.location;
    this.locationBlockedReason = '';
    this.searchFailedReason = '';
    getStore().setLastKnownOrigin(hit.location);
    bwToast('位置已设为：' + hit.label);
    // 位置有了，直接重新摇一次
    this.shakeAndStart();
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
            Stack({ alignContent: Alignment.Center }) {
              SymbolGlyph($r('sys.symbol.' + item.emoji))
                .fontSize(BWSize.iconSizeSm)
                .fontColor([this.isMoodSelected(item.mood) ? BWColor.amber : BWColor.ink2])
                .renderingStrategy(SymbolRenderingStrategy.SINGLE)
            }
            .width(34)
            .height(34)
            .backgroundColor(this.isMoodSelected(item.mood) ? BWColor.amberSoft : BWColor.paper2)
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
    Column({ space: 8 }) {
      // ---------- 失败 / 受阻面板（优先展示，绝不静默降级） ----------
      if (this.locationBlockedReason.length > 0) {
        BwLocationBlockedPanel({
          reason: this.locationBlockedReason,
          onRetryLocation: () => {
            this.locationBlockedReason = '';
            this.shakeAndStart();
          },
          onManualLocation: () => {
            this.manualOpen = true;
          },
          onStartDemo: () => {
            this.startDemoExplicitly();
          }
        })
      }

      if (this.searchFailedReason.length > 0) {
        BwSearchFailedPanel({
          reason: this.searchFailedReason,
          reports: this.searchReports,
          tier: this.searchTier,
          onSearchWider: () => {
            this.searchWider();
          },
          onManualLocation: () => {
            this.manualOpen = true;
          },
          onStartDemo: () => {
            this.startDemoExplicitly();
          }
        })
      }

      if (this.manualOpen) {
        BwManualLocationSheet({
          onCancel: () => {
            this.manualOpen = false;
          },
          onSubmit: (query: string) => {
            this.submitManualLocation(query);
          }
        })
      }

      // ---------- 主按钮 ----------
      Row() {
        BwPrimaryButton({
          title: this.busy ? '正在找真实地点…' : '摇一个盲盒',
          isActive: !this.busy,
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

      if (this.manualOrigin !== undefined) {
        Text('当前位置：手动设置（搜索半径内优先）')
          .fontSize(BWFont.microSm)
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
