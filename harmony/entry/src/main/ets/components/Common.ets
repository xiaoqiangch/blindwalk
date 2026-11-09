/**
 * 盲走 BlindWalk · HarmonyOS ArkUI — 共享小组件
 *
 * 只依赖 theme/Theme.ets 的 token；不读 store。
 * 所有组件都是 V1 状态管理（@Component + @Prop + @State），避免跨版本 API。
 */

import { Rarity } from '../core/types';
import {
  BWColor,
  BWFont,
  BWSize,
  rarityBorder,
  rarityColor,
  rarityLabel,
  raritySoft
} from '../theme/Theme';

// ============================================================
// 微标 / 小标题
// ============================================================

@Component
export struct BwMicroLabel {
  @Prop text: string = '';

  build() {
    Text(this.text)
      .fontSize(BWFont.micro)
      .fontColor(BWColor.ink3)
      .fontWeight(FontWeight.Medium)
      .letterSpacing(1.1)
  }
}

@Component
export struct BwSectionHead {
  @Prop title: string = '';
  @Prop trailing: string = '';
  onTrailingTap: () => void = () => {
  };

  build() {
    Row() {
      Text(this.title)
        .fontSize(BWFont.titleMd)
        .fontWeight(FontWeight.Medium)
        .fontColor(BWColor.ink)

      Blank()

      if (this.trailing.length > 0) {
        Row({ space: 2 }) {
          Text(this.trailing)
            .fontSize(BWFont.captionSm)
            .fontColor(BWColor.amberDeep)
          Text('›')
            .fontSize(BWFont.caption)
            .fontColor(BWColor.amberDeep)
        }
        .onClick(() => {
          this.onTrailingTap();
        })
      }
    }
    .width('100%')
  }
}

// ============================================================
// 按钮
// ============================================================

@Component
export struct BwPrimaryButton {
  @Prop title: string = '';
  /** 按钮内小标签，例如「演示」「兜底」；空字符串不显示 */
  @Prop tag: string = '';
  @Prop enabled: boolean = true;
  onTap: () => void = () => {
  };

  build() {
    Button() {
      Row({ space: 6 }) {
        Text(this.title)
          .fontSize(BWFont.titleSm)
          .fontWeight(FontWeight.Medium)
          .fontColor(BWColor.ink)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })

        if (this.tag.length > 0) {
          Text(this.tag)
            .fontSize(BWFont.microSm)
            .fontWeight(FontWeight.Bold)
            .fontColor(BWColor.ink)
            .padding({ left: 6, right: 6, top: 2, bottom: 2 })
            .backgroundColor('#A6FFFBF3')
            .borderRadius(BWSize.chipRadius)
        }
      }
      .justifyContent(FlexAlign.Center)
      .width('100%')
    }
    .type(ButtonType.Capsule)
    .height(52)
    .width('100%')
    .backgroundColor(BWColor.amber)
    .shadow({ radius: 14, color: BWColor.shadow, offsetX: 0, offsetY: 6 })
    .enabled(this.enabled)
    .opacity(this.enabled ? 1 : 0.55)
    .onClick(() => {
      if (this.enabled) {
        this.onTap();
      }
    })
  }
}

@Component
export struct BwQuietButton {
  @Prop title: string = '';
  @Prop bordered: boolean = true;
  @Prop enabled: boolean = true;
  onTap: () => void = () => {
  };

  build() {
    Button() {
      Text(this.title)
        .fontSize(BWFont.bodySm)
        .fontWeight(FontWeight.Medium)
        .fontColor(BWColor.ink2)
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
    }
    .type(ButtonType.Capsule)
    .height(44)
    .width('100%')
    .backgroundColor(this.bordered ? BWColor.paper2 : Color.Transparent)
    .border({
      width: this.bordered ? 1 : 0,
      color: BWColor.line,
      radius: BWSize.chipRadius
    })
    .enabled(this.enabled)
    .opacity(this.enabled ? 1 : 0.45)
    .onClick(() => {
      if (this.enabled) {
        this.onTap();
      }
    })
  }
}

@Component
export struct BwIconButton {
  @Prop glyph: string = '‹';
  @Prop size: number = 34;
  @Prop dark: boolean = false;
  onTap: () => void = () => {
  };

  build() {
    Text(this.glyph)
      .fontSize(BWFont.titleSm)
      .fontColor(this.dark ? BWColor.creamOnStage : BWColor.ink2)
      .textAlign(TextAlign.Center)
      .width(this.size)
      .height(this.size)
      .backgroundColor(this.dark ? BWColor.stageClose : BWColor.paper)
      .borderRadius(this.size / 2)
      .border({
        width: 1,
        color: this.dark ? BWColor.stageCloseBorder : BWColor.line,
        radius: this.size / 2
      })
      .onClick(() => {
        this.onTap();
      })
  }
}

// ============================================================
// 标签 / 徽章
// ============================================================

@Component
export struct BwPill {
  @Prop text: string = '';
  @Prop selected: boolean = false;
  onTap: () => void = () => {
  };

  build() {
    Button() {
      Text(this.text)
        .fontSize(BWFont.caption)
        .fontWeight(FontWeight.Medium)
        .fontColor(this.selected ? BWColor.ink : BWColor.ink2)
    }
    .type(ButtonType.Capsule)
    .height(30)
    .padding({ left: 14, right: 14 })
    .backgroundColor(this.selected ? BWColor.amberSoftStrong : BWColor.paper)
    .border({
      width: 1,
      color: this.selected ? BWColor.amberBorder : BWColor.line,
      radius: BWSize.chipRadius
    })
    .onClick(() => {
      this.onTap();
    })
  }
}

@Component
export struct BwRarityBadge {
  @Prop rarity: Rarity = Rarity.Common;

  build() {
    Row({ space: 5 }) {
      Circle()
        .width(6)
        .height(6)
        .fill(rarityColor(this.rarity))

      Text(rarityLabel(this.rarity))
        .fontSize(BWFont.captionSm)
        .fontWeight(FontWeight.Medium)
        .fontColor(rarityColor(this.rarity))
    }
    .padding({ left: 10, right: 10, top: 4, bottom: 4 })
    .backgroundColor(raritySoft(this.rarity))
    .borderRadius(BWSize.chipRadius)
    .border({
      width: 1,
      color: rarityBorder(this.rarity),
      radius: BWSize.chipRadius
    })
  }
}

// ============================================================
// 统计 / 进度
// ============================================================

export interface StatItem {
  value: string;
  label: string;
}

@Component
export struct BwStatsRow {
  @Prop items: StatItem[] = [];
  @Prop roomy: boolean = false;

  build() {
    Row() {
      ForEach(this.items, (item: StatItem, index: number) => {
        if (index > 0) {
          Divider()
            .vertical(true)
            .height(this.roomy ? 28 : 22)
            .strokeWidth(1)
            .color(BWColor.line)
        }

        Column({ space: 3 }) {
          Text(item.value)
            .fontSize(BWFont.title)
            .fontWeight(FontWeight.Bold)
            .fontColor(BWColor.ink)
            .maxLines(1)

          Text(item.label)
            .fontSize(BWFont.captionSm)
            .fontColor(BWColor.ink2)
            .maxLines(1)
        }
        .layoutWeight(1)
        .alignItems(HorizontalAlign.Center)
      }, (item: StatItem) => item.label)
    }
    .width('100%')
    .padding({ top: 14, bottom: 14 })
    .backgroundColor(BWColor.paperTranslucent)
    .borderRadius(BWSize.cardRadiusSm)
    .border({ width: 1, color: BWColor.line, radius: BWSize.cardRadiusSm })
  }
}

@Component
export struct BwProgressBar {
  @Prop progress: number = 0;
  @Prop barColor: string = BWColor.amber;
  @Prop trackColor: string = BWColor.line;
  @Prop barHeight: number = 6;

  build() {
    Stack({ alignContent: Alignment.Start }) {
      Row()
        .width('100%')
        .height(this.barHeight)
        .backgroundColor(this.trackColor)
        .borderRadius(this.barHeight / 2)

      Row()
        .width((Math.max(0, Math.min(1, this.progress)) * 100) + '%')
        .height(this.barHeight)
        .backgroundColor(this.barColor)
        .borderRadius(this.barHeight / 2)
    }
    .width('100%')
  }
}

// ============================================================
// Toast / 空状态
// ============================================================

@Component
export struct BwToastBar {
  @Prop text: string = '';
  @Prop icon: string = '✨';
  @Prop amber: boolean = false;

  build() {
    Row({ space: 8 }) {
      Text(this.icon)
        .fontSize(BWFont.bodySm)

      Text(this.text)
        .fontSize(BWFont.caption)
        .fontColor(BWColor.ink)
        .maxLines(2)
    }
    .padding({ left: 16, right: 16, top: 11, bottom: 11 })
    .backgroundColor(BWColor.paper)
    .borderRadius(BWSize.chipRadius)
    .border({
      width: 1,
      color: this.amber ? BWColor.amberBorder : BWColor.line,
      radius: BWSize.chipRadius
    })
    .shadow({ radius: 18, color: BWColor.shadow, offsetX: 0, offsetY: 8 })
  }
}

@Component
export struct BwEmptyState {
  @Prop title: string = '';
  @Prop subtitle: string = '';
  @Prop actionText: string = '';
  onAction: () => void = () => {
  };

  build() {
    Column({ space: 8 }) {
      Text('🪹')
        .fontSize(34)
        .opacity(0.8)

      Text(this.title)
        .fontSize(BWFont.body)
        .fontWeight(FontWeight.Medium)
        .fontColor(BWColor.ink)

      if (this.subtitle.length > 0) {
        Text(this.subtitle)
          .fontSize(BWFont.caption)
          .fontColor(BWColor.ink3)
          .textAlign(TextAlign.Center)
      }

      if (this.actionText.length > 0) {
        Button(this.actionText)
          .type(ButtonType.Capsule)
          .height(40)
          .padding({ left: 22, right: 22 })
          .fontSize(BWFont.caption)
          .fontColor(BWColor.ink)
          .backgroundColor(BWColor.amber)
          .onClick(() => {
            this.onAction();
          })
          .margin({ top: 6 })
      }
    }
    .width('100%')
    .padding({ top: 28, bottom: 28, left: 24, right: 24 })
    .backgroundColor(BWColor.paperHalf)
    .borderRadius(BWSize.cardRadiusSm)
    .border({ width: 1, color: BWColor.line, radius: BWSize.cardRadiusSm })
  }
}

// ============================================================
// 小工具视图
// ============================================================

/** 卡片内的细分割线（design-system：--line） */
@Component
export struct BwHairline {
  @Prop inset: number = 0;

  build() {
    Divider()
      .strokeWidth(1)
      .color(BWColor.line)
      .margin({ left: this.inset, right: this.inset })
  }
}

/** 圆形 emoji 头像（好友 / 动态 / 圈子） */
@Component
export struct BwAvatar {
  @Prop emoji: string = '🙂';
  @Prop size: number = 40;
  @Prop onlineDot: boolean = false;
  @Prop name: string = '';

  build() {
    Column({ space: 4 }) {
      Stack({ alignContent: Alignment.BottomEnd }) {
        Text(this.emoji)
          .fontSize(this.size * 0.46)
          .textAlign(TextAlign.Center)
          .width(this.size)
          .height(this.size)
          .backgroundColor(BWColor.paper)
          .borderRadius(this.size / 2)
          .border({ width: 1, color: BWColor.line, radius: this.size / 2 })

        if (this.onlineDot) {
          Circle()
            .width(12)
            .height(12)
            .fill(BWColor.teal)
            .stroke(BWColor.cream)
            .strokeWidth(2)
            .offset({ x: 2, y: 1 })
        }
      }

      if (this.name.length > 0) {
        Text(this.name)
          .fontSize(BWFont.microSm)
          .fontColor(BWColor.ink3)
          .maxLines(1)
      }
    }
  }
}
