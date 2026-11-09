/**
 * 盲走 BlindWalk · HarmonyOS ArkUI — 牛皮纸盒子线稿插画
 *
 * 首页主卡 / 抽盒 sheet 用。纯 Stack + 形状拼出来，不依赖图片资源。
 * 「?」+ 盒缝暖光 + 轻浮动（2.4s 呼吸，符合 design-system §3）。
 */

import { BWColor } from '../theme/Theme';

@Component
export struct BwBoxArt {
  @Prop size: number = 112;
  @Prop glow: boolean = true;
  @State private floating: boolean = false;

  aboutToAppear(): void {
    animateTo({
      duration: 2400,
      curve: Curve.EaseInOut,
      iterations: -1,
      playMode: PlayMode.Alternate
    }, () => {
      this.floating = true;
    });
  }

  build() {
    Stack({ alignContent: Alignment.Center }) {
      // 暖光
      if (this.glow) {
        Circle()
          .width(this.size * 0.92)
          .height(this.size * 0.92)
          .fill('#33E89B4C')
          .blur(14)
          .rotate({ angle: 0 })
      }

      // 盒盖（微微歪一点）
      Row()
        .width(this.size * 0.72)
        .height(this.size * 0.14)
        .backgroundColor(BWColor.kraftLid)
        .borderRadius(5)
        .border({ width: 1.5, color: BWColor.kraftLine, radius: 5 })
        .rotate({ angle: -1.5 })
        .translate({ y: -this.size * 0.2 + (this.floating ? -2 : 2) })

      // 盒体 + 「?」
      Column() {
        Text('?')
          .fontSize(this.size * 0.24)
          .fontWeight(FontWeight.Bold)
          .fontColor(BWColor.amberDeep)
      }
      .width(this.size * 0.66)
      .height(this.size * 0.46)
      .justifyContent(FlexAlign.Center)
      .backgroundColor(BWColor.kraftBody)
      .borderRadius(8)
      .border({ width: 1.5, color: BWColor.kraftLine, radius: 8 })
      .translate({ y: this.size * 0.1 + (this.floating ? -2 : 2) })

      // 盒缝里的暖光
      Row()
        .width(this.size * 0.56)
        .height(2)
        .backgroundColor(BWColor.kraftAmberLight)
        .borderRadius(1)
        .blur(1.5)
        .translate({ y: this.size * 0.02 })
    }
    .width(this.size * 1.12)
    .height(this.size)
  }
}
