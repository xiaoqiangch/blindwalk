/**
 * 盲走 BlindWalk · HarmonyOS ArkUI — 共享小组件
 *
 * 严格对齐 HarmonyOS 官方组件规格：
 *   - 按钮：胶囊形，品牌蓝底 + 白字，高 40/48vp
 *   - 卡片：16vp 圆角，白底，无重阴影
 *   - 分隔线：官方 20% 透明度
 *   - 图标：统一 SymbolGlyph 单色（components/BwSymbol.ets）
 *
 * 只依赖 theme/Theme.ets 的 token；不读 store。
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
import { BwIcon, BwSymbols } from './BwSymbol';

// ============================================================
// 微标 / 小标题
// ============================================================

@Component
export struct BwMicroLabel {
  @Prop text: string = '';

  build() {
    Text(this.text)
      .fontSize(BWFont.caption)
      .fontColor(BWColor.ink3)
      .fontWeight(FontWeight.Regular)
  }
}

@Component
export struct BwSectionHead {
  @Prop title: string = '';
  @Prop trailing: string = '';
  onTrailingTap: () => void = () => {
  };

  build() {
    Row({ space: 4 }) {
      Text(this.title)
        .fontSize(BWFont.titleMd)
        .fontWeight(FontWeight.Medium)
        .fontColor(BWColor.ink)

      Blank()

      if (this.trailing.length > 0) {
        Row({ space: 2 }) {
          Text(this.trailing)
            .fontSize(BWFont.bodySm)
            .fontColor(BWColor.ink2)
          SymbolGlyph($r('sys.symbol.chevron_right'))
            .fontSize(12)
            .fontColor([BWColor.ink3])
            .renderingStrategy(SymbolRenderingStrategy.SINGLE)
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
// 按钮（官方规格）
// ============================================================

@Component
export struct BwPrimaryButton {
  @Prop title: string = '';
  /** 按钮内小标签，例如「演示」「兜底」；空字符串不显示 */
  @Prop tag: string = '';
  @Prop isActive: boolean = true;
  @Prop large: boolean = false;
  onTap: () => void = () => {
  };

  build() {
    Button() {
      Row({ space: 6 }) {
        Text(this.title)
          .fontSize(BWFont.titleSm)
          .fontWeight(FontWeight.Medium)
          .fontColor(BWColor.iconOnBrand)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })

        if (this.tag.length > 0) {
          Text(this.tag)
            .fontSize(BWFont.micro)
            .fontWeight(FontWeight.Medium)
            .fontColor(BWColor.iconOnBrand)
            .padding({ left: 6, right: 6, top: 1, bottom: 1 })
            .backgroundColor('#33FFFFFF')
            .borderRadius(BWSize.chipRadius)
        }
      }
      .justifyContent(FlexAlign.Center)
      .width('100%')
    }
    .type(ButtonType.Capsule)
    .height(this.large ? BWSize.buttonHeightLg : BWSize.buttonHeight)
    .width('100%')
    .backgroundColor(BWColor.amber)
    .enabled(this.isActive)
    .opacity(this.isActive ? 1 : 0.4)
    .onClick(() => {
      if (this.isActive) {
        this.onTap();
      }
    })
  }
}

@Component
export struct BwQuietButton {
  @Prop title: string = '';
  @Prop bordered: boolean = true;
  @Prop isActive: boolean = true;
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
    .height(BWSize.buttonHeight)
    .width('100%')
    .backgroundColor(this.bordered ? BWColor.paper2 : Color.Transparent)
    .enabled(this.isActive)
    .opacity(this.isActive ? 1 : 0.4)
    .onClick(() => {
      if (this.isActive) {
        this.onTap();
      }
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
        .fontSize(BWFont.bodySm)
        .fontWeight(this.selected ? FontWeight.Medium : FontWeight.Regular)
        .fontColor(this.selected ? BWColor.amber : BWColor.ink2)
    }
    .type(ButtonType.Capsule)
    .height(32)
    .padding({ left: 14, right: 14 })
    .backgroundColor(this.selected ? BWColor.amberSoft : BWColor.paper2)
    .onClick(() => {
      this.onTap();
    })
  }
}

@Component
export struct BwRarityBadge {
  @Prop rarity: Rarity = Rarity.Common;

  build() {
    Row({ space: 4 }) {
      Circle()
        .width(5)
        .height(5)
        .fill(rarityColor(this.rarity))

      Text(rarityLabel(this.rarity))
        .fontSize(BWFont.micro)
        .fontWeight(FontWeight.Medium)
        .fontColor(rarityColor(this.rarity))
    }
    .padding({ left: 8, right: 8, top: 3, bottom: 3 })
    .backgroundColor(raritySoft(this.rarity))
    .borderRadius(BWSize.chipRadius)
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
            .height(this.roomy ? 28 : 24)
            .strokeWidth(1)
            .color(BWColor.line)
        }

        Column({ space: 2 }) {
          Text(item.value)
            .fontSize(BWFont.title)
            .fontWeight(FontWeight.Medium)
            .fontColor(BWColor.ink)
            .maxLines(1)

          Text(item.label)
            .fontSize(BWFont.caption)
            .fontColor(BWColor.ink3)
            .maxLines(1)
        }
        .layoutWeight(1)
        .alignItems(HorizontalAlign.Center)
      }, (item: StatItem) => item.label)
    }
    .width('100%')
    .padding({ top: 16, bottom: 16 })
    .backgroundColor(BWColor.paper)
    .borderRadius(BWSize.cardRadius)
  }
}

@Component
export struct BwProgressBar {
  @Prop progress: number = 0;
  @Prop barColor: string = BWColor.amber;
  @Prop trackColor: string = '#1A182431';
  @Prop barHeight: number = 4;

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
  /** 语义图标名，见 BwSymbols */
  @Prop iconName: string = BwSymbols.info;
  @Prop amber: boolean = false;

  build() {
    Row({ space: 8 }) {
      BwIcon({
        name: this.iconName,
        iconSize: BWSize.iconSizeSm,
        color: this.amber ? BWColor.amber : BWColor.ink2
      })

      Text(this.text)
        .fontSize(BWFont.bodySm)
        .fontColor(BWColor.ink)
        .maxLines(2)
    }
    .padding({ left: 16, right: 16, top: 10, bottom: 10 })
    .backgroundColor('#F2FFFFFF')
    .borderRadius(BWSize.chipRadius)
    .shadow({ radius: 20, color: BWColor.shadow, offsetX: 0, offsetY: 4 })
  }
}

@Component
export struct BwEmptyState {
  @Prop title: string = '';
  @Prop subtitle: string = '';
  @Prop actionText: string = '';
  @Prop iconName: string = BwSymbols.gift;
  onAction: () => void = () => {
  };

  build() {
    Column({ space: 10 }) {
      BwIcon({
        name: this.iconName,
        iconSize: 40,
        color: BWColor.ink4
      })

      Text(this.title)
        .fontSize(BWFont.body)
        .fontWeight(FontWeight.Medium)
        .fontColor(BWColor.ink)

      if (this.subtitle.length > 0) {
        Text(this.subtitle)
          .fontSize(BWFont.bodySm)
          .fontColor(BWColor.ink3)
          .textAlign(TextAlign.Center)
      }

      if (this.actionText.length > 0) {
        Button(this.actionText)
          .type(ButtonType.Capsule)
          .height(BWSize.buttonHeight)
          .padding({ left: 24, right: 24 })
          .fontSize(BWFont.bodySm)
          .fontWeight(FontWeight.Medium)
          .fontColor(BWColor.iconOnBrand)
          .backgroundColor(BWColor.amber)
          .margin({ top: 4 })
          .onClick(() => {
            this.onAction();
          })
      }
    }
    .width('100%')
    .padding({ top: 32, bottom: 32, left: 24, right: 24 })
    .backgroundColor(BWColor.paper)
    .borderRadius(BWSize.cardRadius)
  }
}

// ============================================================
// 小工具视图
// ============================================================

/** 卡片内的细分割线（官方 divider 20%） */
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

/**
 * 圆形头像 —— 官方风格：中性底 + 单色图标
 * （不用 emoji，保持单色极简）
 */
@Component
export struct BwAvatar {
  @Prop emoji: string = '';
  @Prop iconName: string = BwSymbols.profile;
  @Prop boxSize: number = 40;
  @Prop onlineDot: boolean = false;
  @Prop name: string = '';

  build() {
    Column({ space: 4 }) {
      Stack({ alignContent: Alignment.BottomEnd }) {
        Stack({ alignContent: Alignment.Center }) {
          BwIcon({
            name: this.iconName,
            iconSize: this.boxSize * 0.5,
            color: BWColor.ink2
          })
        }
        .width(this.boxSize)
        .height(this.boxSize)
        .backgroundColor(BWColor.paper2)
        .borderRadius(this.boxSize / 2)

        if (this.onlineDot) {
          Circle()
            .width(10)
            .height(10)
            .fill(BWColor.teal)
            .stroke(BWColor.paper)
            .strokeWidth(2)
            .offset({ x: 1, y: 1 })
        }
      }

      if (this.name.length > 0) {
        Text(this.name)
          .fontSize(BWFont.caption)
          .fontColor(BWColor.ink3)
          .maxLines(1)
      }
    }
  }
}

// ============================================================
// 兼容导出：图标组件统一收口到 BwSymbol.ets
// （旧代码从 './Common' 引入 BwIconButton，这里保持可用）
// ============================================================

export { BwIcon, BwIconButton, BwIconLabel } from './BwSymbol';
