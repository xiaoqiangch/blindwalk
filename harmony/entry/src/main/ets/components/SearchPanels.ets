/**
 * 盲走 BlindWalk · HarmonyOS ArkUI — 找不到真实地点时的**明确失败面板**
 *
 * 规格：docs/parity.md §2 末段。文案与按钮与 Web 逐字一致：
 *   标题「没找到真实地点，这次不抽了」
 *   副文案「不会用虚构地点糊弄你」
 *   + 每个源失败原因
 *   三个按钮：扩大范围再找 / 换个位置 / 改成演示模式（虚构地点）
 *
 * 产品红线：**绝不自动进入虚构地点**。演示模式必须由用户显式点按钮。
 */

import { SourceReport } from '../core/http';
import { searchFailText, sourceReportLines } from '../core/search';
import { BWColor, BWFont, BWSize } from '../theme/Theme';
import { BwPrimaryButton, BwQuietButton } from './Common';

@Component
export struct BwSearchFailedPanel {
  /** 失败原因：no-real-place / network / not-real / no-origin */
  @Prop reason: string = 'no-real-place';
  /** 每个源的回报 */
  @Prop reports: SourceReport[] = [];
  /** 当前是第几档（0/1/2），用于按钮文案 */
  @Prop tier: number = 0;

  onSearchWider: () => void = () => {
  };
  onManualLocation: () => void = () => {
  };
  onStartDemo: () => void = () => {
  };

  private lines(): string[] {
    return sourceReportLines(this.reports);
  }

  build() {
    Column({ space: 10 }) {
      Row({ space: 8 }) {
        Text('🪔')
          .fontSize(BWFont.title)
        Text('没找到真实地点，这次不抽了')
          .fontSize(BWFont.titleSm)
          .fontWeight(FontWeight.Medium)
          .fontColor(BWColor.ink)
          .layoutWeight(1)
      }
      .width('100%')

      Text(searchFailText(this.reason))
        .fontSize(BWFont.caption)
        .fontColor(BWColor.ink2)
        .lineHeight(21)
        .width('100%')

      Text('不会用虚构地点糊弄你。')
        .fontSize(BWFont.caption)
        .fontColor(BWColor.ink3)
        .width('100%')

      // ---------- 每个数据源的具体原因 ----------
      if (this.lines().length > 0) {
        Column({ space: 4 }) {
          ForEach(this.lines(), (line: string, index: number) => {
            Row({ space: 6 }) {
              Text('·')
                .fontSize(BWFont.caption)
                .fontColor(BWColor.ink3)
              Text(line)
                .fontSize(BWFont.captionSm)
                .fontColor(BWColor.ink3)
                .layoutWeight(1)
            }
            .width('100%')
          }, (line: string, index: number) => String(index) + line)
        }
        .width('100%')
        .padding({ top: 2, bottom: 2 })
      }

      // ---------- 三个出口 ----------
      BwPrimaryButton({
        title: this.tier >= 2 ? '还是没找到，再扩大一次' : '扩大范围再找',
        onTap: () => {
          this.onSearchWider();
        }
      })

      Row({ space: 8 }) {
        Button() {
          Text('换个位置')
            .fontSize(BWFont.caption)
            .fontColor(BWColor.ink2)
        }
        .type(ButtonType.Capsule)
        .height(40)
        .layoutWeight(1)
        .backgroundColor(BWColor.paper2)
        .border({ width: 1, color: BWColor.line, radius: BWSize.chipRadius })
        .onClick(() => {
          this.onManualLocation();
        })
      }
      .width('100%')

      // 演示模式：显式选择，且文案明确写了「虚构地点」
      Button() {
        Text('改成演示模式（虚构地点）')
          .fontSize(BWFont.captionSm)
          .fontColor(BWColor.ink3)
          .decoration({ type: TextDecorationType.Underline, color: BWColor.ink3 })
      }
      .type(ButtonType.Capsule)
      .height(34)
      .width('100%')
      .backgroundColor(Color.Transparent)
      .onClick(() => {
        this.onStartDemo();
      })
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
    .padding(16)
    .backgroundColor(BWColor.paper)
    .borderRadius(BWSize.cardRadiusSm)
    .border({ width: 1, color: BWColor.line, radius: BWSize.cardRadiusSm })
  }
}

/**
 * 定位受阻面板（还没走到「搜地点」那一步）
 * 文案与 Web 版 locationBlockedHTML 对齐。
 */
@Component
export struct BwLocationBlockedPanel {
  /** denied / timeout / no-fix */
  @Prop reason: string = 'no-fix';

  onRetryLocation: () => void = () => {
  };
  onManualLocation: () => void = () => {
  };
  onStartDemo: () => void = () => {
  };

  private reasonText(): string {
    if (this.reason === 'denied') return '你把定位权限拒绝了';
    if (this.reason === 'timeout') return '定位超时了（室内 / 地下常见）';
    return '系统没有给出位置';
  }

  build() {
    Column({ space: 10 }) {
      Text('没拿到你的位置，抽不了真实地点')
        .fontSize(BWFont.titleSm)
        .fontWeight(FontWeight.Medium)
        .fontColor(BWColor.ink)
        .width('100%')

      Text(this.reasonText() + '。真实盲盒必须知道你在哪。')
        .fontSize(BWFont.caption)
        .fontColor(BWColor.ink2)
        .lineHeight(21)
        .width('100%')

      BwPrimaryButton({
        title: '再试一次定位',
        onTap: () => {
          this.onRetryLocation();
        }
      })

      Row({ space: 8 }) {
        Button() {
          Text('手动输入位置')
            .fontSize(BWFont.caption)
            .fontColor(BWColor.ink2)
        }
        .type(ButtonType.Capsule)
        .height(40)
        .layoutWeight(1)
        .backgroundColor(BWColor.paper2)
        .border({ width: 1, color: BWColor.line, radius: BWSize.chipRadius })
        .onClick(() => {
          this.onManualLocation();
        })
      }
      .width('100%')

      Button() {
        Text('不定位，先看演示（虚构地点）')
          .fontSize(BWFont.captionSm)
          .fontColor(BWColor.ink3)
          .decoration({ type: TextDecorationType.Underline, color: BWColor.ink3 })
      }
      .type(ButtonType.Capsule)
      .height(34)
      .width('100%')
      .backgroundColor(Color.Transparent)
      .onClick(() => {
        this.onStartDemo();
      })
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
    .padding(16)
    .backgroundColor(BWColor.paper)
    .borderRadius(BWSize.cardRadiusSm)
    .border({ width: 1, color: BWColor.line, radius: BWSize.cardRadiusSm })
  }
}

/** 手动输入位置的小弹层（换一个位置再找） */
@Component
export struct BwManualLocationSheet {
  onCancel: () => void = () => {
  };
  onSubmit: (query: string) => void = () => {
  };

  @State private query: string = '';
  @State private busy: boolean = false;

  build() {
    Column({ space: 12 }) {
      Text('换个位置')
        .fontSize(BWFont.titleMd)
        .fontWeight(FontWeight.Medium)
        .fontColor(BWColor.ink)
        .width('100%')

      Text('输入地址或「纬度,经度」。用真实地点，不用虚构的。')
        .fontSize(BWFont.caption)
        .fontColor(BWColor.ink3)
        .width('100%')

      TextInput({ placeholder: '例如：静安寺 / 31.2304,121.4737', text: this.query })
        .height(44)
        .fontSize(BWFont.caption)
        .backgroundColor(BWColor.paper2)
        .borderRadius(BWSize.cardRadiusXs)
        .border({ width: 1, color: BWColor.line, radius: BWSize.cardRadiusXs })
        .onChange((value: string) => {
          this.query = value;
        })

      Row({ space: 8 }) {
        Button() {
          Text('取消')
            .fontSize(BWFont.caption)
            .fontColor(BWColor.ink2)
        }
        .type(ButtonType.Capsule)
        .height(42)
        .layoutWeight(1)
        .backgroundColor(BWColor.paper2)
        .border({ width: 1, color: BWColor.line, radius: BWSize.chipRadius })
        .enabled(!this.busy)
        .onClick(() => {
          this.onCancel();
        })

        Button() {
          Text(this.busy ? '查找中…' : '用这个位置')
            .fontSize(BWFont.caption)
            .fontColor(BWColor.ink)
        }
        .type(ButtonType.Capsule)
        .height(42)
        .layoutWeight(1)
        .backgroundColor(BWColor.amber)
        .enabled(!this.busy)
        .opacity(this.busy ? 0.6 : 1)
        .onClick(() => {
          if (this.busy) return;
          const trimmed: string = this.query.trim();
          if (trimmed.length === 0) return;
          this.busy = true;
          this.onSubmit(trimmed);
        })
      }
      .width('100%')
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
    .padding(20)
    .backgroundColor(BWColor.paper)
    .borderRadius(BWSize.cardRadius)
    .border({ width: 1, color: BWColor.line, radius: BWSize.cardRadius })
    .shadow({ radius: 24, color: BWColor.shadowLift, offsetX: 0, offsetY: 16 })
  }
}