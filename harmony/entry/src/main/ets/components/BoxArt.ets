/**
 * 步迷 Walkaholic · HarmonyOS ArkUI — 盲盒插画
 *
 * 官方风格：中性容器色 + 单色符号 + 极轻动效。
 * 不用牛皮纸暖色、不用渐变、不用重阴影，保持与系统界面一致。
 */

import { WAColor, WASize } from '../theme/Theme';

@Component
export struct WaBoxArt {
  @Prop artSize: number = 112;
  @Prop glow: boolean = false;
  @State private floating: boolean = false;

  aboutToAppear(): void {
    if (!this.glow) {
      return;
    }
    animateTo({
      duration: 2600,
      curve: Curve.EaseInOut,
      iterations: -1,
      playMode: PlayMode.Alternate
    }, () => {
      this.floating = true;
    });
  }

  build() {
    Stack({ alignContent: Alignment.Center }) {
      // 底层：柔和圆形容器（官方浅色填充，无渐变）
      Circle()
        .width(this.artSize * 0.96)
        .height(this.artSize * 0.96)
        .fill(WAColor.amberSoft)

      // 盒体
      Stack({ alignContent: Alignment.Center }) {
        SymbolGlyph($r('sys.symbol.gift'))
          .fontSize(this.artSize * 0.42)
          .fontColor([WAColor.amber])
          .renderingStrategy(SymbolRenderingStrategy.SINGLE)
      }
      .width(this.artSize * 0.66)
      .height(this.artSize * 0.66)
      .backgroundColor(WAColor.paper)
      .borderRadius(WASize.cardRadius)
      .translate({ y: this.floating ? -2 : 2 })
    }
    .width(this.artSize * 1.04)
    .height(this.artSize * 1.04)
  }
}