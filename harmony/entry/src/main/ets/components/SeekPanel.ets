/**
 * 盲走 BlindWalk · HarmonyOS ArkUI — 探寻面板（寻惊喜详情）
 *
 * 对齐 Web v46 的 `#/seek/:id`（`seekDetailHTML`）：
 *   三阶线索按距离解锁 + 当前距离分档 + 「当作到了（演示）」
 *
 * ## 保密铁律（与图鉴提示同一条）
 * - 到达前**不得展示**：地点名 / 作者照片 / 区域名 / 精确坐标
 * - 线索按距离逐条解锁：起点 1 条、≤3×半径 2 条、≤半径 3 条
 * - 没定位 → 只有第 1 条，并明确说「拿不到定位，线索暂时解锁不了」（**不假装解锁**）
 * - 「当作到了（演示）」必须显式标注「演示」，不能伪装成真实到达
 *
 * 解锁逻辑全部在 `core/hints.ts` 的 `seekClueState()`（纯 TS，有单测）。
 */

import { BuriedSurprise, GeoPoint } from '../core/types';
import {
  HINT_FOOTER,
  LOCKED_CLUE_TEXT,
  SEEK_NO_LOCATION_TEXT,
  SURPRISE_RADIUS_METERS,
  SeekClueState,
  distanceBucket,
  hintForSurprise,
  seekClueState,
  seekLeadText
} from '../core/hints';
import { BWColor, BWFont, BWSize } from '../theme/Theme';
import { BwIconButton, BwMicroLabel, BwPrimaryButton, BwQuietButton } from './Common';

/** 线索下标（固定 3 条） */
const CLUE_INDEXES: number[] = [0, 1, 2];

@Component
export struct BwSeekPanel {
  /** 目标惊喜（外部传只读副本；本组件不修改它） */
  @Prop @Watch('onInputChanged') surpriseID: string = '';
  @Prop @Watch('onInputChanged') clues: string[] = [];
  /** 当前位置（Index 从 snapshot.lastKnownOrigin 传） */
  @Prop @Watch('onInputChanged') hereLat: number = 0;
  @Prop @Watch('onInputChanged') hereLon: number = 0;
  @Prop @Watch('onInputChanged') hasOrigin: boolean = false;
  /** 惊喜坐标：**只用于算距离**，绝不渲染成文字（保密） */
  @Prop @Watch('onInputChanged') targetLat: number = 0;
  @Prop @Watch('onInputChanged') targetLon: number = 0;
  @Prop @Watch('onInputChanged') authorEmoji: string = '🎁';

  onBack: () => void = () => {
  };

  /** 是否点了「当作到了（演示）」 */
  @State private demoArrived: boolean = false;
  /** 算出来的线索状态 */
  @State private state: SeekClueState = emptyState();

  aboutToAppear(): void {
    this.recompute();
  }

  onInputChanged(propName: string): void {
    this.recompute();
  }

  /** 点「当作到了」→ 重新算（演示全解锁） */
  private demoArrive(): void {
    this.demoArrived = true;
    this.recompute();
  }

  /** 用 core/hints.ts 算一遍（唯一的解锁判定来源） */
  private recompute(): void {
    // 只构造判定需要的字段：hints + **惊喜自己的** location。
    // 故意不读 areaWord / photoUri（面板根本不需要它们，也不需要传进来）。
    const origin: GeoPoint | undefined = this.hasOrigin
      ? { latitude: this.hereLat, longitude: this.hereLon }
      : undefined;
    const target: BuriedSurprise = {
      id: this.surpriseID,
      authorName: '',
      authorEmoji: this.authorEmoji,
      location: { latitude: this.targetLat, longitude: this.targetLon },
      areaWord: '',
      hints: this.clues,
      photoHash: '',
      photoUri: '',
      buriedAt: 0,
      found: false
    };
    // 没有定位时 seekClueState 不读 target.location（只在 origin 有值时算距离）
    this.state = seekClueState(target, origin, this.demoArrived, SURPRISE_RADIUS_METERS);
  }

  private leadText(): string {
    return seekLeadText(this.state, SURPRISE_RADIUS_METERS);
  }

  private isUnlocked(index: number): boolean {
    return index < this.state.unlockedCount;
  }

  private clueText(index: number): string {
    if (index < this.state.lines.length) return this.state.lines[index];
    return LOCKED_CLUE_TEXT;
  }

  private unlockedText(): string {
    return String(Math.min(this.state.unlockedCount, 3)) + '/3';
  }

  private atmosphereText(): string {
    return hintForSurprise(this.surpriseID, 0);
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
        BwMicroLabel({ text: '正在探寻' })
        Text('一个还没被找到的惊喜')
          .fontSize(BWFont.caption)
          .fontColor(BWColor.ink)
          .maxLines(1)
      }
      .alignItems(HorizontalAlign.Start)

      Blank()

      Text(this.state.distanceText)
        .fontSize(BWFont.microSm)
        .fontColor(BWColor.ink3)
        .maxLines(1)
    }
    .width('100%')
    .padding({ left: BWSize.pagePadding, right: BWSize.pagePadding, top: 6, bottom: 10 })
  }

  /** 顶部摘要：作者 emoji + 氛围句 + 距离（**不含区域名**） */
  @Builder
  summaryCard() {
    Column({ space: 8 }) {
      Row({ space: 10 }) {
        Text(this.authorEmoji)
          .fontSize(BWFont.title)
          .textAlign(TextAlign.Center)
          .width(38)
          .height(38)
          .backgroundColor(BWColor.amberSoft)
          .borderRadius(12)

        Column({ space: 3 }) {
          Text('有人在这儿留下一张照片')
            .fontSize(BWFont.caption)
            .fontWeight(FontWeight.Medium)
            .fontColor(BWColor.ink)
            .maxLines(1)
          Text(this.atmosphereText())
            .fontSize(BWFont.captionSm)
            .fontColor(BWColor.ink2)
            .maxLines(2)
            .lineHeight(18)
        }
        .layoutWeight(1)
        .alignItems(HorizontalAlign.Start)
      }
      .width('100%')
      .alignItems(VerticalAlign.Top)

      Row({ space: 8 }) {
        Text(this.state.distanceText)
          .fontSize(BWFont.microSm)
          .fontColor(BWColor.ink3)
        Text('·')
          .fontSize(BWFont.microSm)
          .fontColor(BWColor.ink3)
        Text('线索 ' + this.unlockedText())
          .fontSize(BWFont.microSm)
          .fontColor(BWColor.ink3)
        Blank()
      }
      .width('100%')

      // 没定位：明确说明（不假装解锁）
      if (!this.hasOrigin) {
        Text(SEEK_NO_LOCATION_TEXT)
          .fontSize(BWFont.captionSm)
          .fontColor(BWColor.ember)
          .width('100%')
          .lineHeight(18)
      }
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
    .padding(14)
    .backgroundColor(BWColor.paper)
    .borderRadius(BWSize.cardRadius)
    .border({ width: 1, color: BWColor.line, radius: BWSize.cardRadius })
  }

  @Builder
  clueRow(index: number) {
    Row({ space: 10 }) {
      Stack({ alignContent: Alignment.Center }) {
        Circle()
          .width(24)
          .height(24)
          .fill(this.isUnlocked(index) ? BWColor.tealSoft : BWColor.paper2)
          .stroke(this.isUnlocked(index) ? '#662E7D78' : BWColor.line)
          .strokeWidth(1)

        Text(this.isUnlocked(index) ? '✓' : String(index + 1))
          .fontSize(BWFont.microSm)
          .fontWeight(FontWeight.Bold)
          .fontColor(this.isUnlocked(index) ? BWColor.teal : BWColor.ink3)
      }

      Text(this.clueText(index))
        .fontSize(BWFont.caption)
        .fontColor(this.isUnlocked(index) ? BWColor.ink : BWColor.ink3)
        .lineHeight(20)
        .layoutWeight(1)

      if (!this.isUnlocked(index)) {
        Text('🔒')
          .fontSize(BWFont.microSm)
      }
    }
    .width('100%')
    .alignItems(VerticalAlign.Top)
    .padding({ left: 13, right: 13, top: 11, bottom: 11 })
    .backgroundColor(this.isUnlocked(index) ? BWColor.paper : '#8CFBF4E9')
    .borderRadius(16)
    .border({
      width: 1,
      color: BWColor.line,
      radius: 16,
      style: this.isUnlocked(index) ? BorderStyle.Solid : BorderStyle.Dashed
    })
  }

  @Builder
  clueSection() {
    Column({ space: 8 }) {
      Row({ space: 6 }) {
        Text('三阶线索')
          .fontSize(BWFont.caption)
          .fontWeight(FontWeight.Medium)
          .fontColor(BWColor.ink)
        Text(this.unlockedText())
          .fontSize(BWFont.microSm)
          .fontColor(BWColor.ink3)
        Blank()
      }
      .width('100%')

      ForEach(CLUE_INDEXES, (index: number) => {
        this.clueRow(index)
      }, (index: number) => String(index))
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
  }

  /** 底部：到了 → 提示拍照；没到 → 距离 + 「当作到了（演示）」 */
  @Builder
  actionSection() {
    Column({ space: 8 }) {
      Text(this.leadText())
        .fontSize(BWFont.caption)
        .fontColor(this.state.inRange ? BWColor.ink : BWColor.ink2)
        .width('100%')
        .textAlign(TextAlign.Center)
        .lineHeight(20)

      if (this.state.inRange) {
        // 到了：下一步是「拍一张同款」。拍照/对比本轮不在范围内，
        // 所以这里只说明「下一步要拍」，绝不显示作者原图（先拍后看）。
        BwPrimaryButton({
          title: '这样拍一张',
          tag: this.state.demoArrived ? '演示' : '',
          onTap: () => {
            // 拍照能力待 DevEco/相机接入（见 docs/HARMONY.md §7 待验证清单）
          }
        })

        Text('先别急着看原图 · 拍完才揭晓')
          .fontSize(BWFont.microSm)
          .fontColor(BWColor.ink3)
          .width('100%')
          .textAlign(TextAlign.Center)
      } else {
        if (!this.state.demoArrived) {
          BwQuietButton({
            title: '当作到了（演示）',
            onTap: () => {
              this.demoArrive();
            }
          })
        }
      }

      Text(HINT_FOOTER)
        .fontSize(BWFont.microSm)
        .fontColor(BWColor.ink3)
        .width('100%')
        .textAlign(TextAlign.Center)
    }
    .width('100%')
  }

  build() {
    Column({ space: 0 }) {
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor(BWColor.cream)

      Scroll() {
        Column({ space: 14 }) {
          this.topBar()
          this.summaryCard()
          this.clueSection()
          this.actionSection()
        }
        .width('100%')
        .constraintSize({ maxWidth: BWSize.contentMaxWidth })
        .padding({
          left: BWSize.pagePadding,
          right: BWSize.pagePadding,
          top: 0,
          bottom: 28
        })
      }
      .width('100%')
      .layoutWeight(1)
      .scrollBar(BarState.Off)
      .edgeEffect(EdgeEffect.Spring)
    }
    .width('100%')
    .height('100%')
    .backgroundColor(BWColor.cream)
  }
}

function emptyState(): SeekClueState {
  const state: SeekClueState = {
    unlockedCount: 1,
    lines: [],
    inRange: false,
    demoArrived: false,
    distanceText: distanceBucket(undefined)
  };
  return state;
}