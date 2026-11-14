/**
 * 步迷 Walkaholic · HarmonyOS ArkUI — 共享小组件
 *
 * 严格对齐 HarmonyOS 官方组件规格：
 *   - 按钮：胶囊形，品牌蓝底 + 白字，高 40/48vp
 *   - 卡片：16vp 圆角，白底，无重阴影
 *   - 分隔线：官方 20% 透明度
 *   - 图标：统一 SymbolGlyph 单色（components/WaSymbol.ets）
 *
 * 只依赖 theme/Theme.ets 的 token；不读 store。
 */

import { Rarity } from '../core/types';
import {
  WAColor,
  WAFont,
  WASize,
  rarityBorder,
  rarityColor,
  rarityLabel,
  raritySoft
} from '../theme/Theme';
import { WaIcon, WaSymbols } from './WaSymbol';

// ============================================================
// 微标 / 小标题
// ============================================================

@Component
export struct WaMicroLabel {
  @Prop text: string = '';

  build() {
    Text(this.text)
      .fontSize(WAFont.caption)
      .fontColor(WAColor.ink3)
      .fontWeight(FontWeight.Regular)
  }
}

@Component
export struct WaSectionHead {
  @Prop title: string = '';
  @Prop trailing: string = '';
  onTrailingTap: () => void = () => {
  };

  build() {
    Row({ space: 4 }) {
      Text(this.title)
        .fontSize(WAFont.titleMd)
        .fontWeight(FontWeight.Medium)
        .fontColor(WAColor.ink)

      Blank()

      if (this.trailing.length > 0) {
        Row({ space: 2 }) {
          Text(this.trailing)
            .fontSize(WAFont.bodySm)
            .fontColor(WAColor.ink2)
          SymbolGlyph($r('sys.symbol.chevron_right'))
            .fontSize(12)
            .fontColor([WAColor.ink3])
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
export struct WaPrimaryButton {
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
          .fontSize(WAFont.titleSm)
          .fontWeight(FontWeight.Medium)
          .fontColor(WAColor.iconOnBrand)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })

        if (this.tag.length > 0) {
          Text(this.tag)
            .fontSize(WAFont.micro)
            .fontWeight(FontWeight.Medium)
            .fontColor(WAColor.iconOnBrand)
            .padding({ left: 6, right: 6, top: 1, bottom: 1 })
            .backgroundColor('#33FFFFFF')
            .borderRadius(WASize.chipRadius)
        }
      }
      .justifyContent(FlexAlign.Center)
      .width('100%')
    }
    .type(ButtonType.Capsule)
    .height(this.large ? WASize.buttonHeightLg : WASize.buttonHeight)
    .width('100%')
    .backgroundColor(WAColor.amber)
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
export struct WaQuietButton {
  @Prop title: string = '';
  @Prop bordered: boolean = true;
  @Prop isActive: boolean = true;
  onTap: () => void = () => {
  };

  build() {
    Button() {
      Text(this.title)
        .fontSize(WAFont.bodySm)
        .fontWeight(FontWeight.Medium)
        .fontColor(WAColor.ink2)
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
    }
    .type(ButtonType.Capsule)
    .height(WASize.buttonHeight)
    .width('100%')
    .backgroundColor(this.bordered ? WAColor.paper2 : Color.Transparent)
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
export struct WaPill {
  @Prop text: string = '';
  @Prop selected: boolean = false;
  onTap: () => void = () => {
  };

  build() {
    Button() {
      Text(this.text)
        .fontSize(WAFont.bodySm)
        .fontWeight(this.selected ? FontWeight.Medium : FontWeight.Regular)
        .fontColor(this.selected ? WAColor.amber : WAColor.ink2)
    }
    .type(ButtonType.Capsule)
    .height(32)
    .padding({ left: 14, right: 14 })
    .backgroundColor(this.selected ? WAColor.amberSoft : WAColor.paper2)
    .onClick(() => {
      this.onTap();
    })
  }
}

@Component
export struct WaRarityBadge {
  @Prop rarity: Rarity = Rarity.Common;

  build() {
    Row({ space: 4 }) {
      Circle()
        .width(5)
        .height(5)
        .fill(rarityColor(this.rarity))

      Text(rarityLabel(this.rarity))
        .fontSize(WAFont.micro)
        .fontWeight(FontWeight.Medium)
        .fontColor(rarityColor(this.rarity))
    }
    .padding({ left: 8, right: 8, top: 3, bottom: 3 })
    .backgroundColor(raritySoft(this.rarity))
    .borderRadius(WASize.chipRadius)
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
export struct WaStatsRow {
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
            .color(WAColor.line)
        }

        Column({ space: 2 }) {
          Text(item.value)
            .fontSize(WAFont.title)
            .fontWeight(FontWeight.Medium)
            .fontColor(WAColor.ink)
            .maxLines(1)

          Text(item.label)
            .fontSize(WAFont.caption)
            .fontColor(WAColor.ink3)
            .maxLines(1)
        }
        .layoutWeight(1)
        .alignItems(HorizontalAlign.Center)
      }, (item: StatItem) => item.label)
    }
    .width('100%')
    .padding({ top: 16, bottom: 16 })
    .backgroundColor(WAColor.paper)
    .borderRadius(WASize.cardRadius)
  }
}

@Component
export struct WaProgressBar {
  @Prop progress: number = 0;
  @Prop barColor: string = WAColor.amber;
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
export struct WaToastBar {
  @Prop text: string = '';
  /** 语义图标名，见 WaSymbols */
  @Prop iconName: string = WaSymbols.info;
  @Prop amber: boolean = false;

  build() {
    Row({ space: 8 }) {
      WaIcon({
        name: this.iconName,
        iconSize: WASize.iconSizeSm,
        color: this.amber ? WAColor.amber : WAColor.ink2
      })

      Text(this.text)
        .fontSize(WAFont.bodySm)
        .fontColor(WAColor.ink)
        .maxLines(2)
    }
    .padding({ left: 16, right: 16, top: 10, bottom: 10 })
    .backgroundColor('#F2FFFFFF')
    .borderRadius(WASize.chipRadius)
    .shadow({ radius: 20, color: WAColor.shadow, offsetX: 0, offsetY: 4 })
  }
}

@Component
export struct WaEmptyState {
  @Prop title: string = '';
  @Prop subtitle: string = '';
  @Prop actionText: string = '';
  @Prop iconName: string = WaSymbols.gift;
  onAction: () => void = () => {
  };

  build() {
    Column({ space: 10 }) {
      WaIcon({
        name: this.iconName,
        iconSize: 40,
        color: WAColor.ink4
      })

      Text(this.title)
        .fontSize(WAFont.body)
        .fontWeight(FontWeight.Medium)
        .fontColor(WAColor.ink)

      if (this.subtitle.length > 0) {
        Text(this.subtitle)
          .fontSize(WAFont.bodySm)
          .fontColor(WAColor.ink3)
          .textAlign(TextAlign.Center)
      }

      if (this.actionText.length > 0) {
        Button(this.actionText)
          .type(ButtonType.Capsule)
          .height(WASize.buttonHeight)
          .padding({ left: 24, right: 24 })
          .fontSize(WAFont.bodySm)
          .fontWeight(FontWeight.Medium)
          .fontColor(WAColor.iconOnBrand)
          .backgroundColor(WAColor.amber)
          .margin({ top: 4 })
          .onClick(() => {
            this.onAction();
          })
      }
    }
    .width('100%')
    .padding({ top: 32, bottom: 32, left: 24, right: 24 })
    .backgroundColor(WAColor.paper)
    .borderRadius(WASize.cardRadius)
  }
}

// ============================================================
// 小工具视图
// ============================================================

/** 卡片内的细分割线（官方 divider 20%） */
@Component
export struct WaHairline {
  @Prop inset: number = 0;

  build() {
    Divider()
      .strokeWidth(1)
      .color(WAColor.line)
      .margin({ left: this.inset, right: this.inset })
  }
}

/**
 * 圆形头像 —— 官方风格：中性底 + 单色图标
 * （不用 emoji，保持单色极简）
 */
@Component
export struct WaAvatar {
  @Prop emoji: string = '';
  @Prop iconName: string = WaSymbols.profile;
  @Prop boxSize: number = 40;
  @Prop onlineDot: boolean = false;
  @Prop name: string = '';

  build() {
    Column({ space: 4 }) {
      Stack({ alignContent: Alignment.BottomEnd }) {
        Stack({ alignContent: Alignment.Center }) {
          WaIcon({
            name: this.iconName,
            iconSize: this.boxSize * 0.5,
            color: WAColor.ink2
          })
        }
        .width(this.boxSize)
        .height(this.boxSize)
        .backgroundColor(WAColor.paper2)
        .borderRadius(this.boxSize / 2)

        if (this.onlineDot) {
          Circle()
            .width(10)
            .height(10)
            .fill(WAColor.teal)
            .stroke(WAColor.paper)
            .strokeWidth(2)
            .offset({ x: 1, y: 1 })
        }
      }

      if (this.name.length > 0) {
        Text(this.name)
          .fontSize(WAFont.caption)
          .fontColor(WAColor.ink3)
          .maxLines(1)
      }
    }
  }
}

// ============================================================
// 兼容导出：图标组件统一收口到 WaSymbol.ets
// （旧代码从 './Common' 引入 WaIconButton，这里保持可用）
// ============================================================

export { WaIcon, WaIconButton, WaIconLabel } from './WaSymbol';
