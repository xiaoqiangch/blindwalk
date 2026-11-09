/**
 * 盲走 BlindWalk · HarmonyOS ArkUI — 单页外壳（pages/Index）
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
import { getStore, initStore } from '../core/store';
import { PreferencesKV } from '../components/PreferencesKV';
import { BWColor, BWFont, BWSize } from '../theme/Theme';
import { BwBoxArt } from '../components/BoxArt';
import { AchievementsPanel } from '../components/AchievementsPanel';
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

@Entry
@Component
struct Index {
  @State private ready: boolean = false;
  @State private initError: string = '';
  @State private tab: number = TAB_HOME;
  @State private overlay: string = OVERLAY_NONE;
  @State private revision: number = 0;
  @State private winWidth: number = 400;
  @State private winHeight: number = 800;

  private tabsController: TabsController = new TabsController();

  aboutToAppear(): void {
    this.bootstrap();
  }

  /** 初始化持久化 + store（失败也要能进演示态） */
  private async bootstrap(): Promise<void> {
    this.initError = '';
    this.ready = false;
    try {
      const context: common.UIAbilityContext = getContext(this) as common.UIAbilityContext;
      const kv: PreferencesKV = new PreferencesKV(context);
      await kv.init();
      await initStore(kv);
    } catch (err) {
      // 持久化不可用时继续：store 会用内存态兜底（不会崩）
    }
    try {
      getStore().snapshot();
      this.ready = true;
      this.revision = this.revision + 1;
    } catch (err) {
      this.initError = '本地数据没准备好，重新打开试试。';
    }
  }

  /** 任何 store 状态变化后调用：让四个 Tab 页重读 snapshot */
  private refresh(): void {
    this.revision = this.revision + 1;
  }

  private openSetup(): void {
    this.overlay = OVERLAY_SETUP;
  }

  private closeSetup(): void {
    this.overlay = OVERLAY_NONE;
    this.refresh();
  }

  private setupStarted(): void {
    this.overlay = OVERLAY_JOURNEY;
    this.refresh();
  }

  private closeJourney(): void {
    this.overlay = OVERLAY_NONE;
    this.refresh();
  }

  private openReveal(): void {
    this.overlay = OVERLAY_REVEAL;
    this.refresh();
  }

  /** 收录完成：回图鉴 Tab */
  private goCards(): void {
    this.overlay = OVERLAY_NONE;
    this.tab = TAB_CARDS;
    this.tabsController.changeIndex(TAB_CARDS);
    this.refresh();
  }

  private openAchievements(): void {
    this.overlay = OVERLAY_ACHIEVEMENTS;
  }

  private closeAchievements(): void {
    this.overlay = OVERLAY_NONE;
    this.refresh();
  }

  // ============================================================
  // 底部 Tab
  // ============================================================

  @Builder
  tabBuilder(title: string, glyph: string, index: number) {
    Column({ space: 3 }) {
      Text(glyph)
        .fontSize(17)
        .opacity(this.tab === index ? 1 : 0.55)

      Text(title)
        .fontSize(BWFont.microSm)
        .fontWeight(this.tab === index ? FontWeight.Medium : FontWeight.Regular)
        .fontColor(this.tab === index ? BWColor.ink : BWColor.ink3)
    }
    .width('100%')
    .height(54)
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
            this.overlay = OVERLAY_JOURNEY;
          },
          onOpenCards: () => {
            this.tab = TAB_CARDS;
            this.tabsController.changeIndex(TAB_CARDS);
            this.refresh();
          }
        })
      }
      .tabBar(this.tabBuilder('今日', '📦', TAB_HOME))

      TabContent() {
        CardsView({
          revision: this.revision,
          winWidth: this.winWidth,
          winHeight: this.winHeight,
          onChanged: () => {
            this.refresh();
          }
        })
      }
      .tabBar(this.tabBuilder('图鉴', '🗂', TAB_CARDS))

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
      .tabBar(this.tabBuilder('圈子', '👥', TAB_SOCIAL))

      TabContent() {
        ProfileView({
          revision: this.revision,
          winWidth: this.winWidth,
          winHeight: this.winHeight,
          onOpenAchievements: () => {
            this.openAchievements();
          },
          onChanged: () => {
            this.refresh();
          }
        })
      }
      .tabBar(this.tabBuilder('我的', '🫥', TAB_PROFILE))
    }
    .barHeight(56)
    .barBackgroundColor(BWColor.paper)
    .barMode(BarMode.Fixed)
    .scrollable(false)
    .animationDuration(0)
    .divider({ strokeWidth: 1, color: BWColor.line })
    .onChange((index: number) => {
      this.tab = index;
      this.refresh();
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
      BwBoxArt({ size: 104 })

      Text('正在准备今晚的盲盒…')
        .fontSize(BWFont.caption)
        .fontColor(BWColor.ink3)
    }
    .width('100%')
    .height('100%')
    .justifyContent(FlexAlign.Center)
    .backgroundColor(BWColor.cream)
  }

  @Builder
  errorView() {
    Column({ space: 12 }) {
      Text('🪔')
        .fontSize(32)
      Text(this.initError)
        .fontSize(BWFont.bodySm)
        .fontColor(BWColor.ink2)
        .textAlign(TextAlign.Center)
      Button('重试')
        .type(ButtonType.Capsule)
        .height(40)
        .padding({ left: 22, right: 22 })
        .fontSize(BWFont.caption)
        .fontColor(BWColor.ink)
        .backgroundColor(BWColor.amber)
        .onClick(() => {
          this.bootstrap();
        })
    }
    .width('100%')
    .height('100%')
    .justifyContent(FlexAlign.Center)
    .padding(BWSize.pagePadding)
    .backgroundColor(BWColor.cream)
  }

  build() {
    Stack({ alignContent: Alignment.TopStart }) {
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor(BWColor.cream)

      if (this.initError.length > 0) {
        this.errorView()
      } else if (!this.ready) {
        this.loadingView()
      } else {
        this.tabShell()
      }

      // ---------- 全屏覆盖层（对应 iOS sheet / fullScreenCover） ----------

      if (this.ready && this.overlay === OVERLAY_SETUP) {
        SetupSheet({
          winWidth: this.winWidth,
          winHeight: this.winHeight,
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

      if (this.ready && this.overlay === OVERLAY_JOURNEY) {
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

      if (this.ready && this.overlay === OVERLAY_REVEAL) {
        RevealView({
          winWidth: this.winWidth,
          winHeight: this.winHeight,
          onGoCards: () => {
            this.goCards();
          },
          onChanged: () => {
            this.refresh();
          }
        })
      }

      if (this.ready && this.overlay === OVERLAY_ACHIEVEMENTS) {
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
