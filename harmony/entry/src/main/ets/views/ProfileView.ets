/**
 * 盲走 BlindWalk · HarmonyOS ArkUI — 我的 Profile（design-system §5.7）
 *
 * 视觉基准：prototype/web/app.js profileHTML + screenshots/showcase.png（PROFILE 屏）
 * 结构：我的 header → 等级卡 → 成就横滚 + 全部成就 → 设置列表 → 版本号
 *
 * 契约说明：Profile 只包含 xp / streakDays / cards / achievements / weeklySurprise，
 * 所以统计用「本周惊喜值 / 收集卡片 / 连续天数」（不是 web 的累计里程/开盒数——那两个字段本期没有）。
 */

import { AppSnapshot } from '../core/contract';
import { Achievement } from '../core/types';
import {
  BwProgressBar,
  BwStatsRow,
  BwToastBar,
  StatItem
} from '../components/Common';
import { achievementsOf, emptySnapshot, readSnapshot } from '../components/StoreBridge';
import {
  BWColor,
  BWFont,
  BWSize,
  LevelInfo,
  levelInfo
} from '../theme/Theme';

@Component
export struct ProfileView {
  @Prop @Watch('onRevisionChanged') revision: number = 0;
  @Prop winWidth: number = 400;
  @Prop winHeight: number = 800;

  onOpenAchievements: () => void = () => {
  };
  /** 由 Index 注入：打开账号面板 */
  onOpenAccount: () => void = () => {
  };
  /** 由 Index 注入：打开数据源状态面板 */
  onOpenDataSource: () => void = () => {
  };
  /** 账号状态文案（由 Index 注入，避免本页直接依赖 account.ts 的存储） */
  @Prop accountLabel: string = '未登录';
  onChanged: () => void = () => {
  };

  @State private snapshot: AppSnapshot = emptySnapshot();
  @State private soundOn: boolean = true;
  @State private hapticOn: boolean = true;
  /** 地图朝向：true=跟随我转身；false=固定北朝上（全局持久化） */
  @StorageLink('mapFollowsHeading') private mapFollowsHeading: boolean = true;
  @State private modal: string = '';
  @State private toastText: string = '';

  aboutToAppear(): void {
    this.load();
  }

  onRevisionChanged(propName: string): void {
    this.load();
  }

  private load(): void {
    this.snapshot = readSnapshot(this.snapshot);
  }

  private level(): LevelInfo {
    return levelInfo(this.snapshot.profile.xp);
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

  private showToast(text: string): void {
    this.toastText = text;
    setTimeout(() => {
      this.toastText = '';
    }, 2400);
  }

  private clearDemoData(): void {
    // 契约里没有 reset API：不假装清空，温柔地兜底。
    this.showToast('这一版先留着这些回忆。');
  }

  // ============================================================
  // 区块
  // ============================================================

  @Builder
  header() {
    Row() {
      Text('我的')
        .fontSize(BWFont.hero)
        .fontWeight(FontWeight.Bold)
        .fontColor(BWColor.ink)

      Blank()

      Text(this.snapshot.profile.avatarEmoji)
        .fontSize(22)
        .textAlign(TextAlign.Center)
        .width(44)
        .height(44)
        .backgroundColor(BWColor.paper2)
        .borderRadius(22)
        .border({ width: 1, color: BWColor.line, radius: 22 })
    }
    .width('100%')
  }

  @Builder
  levelCard() {
    Column({ space: 12 }) {
      Row() {
        Text('散步 Lv.' + this.level().level + ' · ' + this.level().name)
          .fontSize(this.winWidth >= BWSize.wideBreakpoint ? BWFont.title : 20)
          .fontWeight(FontWeight.Medium)
          .fontColor(BWColor.ink)
          .maxLines(1)
        Blank()
      }
      .width('100%')

      Column({ space: 6 }) {
        BwProgressBar({
          progress: this.level().progress,
          barColor: BWColor.amber,
          trackColor: BWColor.line,
          barHeight: 8
        })

        Row() {
          Text(this.level().into + ' / 800')
            .fontSize(BWFont.micro)
            .fontColor(BWColor.ink3)
          Blank()
          Text('距离下一级 ' + (800 - this.level().into))
            .fontSize(BWFont.micro)
            .fontColor(BWColor.ink3)
        }
        .width('100%')
      }
      .width('100%')

      BwStatsRow({ items: this.statsItems(), roomy: true })
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
    .padding(20)
    .linearGradient({
      angle: 135,
      colors: [
        [BWColor.paper, 0.0],
        [BWColor.paper2, 1.0]
      ]
    })
    .borderRadius(BWSize.cardRadius)
    .border({ width: 1, color: BWColor.line, radius: BWSize.cardRadius })
    .shadow({ radius: 16, color: BWColor.shadowSoft, offsetX: 0, offsetY: 10 })
  }

  @Builder
  achievementBadge(achievement: Achievement) {
    Column({ space: 6 }) {
      Text(achievement.icon)
        .fontSize(22)
        .textAlign(TextAlign.Center)
        .width(48)
        .height(48)
        .backgroundColor(achievement.unlockedAt !== undefined ? BWColor.amberSoftStrong : BWColor.paper2)
        .borderRadius(24)
        .border({
          width: 1,
          color: achievement.unlockedAt !== undefined ? BWColor.amberBorder : BWColor.line,
          radius: 24
        })
        .opacity(achievement.unlockedAt !== undefined ? 1 : 0.55)

      Text(achievement.name)
        .fontSize(BWFont.microSm)
        .fontColor(achievement.unlockedAt !== undefined ? BWColor.ink2 : BWColor.ink3)
        .maxLines(1)
        .width(64)
        .textAlign(TextAlign.Center)
    }
    .width(64)
    .onClick(() => {
      this.onOpenAchievements();
    })
  }

  @Builder
  achievementStrip() {
    Column({ space: 12 }) {
      Row() {
        Text('成就')
          .fontSize(BWFont.titleMd)
          .fontWeight(FontWeight.Medium)
          .fontColor(BWColor.ink)
        Blank()
        Row({ space: 2 }) {
          Text('全部成就')
            .fontSize(BWFont.captionSm)
            .fontColor(BWColor.amberDeep)
          Text('›')
            .fontSize(BWFont.caption)
            .fontColor(BWColor.amberDeep)
        }
        .onClick(() => {
          this.onOpenAchievements();
        })
      }
      .width('100%')

      Scroll() {
        Row({ space: 12 }) {
          ForEach(achievementsOf(this.snapshot), (achievement: Achievement) => {
            this.achievementBadge(achievement)
          }, (achievement: Achievement) => achievement.id)
        }
        .padding({ top: 2, bottom: 2 })
      }
      .scrollable(ScrollDirection.Horizontal)
      .scrollBar(BarState.Off)
      .width('100%')
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
  }

  @Builder
  settingRow(title: string, danger: boolean) {
    Row({ space: 12 }) {
      Text(title)
        .fontSize(BWFont.bodySm)
        .fontColor(danger ? BWColor.ember : BWColor.ink)
      Blank()
      Text('›')
        .fontSize(BWFont.caption)
        .fontColor(danger ? '#99D25C3A' : BWColor.ink3)
    }
    .width('100%')
    .padding({ left: 16, right: 16, top: 14, bottom: 14 })
    .onClick(() => {
      if (title === '隐私与安全') {
        this.modal = 'privacy';
      } else if (title === '关于') {
        this.modal = 'about';
      } else if (title === '清除演示数据') {
        this.clearDemoData();
      }
    })
  }

  /** 账号卡片：放在等级卡下方，显眼位置（与 Web v43 一致） */
  @Builder
  accountCard() {
    Row({ space: 12 }) {
      Text(this.accountLabel === '未登录' ? '☁️' : '👤')
        .fontSize(19)
        .width(38)
        .height(38)
        .textAlign(TextAlign.Center)
        .backgroundColor('#1F5B6CFF')
        .borderRadius(12)

      Column({ space: 2 }) {
        Text(this.accountLabel === '未登录' ? '登录 / 注册账号' : '已登录 · ' + this.accountLabel)
          .fontSize(BWFont.bodySm)
          .fontWeight(FontWeight.Medium)
          .fontColor(BWColor.ink)
        Text(this.accountLabel === '未登录' ? '把卡片和进度存到云端，换手机也不丢（可选）' : '进度已可跨设备同步 · 点这里管理')
          .fontSize(BWFont.micro)
          .fontColor(BWColor.ink3)
          .maxLines(2)
      }
      .alignItems(HorizontalAlign.Start)
      .layoutWeight(1)

      Text('›')
        .fontSize(BWFont.caption)
        .fontColor(BWColor.ink3)
    }
    .width('100%')
    .padding({ left: 16, right: 16, top: 14, bottom: 14 })
    .backgroundColor('#F2EEF1FF')
    .borderRadius(16)
    .border({ width: 1, color: BWColor.line })
    .alignItems(VerticalAlign.Center)
    .onClick(() => {
      this.onOpenAccount();
    })
  }

  @Builder
  settingsCard() {
    Column({ space: 0 }) {
      Row({ space: 12 }) {
        Text('音效')
          .fontSize(BWFont.bodySm)
          .fontColor(BWColor.ink)
        Blank()
        Toggle({ type: ToggleType.Switch, isOn: this.soundOn })
          .selectedColor(BWColor.amberDeep)
          .onChange((isOn: boolean) => {
            this.soundOn = isOn;
          })
      }
      .width('100%')
      .padding({ left: 16, right: 16, top: 9, bottom: 9 })

      Divider().strokeWidth(1).color(BWColor.line)

      Row({ space: 12 }) {
        Text('触感')
          .fontSize(BWFont.bodySm)
          .fontColor(BWColor.ink)
        Blank()
        Toggle({ type: ToggleType.Switch, isOn: this.hapticOn })
          .selectedColor(BWColor.amberDeep)
          .onChange((isOn: boolean) => {
            this.hapticOn = isOn;
          })
      }

      Divider().strokeWidth(1).color(BWColor.line)

      Row({ space: 12 }) {
        Column({ space: 2 }) {
          Text('地图跟随我转身')
            .fontSize(BWFont.bodySm)
            .fontColor(BWColor.ink)
          Text(this.mapFollowsHeading ? '开 · 转身地图会转' : '关 · 地图固定北朝上')
            .fontSize(BWFont.micro)
            .fontColor(BWColor.ink3)
        }
        .alignItems(HorizontalAlign.Start)

        Blank()

        Toggle({ type: ToggleType.Switch, isOn: this.mapFollowsHeading })
          .selectedColor(BWColor.amberDeep)
          .onChange((isOn: boolean) => {
            this.mapFollowsHeading = isOn;
          })
      }
      .width('100%')
      .padding({ left: 16, right: 16, top: 9, bottom: 9 })

      Divider().strokeWidth(1).color(BWColor.line)

      // 数据源（parity.md §1：Key 后台统一下发，这里只展示状态）
      Row({ space: 12 }) {
        Text('数据源')
          .fontSize(BWFont.bodySm)
          .fontColor(BWColor.ink)
        Blank()
        Text('高德 / 百度 / OSM / 维基')
          .fontSize(BWFont.captionSm)
          .fontColor(BWColor.ink3)
        Text('›')
          .fontSize(BWFont.caption)
          .fontColor(BWColor.ink3)
      }
      .width('100%')
      .padding({ left: 16, right: 16, top: 14, bottom: 14 })
      .onClick(() => {
        this.onOpenDataSource();
      })

      Divider().strokeWidth(1).color(BWColor.line)

      this.settingRow('隐私与安全', false)

      Divider().strokeWidth(1).color(BWColor.line)

      this.settingRow('清除演示数据', true)

      Divider().strokeWidth(1).color(BWColor.line)

      this.settingRow('关于', false)
    }
    .width('100%')
    .backgroundColor(BWColor.paperTranslucent)
    .borderRadius(20)
    .border({ width: 1, color: BWColor.line, radius: 20 })
  }

  @Builder
  modalOverlay() {
    Stack({ alignContent: Alignment.Center }) {
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor(BWColor.scrim)
        .onClick(() => {
          this.modal = '';
        })

      Column({ space: 12 }) {
        Text(this.modal === 'privacy' ? '隐私与安全' : '关于盲走')
          .fontSize(BWFont.titleMd)
          .fontWeight(FontWeight.Medium)
          .fontColor(BWColor.ink)
          .width('100%')

        Text(this.modal === 'privacy'
          ? '位置只在本地判断距离，不上传；照片与卡片都留在你的手机里。目的地在你到达前不会显示。'
          : '步谜 StepRiddle 0.3 · 原型\n不看见终点，才看得见路。')
          .fontSize(BWFont.caption)
          .fontColor(BWColor.ink2)
          .lineHeight(22)
          .width('100%')

        Button() {
          Text('知道了')
            .fontSize(BWFont.caption)
            .fontColor(BWColor.ink)
        }
        .type(ButtonType.Capsule)
        .height(40)
        .width('100%')
        .backgroundColor(BWColor.amber)
        .onClick(() => {
          this.modal = '';
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
            this.levelCard()
          }
          .margin({ top: 16 })

          Column() {
            this.accountCard()
          }
          .margin({ top: 14 })

          Column() {
            this.achievementStrip()
          }
          .margin({ top: 18 })

          Column() {
            this.settingsCard()
          }
          .margin({ top: 18 })

          Text('步谜 StepRiddle · 原型')
            .fontSize(BWFont.captionSm)
            .fontColor(BWColor.ink3)
            .width('100%')
            .textAlign(TextAlign.Center)
            .margin({ top: 22, bottom: 12 })
        }
        .width('100%')
        .constraintSize({ maxWidth: BWSize.contentMaxWidth })
        .padding({
          left: BWSize.pagePadding,
          right: BWSize.pagePadding,
          top: 8,
          bottom: 20
        })
      }
      .width('100%')
      .height('100%')
      .scrollBar(BarState.Off)
      .edgeEffect(EdgeEffect.Spring)

      if (this.toastText.length > 0) {
        Column() {
          BwToastBar({ text: this.toastText, icon: '🫶' })
        }
        .width('100%')
        .height('100%')
        .padding({ bottom: 44 })
        .justifyContent(FlexAlign.End)
        .hitTestBehavior(HitTestMode.None)
      }

      if (this.modal.length > 0) {
        this.modalOverlay()
      }
    }
    .width('100%')
    .height('100%')
  }
}
