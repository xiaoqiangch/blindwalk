/**
 * 步迷 Walkaholic · HarmonyOS ArkUI — 我的惊喜（回执 / 我埋的 / 我找到的）
 *
 * 移植自 apple/App/Views/SurprisesView.swift：
 *   1. 顶部「被找到」回执条（未读徽标 + 知道了）
 *   2. 统计：我埋的 / 被找到 / 我找到的
 *   3. 我埋的列表（等待中 / 被找到，含寻者名与时间）
 *   4. 我找到的列表（复刻照片与相似度）
 *
 * ## 保密
 * 列表里展示的是**我自己埋的**与**我已经找到的**，所以区域名/作者名/照片都可以出现；
 * 但这些字段来自 store 的快照（mySurprises / foundSurprises），不在这里重新拼装。
 */

import { AppSnapshot } from '../core/contract';
import { BuriedSurprise, SurpriseReceipt } from '../core/types';
import { WaEmptyState, WaIconButton, WaMicroLabel, WaStatsRow, StatItem } from '../components/Common';
import { emptySnapshot, readSnapshot } from '../components/StoreBridge';
import { getStore } from '../core/store';
import { WAColor, WAFont, WASize } from '../theme/Theme';
import { relativeTime } from '../components/Format';

@Component
export struct SurprisesPanel {
  @Prop @Watch('onRevisionChanged') revision: number = 0;
  @Prop winWidth: number = 400;
  @Prop winHeight: number = 800;

  onBack: () => void = () => {
  };
  /** 去埋一个（由 Index 切到埋惊喜面板） */
  onOpenBury: () => void = () => {
  };

  @State private snapshot: AppSnapshot = emptySnapshot();

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

  private unreadReceipts(): SurpriseReceipt[] {
    const list: SurpriseReceipt[] = [];
    for (let i = 0; i < this.snapshot.receipts.length; i += 1) {
      if (this.snapshot.receipts[i].readAt === undefined) list.push(this.snapshot.receipts[i]);
    }
    return list;
  }

  private foundByOthers(): BuriedSurprise[] {
    const list: BuriedSurprise[] = [];
    for (let i = 0; i < this.snapshot.mySurprises.length; i += 1) {
      if (this.snapshot.mySurprises[i].found) list.push(this.snapshot.mySurprises[i]);
    }
    return list;
  }

  private waiting(): BuriedSurprise[] {
    const list: BuriedSurprise[] = [];
    for (let i = 0; i < this.snapshot.mySurprises.length; i += 1) {
      if (!this.snapshot.mySurprises[i].found) list.push(this.snapshot.mySurprises[i]);
    }
    return list;
  }

  private statsItems(): StatItem[] {
    const items: StatItem[] = [];
    items.push({ value: String(this.snapshot.mySurprises.length), label: '我埋的' });
    items.push({ value: String(this.foundByOthers().length), label: '被找到' });
    items.push({ value: String(this.snapshot.foundSurprises.length), label: '我找到的' });
    return items;
  }

  private receiptLine(receipt: SurpriseReceipt): string {
    const area: string = receipt.areaLabel.length === 0 ? '你埋的地方' : receipt.areaLabel;
    return receipt.finderName + ' 在「' + area + '」拍到了同款 · ' + relativeTime(receipt.foundAt);
  }

  private hasUnread(surprise: BuriedSurprise): boolean {
    for (let i = 0; i < this.snapshot.receipts.length; i += 1) {
      const receipt: SurpriseReceipt = this.snapshot.receipts[i];
      if (receipt.id === surprise.id && receipt.readAt === undefined) return true;
    }
    return false;
  }

  private markAllRead(): void {
    getStore().markReceiptsRead(Date.now());
    this.load();
  }

  // ============================================================
  // 区块
  // ============================================================

  @Builder
  header() {
    Row({ space: 10 }) {
      WaIconButton({
        name: 'chevron_left',
        onTap: () => {
          this.onBack();
        }
      })

      Column({ space: 2 }) {
        WaMicroLabel({ text: '我的' })
        Text('惊喜')
          .fontSize(WAFont.hero)
          .fontWeight(FontWeight.Bold)
          .fontColor(WAColor.ink)
      }
      .alignItems(HorizontalAlign.Start)

      Blank()
    }
    .width('100%')
  }

  /** 被找到的回执：这是作者唯一的「我留下的东西被人看见」的反馈 */
  @Builder
  receiptBanner() {
    Column({ space: 8 }) {
      Row({ space: 6 }) {
        SymbolGlyph($r('sys.symbol.star_fill'))
          .fontSize(WAFont.caption)
          .fontColor([WAColor.ember])
          .renderingStrategy(SymbolRenderingStrategy.SINGLE)
        Text(this.unreadReceipts().length === 1
          ? '有人找到了你埋的照片'
          : '有 ' + String(this.unreadReceipts().length) + ' 条新回执')
          .fontSize(WAFont.caption)
          .fontWeight(FontWeight.Medium)
          .fontColor(WAColor.ink)
          .layoutWeight(1)
        Text('知道了')
          .fontSize(WAFont.captionSm)
          .fontColor(WAColor.ember)
          .onClick(() => {
            this.markAllRead();
          })
      }
      .width('100%')

      ForEach(this.unreadReceipts().slice(0, 3), (receipt: SurpriseReceipt) => {
        Row({ space: 6 }) {
          Text('·')
            .fontSize(WAFont.caption)
            .fontColor(WAColor.ember)
          Text(this.receiptLine(receipt))
            .fontSize(WAFont.captionSm)
            .fontColor(WAColor.ink2)
            .layoutWeight(1)
            .lineHeight(18)
        }
        .width('100%')
        .alignItems(VerticalAlign.Top)
      }, (receipt: SurpriseReceipt) => receipt.id)
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
    .padding(14)
    .backgroundColor('#14FA2A2D')
    .borderRadius(WASize.cardRadius)
    .border({ width: 1, color: '#33FA2A2D', radius: WASize.cardRadius })
  }

  @Builder
  statsCard() {
    WaStatsRow({ items: this.statsItems(), roomy: true })
  }

  @Builder
  surpriseRow(surprise: BuriedSurprise, owner: boolean) {
    Column({ space: 8 }) {
      Row({ space: 6 }) {
        Text(surprise.areaWord.length === 0 ? '附近' : surprise.areaWord)
          .fontSize(WAFont.caption)
          .fontWeight(FontWeight.Medium)
          .fontColor(WAColor.ink)
          .layoutWeight(1)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
        if (owner && this.hasUnread(surprise)) {
          Text('新')
            .fontSize(WAFont.micro)
            .fontWeight(FontWeight.Bold)
            .fontColor(WAColor.iconOnBrand)
            .padding({ left: 5, right: 5, top: 1, bottom: 1 })
            .backgroundColor(WAColor.ember)
            .borderRadius(WASize.chipRadius)
        }
        Text(surprise.found ? (owner ? '被找到' : '我找到了') : '等待中')
          .fontSize(WAFont.microSm)
          .fontColor(surprise.found ? WAColor.teal : WAColor.ink3)
      }
      .width('100%')

      if (surprise.message !== undefined && surprise.message.length > 0) {
        Text(surprise.message)
          .fontSize(WAFont.captionSm)
          .fontColor(WAColor.ink2)
          .maxLines(2)
          .lineHeight(18)
          .width('100%')
      }

      Row({ space: 5 }) {
        Text('埋于 ' + relativeTime(surprise.buriedAt))
          .fontSize(WAFont.microSm)
          .fontColor(WAColor.ink3)
        if (surprise.found && surprise.finderName !== undefined) {
          Text('· ' + surprise.finderName + ' 找到了')
            .fontSize(WAFont.microSm)
            .fontColor(WAColor.teal)
        }
        Blank()
      }
      .width('100%')
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
    .padding(14)
    .backgroundColor(WAColor.paper)
    .borderRadius(WASize.cardRadius)
    .border({ width: 1, color: WAColor.line, radius: WASize.cardRadius })
  }

  @Builder
  sectionTitle(title: string, trailing: string) {
    Row({ space: 6 }) {
      Text(title)
        .fontSize(WAFont.caption)
        .fontWeight(FontWeight.Bold)
        .fontColor(WAColor.ink)
      Text(trailing)
        .fontSize(WAFont.microSm)
        .fontColor(WAColor.ink3)
      Blank()
    }
    .width('100%')
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

          Column() {
            this.statsCard()
          }
          .margin({ top: 12 })

          if (this.unreadReceipts().length > 0) {
            Column() {
              this.receiptBanner()
            }
            .margin({ top: 12 })
          }

          Column({ space: 10 }) {
            this.sectionTitle(
              '我埋的',
              this.snapshot.mySurprises.length === 0
                ? ''
                : '等待中 ' + String(this.waiting().length) + ' · 被找到 ' + String(this.foundByOthers().length)
            )

            if (this.snapshot.mySurprises.length === 0) {
              WaEmptyState({
                title: '你还没埋下过惊喜。',
                subtitle: '找一个你觉得好的地方，放一张照片在那儿。',
                actionText: '埋下一个',
                iconName: 'gift',
                onAction: () => {
                  this.onOpenBury();
                }
              })
            } else {
              ForEach(this.snapshot.mySurprises, (surprise: BuriedSurprise) => {
                this.surpriseRow(surprise, true)
              }, (surprise: BuriedSurprise) => surprise.id)
            }
          }
          .margin({ top: 22 })

          Column({ space: 10 }) {
            this.sectionTitle('我找到的', this.snapshot.foundSurprises.length === 0
              ? ''
              : String(this.snapshot.foundSurprises.length) + ' 个')

            if (this.snapshot.foundSurprises.length === 0) {
              WaEmptyState({
                title: '还没找到过别人的惊喜。',
                subtitle: '图鉴里「附近的惊喜」点进去，走近就会解锁线索。',
                iconName: 'magnifyingglass'
              })
            } else {
              ForEach(this.snapshot.foundSurprises, (surprise: BuriedSurprise) => {
                this.surpriseRow(surprise, false)
              }, (surprise: BuriedSurprise) => surprise.id)
            }
          }
          .margin({ top: 22 })

          Text('登录后埋下的惊喜会共享到服务器，附近的步迷才能找到；未登录时只存在本机。')
            .fontSize(WAFont.microSm)
            .fontColor(WAColor.ink3)
            .textAlign(TextAlign.Center)
            .width('100%')
            .margin({ top: 22, bottom: 30 })
        }
        .width('100%')
        .constraintSize({ maxWidth: WASize.contentMaxWidth })
        .padding({ left: WASize.pagePadding, right: WASize.pagePadding, top: 8 })
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
