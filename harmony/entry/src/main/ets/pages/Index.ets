/**
 * 步迷 Walkaholic · HarmonyOS ArkUI — 单页外壳（pages/Index）
 *
 * 结构：
 * - Tabs（今日 / 图鉴 / 圈子 / 我的）作为底部外壳；
 * - 抽盒 sheet、旅程、揭晓、成就 用「全屏覆盖层」叠在外壳上（对应 iOS 的 sheet / fullScreenCover）；
 * - 状态：所有实时状态都在 store 里，本页只维护 route / revision / 窗口尺寸；
 *   每次交互后 refresh() 让各页重读 snapshot。
 *
 * 定位权限与 initStore 时机：本页 aboutToAppear 里 await initStore(...)，就绪后才渲染页面，
 * 避免 UI 先读到半初始化状态（逻辑层 getStore 是懒加载单例）。
 */

import { common } from '@kit.AbilityKit';
import { getStore, initStore, registerPlaces, setNearbyPlaces } from '../core/store';
import { PreferencesKV } from '../components/PreferencesKV';
import { HarmonyHttpClient, readBundledMapKeys } from '../components/HttpClient';
import { WaAccountPanel } from '../components/AccountPanel';
import { WaDataSourcePanel } from '../components/DataSourcePanel';
import { WaSeekPanel } from '../components/SeekPanel';
import { BurySurprisePanel } from '../components/BurySurprisePanel';
import { SurprisesPanel } from '../components/SurprisesPanel';
import { CityMapView } from '../views/CityMapView';
import { AccountConfig, readDeviceID } from '../core/account';
import {
  claimSurprise,
  fetchMySurpriseReceipts,
  fetchNearbySurprises,
  uploadSurprise
} from '../core/surpriseRemote';
import { BuriedSurprise, GeoPoint as GeoPointType } from '../core/types';
import { DataSourceStatus } from '../core/contract';
import { WAColor, WAFont, WASize } from '../theme/Theme';
import { WaBoxArt } from '../components/BoxArt';
import { AchievementsPanel } from '../components/AchievementsPanel';
import { KeyValueStore, RoutePolyline } from '../core/contract';
import { QuestFlowDeps, planRoute } from '../core/flow';
import { discoverNearbyPlaces } from '../core/nearby';
import { getCurrentLocationOnce, requestLocationPermission } from '../components/Location';
import { applySyncedPayload, buildSyncPayload } from '../components/StoreBridge';
import { readAccountConfig } from '../core/account';
import { MAPKEYS_CACHE_KEY, loadMapKeys, mapKeysSourceText } from '../core/mapkeys';
import { waToast } from '../components/Async';
import { BuriedSurprise, GeoPoint, Place } from '../core/types';
import { HomeView } from '../views/HomeView';
import { CardsView } from '../views/CardsView';
import { SocialView } from '../views/SocialView';
import { ProfileView } from '../views/ProfileView';
import { SetupSheet } from '../views/SetupSheet';
import { JourneyView } from '../views/JourneyView';
import { RevealView } from '../views/RevealView';

const TAB_HOME: number = 0;
const TAB_CARDS: number = 1;
const TAB_SOCIAL: number = 2;
const TAB_PROFILE: number = 3;

const OVERLAY_NONE: string = 'none';
const OVERLAY_SETUP: string = 'setup';
const OVERLAY_JOURNEY: string = 'journey';
const OVERLAY_REVEAL: string = 'reveal';
const OVERLAY_ACHIEVEMENTS: string = 'achievements';
const OVERLAY_ACCOUNT: string = 'account';
const OVERLAY_DATASOURCE: string = 'datasource';
const OVERLAY_SEEK: string = 'seek';
const OVERLAY_BURY: string = 'bury';
const OVERLAY_SURPRISES: string = 'surprises';
const OVERLAY_CITYMAP: string = 'citymap';

@Entry
@Component
struct Index {
  @State private ready: boolean = false;
  @State private initError: string = '';
  @State private tab: number = TAB_HOME;
  @State private activeOverlay: string = OVERLAY_NONE;
  @State private revision: number = 0;
  @State private winWidth: number = 400;
  @State private winHeight: number = 800;

  private tabsController: TabsController = new TabsController();

  /** 平台能力（注入给 core/ 的纯逻辑，UI 层只在这里创建一次） */
  private http: HarmonyHttpClient = new HarmonyHttpClient();
  private kv: KeyValueStore | undefined = undefined;
  /** 后台地址（key 下发 / 账号服务可配） */
  private adminBase: string = 'http://127.0.0.1:8802';
  /** 抽盒完成后异步规划路线（迷雾路径视图用） */
  private routePending: boolean = false;
  /** 包内 mapkeys.json 文本（启动时读一次；没有就是空串） */
  private bundledKeys: string | undefined = undefined;
  /** 账号状态文案（ProfileView 入口右侧小字；登录/退出后刷新） */
  @State private accountLabel: string = '未登录';
  /** 策展地点条数（数据源面板展示） */
  @State private curatedCount: number = 0;
  /** 正在探寻的惊喜 id（空串 = 没打开） */
  @State private seekSurpriseID: string = '';
  /** 正在探寻的惊喜线索（只读副本；不传整颗惊喜，避免 UI 拿到照片字段） */
  @State private seekClues: string[] = [];
  /** 正在探寻的惊喜坐标（只用于算距离，不渲染） */
  @State private seekTargetLat: number = 0;
  @State private seekTargetLon: number = 0;
  @State private seekAuthorEmoji: string = '🎁';
  /** 附近兴趣点检索中（避免重复请求） */
  private nearbyLoading: boolean = false;
  /** 上次附近检索的位置（偏差 300m 以上才重查） */
  private nearbyAnchor: GeoPoint | undefined = undefined;

  aboutToAppear(): void {
    // 地图朝向开关：AppStorage 全局共享 + 持久化（重启后保持）
    PersistentStorage.persistProp('mapFollowsHeading', true);
    this.bootstrap();
  }

  /** 读包内 mapkeys.json（部署时注入；读不到是正常情况） */
  private async loadBundledKeys(): Promise<void> {
    try {
      const text: string | undefined = await readBundledMapKeys();
      this.bundledKeys = text;
    } catch (err) {
      this.bundledKeys = undefined;
    }
  }

  /** 初始化持久化 + store（失败也要能进演示态） */
  private async bootstrap(): Promise<void> {
    this.initError = '';
    this.ready = false;
    await this.loadBundledKeys();
    try {
      const context: common.UIAbilityContext = getContext(this) as common.UIAbilityContext;
      const kv: PreferencesKV = new PreferencesKV(context);
      await kv.init();
      this.kv = kv;
      await initStore(kv);
    } catch (err) {
      // 持久化不可用时继续：store 会用内存态兜底（不会崩）
    }
    try {
      getStore().snapshot();
      this.ready = true;
      this.revision = this.revision + 1;
      // 有定位就顺手把附近兴趣点拉了（进图鉴立刻有内容）
      this.loadNearbyPlaces();
      // 冷启动：补齐未上传的惊喜 + 同步「被找到」回执（失败静默）
      this.syncSurprises();
    } catch (err) {
      this.initError = '本地数据没准备好，重新打开试试。';
    }
  }

  /** 账号配置（远端惊喜 / 回执 / 照片上传都要它） */
  private accountConfig(): AccountConfig {
    if (this.kv === undefined) {
      const fallback: AccountConfig = { baseUrl: 'https://xqlounge.top' };
      return fallback;
    }
    try {
      return readAccountConfig(this.kv);
    } catch (err) {
      const fallback: AccountConfig = { baseUrl: 'https://xqlounge.top' };
      return fallback;
    }
  }

  /**
   * 惊喜的远端同步（与 iOS SurpriseService 同一套职责）：
   *   1. 拉附近别人埋的 → 合并进 store
   *   2. 补传本机还没上传成功的
   *   3. 拉「被找到」回执 → 点红点
   *
   * 任何一步失败都静默（不打扰浏览）。
   */
  private async syncSurprises(): Promise<void> {
    if (this.kv === undefined) return;
    const config: AccountConfig = this.accountConfig();
    const origin: GeoPointType | undefined = this.currentFixOrUndefined();
    if (origin !== undefined) {
      const result = await fetchNearbySurprises(this.http, config, this.kv, origin, 5000);
      if (result.ok && result.surprises.length > 0) {
        getStore().mergeRemoteSurprises(result.surprises);
        this.refresh();
      }
    }
    // 补传本机埋下的
    const pending: BuriedSurprise[] = getStore().pendingUploadSurprises();
    for (let i = 0; i < pending.length; i += 1) {
      const ok = await uploadSurprise(this.http, config, this.kv, pending[i]);
      if (ok) getStore().markSurpriseUploaded(pending[i].id);
    }
    // 回执
    const receipts = await fetchMySurpriseReceipts(this.http, config, this.kv);
    if (receipts.length > 0) {
      getStore().applyReceipts(receipts);
      this.refresh();
    }
  }

  private currentFixOrUndefined(): GeoPointType | undefined {
    try {
      const origin: GeoPointType | undefined = getStore().snapshot().lastKnownOrigin;
      if (origin === undefined) return undefined;
      return origin;
    } catch (err) {
      return undefined;
    }
  }

  /** 埋下后立刻尽力上传这一颗（失败保留 pending，下次冷启动再补） */
  private async uploadSurpriseByID(surpriseID: string): Promise<void> {
    if (this.kv === undefined) return;
    const snapshot = getStore().snapshot();
    let target: BuriedSurprise | undefined = undefined;
    for (let i = 0; i < snapshot.mySurprises.length; i += 1) {
      if (snapshot.mySurprises[i].id === surpriseID) {
        target = snapshot.mySurprises[i];
        break;
      }
    }
    if (target === undefined) return;
    const config: AccountConfig = this.accountConfig();
    const ok = await uploadSurprise(this.http, config, this.kv, target);
    if (ok) getStore().markSurpriseUploaded(surpriseID);
  }

  /** 任何 store 状态变化后调用：让四个 Tab 页重读 snapshot */
  private refresh(): void {
    this.refreshAccountLabel();
    this.revision = this.revision + 1;
  }

  private openSetup(): void {
    this.activeOverlay = OVERLAY_SETUP;
  }

  private closeSetup(): void {
    this.activeOverlay = OVERLAY_NONE;
    this.refresh();
  }

  private setupStarted(): void {
    this.activeOverlay = OVERLAY_JOURNEY;
    this.refresh();
    this.planRouteInBackground();
  }

  /**
   * 抽盒成功后异步规划步行路线（迷雾路径视图用）。
   * 失败不影响旅程：UI 会退回「只显示直线距离 + 方向」。
   */
  private async planRouteInBackground(): Promise<void> {
    if (this.routePending) return;
    if (this.kv === undefined) return;
    const deps: QuestFlowDeps = {
      http: this.http,
      kv: this.kv,
      readBundledKeys: (): string | undefined => this.bundledKeys,
      adminBase: this.adminBase,
      now: (): number => Date.now()
    };
    let snapshot = getStore().snapshot();
    const from = snapshot.lastKnownOrigin;
    const session = snapshot.session;
    if (session === undefined || session.target === undefined || from === undefined) return;
    this.routePending = true;
    try {
      const route: RoutePolyline | undefined = await planRoute(deps, from, session.target);
      if (route !== undefined) {
        getStore().setRoute(route);
        this.refresh();
      }
    } catch (err) {
      // 路线失败：不阻塞、不弹错，UI 自动降级
    } finally {
      this.routePending = false;
    }
  }

  /** 刷新账号状态文案（ProfileView 的入口右侧小字） */
  private refreshAccountLabel(): void {
    if (this.kv === undefined) {
      this.accountLabel = '未登录';
      return;
    }
    try {
      const config = readAccountConfig(this.kv);
      this.accountLabel = config.user === undefined ? '未登录' : config.user.username;
    } catch (err) {
      this.accountLabel = '未登录';
    }
  }

  /** 当前定位（没有就是 0,0；配合 hasOrigin() 判断） */
  private currentFix(): GeoPoint {
    try {
      const snapshot = getStore().snapshot();
      const origin: GeoPoint | undefined = snapshot.lastKnownOrigin;
      if (origin === undefined) {
        const zero: GeoPoint = { latitude: 0, longitude: 0 };
        return zero;
      }
      return origin;
    } catch (err) {
      const zero: GeoPoint = { latitude: 0, longitude: 0 };
      return zero;
    }
  }

  /** 是否已经拿到过定位（决定线索能不能按距离解锁） */
  private hasOrigin(): boolean {
    try {
      return getStore().snapshot().lastKnownOrigin !== undefined;
    } catch (err) {
      return false;
    }
  }

  /** 当前数据源状态（没搜索过时给空态） */
  private dataSourceStatus(): DataSourceStatus {
    try {
      return getStore().dataSourceStatus();
    } catch (err) {
      const empty: DataSourceStatus = {
        keySource: 'none', amapReady: false, baiduReady: false,
        amapMask: '', baiduMask: '', reports: [], checkedAt: 0, curatedCount: 0
      };
      return empty;
    }
  }

  /** 重新加载地图 Key（清缓存后重跑一次下发流程） */
  private async reloadKeys(): Promise<void> {
    if (this.kv === undefined) return;
    try {
      this.kv.delete(MAPKEYS_CACHE_KEY);
    } catch (err) {
      // 忽略
    }
    this.bundledKeys = await readBundledMapKeys();
    const keys = await loadMapKeys(
      this.http, this.kv,
      (): string | undefined => this.bundledKeys,
      this.adminBase, Date.now()
    );
    waToast(mapKeysSourceText(keys.source));
    this.refresh();
  }

  /**
   * 打开探寻面板：从快照里找到目标惊喜，只把「判定线索需要的字段」传进去。
   *
   * **保密**：不传 areaWord / photoUri / photoHash，只传 hints + 坐标（坐标只算距离）。
   */
  private openSeek(surpriseID: string): void {
    let found: BuriedSurprise | undefined = undefined;
    try {
      const snapshot = getStore().snapshot();
      const list: BuriedSurprise[] = snapshot.explorableSurprises;
      for (let i = 0; i < list.length; i += 1) {
        if (list[i].id === surpriseID) {
          found = list[i];
          break;
        }
      }
    } catch (err) {
      found = undefined;
    }
    if (found === undefined) {
      waToast('这个惊喜已经不在了');
      this.refresh();
      return;
    }
    this.seekSurpriseID = found.id;
    this.seekClues = found.hints.slice();
    this.seekAuthorEmoji = found.authorEmoji;
    this.seekTargetLat = found.location.latitude;
    this.seekTargetLon = found.location.longitude;
    this.activeOverlay = OVERLAY_SEEK;
    this.refresh();
  }

  /**
   * 检索附近的兴趣点并灌入 store（图鉴「附近的兴趣点」区块用）。
   *
   * 只在有定位时执行；同一位置（300m 内）不重复请求。
   * 失败不弹错：图鉴会显示「正在搜附近…」，用户可下拉重试。
   */
  private async loadNearbyPlaces(): Promise<void> {
    if (this.kv === undefined) return;
    if (this.nearbyLoading) return;
    let origin: GeoPoint | undefined = undefined;
    try {
      origin = getStore().snapshot().lastKnownOrigin;
    } catch (err) {
      origin = undefined;
    }
    // 没有定位就主动取一次（图鉴不该要求用户先去抽盒才能看附近）
    if (origin === undefined) {
      try {
        const context: common.UIAbilityContext = getContext(this) as common.UIAbilityContext;
        const granted: boolean = await requestLocationPermission(context);
        if (!granted) return;
        const fix: GeoPoint = await getCurrentLocationOnce(8000);
        getStore().setLastKnownOrigin(fix);
        getStore().setDemoMode(false);
        origin = fix;
      } catch (err) {
        return;
      }
    }

    // 同一位置不重复拉
    if (this.nearbyAnchor !== undefined) {
      const dLat: number = Math.abs(this.nearbyAnchor.latitude - origin.latitude);
      const dLon: number = Math.abs(this.nearbyAnchor.longitude - origin.longitude);
      if (dLat < 0.003 && dLon < 0.003) return;
    }

    this.nearbyLoading = true;
    try {
      const discovery = await discoverNearbyPlaces({
        kv: this.kv,
        http: this.http,
        readBundledKeys: (): string | undefined => this.bundledKeys,
        adminBase: this.adminBase,
        now: (): number => Date.now()
      }, origin);
      if (!discovery.failed) {
        this.nearbyAnchor = origin;
        setNearbyPlaces(discovery.places);
        registerPlaces(discovery.places);
        this.refresh();
      }
    } catch (err) {
      // 网络/数据源全挂：保持空列表，图鉴显示「正在搜附近…」
    } finally {
      this.nearbyLoading = false;
    }
  }

  /**
   * 从图鉴点「未探索的兴趣点」→ 用该地点开始一次真实旅程。
   *
   * 闸门：必须有真实坐标 + 真实来源，否则明确失败（绝不虚构）。
   */
  private exploreNearbyPlace(placeID: string): void {
    let target: Place | undefined = undefined;
    let origin: GeoPoint | undefined = undefined;
    try {
      const snapshot = getStore().snapshot();
      origin = snapshot.lastKnownOrigin;
      for (let i = 0; i < snapshot.nearbyPlaces.length; i += 1) {
        if (snapshot.nearbyPlaces[i].id === placeID) {
          target = snapshot.nearbyPlaces[i];
          break;
        }
      }
    } catch (err) {
      target = undefined;
    }
    if (target === undefined) {
      waToast('这个地点已经不在了');
      this.refresh();
      return;
    }
    if (origin === undefined) {
      waToast('需要先定位才能出发');
      this.refresh();
      return;
    }
    const started = getStore().startQuestWithPlace(target, origin);
    if (started === undefined) {
      waToast('这个地点信息不完整，换个试试');
      this.refresh();
      return;
    }
    getStore().setDemoMode(false);
    this.activeOverlay = OVERLAY_JOURNEY;
    this.refresh();
    this.planRouteInBackground();
  }

  /** 打开账号面板（我的 → 设置 → 账号） */
  private openAccount(): void {
    this.activeOverlay = OVERLAY_ACCOUNT;
    this.refresh();
  }

  private closeJourney(): void {
    this.activeOverlay = OVERLAY_NONE;
    this.refresh();
  }

  private openReveal(): void {
    this.activeOverlay = OVERLAY_REVEAL;
    this.refresh();
  }

  /** 收录完成：回图鉴 Tab */
  private goCards(): void {
    this.activeOverlay = OVERLAY_NONE;
    this.tab = TAB_CARDS;
    this.tabsController.changeIndex(TAB_CARDS);
    this.refresh();
  }

  private openAchievements(): void {
    this.activeOverlay = OVERLAY_ACHIEVEMENTS;
  }

  private closeAchievements(): void {
    this.activeOverlay = OVERLAY_NONE;
    this.refresh();
  }

  // ============================================================
  // 底部 Tab
  // ============================================================

  @Builder
  tabBuilder(title: string, glyph: string, index: number) {
    Column({ space: 2 }) {
      SymbolGlyph($r('sys.symbol.' + glyph))
        .fontSize(WASize.iconSize)
        .fontColor([this.tab === index ? WAColor.amber : WAColor.ink3])
        .renderingStrategy(SymbolRenderingStrategy.SINGLE)

      Text(title)
        .fontSize(WAFont.micro)
        .fontWeight(this.tab === index ? FontWeight.Medium : FontWeight.Regular)
        .fontColor(this.tab === index ? WAColor.amber : WAColor.ink3)
    }
    .width('100%')
    .height(56)
    .justifyContent(FlexAlign.Center)
  }

  @Builder
  tabShell() {
    Tabs({ barPosition: BarPosition.End, index: this.tab, controller: this.tabsController }) {
      TabContent() {
        HomeView({
          revision: this.revision,
          winWidth: this.winWidth,
          winHeight: this.winHeight,
          onOpenSetup: () => {
            this.openSetup();
          },
          onOpenJourney: () => {
            this.activeOverlay = OVERLAY_JOURNEY;
          },
          onOpenCards: () => {
            this.tab = TAB_CARDS;
            this.tabsController.changeIndex(TAB_CARDS);
            this.refresh();
          },
          onOpenBury: () => {
            this.activeOverlay = OVERLAY_BURY;
            this.refresh();
          },
          onOpenMySurprises: () => {
            this.activeOverlay = OVERLAY_SURPRISES;
            this.syncSurprises();
            this.refresh();
          },
          onOpenSeek: (surpriseID: string) => {
            this.openSeek(surpriseID);
          }
        })
      }
      .tabBar(this.tabBuilder('今日', 'house', TAB_HOME))

      TabContent() {
        CardsView({
          revision: this.revision,
          winWidth: this.winWidth,
          winHeight: this.winHeight,
          kv: this.kv,
          onChanged: () => {
            this.refresh();
          },
          onOpenSeek: (surpriseID: string) => {
            this.openSeek(surpriseID);
          },
          onOpenBury: () => {
            this.activeOverlay = OVERLAY_BURY;
            this.refresh();
          },
          onExplorePlace: (placeID: string) => {
            this.exploreNearbyPlace(placeID);
          }
        })
      }
      .tabBar(this.tabBuilder('图鉴', 'square_grid_2x2', TAB_CARDS))

      TabContent() {
        SocialView({
          revision: this.revision,
          winWidth: this.winWidth,
          winHeight: this.winHeight,
          onOpenSetup: () => {
            this.openSetup();
          },
          onChanged: () => {
            this.refresh();
          }
        })
      }
      .tabBar(this.tabBuilder('圈子', 'person_2', TAB_SOCIAL))

      TabContent() {
        ProfileView({
          revision: this.revision,
          winWidth: this.winWidth,
          winHeight: this.winHeight,
          accountLabel: this.accountLabel,
          onOpenAchievements: () => {
            this.openAchievements();
          },
          onOpenAccount: () => {
            this.openAccount();
          },
          onOpenDataSource: () => {
            this.activeOverlay = OVERLAY_DATASOURCE;
            this.refresh();
          },
          onOpenCityMap: () => {
            this.activeOverlay = OVERLAY_CITYMAP;
            this.refresh();
          },
          onOpenMySurprises: () => {
            this.activeOverlay = OVERLAY_SURPRISES;
            this.syncSurprises();
            this.refresh();
          },
          onChanged: () => {
            this.refresh();
          }
        })
      }
      .tabBar(this.tabBuilder('我的', 'person', TAB_PROFILE))
    }
    .barHeight(56)
    .barBackgroundColor(WAColor.paper)
    .barMode(BarMode.Fixed)
    .scrollable(false)
    .animationDuration(0)
    .divider({ strokeWidth: 1, color: WAColor.line })
    .onChange((index: number) => {
      this.tab = index;
      this.refresh();
      if (index === TAB_CARDS) {
        this.loadNearbyPlaces();
      }
    })
    .width('100%')
    .height('100%')
  }

  // ============================================================
  // 加载 / 错误态
  // ============================================================

  @Builder
  loadingView() {
    Column({ space: 18 }) {
      WaBoxArt({ artSize: 104 })

      Text('正在准备今晚的盲盒…')
        .fontSize(WAFont.caption)
        .fontColor(WAColor.ink3)
    }
    .width('100%')
    .height('100%')
    .justifyContent(FlexAlign.Center)
    .backgroundColor(WAColor.cream)
  }

  @Builder
  errorView() {
    Column({ space: 12 }) {
      SymbolGlyph($r('sys.symbol.exclamationmark_triangle'))
        .fontSize(32)
        .fontColor([WAColor.gold])
        .renderingStrategy(SymbolRenderingStrategy.SINGLE)
        .fontSize(32)
      Text(this.initError)
        .fontSize(WAFont.bodySm)
        .fontColor(WAColor.ink2)
        .textAlign(TextAlign.Center)
      Button('重试')
        .type(ButtonType.Capsule)
        .height(40)
        .padding({ left: 22, right: 22 })
        .fontSize(WAFont.caption)
        .fontColor(WAColor.ink)
        .backgroundColor(WAColor.amber)
        .onClick(() => {
          this.bootstrap();
        })
    }
    .width('100%')
    .height('100%')
    .justifyContent(FlexAlign.Center)
    .padding(WASize.pagePadding)
    .backgroundColor(WAColor.cream)
  }

  build() {
    Stack({ alignContent: Alignment.TopStart }) {
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor(WAColor.cream)

      if (this.initError.length > 0) {
        this.errorView()
      } else if (!this.ready) {
        this.loadingView()
      } else {
        this.tabShell()
      }

      // ---------- 全屏覆盖层（对应 iOS sheet / fullScreenCover） ----------

      if (this.ready && this.activeOverlay === OVERLAY_SETUP) {
        SetupSheet({
          winWidth: this.winWidth,
          winHeight: this.winHeight,
          http: this.http,
          kv: this.kv,
          readBundledKeys: (): string | undefined => this.bundledKeys,
          adminBase: this.adminBase,
          onClose: () => {
            this.closeSetup();
          },
          onStarted: () => {
            this.setupStarted();
          },
          onChanged: () => {
            this.refresh();
          }
        })
      }

      if (this.ready && this.activeOverlay === OVERLAY_SEEK) {
        WaSeekPanel({
          surpriseID: this.seekSurpriseID,
          clues: this.seekClues,
          authorEmoji: this.seekAuthorEmoji,
          hereLat: this.currentFix().latitude,
          hereLon: this.currentFix().longitude,
          hasOrigin: this.hasOrigin(),
          targetLat: this.seekTargetLat,
          targetLon: this.seekTargetLon,
          onBack: () => {
            this.activeOverlay = OVERLAY_NONE;
            this.seekSurpriseID = '';
            this.refresh();
          }
        })
      }

      if (this.ready && this.activeOverlay === OVERLAY_DATASOURCE) {
        WaDataSourcePanel({
          status: this.dataSourceStatus(),
          curatedCount: this.curatedCount,
          onBack: () => {
            this.activeOverlay = OVERLAY_NONE;
            this.refresh();
          },
          onReload: () => {
            this.reloadKeys();
          }
        })
      }

      if (this.ready && this.activeOverlay === OVERLAY_BURY) {
        BurySurprisePanel({
          winWidth: this.winWidth,
          winHeight: this.winHeight,
          onClose: () => {
            this.activeOverlay = OVERLAY_NONE;
            this.refresh();
          },
          onBuried: (surpriseID: string) => {
            // 埋下后立刻尽力上传（未登录也能传：服务端按设备标识区分作者）
            this.uploadSurpriseByID(surpriseID);
            this.refresh();
          },
          onChanged: () => {
            this.refresh();
          }
        })
      }

      if (this.ready && this.activeOverlay === OVERLAY_SURPRISES) {
        SurprisesPanel({
          revision: this.revision,
          winWidth: this.winWidth,
          winHeight: this.winHeight,
          onBack: () => {
            this.activeOverlay = OVERLAY_NONE;
            this.refresh();
          },
          onOpenBury: () => {
            this.activeOverlay = OVERLAY_BURY;
            this.refresh();
          }
        })
      }

      if (this.ready && this.activeOverlay === OVERLAY_CITYMAP) {
        CityMapView({
          revision: this.revision,
          winWidth: this.winWidth,
          winHeight: this.winHeight,
          onBack: () => {
            this.activeOverlay = OVERLAY_NONE;
            this.refresh();
          }
        })
      }

      if (this.ready && this.activeOverlay === OVERLAY_ACCOUNT) {
        WaAccountPanel({
          revision: this.revision,
          kv: this.kv,
          http: this.http,
          buildPayload: (): Record<string, Object> => buildSyncPayload(),
          applyPayload: (payload: Record<string, Object>): void => {
            applySyncedPayload(payload);
            this.refresh();
          },
          onBack: () => {
            this.activeOverlay = OVERLAY_NONE;
            this.refresh();
          },
          onChanged: () => {
            this.refresh();
          }
        })
      }

      if (this.ready && this.activeOverlay === OVERLAY_JOURNEY) {
        JourneyView({
          revision: this.revision,
          winWidth: this.winWidth,
          winHeight: this.winHeight,
          onBack: () => {
            this.closeJourney();
          },
          onArrived: () => {
            this.openReveal();
          },
          onChanged: () => {
            this.refresh();
          }
        })
      }

      if (this.ready && this.activeOverlay === OVERLAY_REVEAL) {
        RevealView({
          winWidth: this.winWidth,
          winHeight: this.winHeight,
          http: this.http,
          kv: this.kv,
          onGoCards: () => {
            this.goCards();
          },
          onChanged: () => {
            this.refresh();
          }
        })
      }

      if (this.ready && this.activeOverlay === OVERLAY_ACHIEVEMENTS) {
        AchievementsPanel({
          onBack: () => {
            this.closeAchievements();
          }
        })
      }
    }
    .width('100%')
    .height('100%')
    .onAreaChange((oldValue: Area, newValue: Area) => {
      this.winWidth = parseFloat(newValue.width.toString());
      this.winHeight = parseFloat(newValue.height.toString());
    })
  }
}
