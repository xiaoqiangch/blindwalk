/**
 * 盲走 BlindWalk · HarmonyOS ArkUI — 旅程 Journey（design-system §5.3 + parity.md §3）
 *
 * 结构：顶栏（盲盒进行中 + 计时 + 暂停）→ **迷雾路径视图**（真实模式）
 *       → 距离 + 方位 → 三阶线索 → 底部操作
 *
 * 迷雾路径（docs/parity.md §3 / core/fog.ts）：
 * - heading-up；前方 min(260, 剩余-25)m；后方 min(140, 已走-5)m；两端 46m 渐隐
 * - 已走 #AEB8D6 / 前方 #5B6CFF；每 55m 箭头；「你」白底琥珀圈；右下指北针
 * - 剩余 < 60m 整段隐藏，只显示「就在附近 · 抬头看看周围」
 *
 * 保密规则（产品灵魂）：本页**绝不渲染 currentPlace.name**。
 * 只显示「目的地保密中 · 还有 N 米」、方位箭头、以及不含地名的三阶线索。
 *
 * 真实定位：geoLocationManager.on('locationChange') → store.updateGeoLocation(origin)；
 * 权限被拒 / 超时 / 定位关闭 → 降级 store.setDemoMode(true)，并在 UI 明确标「演示」。
 */

import { getStore } from '../core/store';
import { AppSnapshot, RoutePolyline } from '../core/contract';
import {
  GeoPoint,
  HINT_THRESHOLDS,
  Place,
  QuestEvent,
  QuestEventType,
  QuestPhase,
  QuestSession
} from '../core/types';
import {
  BwIconButton,
  BwMicroLabel,
  BwPrimaryButton,
  BwQuietButton
} from '../components/Common';
import { BwAbstractMap } from '../components/AbstractMap';
import { BwFogPath } from '../components/FogPath';
import { CompassWatcher, GeoWatcher } from '../components/Location';
import { bwSleep } from '../components/Async';
import { activeSession, emptySnapshot, readSnapshot } from '../components/StoreBridge';
import {
  BWColor,
  BWFont,
  BWSize,
  walkCopy
} from '../theme/Theme';
import {
  bearingArrow,
  chineseIndex,
  clockHHMMSS,
  compassCopy,
  demoBearingArrow
} from '../components/Format';

const CLUE_INDEXES: number[] = [0, 1, 2];

@Component
export struct JourneyView {
  @Prop @Watch('onRevisionChanged') revision: number = 0;
  @Prop winWidth: number = 400;
  @Prop winHeight: number = 800;

  /** 返回首页（保留旅程，首页可「继续」） */
  onBack: () -> void = () => {
  };
  /** 到达：由 Index 打开揭晓全屏 */
  onArrived: () => void = () => {
  };
  /** 任何 store 状态变化后通知 Index 重读 */
  onChanged: () => void = () => {
  };

  @State private snapshot: AppSnapshot = emptySnapshot();
  @State private nowMs: number = 0;
  @State private paused: boolean = false;
  @State private pausedAccumMs: number = 0;
  @State private pauseStartedAt: number = 0;
  @State private flashOpacity: number = 0;
  @State private arrivalHandled: boolean = false;
  @State private watchFailed: boolean = false;
  @State private fogCaption: string = '正在规划路径…';
  @State private fixLat: number = 0;
  @State private fixLon: number = 0;

  private timerId: number = -1;
  private watcher: GeoWatcher | undefined = undefined;
  private compass: CompassWatcher | undefined = undefined;
  @State private heading: number = -1;
  @State private compassHeading: number = -1;

  aboutToAppear(): void {
    this.load();
    this.nowMs = Date.now();
    this.timerId = setInterval(() => {
      this.nowMs = Date.now();
    }, 1000);

    const origin: GeoPoint | undefined = this.snapshot.lastKnownOrigin;
    if (origin !== undefined) {
      this.fixLat = origin.latitude;
      this.fixLon = origin.longitude;
    }

    const session: QuestSession | undefined = this.session();
    if (session === undefined) {
      return;
    }
    if (session.phase === QuestPhase.Walking && !this.snapshot.demoMode) {
      this.startTracking();
    }
    if (session.phase === QuestPhase.Arrived) {
      this.beginArrival();
    }
  }

  aboutToDisappear(): void {
    this.stopCompass();
    if (this.timerId >= 0) {
      clearInterval(this.timerId);
      this.timerId = -1;
    }
    if (this.watcher !== undefined) {
      this.watcher.stop();
      this.watcher = undefined;
    }
  }

  onRevisionChanged(propName: string): void {
    this.load();
  }

  private load(): void {
    this.snapshot = readSnapshot(this.snapshot);
  }

  private session(): QuestSession | undefined {
    return activeSession(this.snapshot);
  }

  private place(): Place | undefined {
    return this.snapshot.currentPlace;
  }

  private isRealMode(): boolean {
    return !this.snapshot.demoMode;
  }

  private isShort(): boolean {
    return this.winHeight < BWSize.shortHeightBreakpoint;
  }

  private mapHeight(): number {
    if (this.isShort()) {
      return 176;
    }
    if (this.winWidth >= BWSize.wideBreakpoint) {
      return 300;
    }
    return 268;
  }

  private elapsedSeconds(): number {
    const session: QuestSession | undefined = this.session();
    if (session === undefined) {
      return 0;
    }
    const now: number = this.nowMs > 0 ? this.nowMs : Date.now();
    const pausedNow: number = this.paused ? Math.max(0, now - this.pauseStartedAt) : 0;
    const elapsedMs: number = now - session.startedAt - this.pausedAccumMs - pausedNow;
    return Math.max(0, elapsedMs / 1000);
  }

  private progressValue(): number {
    const session: QuestSession | undefined = this.session();
    if (session === undefined || session.totalMeters <= 0) {
      return 0;
    }
    const walked: number = session.totalMeters - session.remainingMeters;
    return Math.max(0, Math.min(1, walked / session.totalMeters));
  }

  // ============================================================
  // 真实定位
  // ============================================================

  private startTracking(): void {
    if (this.watcher !== undefined) {
      return;
    }
    const watcher: GeoWatcher = new GeoWatcher((point: GeoPoint) => {
      this.onGeoPoint(point);
    });
    const started: boolean = watcher.start();
    if (!started) {
      this.watchFailed = true;
      getStore().setDemoMode(true);
      this.onChanged();
      this.load();
      return;
    }
    this.watcher = watcher;
    this.watchFailed = false;
    this.startCompass();
  }

  /** 罗盘：让迷雾路径跟随「你面朝的方向」转，而不是只按路线方向 */
  private startCompass(): void {
    if (this.compass !== undefined) {
      return;
    }
    const compass: CompassWatcher = new CompassWatcher((heading: number) => {
      this.compassHeading = heading;
      this.heading = heading;
    });
    if (compass.start()) {
      this.compass = compass;
    }
  }

  private stopCompass(): void {
    if (this.compass !== undefined) {
      this.compass.stop();
      this.compass = undefined;
    }
  }

  private onGeoPoint(point: GeoPoint): void {
    this.fixLat = point.latitude;
    this.fixLon = point.longitude;
    // 没罗盘（或罗盘还没就绪）时，用移动方向让地图跟着转
    if (this.compassHeading < 0 && this.watcher !== undefined) {
      const move = this.watcher.heading();
      if (move >= 0) {
        this.heading = move;
      }
    }
    const store = getStore();
    store.setLastKnownOrigin(point);
    const events: QuestEvent[] = store.updateGeoLocation(point);
    this.load();
    this.onChanged();
    this.handleEvents(events);
  }

  private switchToDemo(): void {
    if (this.watcher !== undefined) {
      this.watcher.stop();
      this.watcher = undefined;
    }
    getStore().setDemoMode(true);
    this.onChanged();
    this.load();
  }

  // ============================================================
  // 事件 / 到达
  // ============================================================

  private handleEvents(events: QuestEvent[]): void {
    for (let i = 0; i < events.length; i++) {
      const event: QuestEvent = events[i];
      if (event.type === QuestEventType.Arrived) {
        this.beginArrival();
      }
    }
    const session: QuestSession | undefined = this.session();
    if (session !== undefined && session.phase === QuestPhase.Arrived && !this.arrivalHandled) {
      this.beginArrival();
    }
  }

  private async beginArrival(): Promise<void> {
    if (this.arrivalHandled) {
      return;
    }
    this.arrivalHandled = true;

    if (this.watcher !== undefined) {
      this.watcher.stop();
      this.watcher = undefined;
    }

    animateTo({ duration: 220, curve: Curve.EaseOut }, () => {
      this.flashOpacity = 1;
    });
    await bwSleep(900);
    animateTo({ duration: 220, curve: Curve.EaseIn }, () => {
      this.flashOpacity = 0;
    });
    await bwSleep(240);
    this.onArrived();
  }

  // ============================================================
  // 交互
  // ============================================================

  private simulateWalk(): void {
    if (this.paused) {
      return;
    }
    const session: QuestSession | undefined = this.session();
    if (session === undefined) {
      return;
    }
    // 契约注意：updateLocation(distanceMeters) 传的是**新的剩余距离**（不是增量）
    const nextRemaining: number = Math.max(0, session.remainingMeters - 50);
    const events: QuestEvent[] = getStore().updateLocation(nextRemaining);
    this.load();
    this.onChanged();
    this.handleEvents(events);
  }

  private arriveNow(): void {
    const events: QuestEvent[] = getStore().arriveNow();
    this.load();
    this.onChanged();
    this.handleEvents(events);
  }

  private togglePause(): void {
    if (this.paused) {
      this.pausedAccumMs = this.pausedAccumMs + Math.max(0, Date.now() - this.pauseStartedAt);
      this.pauseStartedAt = 0;
      this.paused = false;
    } else {
      this.pauseStartedAt = Date.now();
      this.paused = true;
    }
  }

  // ============================================================
  // 文案
  // ============================================================

  private bearingGlyph(): string {
    const session: QuestSession | undefined = this.session();
    if (session === undefined) {
      return '→';
    }
    if (this.isRealMode() && session.currentBearing !== undefined) {
      return bearingArrow(session.currentBearing);
    }
    return demoBearingArrow(session.remainingMeters);
  }

  private directionCopy(): string {
    const session: QuestSession | undefined = this.session();
    if (session === undefined) {
      return '顺着灯走，别急';
    }
    if (this.isRealMode() && session.currentBearing !== undefined) {
      return compassCopy(session.currentBearing);
    }
    const place: Place | undefined = this.place();
    if (place === undefined) {
      return '顺着灯走，别急';
    }
    return walkCopy(place.area);
  }

  private clueText(index: number): string {
    const place: Place | undefined = this.place();
    if (place !== undefined && index < place.hints.length) {
      return place.hints[index];
    }
    return '';
  }

  private isClueUnlocked(index: number): boolean {
    const session: QuestSession | undefined = this.session();
    if (session === undefined) {
      return false;
    }
    return index < session.unlockedHintCount;
  }

  private lockedClueCopy(index: number): string {
    const session: QuestSession | undefined = this.session();
    if (session === undefined) {
      return '到了你就知道';
    }
    if (index === session.unlockedHintCount && index < HINT_THRESHOLDS.length) {
      const gap: number = Math.max(0, session.remainingMeters - HINT_THRESHOLDS[index]);
      return '再走 ' + gap + ' 米，解锁第' + chineseIndex(index + 1) + '条线索';
    }
    return '到了你就知道';
  }

  private isArrived(): boolean {
    const session: QuestSession | undefined = this.session();
    if (session === undefined) {
      return false;
    }
    return session.phase === QuestPhase.Arrived;
  }

  // ============================================================
  // 区块
  // ============================================================

  @Builder
  topBar() {
    Row({ space: 10 }) {
      BwIconButton({
        glyph: '‹',
        onTap: () => {
          this.onBack();
        }
      })

      Column({ space: 2 }) {
        BwMicroLabel({ text: '盲盒进行中' })
        Text(clockHHMMSS(this.elapsedSeconds()))
          .fontSize(BWFont.bodySm)
          .fontColor(BWColor.ink)
          .maxLines(1)
      }
      .alignItems(HorizontalAlign.Start)

      Blank()

      Button() {
        Text(this.paused ? '继续' : '暂停')
          .fontSize(BWFont.captionSm)
          .fontColor(BWColor.ink2)
      }
      .type(ButtonType.Capsule)
      .height(28)
      .padding({ left: 11, right: 11 })
      .backgroundColor(BWColor.paper2)
      .border({ width: 1, color: BWColor.line, radius: BWSize.chipRadius })
      .onClick(() => {
        this.togglePause();
      })
    }
    .width('100%')
    .padding({ left: BWSize.pagePadding, right: BWSize.pagePadding, top: 6, bottom: 6 })
  }

  @Builder
  statusRow() {
    Row({ space: 6 }) {
      Row({ space: 4 }) {
        Circle()
          .width(6)
          .height(6)
          .fill(this.isRealMode() ? BWColor.teal : BWColor.amberDeep)
        Text(this.isRealMode() ? '实时定位 · 真实坐标' : '演示模式 · 内置地点')
          .fontSize(BWFont.micro)
          .fontColor(this.isRealMode() ? BWColor.teal : BWColor.amberDeep)
      }
      .padding({ left: 9, right: 9, top: 4, bottom: 4 })
      .backgroundColor(this.isRealMode() ? BWColor.tealSoft : BWColor.amberSoft)
      .borderRadius(BWSize.chipRadius)

      if (this.isRealMode()) {
        Text('GPS')
          .fontSize(BWFont.microSm)
          .fontWeight(FontWeight.Medium)
          .fontColor(BWColor.ink3)
          .padding({ left: 7, right: 7, top: 3, bottom: 3 })
          .border({ width: 1, color: BWColor.line, radius: BWSize.chipRadius })
      }

      Blank()
    }
    .width('100%')
    .padding({ left: BWSize.pagePadding, right: BWSize.pagePadding, bottom: 8 })
  }

  /** 当前路线折线（真实模式才有） */
  private routePoints(): number[][] {
    const route: RoutePolyline | undefined = this.snapshot.route;
    if (route === undefined) return [];
    return route.points;
  }

  private routeDistance(): number {
    const route: RoutePolyline | undefined = this.snapshot.route;
    if (route === undefined) return 0;
    return route.distanceMeters;
  }

  private hasRoute(): boolean {
    return this.routePoints().length >= 2;
  }

  /**
   * 迷雾路径视图（真实模式 + 有路线时）。
   * 没有路线时退回抽象地图（并且不显示任何终点标记）。
   */
  @Builder
  pathSection() {
    if (this.isRealMode() && this.hasRoute()) {
      Column({ space: 6 }) {
        BwFogPath({
          routePoints: this.routePoints(),
          routeDistance: this.routeDistance(),
          hereLat: this.fixLat,
          hereLon: this.fixLon,
          viewHeight: this.mapHeight(),
          heading: this.heading,
          onCaption: (text: string) => {
            this.fogCaption = text;
          }
        })

        Row({ space: 6 }) {
          Text('👁')
            .fontSize(BWFont.microSm)
          Text(this.fogCaption)
            .fontSize(BWFont.micro)
            .fontColor(BWColor.ink3)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .layoutWeight(1)
        }
        .width('100%')
        .padding({ left: 4, right: 4 })
      }
      .width('100%')
      .padding({ left: BWSize.pagePadding, right: BWSize.pagePadding })
    } else {
      this.mapSection()
    }
  }

  @Builder
  mapSection() {
    Stack({ alignContent: Alignment.BottomStart }) {
      BwAbstractMap({
        progress: this.progressValue(),
        realMode: this.isRealMode()
      })

      Row({ space: 5 }) {
        Text('👁')
          .fontSize(BWFont.microSm)
        Text((this.isRealMode() ? '真实位置 · ' : '') + '目的地保密中 · 还有 ' +
          this.remainingMeters() + ' 米')
          .fontSize(BWFont.micro)
          .fontColor(BWColor.ink2)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
      }
      .padding({ left: 10, right: 10, top: 6, bottom: 6 })
      .backgroundColor(BWColor.creamTranslucent)
      .borderRadius(BWSize.chipRadius)
      .border({ width: 1, color: BWColor.line, radius: BWSize.chipRadius })
      .margin(12)
    }
    .width('100%')
    .height(this.mapHeight())
    .padding({ left: BWSize.pagePadding, right: BWSize.pagePadding })
  }

  private remainingMeters(): number {
    const session: QuestSession | undefined = this.session();
    return session === undefined ? 0 : session.remainingMeters;
  }

  @Builder
  distanceSection() {
    Column({ space: 8 }) {
      Row() {
        Row() {
          Text(String(this.remainingMeters()))
            .fontSize(this.isShort() ? 46 : BWFont.digits)
            .fontWeight(FontWeight.Bold)
            .fontColor(BWColor.ink)
          Text(' 米')
            .fontSize(BWFont.titleMd)
            .fontColor(BWColor.ink2)
            .margin({ left: 4 })
        }
        .alignItems(VerticalAlign.Bottom)

        Blank()

        Text(this.bearingGlyph())
          .fontSize(34)
          .fontWeight(FontWeight.Bold)
          .fontColor(BWColor.amberDeep)
      }
      .width('100%')

      Text(this.directionCopy())
        .fontSize(BWFont.bodySm)
        .fontColor(BWColor.ink2)
        .width('100%')

      Stack({ alignContent: Alignment.Start }) {
        Row()
          .width('100%')
          .height(5)
          .backgroundColor(BWColor.line)
          .borderRadius(3)

        Row()
          .width((this.progressValue() * 100) + '%')
          .height(5)
          .backgroundColor(BWColor.amber)
          .borderRadius(3)
      }
      .width('100%')
      .margin({ top: 4 })

      Text('已走 ' + String(this.walkedMeters()) + ' 米 · 共 ' + String(this.totalMeters()) + ' 米')
        .fontSize(BWFont.micro)
        .fontColor(BWColor.ink3)
        .width('100%')
    }
    .width('100%')
    .padding({ left: BWSize.pagePadding, right: BWSize.pagePadding, top: 18 })
  }

  private walkedMeters(): number {
    const session: QuestSession | undefined = this.session();
    if (session === undefined) {
      return 0;
    }
    return Math.max(0, session.totalMeters - session.remainingMeters);
  }

  private totalMeters(): number {
    const session: QuestSession | undefined = this.session();
    return session === undefined ? 0 : session.totalMeters;
  }

  @Builder
  clueRow(index: number) {
    Row({ space: 12 }) {
      Stack({ alignContent: Alignment.Center }) {
        Circle()
          .width(26)
          .height(26)
          .fill(this.isClueUnlocked(index) ? '#292E7D78' : BWColor.paper2)
          .stroke(this.isClueUnlocked(index) ? '#662E7D78' : BWColor.line)
          .strokeWidth(1)

        Text(this.isClueUnlocked(index) ? '✓' : String(index + 1))
          .fontSize(BWFont.microSm)
          .fontWeight(FontWeight.Bold)
          .fontColor(this.isClueUnlocked(index) ? BWColor.teal : BWColor.ink3)
      }

      if (this.isClueUnlocked(index)) {
        Row({ space: 8 }) {
          Text('✅')
            .fontSize(BWFont.caption)
          Text(this.clueText(index))
            .fontSize(BWFont.caption)
            .fontColor(BWColor.ink)
            .lineHeight(21)
            .layoutWeight(1)
        }
        .width('100%')
        .padding({ left: 14, right: 14, top: 12, bottom: 12 })
        .backgroundColor(BWColor.paper)
        .borderRadius(18)
        .border({ width: 1, color: BWColor.line, radius: 18 })
        .shadow({ radius: 10, color: BWColor.shadowSoft, offsetX: 0, offsetY: 6 })
      } else {
        Row({ space: 8 }) {
          Text('🔒')
            .fontSize(BWFont.captionSm)
          Text(this.lockedClueCopy(index))
            .fontSize(BWFont.caption)
            .fontColor(BWColor.ink3)
            .lineHeight(20)
            .layoutWeight(1)
        }
        .width('100%')
        .padding({ left: 14, right: 14, top: 12, bottom: 12 })
        .backgroundColor('#8CFBF4E9')
        .borderRadius(18)
        .border({ width: 1, color: BWColor.line, style: BorderStyle.Dashed, radius: 18 })
      }
    }
    .width('100%')
    .alignItems(VerticalAlign.Top)
  }

  @Builder
  clueSection() {
    Column({ space: 12 }) {
      Row({ space: 8 }) {
        Text('线索')
          .fontSize(BWFont.titleMd)
          .fontWeight(FontWeight.Medium)
          .fontColor(BWColor.ink)
        Text(this.unlockedHintCountText())
          .fontSize(BWFont.caption)
          .fontColor(BWColor.ink3)
        Blank()
      }
      .width('100%')

      Column({ space: 10 }) {
        ForEach(CLUE_INDEXES, (index: number) => {
          this.clueRow(index)
        }, (index: number) => String(index))
      }
      .width('100%')
    }
    .width('100%')
    .padding({ left: BWSize.pagePadding, right: BWSize.pagePadding, top: 16 })
  }

  private unlockedHintCountText(): string {
    const session: QuestSession | undefined = this.session();
    if (session === undefined) {
      return '0/3';
    }
    return Math.min(session.unlockedHintCount, 3) + '/3';
  }

  @Builder
  actionSection() {
    Column({ space: 8 }) {
      if (this.isArrived()) {
        BwPrimaryButton({
          title: '揭晓盲盒',
          onTap: () => {
            this.beginArrival();
          }
        })
      } else if (this.snapshot.demoMode) {
        BwPrimaryButton({
          title: '模拟步行 +50m',
          tag: '演示',
          onTap: () => {
            this.simulateWalk();
          }
        })
        BwQuietButton({
          title: '我到了',
          onTap: () => {
            this.arriveNow();
          }
        })
      } else {
        BwPrimaryButton({
          title: '走累了？直接揭晓',
          tag: '兜底',
          onTap: () => {
            this.arriveNow();
          }
        })
        Text('位置没动？改用演示模式 ›')
          .fontSize(BWFont.micro)
          .fontColor(BWColor.ink3)
          .width('100%')
          .textAlign(TextAlign.Center)
          .onClick(() => {
            this.switchToDemo();
          })
      }
    }
    .width('100%')
    .padding({
      left: BWSize.pagePadding,
      right: BWSize.pagePadding,
      top: 14,
      bottom: 18
    })
  }

  @Builder
  journeyBody() {
    Column({ space: 0 }) {
      this.topBar()
      this.statusRow()
      this.pathSection()
      this.distanceSection()
      this.clueSection()
      this.actionSection()
    }
    .width('100%')
    .constraintSize({ maxWidth: BWSize.contentMaxWidth })
  }

  @Builder
  emptyBody() {
    Column({ space: 14 }) {
      BwMicroLabel({ text: '盲盒进行中' })
      Text('还没有正在进行的盲盒。')
        .fontSize(BWFont.body)
        .fontWeight(FontWeight.Medium)
        .fontColor(BWColor.ink)
      Text('让城市替你选一个。')
        .fontSize(BWFont.caption)
        .fontColor(BWColor.ink3)
      Row() {
        BwQuietButton({
          title: '返回今日',
          onTap: () => {
            this.onBack();
          }
        })
      }
      .width(180)
    }
    .width('100%')
    .padding(30)
    .justifyContent(FlexAlign.Center)
    .height('100%')
  }

  build() {
    Stack({ alignContent: Alignment.TopStart }) {
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor(BWColor.cream)

      if (this.session() === undefined) {
        this.emptyBody()
      } else {
        Scroll() {
          Column({ space: 0 }) {
            this.journeyBody()
          }
          .width('100%')
          .alignItems(HorizontalAlign.Center)
        }
        .width('100%')
        .height('100%')
        .scrollBar(BarState.Off)
        .edgeEffect(EdgeEffect.Spring)
      }

      // 到达闪屏
      if (this.flashOpacity > 0) {
        Column({ space: 14 }) {
          Text('到了')
            .fontSize(46)
            .fontWeight(FontWeight.Bold)
            .fontColor(BWColor.creamOnStage)
          Text('这个地点，只为你亮一次。')
            .fontSize(BWFont.bodySm)
            .fontColor(BWColor.creamOnStageDim)
        }
        .width('100%')
        .height('100%')
        .justifyContent(FlexAlign.Center)
        .backgroundColor(BWColor.stage)
        .opacity(this.flashOpacity)
      }
    }
    .width('100%')
    .height('100%')
  }
}
