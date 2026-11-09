/**
 * 盲走 BlindWalk · HarmonyOS ArkUI — 数据源状态面板
 *
 * parity.md §1 的产品要求：**Key 由后台统一配置，用户不需要也无法填写**。
 * 所以这里只做「状态展示」，不是输入框：
 *   - 高德 / 百度：已由后台配置 / 后台未配置
 *   - OSM / 中文维基：免费、始终可用
 *   - Key 来源：随包内置 / Pages 下发 / 后台接口 / 未配置
 *   - 上次抓取：每个源找到了多少条 / 失败原因
 *
 * 与 Web 版 `#/datasource` 页文案对齐。
 */

import { DataSourceStatus } from '../core/contract';
import { SourceReport } from '../core/http';
import { mapKeysSourceText } from '../core/mapkeys';
import { BWColor, BWFont, BWSize } from '../theme/Theme';
import { BwMicroLabel } from './Common';

@Component
export struct BwDataSourcePanel {
  @Prop status: DataSourceStatus = emptyDataSourceStatus();
  /** 策展数据条数（pois.json；人工审核过的点） */
  @Prop curatedCount: number = 0;
  onBack: () => void = () => {
  };
  onReload: () => void = () => {
  };

  private sourceLines(): string[] {
    const lines: string[] = [];
    const reports: SourceReport[] = this.status.reports;
    for (let i = 0; i < reports.length; i += 1) {
      const report: SourceReport = reports[i];
      const suffix: string = report.ok
        ? '找到 ' + String(report.count) + ' 个'
        : (report.error.length > 0 ? report.error : '没返回结果');
      lines.push(report.label + '：' + suffix);
    }
    return lines;
  }

  @Builder
  statusRow(label: string, value: string, good: boolean) {
    Row({ space: 10 }) {
      Text(label)
        .fontSize(BWFont.caption)
        .fontColor(BWColor.ink3)
      Blank()
      Text(value)
        .fontSize(BWFont.caption)
        .fontColor(good ? BWColor.teal : BWColor.ink2)
        .maxLines(1)
    }
    .width('100%')
    .padding({ top: 9, bottom: 9 })
  }

  build() {
    Column({ space: 0 }) {
      Scroll() {
        Column({ space: 14 }) {
          // ---------- 顶栏 ----------
          Row({ space: 8 }) {
            Text('‹')
              .fontSize(BWFont.titleSm)
              .fontColor(BWColor.ink2)
              .textAlign(TextAlign.Center)
              .width(34)
              .height(34)
              .backgroundColor(BWColor.paper)
              .borderRadius(17)
              .border({ width: 1, color: BWColor.line, radius: 17 })
              .onClick(() => {
                this.onBack();
              })

            Text('数据源')
              .fontSize(BWFont.hero)
              .fontWeight(FontWeight.Bold)
              .fontColor(BWColor.ink)

            Blank()
          }
          .width('100%')
          .padding({ bottom: 4 })

          Text('Key 由后台统一管理，你不需要填写')
            .fontSize(BWFont.caption)
            .fontColor(BWColor.ink3)
            .width('100%')

          // ---------- 各源状态 ----------
          Column({ space: 0 }) {
            this.statusRow('高德地图', this.status.amapReady ? '已由后台配置 ✓' : '后台未配置', this.status.amapReady)
            Divider().strokeWidth(1).color(BWColor.line)
            this.statusRow('百度地图', this.status.baiduReady ? '已由后台配置 ✓' : '后台未配置', this.status.baiduReady)
            Divider().strokeWidth(1).color(BWColor.line)
            this.statusRow('OpenStreetMap', '免费 · 始终可用', true)
            Divider().strokeWidth(1).color(BWColor.line)
            this.statusRow('中文维基百科', '免费 · 带实景照片', true)
            Divider().strokeWidth(1).color(BWColor.line)
            this.statusRow('后台策展地点', this.curatedCount > 0 ? String(this.curatedCount) + ' 个（优先使用）' : '暂无', this.curatedCount > 0)
            Divider().strokeWidth(1).color(BWColor.line)
            this.statusRow('Key 来源', mapKeysSourceText(this.status.keySource), this.status.amapReady || this.status.baiduReady)
          }
          .width('100%')
          .padding({ left: 16, right: 16 })
          .backgroundColor(BWColor.paper)
          .borderRadius(BWSize.cardRadius)
          .border({ width: 1, color: BWColor.line, radius: BWSize.cardRadius })

          // ---------- 上次抓取 ----------
          if (this.sourceLines().length > 0) {
            Column({ space: 6 }) {
              BwMicroLabel({ text: '上次抓取' })
              ForEach(this.sourceLines(), (line: string, index: number) => {
                Text(line)
                  .fontSize(BWFont.captionSm)
                  .fontColor(BWColor.ink3)
                  .width('100%')
                  .lineHeight(19)
              }, (line: string, index: number) => String(index) + line)
            }
            .width('100%')
            .alignItems(HorizontalAlign.Start)
          }

          // ---------- 说明 ----------
          Column({ space: 8 }) {
            Text('地图服务商的 Key 由管理后台统一配置并下发，所有用户共用。')
              .fontSize(BWFont.captionSm)
              .fontColor(BWColor.ink2)
              .width('100%')
              .lineHeight(20)
            Text('只用免费源（OpenStreetMap + 中文维基）也能正常抽到真实地点。')
              .fontSize(BWFont.captionSm)
              .fontColor(BWColor.ink2)
              .width('100%')
              .lineHeight(20)
            Text('需要替换 Key？在后台「地图 Key」页修改，重启 App 后自动生效。')
              .fontSize(BWFont.captionSm)
              .fontColor(BWColor.ink3)
              .width('100%')
              .lineHeight(20)
          }
          .width('100%')
          .alignItems(HorizontalAlign.Start)
          .padding(16)
          .backgroundColor(BWColor.paperHalf)
          .borderRadius(BWSize.cardRadiusSm)
          .border({ width: 1, color: BWColor.line, style: BorderStyle.Dashed, radius: BWSize.cardRadiusSm })

          Button() {
            Text('重新加载 Key')
              .fontSize(BWFont.caption)
              .fontColor(BWColor.ink)
          }
          .type(ButtonType.Capsule)
          .height(44)
          .width('100%')
          .backgroundColor(BWColor.paper2)
          .border({ width: 1, color: BWColor.line, radius: BWSize.chipRadius })
          .onClick(() => {
            this.onReload();
          })
        }
        .width('100%')
        .constraintSize({ maxWidth: BWSize.contentMaxWidth })
        .padding({
          left: BWSize.pagePadding,
          right: BWSize.pagePadding,
          top: 8,
          bottom: 24
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

function emptyDataSourceStatus(): DataSourceStatus {
  const status: DataSourceStatus = {
    keySource: 'none',
    amapReady: false,
    baiduReady: false,
    amapMask: '',
    baiduMask: '',
    reports: [],
    checkedAt: 0,
    curatedCount: 0
  };
  return status;
}