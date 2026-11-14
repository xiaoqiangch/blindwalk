/**
 * 步迷 Walkaholic · HarmonyOS ArkUI — 圈子 Social（design-system §5.6）
 *
 * 视觉基准：prototype/web/app.js socialHTML + screenshots/showcase.png（SOCIAL 屏）
 * 结构：圈子 header + 同频 → 同频码卡 → 本周榜（Top 3 + 折叠） → 动态流（本人置顶、反应可点）
 */

import { getStore } from '../core/store';
import { AppSnapshot } from '../core/contract';
import { FeedPost, LeaderboardEntry, ReactionKey } from '../core/types';
import { WaEmptyState, WaSectionHead } from '../components/Common';
import {
  emptySnapshot,
  hasReacted,
  reactionCount,
  reactionMetas,
  readSnapshot,
  ReactionMeta,
  sortedFeed
} from '../components/StoreBridge';
import { waCopyText, waToast } from '../components/Async';
import {
  WAColor,
  WAFont,
  WASize,
  rarityColor,
  rarityLabel
} from '../theme/Theme';
import { relativeTime } from '../components/Format';

@Component
export struct SocialView {
  @Prop @Watch('onRevisionChanged') revision: number = 0;
  @Prop winWidth: number = 400;
  @Prop winHeight: number = 800;

  onOpenSetup: () => void = () => {
  };
  onChanged: () => void = () => {
  };

  @State private snapshot: AppSnapshot = emptySnapshot();
  @State private boardOpen: boolean = false;

  aboutToAppear(): void {
    this.load();
  }

  onRevisionChanged(propName: string): void {
    this.load();
  }

  private load(): void {
    this.snapshot = readSnapshot(this.snapshot);
  }

  // ============================================================
  // 数据
  // ============================================================

  private boardTotal(): number {
    return this.snapshot.leaderboard.length;
  }

  private visibleBoard(): LeaderboardEntry[] {
    const list: LeaderboardEntry[] = this.snapshot.leaderboard;
    if (this.boardOpen) {
      return list;
    }
    const top: LeaderboardEntry[] = [];
    for (let i = 0; i < list.length && i < 3; i++) {
      top.push(list[i]);
    }
    for (let i = 3; i < list.length; i++) {
      if (list[i].isMe) {
        top.push(list[i]);
      }
    }
    return top;
  }

  private rankOf(entry: LeaderboardEntry): number {
    for (let i = 0; i < this.snapshot.leaderboard.length; i++) {
      if (this.snapshot.leaderboard[i].id === entry.id) {
        return i + 1;
      }
    }
    return this.snapshot.leaderboard.length;
  }

  private copyCode(): void {
    waCopyText(this.snapshot.togetherCode).then(() => {
      waToast('已复制同频码');
    });
  }

  private react(post: FeedPost, key: ReactionKey): void {
    getStore().reactToPost(post.id, key);
    this.load();
    this.onChanged();
  }

  // ============================================================
  // 区块
  // ============================================================

  @Builder
  header() {
    Row() {
      Text('圈子')
        .fontSize(WAFont.hero)
        .fontWeight(FontWeight.Bold)
        .fontColor(WAColor.ink)

      Blank()

      Button() {
        Text('同频')
          .fontSize(WAFont.caption)
          .fontColor(WAColor.ink2)
      }
      .type(ButtonType.Capsule)
      .height(30)
      .padding({ left: 14, right: 14 })
      .backgroundColor(WAColor.paper)
      .border({ width: 1, color: WAColor.line, radius: WASize.chipRadius })
      .onClick(() => {
        this.copyCode();
      })
    }
    .width('100%')
  }

  @Builder
  togetherCard() {
    Column({ space: 0 }) {
      Row() {
        Text('今晚一起走？')
          .fontSize(WAFont.titleMd)
          .fontWeight(FontWeight.Medium)
          .fontColor(WAColor.ink)
        Blank()
        SymbolGlyph($r('sys.symbol.arrowshape_turn_up_right'))
          .fontSize(WASize.iconSizeSm)
          .fontColor([WAColor.ink2])
          .renderingStrategy(SymbolRenderingStrategy.SINGLE)
          .fontSize(16)
      }
      .width('100%')

      Text('把这串码给朋友，各自开盒。')
        .fontSize(WAFont.captionSm)
        .fontColor('#A6171410')
        .width('100%')
        .margin({ top: 4 })

      Row({ space: 12 }) {
        Text(this.snapshot.togetherCode.length > 0 ? this.snapshot.togetherCode : 'K7M2QX')
          .fontSize(26)
          .fontWeight(FontWeight.Bold)
          .fontColor(WAColor.ink)
          .letterSpacing(6)

        Blank()

        Button() {
          Text('复制')
            .fontSize(WAFont.captionSm)
            .fontColor(WAColor.ink)
        }
        .type(ButtonType.Capsule)
        .height(30)
        .padding({ left: 14, right: 14 })
        .backgroundColor('#B3FFFBF3')
        .border({ width: 1, color: WAColor.amberBorder, radius: WASize.chipRadius })
        .onClick(() => {
          this.copyCode();
        })
      }
      .width('100%')
      .margin({ top: 12 })

      Text('好友输入同频码，各自开盒，结束后交换线索')
        .fontSize(WAFont.captionSm)
        .fontColor('#A6171410')
        .width('100%')
        .margin({ top: 10 })
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
    .padding(18)
    .backgroundColor(WAColor.paper)
    .borderRadius(WASize.cardRadius)
    .border({ width: 1, color: '#52E89B4C', radius: WASize.cardRadius })
    .shadow({ radius: 18, color: WAColor.shadow, offsetX: 0, offsetY: 12 })
  }

  @Builder
  boardRow(entry: LeaderboardEntry) {
    Row({ space: 12 }) {
      Text(String(this.rankOf(entry)))
        .fontSize(WAFont.titleSm)
        .fontWeight(FontWeight.Bold)
        .fontColor(this.rankOf(entry) <= 3 ? WAColor.amberDeep : WAColor.ink3)
        .width(22)

      Text(entry.emoji)
        .fontSize(18)
        .textAlign(TextAlign.Center)
        .width(32)
        .height(32)
        .backgroundColor(WAColor.paper2)
        .borderRadius(16)

      Text(entry.name)
        .fontSize(WAFont.bodySm)
        .fontColor(WAColor.ink)

      if (entry.isMe) {
        Text('你')
          .fontSize(WAFont.microSm)
          .fontWeight(FontWeight.Bold)
          .fontColor(WAColor.amberDeep)
          .padding({ left: 5, right: 5, top: 2, bottom: 2 })
          .backgroundColor(WAColor.amberSoftStrong)
          .borderRadius(WASize.chipRadius)
      }

      Blank()

      Text(String(entry.score))
        .fontSize(WAFont.caption)
        .fontColor(WAColor.ink2)
    }
    .width('100%')
    .padding({ left: 12, right: 12, top: 9, bottom: 9 })
    .backgroundColor(entry.isMe ? '#12E89B4C' : Color.Transparent)
  }

  @Builder
  boardSection() {
    Column({ space: 10 }) {
      Row() {
        Text('本周榜')
          .fontSize(WAFont.titleMd)
          .fontWeight(FontWeight.Medium)
          .fontColor(WAColor.ink)
        Blank()
        Text('惊喜指数')
          .fontSize(WAFont.micro)
          .fontColor(WAColor.ink3)
      }
      .width('100%')

      Column({ space: 0 }) {
        ForEach(this.visibleBoard(), (entry: LeaderboardEntry) => {
          this.boardRow(entry)
        }, (entry: LeaderboardEntry) => entry.id)
      }
      .width('100%')
      .backgroundColor(WAColor.paperTranslucent)
      .borderRadius(WASize.cardRadiusSm)
      .border({ width: 1, color: WAColor.line, radius: WASize.cardRadiusSm })

      if (this.boardTotal() > 3) {
        Row({ space: 4 }) {
          Text(this.boardOpen ? '收起' : '展开 · 其余 ' + String(this.boardTotal() - 3) + ' 位')
            .fontSize(WAFont.captionSm)
            .fontColor(WAColor.amberDeep)
        }
        .onClick(() => {
          this.boardOpen = !this.boardOpen;
        })
      }
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
  }

  @Builder
  reactionButton(post: FeedPost, meta: ReactionMeta) {
    Button() {
      Row({ space: 4 }) {
        if (meta.icon.length > 0) {
          SymbolGlyph($r('sys.symbol.' + meta.icon))
            .fontSize(WAFont.captionSm)
            .fontColor([hasReacted(post, meta.key) ? WAColor.amber : WAColor.ink3])
            .renderingStrategy(SymbolRenderingStrategy.SINGLE)
        }
        Text(String(reactionCount(post, meta.key)))
          .fontSize(WAFont.captionSm)
          .fontWeight(FontWeight.Medium)
          .fontColor(hasReacted(post, meta.key) ? WAColor.amberDeep : WAColor.ink3)
        if (meta.icon.length === 0) {
          Text(meta.label)
            .fontSize(WAFont.captionSm)
            .fontColor(hasReacted(post, meta.key) ? WAColor.amberDeep : WAColor.ink3)
        }
      }
    }
    .type(ButtonType.Capsule)
    .height(26)
    .padding({ left: 9, right: 9 })
    .backgroundColor(hasReacted(post, meta.key) ? WAColor.amberSoftStrong : WAColor.paper2)
    .border({
      width: 1,
      color: hasReacted(post, meta.key) ? WAColor.amberBorder : WAColor.line,
      radius: WASize.chipRadius
    })
    .onClick(() => {
      this.react(post, meta.key);
    })
  }

  @Builder
  postCard(post: FeedPost) {
    Column({ space: 0 }) {
      Row({ space: 10 }) {
        Text(post.authorEmoji)
          .fontSize(WAFont.bodySm)
          .textAlign(TextAlign.Center)
          .width(36)
          .height(36)
          .backgroundColor(WAColor.paper2)
          .borderRadius(18)

        Column({ space: 2 }) {
          Text(post.authorName)
            .fontSize(WAFont.caption)
            .fontColor(WAColor.ink)
          Text(relativeTime(post.createdAt))
            .fontSize(WAFont.microSm)
            .fontColor(WAColor.ink3)
        }
        .alignItems(HorizontalAlign.Start)

        Blank()

        Text('揭晓')
          .fontSize(WAFont.microSm)
          .fontWeight(FontWeight.Medium)
          .fontColor(WAColor.amberDeep)
          .letterSpacing(1)
          .padding({ left: 8, right: 8, top: 3, bottom: 3 })
          .backgroundColor(WAColor.amberSoft)
          .borderRadius(WASize.chipRadius)
      }
      .width('100%')

      Row({ space: 10 }) {
        Text(post.categoryEmoji)
          .fontSize(20)

        Column({ space: 2 }) {
          Text(post.placeName)
            .fontSize(WAFont.caption)
            .fontColor(WAColor.ink)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
          Text(rarityLabel(post.rarity))
            .fontSize(WAFont.microSm)
            .fontWeight(FontWeight.Medium)
            .fontColor(rarityColor(post.rarity))
        }
        .alignItems(HorizontalAlign.Start)

        Blank()
      }
      .width('100%')
      .padding(10)
      .backgroundColor(WAColor.paper2)
      .borderRadius(14)
      .margin({ top: 12 })

      Text(post.caption)
        .fontSize(WAFont.caption)
        .fontColor(WAColor.ink)
        .lineHeight(21)
        .width('100%')
        .margin({ top: 10 })

      Row({ space: 8 }) {
        ForEach(reactionMetas(), (meta: ReactionMeta) => {
          this.reactionButton(post, meta)
        }, (meta: ReactionMeta) => meta.key)
        Blank()
      }
      .width('100%')
      .margin({ top: 10 })
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
    .padding(16)
    .backgroundColor(WAColor.paper)
    .borderRadius(WASize.cardRadius)
    .border({ width: 1, color: WAColor.line, radius: WASize.cardRadius })
    .shadow({ radius: 12, color: WAColor.shadowSoft, offsetX: 0, offsetY: 8 })
    .margin({ bottom: 12 })
  }

  @Builder
  feedSection() {
    Column({ space: 12 }) {
      WaSectionHead({ title: '今晚的惊喜' })

      if (sortedFeed(this.snapshot).length === 0) {
        WaEmptyState({
          title: '还没有人分享今晚的惊喜。',
          subtitle: '去开一个盲盒，把第一个留在这里。',
          actionText: '开一个盲盒',
          onAction: () => {
            this.onOpenSetup();
          }
        })
      } else {
        ForEach(sortedFeed(this.snapshot), (post: FeedPost) => {
          this.postCard(post)
        }, (post: FeedPost) => post.id)
      }
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
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
            // 折叠屏展开态：左（同频码 + 排行榜） / 右（动态流）
            Row({ space: 20 }) {
              Column({ space: 0 }) {
                this.togetherCard()

                Column() {
                  this.boardSection()
                }
                .margin({ top: 18 })
              }
              .layoutWeight(1)
              .alignItems(HorizontalAlign.Start)

              Column({ space: 0 }) {
                this.feedSection()
              }
              .layoutWeight(1)
              .alignItems(HorizontalAlign.Start)
              .padding({ top: 14 })
            }
            .width('100%')
            .alignItems(VerticalAlign.Top)
            .margin({ top: 14 })
          } else {
            Column({ space: 0 }) {
              Column() {
                this.togetherCard()
              }
              .margin({ top: 14 })

              Column() {
                this.boardSection()
              }
              .margin({ top: 18 })

              Column() {
                this.feedSection()
              }
              .margin({ top: 18 })
            }
            .width('100%')
          }
        }
        .width('100%')
        .constraintSize({ maxWidth: this.isWide() ? '100%' : WASize.contentMaxWidth })
        .padding({
          left: WASize.pagePadding,
          right: WASize.pagePadding,
          top: 8,
          bottom: 26
        })
      }
      .width('100%')
      .height('100%')
      .scrollBar(BarState.Off)
      .edgeEffect(EdgeEffect.Spring)
    }
    .width('100%')
    .height('100%')
  }
}
