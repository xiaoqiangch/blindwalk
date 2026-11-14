/**
 * 步迷 Walkaholic · HarmonyOS ArkUI — 成就页（design-system §5.8）
 *
 * 作为「我的 → 全部成就」的 push 页（本工程内用全屏覆盖层承载，Back 回我的）。
 * 视觉基准：prototype/web/app.js achievementsHTML + screenshots/showcase.png（ACHIEVEMENTS 屏）
 */

import { AppSnapshot } from '../core/contract';
import { Achievement } from '../core/types';
import { WaIconButton, WaProgressBar } from './Common';
import {
  achievementsOf,
  emptySnapshot,
  readSnapshot,
  unlockedAchievementCount
} from './StoreBridge';
import { WAColor, WAFont, WASize } from '../theme/Theme';

@Component
export struct AchievementsPanel {
  onBack: () => void = () => {
  };

  @State private snapshot: AppSnapshot = emptySnapshot();

  aboutToAppear(): void {
    this.load();
  }

  private load(): void {
    this.snapshot = readSnapshot(this.snapshot);
  }

  private fraction(achievement: Achievement): number {
    if (achievement.target <= 0) {
      return 1;
    }
    return Math.max(0, Math.min(1, achievement.progress / achievement.target));
  }

  @Builder
  header() {
    Row({ space: 12 }) {
      WaIconButton({
        name: 'chevron_left',
        onTap: () => {
          this.onBack();
        }
      })

      Text('成就')
        .fontSize(WAFont.hero)
        .fontWeight(FontWeight.Bold)
        .fontColor(WAColor.ink)

      Blank()

      Text(String(unlockedAchievementCount(this.snapshot)) + '/' +
        String(achievementsOf(this.snapshot).length))
        .fontSize(WAFont.caption)
        .fontColor(WAColor.ink3)
    }
    .width('100%')
    .padding({ left: WASize.pagePadding, right: WASize.pagePadding, top: 8, bottom: 10 })
  }

  @Builder
  achievementRow(achievement: Achievement) {
    Row({ space: 14 }) {
      Text(achievement.icon)
        .fontSize(WAFont.title)
        .textAlign(TextAlign.Center)
        .width(46)
        .height(46)
        .backgroundColor(achievement.unlockedAt !== undefined ? WAColor.amberSoftStrong : WAColor.paper2)
        .borderRadius(23)
        .border({
          width: 1,
          color: achievement.unlockedAt !== undefined ? WAColor.amberBorder : WAColor.line,
          radius: 23
        })
        .opacity(achievement.unlockedAt !== undefined ? 1 : 0.6)

      Column({ space: 6 }) {
        Row() {
          Text(achievement.name)
            .fontSize(WAFont.titleSm)
            .fontWeight(FontWeight.Medium)
            .fontColor(WAColor.ink)
          Blank()
          if (achievement.unlockedAt !== undefined) {
            Text('已获得')
              .fontSize(WAFont.microSm)
              .fontWeight(FontWeight.Bold)
              .fontColor(WAColor.amberDeep)
              .padding({ left: 7, right: 7, top: 3, bottom: 3 })
              .backgroundColor(WAColor.amberSoftStrong)
              .borderRadius(WASize.chipRadius)
              .rotate({ angle: -4 })
          }
        }
        .width('100%')

        Text(achievement.detail)
          .fontSize(WAFont.captionSm)
          .fontColor(WAColor.ink2)
          .width('100%')

        Row({ space: 8 }) {
          Column() {
            WaProgressBar({
              progress: this.fraction(achievement),
              barColor: achievement.unlockedAt !== undefined ? WAColor.amber : '#80A69C8C',
              trackColor: WAColor.line,
              barHeight: 5
            })
          }
          .layoutWeight(1)

          Text(String(achievement.progress) + '/' + String(achievement.target))
            .fontSize(WAFont.microSm)
            .fontColor(WAColor.ink3)
        }
        .width('100%')
      }
      .layoutWeight(1)
      .alignItems(HorizontalAlign.Start)
    }
    .width('100%')
    .padding(14)
    .backgroundColor(WAColor.paper)
    .borderRadius(WASize.cardRadius)
    .border({
      width: achievement.unlockedAt !== undefined ? 1.4 : 1,
      color: achievement.unlockedAt !== undefined ? '#73E89B4C' : WAColor.line,
      radius: 18
    })
    .shadow({
      radius: 10,
      color: achievement.unlockedAt !== undefined ? WAColor.shadowSoft : '#08171410',
      offsetX: 0,
      offsetY: 6
    })
  }

  build() {
    Stack({ alignContent: Alignment.TopStart }) {
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor(WAColor.cream)

      Column({ space: 0 }) {
        this.header()

        Scroll() {
          Column({ space: 12 }) {
            ForEach(achievementsOf(this.snapshot), (achievement: Achievement) => {
              this.achievementRow(achievement)
            }, (achievement: Achievement) => achievement.id)
          }
          .width('100%')
          .padding({
            left: WASize.pagePadding,
            right: WASize.pagePadding,
            top: 4,
            bottom: 28
          })
        }
        .layoutWeight(1)
        .scrollBar(BarState.Off)
      }
      .width('100%')
      .height('100%')
      .constraintSize({ maxWidth: WASize.contentMaxWidth })
    }
    .width('100%')
    .height('100%')
  }
}
