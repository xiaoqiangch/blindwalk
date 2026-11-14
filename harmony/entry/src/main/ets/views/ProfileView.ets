/**
 * 步迷 Walkaholic · HarmonyOS ArkUI — 我的 Profile（design-system §5.7）
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
  WaProgressBar,
  WaStatsRow,
  WaToastBar,
  StatItem
} from '../components/Common';
import { achievementsOf, emptySnapshot, readSnapshot } from '../components/StoreBridge';
import { getStore, getStoreInstance } from '../core/store';
import {
  WAColor,
  WAFont,
  WASize,
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
  /** 由 Index 注入：打开「我的城市」地图 */
  onOpenCityMap: () => void = () => {
  };
  /** 由 Index 注入：打开「我的惊喜」（回执 / 我埋的 / 我找到的） */
  onOpenMySurprises: () => void = () => {
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
    const km: StatItem = {
      value: this.snapshot.totalKm.toFixed(1),
      label: '累计里程'
    };
    const boxes: StatItem = {
      value: String(this.snapshot.boxesOpened),
      label: '开盒'
    };
    const streak: StatItem = {
      value: String(this.snapshot.profile.streakDays),
      label: '连续天数'
    };
    items.push(km);
    items.push(boxes);
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
    try {
      getStore().reset(Date.now());
      this.load();
      this.onChanged();
      this.showToast('演示数据已清除');
    } catch (err) {
      this.showToast('清除失败，再试一次。');
    }
  }

  // ============================================================
  // 区块
  // ============================================================

  @Builder
  header() {
    Row() {
      Text('我的')
        .fontSize(WAFont.hero)
        .fontWeight(FontWeight.Bold)
        .fontColor(WAColor.ink)

      Blank()

      if (this.snapshot.unreadReceiptCount > 0) {
        Row({ space: 4 }) {
          Circle()
            .width(6)
            .height(6)
            .fill(WAColor.ember)
          Text(String(this.snapshot.unreadReceiptCount))
            .fontSize(WAFont.micro)
            .fontWeight(FontWeight.Bold)
            .fontColor(WAColor.iconOnBrand)
        }
        .padding({ left: 8, right: 8, top: 3, bottom: 3 })
        .backgroundColor(WAColor.ember)
        .borderRadius(WASize.chipRadius)
        .margin({ right: 8 })
        .onClick(() => {
          this.onOpenMySurprises();
        })
      }

      Text(this.snapshot.profile.avatarEmoji)
        .fontSize(22)
        .textAlign(TextAlign.Center)
        .width(44)
        .height(44)
        .backgroundColor(WAColor.paper2)
        .borderRadius(22)
        .border({ width: 1, color: WAColor.line, radius: 22 })
    }
    .width('100%')
  }

  /** 我的城市（个人城市地图）入口 */
  @Builder
  cityMapRow() {
    Row({ space: 12 }) {
      Stack({ alignContent: Alignment.Center }) {
        SymbolGlyph($r('sys.symbol.map'))
          .fontSize(WASize.iconSizeSm)
          .fontColor([WAColor.amber])
          .renderingStrategy(SymbolRenderingStrategy.SINGLE)
      }
      .width(26)

      Column({ space: 2 }) {
        Text('个人城市地图')
          .fontSize(WAFont.bodySm)
          .fontColor(WAColor.ink)
        Text(this.cityMapCaption())
          .fontSize(WAFont.microSm)
          .fontColor(WAColor.ink2)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
      }
      .alignItems(HorizontalAlign.Start)
      .layoutWeight(1)

      Text('›')
        .fontSize(WAFont.caption)
        .fontColor(WAColor.ink3)
    }
    .width('100%')
    .padding({ left: 16, right: 16, top: 14, bottom: 14 })
    .onClick(() => {
      this.onOpenCityMap();
    })
  }

  /** 城市地图副文案（与 iOS ProfileView.cityMapCaption 一致） */
  private cityMapCaption(): string {
    try {
      const stats = getStoreInstance().track().stats();
      if (stats.isEmpty) return '走完第一个盲盒，这里会长出你的路';
      return String(stats.walkedDayCount) + ' 天 · ' +
        (stats.totalMeters / 1000).toFixed(1) + ' 公里 · ' +
        String(stats.exploredCellCount) + ' 个街区';
    } catch (err) {
      return '走完第一个盲盒，这里会长出你的路';
    }
  }

  /** 我的惊喜（回执 / 我埋的 / 我找到的）入口 */
  @Builder
  mySurprisesRow() {
    Row({ space: 12 }) {
      Stack({ alignContent: Alignment.Center }) {
        SymbolGlyph($r('sys.symbol.gift_fill'))
          .fontSize(WASize.iconSizeSm)
          .fontColor([WAColor.amber])
          .renderingStrategy(SymbolRenderingStrategy.SINGLE)
      }
      .width(26)

      Column({ space: 2 }) {
        Text('我的惊喜')
          .fontSize(WAFont.bodySm)
          .fontColor(WAColor.ink)
        Text('我埋了 ' + String(this.snapshot.mySurprises.length) +
          ' · 被找到 ' + String(this.foundByOthersCount()) +
          ' · 我找到的 ' + String(this.snapshot.foundSurprises.length))
          .fontSize(WAFont.microSm)
          .fontColor(WAColor.ink2)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
      }
      .alignItems(HorizontalAlign.Start)
      .layoutWeight(1)

      if (this.snapshot.unreadReceiptCount > 0) {
        Text('新')
          .fontSize(WAFont.micro)
          .fontWeight(FontWeight.Bold)
          .fontColor(WAColor.iconOnBrand)
          .padding({ left: 6, right: 6, top: 1, bottom: 1 })
          .backgroundColor(WAColor.ember)
          .borderRadius(WASize.chipRadius)
      }

      Text('›')
        .fontSize(WAFont.caption)
        .fontColor(WAColor.ink3)
    }
    .width('100%')
    .padding({ left: 16, right: 16, top: 14, bottom: 14 })
    .onClick(() => {
      this.onOpenMySurprises();
    })
  }

  private foundByOthersCount(): number {
    let count: number = 0;
    for (let i = 0; i < this.snapshot.mySurprises.length; i += 1) {
      if (this.snapshot.mySurprises[i].found) count += 1;
    }
    return count;
  }

  @Builder
  levelCard() {
    Column({ space: 12 }) {
      Row() {
        Text('散步 Lv.' + this.level().level + ' · ' + this.level().name)
          .fontSize(this.winWidth >= WASize.wideBreakpoint ? WAFont.title : 20)
          .fontWeight(FontWeight.Medium)
          .fontColor(WAColor.ink)
          .maxLines(1)
        Blank()
      }
      .width('100%')

      Column({ space: 6 }) {
        WaProgressBar({
          progress: this.level().progress,
          barColor: WAColor.amber,
          trackColor: WAColor.line,
          barHeight: 8
        })

        Row() {
          Text(this.level().into + ' / 800')
            .fontSize(WAFont.micro)
            .fontColor(WAColor.ink3)
          Blank()
          Text('距离下一级 ' + (800 - this.level().into))
            .fontSize(WAFont.micro)
            .fontColor(WAColor.ink3)
        }
        .width('100%')
      }
      .width('100%')

      WaStatsRow({ items: this.statsItems(), roomy: true })
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
    .padding(20)
    .backgroundColor(WAColor.paper)
    .borderRadius(WASize.cardRadius)
    .border({ width: 1, color: WAColor.line, radius: WASize.cardRadius })
    .shadow({ radius: 16, color: WAColor.shadowSoft, offsetX: 0, offsetY: 10 })
  }

  @Builder
  achievementBadge(achievement: Achievement) {
    Column({ space: 6 }) {
      Text(achievement.icon)
        .fontSize(22)
        .textAlign(TextAlign.Center)
        .width(48)
        .height(48)
        .backgroundColor(achievement.unlockedAt !== undefined ? WAColor.amberSoftStrong : WAColor.paper2)
        .borderRadius(WASize.cardRadius)
        .border({
          width: 1,
          color: achievement.unlockedAt !== undefined ? WAColor.amberBorder : WAColor.line,
          radius: 24
        })
        .opacity(achievement.unlockedAt !== undefined ? 1 : 0.55)

      Text(achievement.name)
        .fontSize(WAFont.microSm)
        .fontColor(achievement.unlockedAt !== undefined ? WAColor.ink2 : WAColor.ink3)
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
          .fontSize(WAFont.titleMd)
          .fontWeight(FontWeight.Medium)
          .fontColor(WAColor.ink)
        Blank()
        Row({ space: 2 }) {
          Text('全部成就')
            .fontSize(WAFont.captionSm)
            .fontColor(WAColor.amberDeep)
          Text('›')
            .fontSize(WAFont.caption)
            .fontColor(WAColor.amberDeep)
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
        .fontSize(WAFont.bodySm)
        .fontColor(danger ? WAColor.ember : WAColor.ink)
      Blank()
      Text('›')
        .fontSize(WAFont.caption)
        .fontColor(danger ? '#99D25C3A' : WAColor.ink3)
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
      Stack({ alignContent: Alignment.Center }) {
        SymbolGlyph($r('sys.symbol.' + (this.accountLabel === '未登录' ? 'info_circle' : 'person')))
          .fontSize(WASize.iconSizeSm)
          .fontColor([WAColor.amber])
          .renderingStrategy(SymbolRenderingStrategy.SINGLE)
      }
      .width(38)
      .height(38)
      .backgroundColor(WAColor.amberSoft)
      .borderRadius(12)

      Column({ space: 2 }) {
        Text(this.accountLabel === '未登录' ? '登录 / 注册账号' : '已登录 · ' + this.accountLabel)
          .fontSize(WAFont.bodySm)
          .fontWeight(FontWeight.Medium)
          .fontColor(WAColor.ink)
        Text(this.accountLabel === '未登录' ? '把卡片和进度存到云端，换手机也不丢（可选）' : '进度已可跨设备同步 · 点这里管理')
          .fontSize(WAFont.micro)
          .fontColor(WAColor.ink3)
          .maxLines(2)
      }
      .alignItems(HorizontalAlign.Start)
      .layoutWeight(1)

      Text('›')
        .fontSize(WAFont.caption)
        .fontColor(WAColor.ink3)
    }
    .width('100%')
    .padding({ left: 16, right: 16, top: 14, bottom: 14 })
    .backgroundColor('#F2EEF1FF')
    .borderRadius(16)
    .border({ width: 1, color: WAColor.line })
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
          .fontSize(WAFont.bodySm)
          .fontColor(WAColor.ink)
        Blank()
        Toggle({ type: ToggleType.Switch, isOn: this.soundOn })
          .selectedColor(WAColor.amberDeep)
          .onChange((isOn: boolean) => {
            this.soundOn = isOn;
          })
      }
      .width('100%')
      .padding({ left: 16, right: 16, top: 9, bottom: 9 })

      Divider().strokeWidth(1).color(WAColor.line)

      Row({ space: 12 }) {
        Text('触感')
          .fontSize(WAFont.bodySm)
          .fontColor(WAColor.ink)
        Blank()
        Toggle({ type: ToggleType.Switch, isOn: this.hapticOn })
          .selectedColor(WAColor.amberDeep)
          .onChange((isOn: boolean) => {
            this.hapticOn = isOn;
          })
      }

      Divider().strokeWidth(1).color(WAColor.line)

      Row({ space: 12 }) {
        Column({ space: 2 }) {
          Text('地图跟随我转身')
            .fontSize(WAFont.bodySm)
            .fontColor(WAColor.ink)
          Text(this.mapFollowsHeading ? '开 · 转身地图会转' : '关 · 地图固定北朝上')
            .fontSize(WAFont.micro)
            .fontColor(WAColor.ink3)
        }
        .alignItems(HorizontalAlign.Start)

        Blank()

        Toggle({ type: ToggleType.Switch, isOn: this.mapFollowsHeading })
          .selectedColor(WAColor.amberDeep)
          .onChange((isOn: boolean) => {
            this.mapFollowsHeading = isOn;
          })
      }
      .width('100%')
      .padding({ left: 16, right: 16, top: 9, bottom: 9 })

      Divider().strokeWidth(1).color(WAColor.line)

      // 数据源（parity.md §1：Key 后台统一下发，这里只展示状态）
      Row({ space: 12 }) {
        Text('数据源')
          .fontSize(WAFont.bodySm)
          .fontColor(WAColor.ink)
        Blank()
        Text('高德 / 百度 / OSM / 维基')
          .fontSize(WAFont.captionSm)
          .fontColor(WAColor.ink3)
        Text('›')
          .fontSize(WAFont.caption)
          .fontColor(WAColor.ink3)
      }
      .width('100%')
      .padding({ left: 16, right: 16, top: 14, bottom: 14 })
      .onClick(() => {
        this.onOpenDataSource();
      })

      Divider().strokeWidth(1).color(WAColor.line)

      this.cityMapRow()

      Divider().strokeWidth(1).color(WAColor.line)

      this.mySurprisesRow()

      Divider().strokeWidth(1).color(WAColor.line)

      this.settingRow('隐私与安全', false)

      Divider().strokeWidth(1).color(WAColor.line)

      this.settingRow('清除演示数据', true)

      Divider().strokeWidth(1).color(WAColor.line)

      this.settingRow('关于', false)
    }
    .width('100%')
    .backgroundColor(WAColor.paperTranslucent)
    .borderRadius(WASize.cardRadius)
    .border({ width: 1, color: WAColor.line, radius: WASize.cardRadius })
  }

  @Builder
  modalOverlay() {
    Stack({ alignContent: Alignment.Center }) {
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor(WAColor.scrim)
        .onClick(() => {
          this.modal = '';
        })

      Column({ space: 12 }) {
        Text(this.modal === 'privacy' ? '隐私与安全' : '关于步迷')
          .fontSize(WAFont.titleMd)
          .fontWeight(FontWeight.Medium)
          .fontColor(WAColor.ink)
          .width('100%')

        Text(this.modal === 'privacy'
          ? '位置只在本地判断距离，不上传；照片与卡片都留在你的手机里。目的地在你到达前不会显示。'
          : '步迷 Walkaholic 0.3 · 原型\n不看见终点，才看得见路。')
          .fontSize(WAFont.caption)
          .fontColor(WAColor.ink2)
          .lineHeight(22)
          .width('100%')

        Button() {
          Text('知道了')
            .fontSize(WAFont.caption)
            .fontColor(WAColor.ink)
        }
        .type(ButtonType.Capsule)
        .height(40)
        .width('100%')
        .backgroundColor(WAColor.amber)
        .onClick(() => {
          this.modal = '';
        })
      }
      .width('100%')
      .padding(20)
      .backgroundColor(WAColor.paper)
      .borderRadius(WASize.cardRadius)
      .border({ width: 1, color: WAColor.line, radius: WASize.cardRadius })
      .shadow({ radius: 24, color: WAColor.shadowLift, offsetX: 0, offsetY: 16 })
    }
    .width('100%')
    .height('100%')
  }

  private isWide(): boolean {
    return this.winWidth >= WASize.wideBreakpoint;
  }

  build() {
    Stack({ alignContent: Alignment.TopStart }) {
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor(WAColor.cream)

      Scroll() {
        Column({ space: 0 }) {
          this.header()

          if (this.isWide()) {
            // 折叠屏展开态：左（等级 + 账号）/ 右（成就 + 设置）
            Row({ space: 20 }) {
              Column({ space: 0 }) {
                this.levelCard()

                Column() {
                  this.accountCard()
                }
                .margin({ top: 14 })
              }
              .layoutWeight(1)
              .alignItems(HorizontalAlign.Start)

              Column({ space: 0 }) {
                this.achievementStrip()

                Column() {
                  this.settingsCard()
                }
                .margin({ top: 18 })
              }
              .layoutWeight(1)
              .alignItems(HorizontalAlign.Start)
            }
            .width('100%')
            .alignItems(VerticalAlign.Top)
            .margin({ top: 16 })
          } else {
            Column({ space: 0 }) {
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
            }
            .width('100%')
          }

          Text('步迷 Walkaholic · 原型')
            .fontSize(WAFont.captionSm)
            .fontColor(WAColor.ink3)
            .width('100%')
            .textAlign(TextAlign.Center)
            .margin({ top: 22, bottom: 12 })
        }
        .width('100%')
        .constraintSize({ maxWidth: this.isWide() ? '100%' : WASize.contentMaxWidth })
        .padding({
          left: WASize.pagePadding,
          right: WASize.pagePadding,
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
          WaToastBar({ text: this.toastText, iconName: 'heart_fill' })
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
