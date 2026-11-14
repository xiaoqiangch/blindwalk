/**
 * 步迷 Walkaholic · HarmonyOS ArkUI — 探寻面板（寻惊喜详情）
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

import { common } from '@kit.AbilityKit';
import { BuriedSurprise, GeoPoint, PHOTO_PASS_THRESHOLD, SurpriseFindResult } from '../core/types';
import { demoSimilarity, similarity, verdict } from '../core/surprise';
import { getStore } from '../core/store';
import { AccountConfig, isLoggedIn, readAccountConfig } from '../core/account';
import { claimSurprise } from '../core/surpriseRemote';
import { HttpClient } from '../core/http';
import { KeyValueStore } from '../core/contract';
import { PickedPhoto, pickAndAdoptPhoto, takeAndAdoptPhoto } from './PhotoPick';
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
import { WAColor, WAFont, WASize } from '../theme/Theme';
import { WaIconButton, WaMicroLabel, WaPrimaryButton, WaQuietButton } from './Common';

/** 线索下标（固定 3 条） */
const CLUE_INDEXES: number[] = [0, 1, 2];

@Component
export struct WaSeekPanel {
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
  /** 是否远端惊喜（别人埋的）：认领要通知服务端 */
  isRemote: boolean = false;

  /** 平台能力：远端认领 */
  http: HttpClient | undefined = undefined;
  kv: KeyValueStore | undefined = undefined;

  onBack: () => void = () => {
  };
  onChanged: () => void = () => {
  };

  /** 是否点了「当作到了（演示）」 */
  @State private demoArrived: boolean = false;
  /** 算出来的线索状态 */
  @State private state: SeekClueState = emptyState();
  /** 正在比对 / 结算 */
  @State private busy: boolean = false;
  /** 结算结果（达标 / 不达标） */
  @State private resultScore: number = -1;
  @State private resultPassed: boolean = false;
  @State private resultVerdict: string = '';
  @State private resultDemo: boolean = false;
  @State private resultXP: number = 0;

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
  // 这样拍一张 → 比对 → 结算
  // ============================================================

  /**
   * 拍一张（或从相册选）→ 算 dHash → 与作者照片比对 → 达标记为找到。
   *
   * 保密：先拍后看。作者原图**永远不在**这一步出现（远端惊喜本来也没有原图）。
   * 远端惊喜达标后要通知服务端认领（先到先得）；未登录时服务端不接受，本机照记。
   */
  private async shootAndCompare(): Promise<void> {
    if (this.busy) return;
    const context: common.UIAbilityContext = getContext() as common.UIAbilityContext;
    let picked: PickedPhoto | undefined = undefined;
    try {
      picked = await takeAndAdoptPhoto(context);
    } catch (err) {
      picked = undefined;
    }
    if (picked === undefined) {
      // 相机不可用（模拟器 / 权限）→ 退到相册
      try {
        picked = await pickAndAdoptPhoto(context);
      } catch (err) {
        picked = undefined;
      }
    }
    if (picked === undefined) return;
    this.busy = true;
    this.compare(picked);
    this.busy = false;
  }

  private compare(picked: PickedPhoto): void {
    // 作者哈希由 store 提供（UI 不直接读惊喜的哈希字段，避免剧透字段外流）
    const authorHash: string = getStore().surprisePhotoHash(this.surpriseID);
    const hasAuthorHash: boolean = authorHash.length > 0 && authorHash !== '0000000000000000';
    const score: number = hasAuthorHash
      ? similarity(authorHash, picked.hash)
      : demoSimilarity(picked.hash);
    const passed: boolean = score >= PHOTO_PASS_THRESHOLD;

    let xp: number = 0;
    try {
      const result: SurpriseFindResult | undefined = getStore().completeSurpriseFind(
        this.surpriseID, score
      );
      if (result !== undefined) {
        xp = result.seekerXP;
        if (result.passed && result.surprise.myPhotoUri === undefined) {
          // 把寻者照片挂到本机记录上（下次打开「我找到的」还能看）
          getStore().setSurpriseFinderPhoto(this.surpriseID, picked.uri);
        }
      }
    } catch (err) {
      xp = 0;
    }

    this.resultScore = score;
    this.resultPassed = passed;
    this.resultDemo = !hasAuthorHash;
    this.resultVerdict = verdict(score);
    this.resultXP = xp;
    this.onChanged();

    // 远端惊喜达标：通知服务端认领（失败只提示「被抢先」，不打扰）
    if (passed && this.isRemote && this.http !== undefined && this.kv !== undefined) {
      this.claimRemote();
    }
  }

  private async claimRemote(): Promise<void> {
    if (this.http === undefined || this.kv === undefined) return;
    const config = readAccountConfig(this.kv);
    if (!isLoggedIn(config)) return;
    const ok: boolean = await claimSurprise(this.http, config, this.kv, this.surpriseID);
    if (!ok) {
      this.resultVerdict = '服务器上这条已被别人抢先找到（本机仍记为找到）';
    }
  }

  private resetResult(): void {
    this.resultScore = -1;
    this.resultPassed = false;
    this.resultVerdict = '';
    this.resultXP = 0;
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
        WaMicroLabel({ text: '正在探寻' })
        Text('一个还没被找到的惊喜')
          .fontSize(WAFont.caption)
          .fontColor(WAColor.ink)
          .maxLines(1)
      }
      .alignItems(HorizontalAlign.Start)

      Blank()

      Text(this.state.distanceText)
        .fontSize(WAFont.microSm)
        .fontColor(WAColor.ink3)
        .maxLines(1)
    }
    .width('100%')
    .padding({ left: WASize.pagePadding, right: WASize.pagePadding, top: 6, bottom: 10 })
  }

  /** 顶部摘要：作者 emoji + 氛围句 + 距离（**不含区域名**） */
  @Builder
  summaryCard() {
    Column({ space: 8 }) {
      Row({ space: 10 }) {
        Text(this.authorEmoji)
          .fontSize(WAFont.titleSm)
          .textAlign(TextAlign.Center)
          .width(40)
          .height(40)
          .backgroundColor(WAColor.paper2)
          .borderRadius(20)

        Column({ space: 3 }) {
          Text('有人在这儿留下一张照片')
            .fontSize(WAFont.caption)
            .fontWeight(FontWeight.Medium)
            .fontColor(WAColor.ink)
            .maxLines(1)
          Text(this.atmosphereText())
            .fontSize(WAFont.captionSm)
            .fontColor(WAColor.ink2)
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
          .fontSize(WAFont.microSm)
          .fontColor(WAColor.ink3)
        Text('·')
          .fontSize(WAFont.microSm)
          .fontColor(WAColor.ink3)
        Text('线索 ' + this.unlockedText())
          .fontSize(WAFont.microSm)
          .fontColor(WAColor.ink3)
        Blank()
      }
      .width('100%')

      // 没定位：明确说明（不假装解锁）
      if (!this.hasOrigin) {
        Text(SEEK_NO_LOCATION_TEXT)
          .fontSize(WAFont.captionSm)
          .fontColor(WAColor.ember)
          .width('100%')
          .lineHeight(18)
      }
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
    .padding(14)
    .backgroundColor(WAColor.paper)
    .borderRadius(WASize.cardRadius)
    .border({ width: 1, color: WAColor.line, radius: WASize.cardRadius })
  }

  @Builder
  clueRow(index: number) {
    Row({ space: 10 }) {
      Stack({ alignContent: Alignment.Center }) {
        Circle()
          .width(24)
          .height(24)
          .fill(this.isUnlocked(index) ? WAColor.tealSoft : WAColor.paper2)
          .stroke(this.isUnlocked(index) ? '#662E7D78' : WAColor.line)
          .strokeWidth(1)

        if (this.isUnlocked(index)) {
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

      Text(this.clueText(index))
        .fontSize(WAFont.caption)
        .fontColor(this.isUnlocked(index) ? WAColor.ink : WAColor.ink3)
        .lineHeight(20)
        .layoutWeight(1)

      if (!this.isUnlocked(index)) {
        SymbolGlyph($r('sys.symbol.lock'))
          .fontSize(WAFont.caption)
          .fontColor([WAColor.ink3])
          .renderingStrategy(SymbolRenderingStrategy.SINGLE)
          .fontSize(WAFont.microSm)
      }
    }
    .width('100%')
    .alignItems(VerticalAlign.Top)
    .padding({ left: 13, right: 13, top: 11, bottom: 11 })
    .backgroundColor(this.isUnlocked(index) ? WAColor.paper : '#8CFBF4E9')
    .borderRadius(16)
    .border({
      width: 1,
      color: WAColor.line,
      radius: 16,
      style: this.isUnlocked(index) ? BorderStyle.Solid : BorderStyle.Dashed
    })
  }

  @Builder
  clueSection() {
    Column({ space: 8 }) {
      Row({ space: 6 }) {
        Text('三阶线索')
          .fontSize(WAFont.caption)
          .fontWeight(FontWeight.Medium)
          .fontColor(WAColor.ink)
        Text(this.unlockedText())
          .fontSize(WAFont.microSm)
          .fontColor(WAColor.ink3)
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
      // 结算结果（先拍后看：这里只给相似度与评价，不给作者原图）
      if (this.resultScore >= 0) {
        Column({ space: 4 }) {
          Row({ space: 6 }) {
            Text(this.resultPassed ? '找到 · 探索值 +' + String(this.resultXP) : '还没对上')
              .fontSize(WAFont.caption)
              .fontWeight(FontWeight.Medium)
              .fontColor(this.resultPassed ? WAColor.teal : WAColor.ink2)
            Text(Math.round(this.resultScore * 100) + '%')
              .fontSize(WAFont.captionSm)
              .fontColor(WAColor.ink3)
            if (this.resultDemo) {
              Text('演示匹配')
                .fontSize(WAFont.micro)
                .fontColor(WAColor.ink3)
            }
            Blank()
          }
          .width('100%')
          Text(this.resultVerdict)
            .fontSize(WAFont.microSm)
            .fontColor(WAColor.ink3)
            .lineHeight(17)
            .width('100%')
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start)
        .padding(12)
        .backgroundColor(this.resultPassed ? WAColor.tealSoft : WAColor.paper2)
        .borderRadius(WASize.cardRadiusSm)
      }

      Text(this.leadText())
        .fontSize(WAFont.caption)
        .fontColor(this.state.inRange ? WAColor.ink : WAColor.ink2)
        .width('100%')
        .textAlign(TextAlign.Center)
        .lineHeight(20)

      if (this.state.inRange) {
        WaPrimaryButton({
          title: this.busy ? '正在比对…' : '这样拍一张',
          tag: this.state.demoArrived ? '演示' : '',
          isActive: !this.busy,
          onTap: () => {
            this.shootAndCompare();
          }
        })

        Text('先别急着看原图 · 拍完才揭晓')
          .fontSize(WAFont.microSm)
          .fontColor(WAColor.ink3)
          .width('100%')
          .textAlign(TextAlign.Center)

        if (this.resultScore >= 0 && !this.resultPassed) {
          WaQuietButton({
            title: '再拍一张',
            onTap: () => {
              this.resetResult();
            }
          })
        }
      } else {
        if (!this.state.demoArrived) {
          WaQuietButton({
            title: '当作到了（演示）',
            onTap: () => {
              this.demoArrive();
            }
          })
        }
      }

      Text(HINT_FOOTER)
        .fontSize(WAFont.microSm)
        .fontColor(WAColor.ink3)
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
        .backgroundColor(WAColor.cream)

      Scroll() {
        Column({ space: 14 }) {
          this.topBar()
          this.summaryCard()
          this.clueSection()
          this.actionSection()
        }
        .width('100%')
        .constraintSize({ maxWidth: WASize.contentMaxWidth })
        .padding({
          left: WASize.pagePadding,
          right: WASize.pagePadding,
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
    .backgroundColor(WAColor.cream)
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