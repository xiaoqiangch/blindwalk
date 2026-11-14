/**
 * 步迷 Walkaholic · HarmonyOS ArkUI — 旅程 Journey（design-system §5.3 + parity.md §3）
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

import { common } from '@kit.AbilityKit';
import { getStore, getStoreInstance } from '../core/store';
import { AppSnapshot, RoutePolyline } from '../core/contract';
import {
  DRIVE_RESUME_METERS,
  ExploreScope,
  GeoPoint,
  HINT_THRESHOLDS,
  PARKING_RADIUS_METERS,
  PARKING_TOLERANCE_METERS,
  Place,
  QuestEvent,
  QuestEventType,
  QuestPhase,
  QuestSession,
  isRoamJourney
} from '../core/types';
import { SeededGenerator } from '../core/engine';
import { offset as offsetPoint } from '../core/geo';
import {
  WaIconButton,
  WaMicroLabel,
  WaPrimaryButton,
  WaQuietButton
} from '../components/Common';
import { WaAbstractMap } from '../components/AbstractMap';
import { WaFogPath } from '../components/FogPath';
import { CompassWatcher, GeoWatcher } from '../components/Location';
import { waSleep } from '../components/Async';
import { activeSession, emptySnapshot, readSnapshot } from '../components/StoreBridge';
import {
  WAColor,
  WAFont,
  WASize,
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
  onBack: () => void = () => {
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
  /** 用户手动确认「已停车」：GPS 在停车场里经常漂几百米，不能只靠距离自动切换 */
  @State private parkedOverride: boolean = false;
  /** 还离很远就点「已停车」→ 先确认一次 */
  @State private confirmParkedFar: boolean = false;

  private timerId: number = -1;
  private watcher: GeoWatcher | undefined = undefined;
  private compass: CompassWatcher | undefined = undefined;
  /** 上次看到的会话 id（换了一趟旅程要清掉「已停车」标记） */
  private lastSessionID: string = '';
  @State private heading: number = -1;
  @StorageLink('mapFollowsHeading') private mapFollowsHeading: boolean = true;
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
    // 换了另一趟旅程：手动停车标记不应该带过去（与 iOS onChange(of: session?.id) 一致）
    const session: QuestSession | undefined = this.session();
    const currentID: string = session === undefined ? '' : session.id;
    if (this.lastSessionID.length > 0 && currentID !== this.lastSessionID) {
      this.parkedOverride = false;
      this.confirmParkedFar = false;
    }
    this.lastSessionID = currentID;
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
    return this.winHeight < WASize.shortHeightBreakpoint;
  }

  private mapHeight(): number {
    if (this.isShort()) {
      return 176;
    }
    if (this.winWidth >= WASize.wideBreakpoint) {
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
    // 个人城市地图的轨迹：只在步行段记（开车段记进去，城市地图就成了行车记录）
    if (!this.isDriveSegment()) {
      try {
        getStoreInstance().track().append(point, Date.now());
      } catch (err) {
        // 轨迹失败不影响导航
      }
    }
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
    await waSleep(900);
    animateTo({ duration: 220, curve: Curve.EaseIn }, () => {
      this.flashOpacity = 0;
    });
    await waSleep(240);
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
  // 远程漫游（开车段 / 步行段）
  // ============================================================

  /** 这一趟是不是「远程漫游」：优先看会话自己记的范围，旧会话按里程兜底 */
  private isRoamQuest(): boolean {
    const session: QuestSession | undefined = this.session();
    if (session === undefined) return false;
    if (session.scope === ExploreScope.Roam) return true;
    return isRoamJourney(session.totalMeters);
  }

  /** 已进入停车圈（目的地 1 公里内）—— 从这里开始才算真正的步行探索 */
  private inParkingZone(): boolean {
    return this.remainingMeters() <= PARKING_RADIUS_METERS;
  }

  /**
   * 漫游旅程当前处于「开车段」——开车段不给线索、不画迷雾路径。
   * 判定顺序：进了停车圈 → 步行段；手动点过「已停车」→ 步行段，
   * 但之后又把车开出去（超过 3.5 公里）→ 自动退回开车段。
   */
  private isDriveSegment(): boolean {
    if (!this.isRoamQuest()) return false;
    if (this.inParkingZone()) return false;
    if (this.parkedOverride) return this.remainingMeters() > DRIVE_RESUME_METERS;
    return true;
  }

  /** 允许手动标记「已停车」的距离上限：停车圈 1 公里 + 停车场误差 */
  private canMarkParked(): boolean {
    if (!this.isRoamQuest() || this.parkedOverride) return false;
    return this.remainingMeters() <= PARKING_TOLERANCE_METERS;
  }

  /** 距离文案：漫游里 1 公里以上一律读「X.X 公里」 */
  private distanceCopy(meters: number): string {
    if (meters >= 1000) {
      return (meters / 1000).toFixed(1) + ' 公里';
    }
    return String(Math.round(meters)) + ' 米';
  }

  /** 用户说「已停车」：只切换「段」，不动距离（不篡改 GPS，线索仍按真实距离解锁） */
  private markParked(): void {
    if (!this.canMarkParked()) {
      this.confirmParkedFar = true;
      return;
    }
    this.parkedOverride = true;
    this.load();
    this.onChanged();
  }

  private confirmParkedAnyway(): void {
    this.parkedOverride = true;
    this.confirmParkedFar = false;
    this.load();
    this.onChanged();
  }

  /** 开车段的导航点：目的地 1 公里、方向随机的落点（不泄露终点） */
  private parkingPoint(): GeoPoint | undefined {
    const session: QuestSession | undefined = this.session();
    if (session === undefined || session.target === undefined) return undefined;
    let seedText: number = 0;
    for (let i = 0; i < session.id.length; i += 1) {
      seedText = (seedText * 31 + session.id.charCodeAt(i)) % 2147483647;
    }
    const generator: SeededGenerator = new SeededGenerator(seedText);
    const bearing: number = generator.nextInt(360);
    return offsetPoint(session.target, PARKING_RADIUS_METERS * 0.9, bearing);
  }

  /** 开车段面板：只有「还有多远 / 怎么过去 / 到哪停车」，不给线索也不画路 */
  @Builder
  driveSection() {
    Column({ space: 14 }) {
      Row({ space: 8 }) {
        SymbolGlyph($r('sys.symbol.map'))
          .fontSize(WASize.iconSizeSm)
          .fontColor([WAColor.ink])
          .renderingStrategy(SymbolRenderingStrategy.SINGLE)
        Text('远程漫游 · 先开车过去')
          .fontSize(WAFont.bodySm)
          .fontWeight(FontWeight.Medium)
          .fontColor(WAColor.ink)
        Blank()
        Text('目的地保密')
          .fontSize(WAFont.microSm)
          .fontColor(WAColor.ink3)
      }
      .width('100%')

      Row({ space: 6 }) {
        Text(this.distanceCopy(this.remainingMeters()))
          .fontSize(38)
          .fontWeight(FontWeight.Bold)
          .fontColor(WAColor.ink)
        Text('到停车圈')
          .fontSize(WAFont.bodySm)
          .fontColor(WAColor.ink2)
      }
      .width('100%')
      .alignItems(VerticalAlign.Bottom)

      Text('开到目的地 1 公里内找个地方停车，剩下的路再走过去。不会告诉你终点具体在哪。')
        .fontSize(WAFont.captionSm)
        .fontColor(WAColor.ink2)
        .lineHeight(19)
        .width('100%')

      if (!this.canMarkParked()) {
        Text('还有 ' + this.distanceCopy(this.remainingMeters()) +
          '，进到 2 公里内就能点「已停车」；GPS 飘了也可以手动确认。')
          .fontSize(WAFont.microSm)
          .fontColor(WAColor.ink3)
          .lineHeight(17)
          .width('100%')
      }

      Row({ space: 10 }) {
        Button() {
          Text('导航到附近')
            .fontSize(WAFont.caption)
            .fontWeight(FontWeight.Medium)
            .fontColor(WAColor.iconOnBrand)
        }
        .type(ButtonType.Capsule)
        .height(40)
        .layoutWeight(1)
        .backgroundColor(WAColor.amber)
        .onClick(() => {
          this.openParkingNavigation();
        })

        Button() {
          Text('已停车')
            .fontSize(WAFont.caption)
            .fontWeight(FontWeight.Medium)
            .fontColor(WAColor.ink2)
        }
        .type(ButtonType.Capsule)
        .height(40)
        .layoutWeight(1)
        .backgroundColor(WAColor.paper2)
        .border({ width: 1, color: WAColor.line, radius: WASize.chipRadius })
        .onClick(() => {
          this.markParked();
        })
      }
      .width('100%')
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
    .padding(16)
    .backgroundColor(WAColor.paper)
    .borderRadius(WASize.cardRadius)
    .border({ width: 1, color: WAColor.line, radius: WASize.cardRadius })
    .margin({ left: WASize.pagePadding, right: WASize.pagePadding })
  }

  /** 用系统地图导航到「停车点」（目的地 1 公里外的随机落点，不泄露终点） */
  private openParkingNavigation(): void {
    const point: GeoPoint | undefined = this.parkingPoint();
    if (point === undefined) return;
    try {
      const context = getContext() as common.UIAbilityContext;
      if (context.startAbility !== undefined) {
        const want = {
          action: 'ohos.want.action.viewData',
          entities: ['entity.system.browsable'],
          uri: 'geo:' + point.latitude.toFixed(6) + ',' + point.longitude.toFixed(6) +
            '?q=目的地附近&driving=1'
        };
        context.startAbility(want).catch(() => {
          // 没有地图应用时静默失败（不影响旅程）
        });
      }
    } catch (err) {
      // 同上
    }
  }

  /** 进停车圈后的提示条 */
  @Builder
  roamParkedBanner() {
    Row({ space: 6 }) {
      SymbolGlyph($r('sys.symbol.' + (this.inParkingZone() ? 'figure_walk' : 'pin')))
        .fontSize(WAFont.caption)
        .fontColor([WAColor.teal])
        .renderingStrategy(SymbolRenderingStrategy.SINGLE)
      Text(this.inParkingZone()
        ? '已进入停车圈 · 开始步行探索，线索按距离解锁'
        : '已按「已停车」处理 · 还有 ' + this.distanceCopy(this.remainingMeters()) + ' 走到停车圈')
        .fontSize(WAFont.microSm)
        .fontWeight(FontWeight.Medium)
        .fontColor(WAColor.teal)
        .layoutWeight(1)
        .maxLines(2)
    }
    .width('100%')
    .padding(12)
    .backgroundColor(WAColor.tealSoft)
    .borderRadius(WASize.cardRadiusSm)
  }

  /** 开车段不显示线索：给一个说明，而不是空着 */
  @Builder
  lockedCluePlaceholder() {
    Column({ space: 6 }) {
      Text('线索')
        .fontSize(WAFont.titleMd)
        .fontWeight(FontWeight.Medium)
        .fontColor(WAColor.ink)
      Text('进入停车圈后才会解锁。现在看线索，你也找不准。')
        .fontSize(WAFont.captionSm)
        .fontColor(WAColor.ink2)
        .lineHeight(19)
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
    .padding(14)
    .backgroundColor(WAColor.paper)
    .borderRadius(WASize.cardRadius)
    .border({ width: 1, color: WAColor.line, radius: WASize.cardRadius })
  }

  // ============================================================
  // 区块
  // ============================================================

  @Builder
  topBar() {
    Row({ space: 10 }) {
      WaIconButton({
        name: 'chevron_left',
        onTap: () => {
          this.onBack();
        }
      })

      Column({ space: 2 }) {
        WaMicroLabel({ text: '盲盒进行中' })
        Text(clockHHMMSS(this.elapsedSeconds()))
          .fontSize(WAFont.bodySm)
          .fontColor(WAColor.ink)
          .maxLines(1)
      }
      .alignItems(HorizontalAlign.Start)

      Blank()

      Button() {
        Text(this.paused ? '继续' : '暂停')
          .fontSize(WAFont.captionSm)
          .fontColor(WAColor.ink2)
      }
      .type(ButtonType.Capsule)
      .height(28)
      .padding({ left: 11, right: 11 })
      .backgroundColor(WAColor.paper2)
      .border({ width: 1, color: WAColor.line, radius: WASize.chipRadius })
      .onClick(() => {
        this.togglePause();
      })
    }
    .width('100%')
    .padding({ left: WASize.pagePadding, right: WASize.pagePadding, top: 6, bottom: 6 })
  }

  @Builder
  statusRow() {
    Row({ space: 6 }) {
      Row({ space: 4 }) {
        Circle()
          .width(6)
          .height(6)
          .fill(this.isRealMode() ? WAColor.teal : WAColor.amberDeep)
        Text(this.isRealMode() ? '实时定位 · 真实坐标' : '演示模式 · 内置地点')
          .fontSize(WAFont.micro)
          .fontColor(this.isRealMode() ? WAColor.teal : WAColor.amberDeep)
      }
      .padding({ left: 9, right: 9, top: 4, bottom: 4 })
      .backgroundColor(this.isRealMode() ? WAColor.tealSoft : WAColor.amberSoft)
      .borderRadius(WASize.chipRadius)

      if (this.isRealMode()) {
        Text('GPS')
          .fontSize(WAFont.microSm)
          .fontWeight(FontWeight.Medium)
          .fontColor(WAColor.ink3)
          .padding({ left: 7, right: 7, top: 3, bottom: 3 })
          .border({ width: 1, color: WAColor.line, radius: WASize.chipRadius })
      }

      Blank()
    }
    .width('100%')
    .padding({ left: WASize.pagePadding, right: WASize.pagePadding, bottom: 8 })
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
        WaFogPath({
          routePoints: this.routePoints(),
          routeDistance: this.routeDistance(),
          hereLat: this.fixLat,
          hereLon: this.fixLon,
          viewHeight: this.mapHeight(),
          heading: this.heading,
          northUp: !this.mapFollowsHeading,
          onCaption: (text: string) => {
            this.fogCaption = text;
          }
        })

        Row({ space: 6 }) {
          SymbolGlyph($r('sys.symbol.eye'))
            .fontSize(WAFont.caption)
            .fontColor([WAColor.ink3])
            .renderingStrategy(SymbolRenderingStrategy.SINGLE)
            .fontSize(WAFont.microSm)
          Text(this.fogCaption)
            .fontSize(WAFont.micro)
            .fontColor(WAColor.ink3)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .layoutWeight(1)
        }
        .width('100%')
        .padding({ left: 4, right: 4 })
      }
      .width('100%')
      .padding({ left: WASize.pagePadding, right: WASize.pagePadding })
    } else {
      this.mapSection()
    }
  }

  @Builder
  mapSection() {
    Stack({ alignContent: Alignment.BottomStart }) {
      WaAbstractMap({
        progress: this.progressValue(),
        realMode: this.isRealMode()
      })

      Row({ space: 5 }) {
        SymbolGlyph($r('sys.symbol.eye'))
          .fontSize(WAFont.caption)
          .fontColor([WAColor.ink3])
          .renderingStrategy(SymbolRenderingStrategy.SINGLE)
          .fontSize(WAFont.microSm)
        Text((this.isRealMode() ? '真实位置 · ' : '') + '目的地保密中 · 还有 ' +
          this.remainingMeters() + ' 米')
          .fontSize(WAFont.micro)
          .fontColor(WAColor.ink2)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
      }
      .padding({ left: 10, right: 10, top: 6, bottom: 6 })
      .backgroundColor(WAColor.creamTranslucent)
      .borderRadius(WASize.chipRadius)
      .border({ width: 1, color: WAColor.line, radius: WASize.chipRadius })
      .margin(12)
    }
    .width('100%')
    .height(this.mapHeight())
    .padding({ left: WASize.pagePadding, right: WASize.pagePadding })
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
            .fontSize(this.isShort() ? 46 : WAFont.digits)
            .fontWeight(FontWeight.Bold)
            .fontColor(WAColor.ink)
          Text(' 米')
            .fontSize(WAFont.titleMd)
            .fontColor(WAColor.ink2)
            .margin({ left: 4 })
        }
        .alignItems(VerticalAlign.Bottom)

        Blank()

        Text(this.bearingGlyph())
          .fontSize(34)
          .fontWeight(FontWeight.Bold)
          .fontColor(WAColor.amberDeep)
      }
      .width('100%')

      Text(this.directionCopy())
        .fontSize(WAFont.bodySm)
        .fontColor(WAColor.ink2)
        .width('100%')

      Stack({ alignContent: Alignment.Start }) {
        Row()
          .width('100%')
          .height(5)
          .backgroundColor(WAColor.line)
          .borderRadius(3)

        Row()
          .width((this.progressValue() * 100) + '%')
          .height(5)
          .backgroundColor(WAColor.amber)
          .borderRadius(3)
      }
      .width('100%')
      .margin({ top: 4 })

      Text('已走 ' + String(this.walkedMeters()) + ' 米 · 共 ' + String(this.totalMeters()) + ' 米')
        .fontSize(WAFont.micro)
        .fontColor(WAColor.ink3)
        .width('100%')
    }
    .width('100%')
    .padding({ left: WASize.pagePadding, right: WASize.pagePadding, top: 18 })
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
          .fill(this.isClueUnlocked(index) ? '#292E7D78' : WAColor.paper2)
          .stroke(this.isClueUnlocked(index) ? '#662E7D78' : WAColor.line)
          .strokeWidth(1)

        if (this.isClueUnlocked(index)) {
          SymbolGlyph($r('sys.symbol.checkmark'))
            .fontSize(WAFont.micro)
            .fontColor([WAColor.teal])
            .renderingStrategy(SymbolRenderingStrategy.SINGLE)
        } else {
          Text(String(index + 1))
            .fontSize(WAFont.microSm)
            .fontWeight(FontWeight.Bold)
            .fontColor(WAColor.ink3)
        }
      }

      if (this.isClueUnlocked(index)) {
        Row({ space: 8 }) {
          SymbolGlyph($r('sys.symbol.checkmark_circle'))
            .fontSize(WAFont.caption)
            .fontColor([WAColor.teal])
            .renderingStrategy(SymbolRenderingStrategy.SINGLE)
            .fontSize(WAFont.caption)
          Text(this.clueText(index))
            .fontSize(WAFont.caption)
            .fontColor(WAColor.ink)
            .lineHeight(21)
            .layoutWeight(1)
        }
        .width('100%')
        .padding({ left: 14, right: 14, top: 12, bottom: 12 })
        .backgroundColor(WAColor.paper)
        .borderRadius(18)
        .border({ width: 1, color: WAColor.line, radius: 18 })
        .shadow({ radius: 10, color: WAColor.shadowSoft, offsetX: 0, offsetY: 6 })
      } else {
        Row({ space: 8 }) {
          SymbolGlyph($r('sys.symbol.lock'))
            .fontSize(WAFont.caption)
            .fontColor([WAColor.ink3])
            .renderingStrategy(SymbolRenderingStrategy.SINGLE)
            .fontSize(WAFont.captionSm)
          Text(this.lockedClueCopy(index))
            .fontSize(WAFont.caption)
            .fontColor(WAColor.ink3)
            .lineHeight(20)
            .layoutWeight(1)
        }
        .width('100%')
        .padding({ left: 14, right: 14, top: 12, bottom: 12 })
        .backgroundColor('#8CFBF4E9')
        .borderRadius(18)
        .border({ width: 1, color: WAColor.line, style: BorderStyle.Dashed, radius: 18 })
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
          .fontSize(WAFont.titleMd)
          .fontWeight(FontWeight.Medium)
          .fontColor(WAColor.ink)
        Text(this.unlockedHintCountText())
          .fontSize(WAFont.caption)
          .fontColor(WAColor.ink3)
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
    .padding({ left: WASize.pagePadding, right: WASize.pagePadding, top: 16 })
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
        WaPrimaryButton({
          title: '揭晓盲盒',
          onTap: () => {
            this.beginArrival();
          }
        })
      } else if (this.snapshot.demoMode) {
        WaPrimaryButton({
          title: '模拟步行 +50m',
          tag: '演示',
          onTap: () => {
            this.simulateWalk();
          }
        })
        WaQuietButton({
          title: '我到了',
          onTap: () => {
            this.arriveNow();
          }
        })
      } else {
        WaPrimaryButton({
          title: '走累了？直接揭晓',
          tag: '兜底',
          onTap: () => {
            this.arriveNow();
          }
        })
        Text('位置没动？改用演示模式 ›')
          .fontSize(WAFont.micro)
          .fontColor(WAColor.ink3)
          .width('100%')
          .textAlign(TextAlign.Center)
          .onClick(() => {
            this.switchToDemo();
          })
      }
    }
    .width('100%')
    .padding({
      left: WASize.pagePadding,
      right: WASize.pagePadding,
      top: 14,
      bottom: 18
    })
  }

  @Builder
  journeyBody() {
    Column({ space: 0 }) {
      this.topBar()
      this.statusRow()

      if (this.isDriveSegment()) {
        // 开车段：先开车过去（不给线索、不画迷雾路径）
        this.driveSection()
      } else {
        if (this.isRoamQuest()) {
          Column() {
            this.roamParkedBanner()
          }
          .padding({ left: WASize.pagePadding, right: WASize.pagePadding, bottom: 10 })
        }
        this.pathSection()
        this.distanceSection()
        this.clueSection()
      }

      this.actionSection()
    }
    .width('100%')
    .constraintSize({ maxWidth: WASize.contentMaxWidth })
  }

  @Builder
  emptyBody() {
    Column({ space: 14 }) {
      WaMicroLabel({ text: '盲盒进行中' })
      Text('还没有正在进行的盲盒。')
        .fontSize(WAFont.body)
        .fontWeight(FontWeight.Medium)
        .fontColor(WAColor.ink)
      Text('让城市替你选一个。')
        .fontSize(WAFont.caption)
        .fontColor(WAColor.ink3)
      Row() {
        WaQuietButton({
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
        .backgroundColor(WAColor.cream)

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
            .fontColor(WAColor.creamOnStage)
          Text('这个地点，只为你亮一次。')
            .fontSize(WAFont.bodySm)
            .fontColor(WAColor.creamOnStageDim)
        }
        .width('100%')
        .height('100%')
        .justifyContent(FlexAlign.Center)
        .backgroundColor(WAColor.stage)
        .opacity(this.flashOpacity)
      }

      // 「还没到停车圈，确定已经停好车了吗？」确认弹层
      if (this.confirmParkedFar) {
        Stack({ alignContent: Alignment.Center }) {
          Column()
            .width('100%')
            .height('100%')
            .backgroundColor(WAColor.scrim)
            .onClick(() => {
              this.confirmParkedFar = false;
            })

          Column({ space: 12 }) {
            Text('还没到停车圈，确定已经停好车了吗？')
              .fontSize(WAFont.titleSm)
              .fontWeight(FontWeight.Medium)
              .fontColor(WAColor.ink)
              .width('100%')

            Text('现在离目的地还有 ' + this.distanceCopy(this.remainingMeters()) +
              '。按步行段继续后，线索仍按真实距离解锁。')
              .fontSize(WAFont.caption)
              .fontColor(WAColor.ink2)
              .lineHeight(20)
              .width('100%')

            Button() {
              Text('已经停好车，按步行段继续')
                .fontSize(WAFont.caption)
                .fontWeight(FontWeight.Medium)
                .fontColor(WAColor.iconOnBrand)
            }
            .type(ButtonType.Capsule)
            .height(42)
            .width('100%')
            .backgroundColor(WAColor.amber)
            .onClick(() => {
              this.confirmParkedAnyway();
            })

            Button() {
              Text('再开一会儿')
                .fontSize(WAFont.caption)
                .fontColor(WAColor.ink2)
            }
            .type(ButtonType.Capsule)
            .height(40)
            .width('100%')
            .backgroundColor(WAColor.paper2)
            .onClick(() => {
              this.confirmParkedFar = false;
            })
          }
          .width('100%')
          .constraintSize({ maxWidth: 380 })
          .padding(18)
          .backgroundColor(WAColor.paper)
          .borderRadius(WASize.cardRadius)
          .margin({ left: WASize.pagePadding, right: WASize.pagePadding })
        }
        .width('100%')
        .height('100%')
      }
    }
    .width('100%')
    .height('100%')
  }
}
