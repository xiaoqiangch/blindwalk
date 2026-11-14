/**
 * 步迷 Walkaholic · HarmonyOS ArkUI — 埋惊喜面板
 *
 * 对齐 apple/App/Views/BurySurpriseView.swift（三端同一套语义）：
 *   选照片 → 写一句话 → 可选提示 → 确认位置 → 埋下 → 完成态
 *
 * ## 产品红线
 * - 照片**只留在本机沙箱**，不上传任何服务器；
 * - 提示里不能出现地名（否则等于剧透）；
 * - 位置必须真实（埋点误差直接影响别人能否找到），拿不到就明确说，不静默降级；
 * - 埋下成功才 +30 XP，失败不动分数。
 */

import { common } from '@kit.AbilityKit';
import { BuriedSurprise, GeoPoint } from '../core/types';
import { getStore } from '../core/store';
import { WAColor, WAFont, WASize } from '../theme/Theme';
import { WaIconButton, WaMicroLabel, WaPrimaryButton, WaQuietButton } from './Common';
import { PickedPhoto, adoptPhoto, pickPhotoFromAlbum } from './PhotoPick';
import { getCurrentLocationOnce, requestLocationPermission } from './Location';

const MESSAGE_LIMIT: number = 60;
const HINT_LIMIT: number = 40;

@Component
export struct BurySurprisePanel {
  @Prop winWidth: number = 400;
  @Prop winHeight: number = 800;

  onClose: () => void = () => {
  };
  /** 埋下成功后回调（Index 用来刷新） */
  onBuried: (surpriseID: string) => void = () => {
  };
  onChanged: () => void = () => {
  };

  /** compose / done */
  @State private stage: string = 'compose';
  @State private picked: PickedPhoto | undefined = undefined;
  @State private message: string = '';
  @State private hint: string = '';
  @State private busy: boolean = false;
  @State private errorText: string = '';

  /** 当前确认的埋点坐标 */
  @State private point: GeoPoint | undefined = undefined;
  /** 是否用了 store 里的旧位置（非实时） */
  @State private staleLocation: boolean = false;
  @State private locating: boolean = false;

  /** 埋下结果 */
  @State private buriedID: string = '';
  @State private buriedArea: string = '';

  aboutToAppear(): void {
    this.locate();
  }

  // ============================================================
  // 位置
  // ============================================================

  /** 埋点必须准：优先现取一次；取不到才退回 store 里的点，并明确标注 */
  private async locate(): Promise<void> {
    if (this.locating) return;
    this.locating = true;
    let fix: GeoPoint | undefined = undefined;
    try {
      const context: common.UIAbilityContext = getContext(this) as common.UIAbilityContext;
      const granted: boolean = await requestLocationPermission(context);
      if (granted) {
        fix = await getCurrentLocationOnce(8000);
      }
    } catch (err) {
      fix = undefined;
    }
    if (fix !== undefined) {
      this.point = fix;
      this.staleLocation = false;
      this.locating = false;
      return;
    }
    // 退化到上次已知位置
    try {
      const snapshot = getStore().snapshot();
      const origin: GeoPoint | undefined = snapshot.lastKnownOrigin;
      if (origin !== undefined) {
        this.point = origin;
        this.staleLocation = true;
      }
    } catch (err) {
      this.point = undefined;
    }
    this.locating = false;
  }

  /** 坐标展示（5 位小数足够，不泄露更多精度） */
  private coordinateText(): string {
    if (this.point === undefined) {
      return '拿不到位置';
    }
    return this.point.latitude.toFixed(5) + ', ' + this.point.longitude.toFixed(5);
  }

  /** 区域词：从坐标推算（不暴露具体地点名） */
  private areaLabel(): string {
    if (this.point === undefined) {
      return '位置未知';
    }
    return '这附近';
  }

  // ============================================================
  // 照片
  // ============================================================

  private async choosePhoto(): Promise<void> {
    if (this.busy) return;
    this.errorText = '';
    const mediaUri: string | undefined = await pickPhotoFromAlbum();
    if (mediaUri === undefined) {
      return;
    }
    this.busy = true;
    let adopted: PickedPhoto | undefined = undefined;
    try {
      const context: common.UIAbilityContext = getContext(this) as common.UIAbilityContext;
      adopted = await adoptPhoto(context, mediaUri);
    } catch (err) {
      adopted = undefined;
    }
    this.busy = false;
    if (adopted === undefined) {
      this.errorText = '这张照片读不出来，换一张试试。';
      return;
    }
    this.picked = adopted;
  }

  // ============================================================
  // 埋下
  // ============================================================

  private canBury(): boolean {
    return this.picked !== undefined && this.point !== undefined && !this.busy;
  }

  private ctaTitle(): string {
    if (this.picked === undefined) {
      return '还差一张照片';
    }
    if (this.point === undefined) {
      return '等定位好';
    }
    return '埋在这里';
  }

  private bury(): void {
    if (!this.canBury()) return;
    const picked: PickedPhoto = this.picked as PickedPhoto;
    const point: GeoPoint = this.point as GeoPoint;

    let buried: BuriedSurprise | undefined = undefined;
    try {
      const snapshot = getStore().snapshot();
      const hints: string[] = this.hint.length > 0 ? [this.hint] : [];
      buried = getStore().burySurprise({
        authorName: snapshot.profile.name,
        authorEmoji: snapshot.profile.avatarEmoji,
        location: point,
        areaWord: this.areaLabel(),
        hints: hints,
        photoHash: picked.hash,
        photoUri: picked.uri,
        message: this.message,
        radiusMeters: 60
      });
    } catch (err) {
      buried = undefined;
    }

    if (buried === undefined) {
      this.errorText = '埋下没成功，再试一次。';
      return;
    }
    this.buriedID = buried.id;
    this.buriedArea = buried.areaWord;
    this.stage = 'done';
    this.onChanged();
    this.onBuried(buried.id);
  }


  private resetForAnother(): void {
    this.stage = 'compose';
    this.picked = undefined;
    this.message = '';
    this.hint = '';
    this.buriedID = '';
    this.buriedArea = '';
    this.errorText = '';
    this.locate();
  }

  // ============================================================
  // 界面
  // ============================================================

  @Builder
  header() {
    Row() {
      Column({ space: 3 }) {
        WaMicroLabel({ text: '埋惊喜' })
        Text(this.stage === 'done' ? '已埋下' : '埋下一张照片')
          .fontSize(WAFont.hero)
          .fontWeight(FontWeight.Bold)
          .fontColor(WAColor.ink)
      }
      .alignItems(HorizontalAlign.Start)
      .layoutWeight(1)

      WaIconButton({
        name: 'xmark',
        iconSize: WASize.iconSizeSm,
        color: WAColor.ink2,
        filled: true,
        onTap: () => {
          this.onClose();
        }
      })
    }
    .width('100%')
    .alignItems(VerticalAlign.Center)
  }

  build() {
    Stack({ alignContent: Alignment.TopStart }) {
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor(WAColor.cream)

      if (this.stage === 'done') {
        this.doneStage()
      } else {
        this.composeStage()
      }
    }
    .width('100%')
    .height('100%')
  }

  // ============================================================
  // 编写阶段
  // ============================================================

  @Builder
  composeStage() {
    Column({ space: 0 }) {
      Scroll() {
        Column({ space: 0 }) {
          this.header()

          Text('它留在这里，等一个人来找到。')
            .fontSize(WAFont.bodySm)
            .fontColor(WAColor.ink2)
            .width('100%')
            .margin({ top: 6 })

          Column() {
            this.photoSection()
          }
          .margin({ top: 18 })

          Column() {
            this.messageSection()
          }
          .margin({ top: 20 })

          Column() {
            this.hintSection()
          }
          .margin({ top: 16 })

          Column() {
            this.locationSection()
          }
          .margin({ top: 20 })

          Text('照片只留在你自己的手机里，不上传。')
            .fontSize(WAFont.caption)
            .fontColor(WAColor.ink3)
            .width('100%')
            .textAlign(TextAlign.Center)
            .margin({ top: 16, bottom: 12 })
        }
        .width('100%')
        .constraintSize({ maxWidth: WASize.contentMaxWidth })
        .padding({
          left: WASize.pagePadding,
          right: WASize.pagePadding,
          top: 8
        })
      }
      .layoutWeight(1)
      .scrollBar(BarState.Off)
      .edgeEffect(EdgeEffect.Spring)

      this.bottomBar()
    }
    .width('100%')
    .height('100%')
  }

  // ---- 照片 ----

  @Builder
  photoSection() {
    if (this.picked !== undefined) {
      Column({ space: 10 }) {
        Image((this.picked as PickedPhoto).uri)
          .width('100%')
          .height(200)
          .objectFit(ImageFit.Cover)
          .borderRadius(WASize.cardRadiusSm)

        Row({ space: 8 }) {
          Text('已选好一张')
            .fontSize(WAFont.captionSm)
            .fontColor(WAColor.ink3)
          Blank()
          WaQuietButton({
            title: '换一张',
            bordered: true,
            onTap: () => {
              this.choosePhoto();
            }
          })
        }
        .width('100%')
      }
      .width('100%')
      .padding(12)
      .backgroundColor(WAColor.paper)
      .borderRadius(WASize.cardRadius)
      .border({ width: 1, color: WAColor.line, radius: WASize.cardRadius })
    } else {
      Column({ space: 10 }) {
        SymbolGlyph($r('sys.symbol.bag_fill'))
          .fontSize(34)
          .fontColor([WAColor.ink4])
          .renderingStrategy(SymbolRenderingStrategy.SINGLE)

        Text('先选一张。你觉得好的那一张。')
          .fontSize(WAFont.bodySm)
          .fontColor(WAColor.ink2)
          .textAlign(TextAlign.Center)

        Button() {
          Row({ space: 6 }) {
            SymbolGlyph($r('sys.symbol.bag_fill'))
              .fontSize(WAFont.bodySm)
              .fontColor([WAColor.iconOnBrand])
              .renderingStrategy(SymbolRenderingStrategy.SINGLE)
            Text(this.busy ? '正在读取…' : '从相册选')
              .fontSize(WAFont.bodySm)
              .fontWeight(FontWeight.Medium)
              .fontColor(WAColor.iconOnBrand)
          }
        }
        .type(ButtonType.Capsule)
        .height(WASize.buttonHeight)
        .padding({ left: 22, right: 22 })
        .backgroundColor(WAColor.amber)
        .enabled(!this.busy)
        .opacity(this.busy ? 0.5 : 1)
        .onClick(() => {
          this.choosePhoto();
        })
      }
      .width('100%')
      .padding({ top: 26, bottom: 26, left: 16, right: 16 })
      .backgroundColor(WAColor.paper)
      .borderRadius(WASize.cardRadius)
      .border({
        width: 1,
        color: WAColor.line,
        radius: WASize.cardRadius,
        style: BorderStyle.Dashed
      })
    }
  }

  // ---- 一句话 ----

  @Builder
  messageSection() {
    Column({ space: 8 }) {
      Row() {
        WaMicroLabel({ text: '写一句话：为什么埋在这里' })
        Blank()
        Text(String(this.message.length) + '/' + String(MESSAGE_LIMIT))
          .fontSize(WAFont.micro)
          .fontColor(this.message.length >= MESSAGE_LIMIT ? WAColor.gold : WAColor.ink3)
      }
      .width('100%')

      TextArea({ placeholder: '比如：这张是我在等一杯咖啡时拍的。', text: this.message })
        .fontSize(WAFont.bodySm)
        .fontColor(WAColor.ink)
        .placeholderColor(WAColor.ink3)
        .height(84)
        .width('100%')
        .backgroundColor(WAColor.paper2)
        .borderRadius(WASize.cardRadiusSm)
        .onChange((value: string) => {
          this.message = value.length > MESSAGE_LIMIT
            ? value.slice(0, MESSAGE_LIMIT)
            : value;
        })

      Text('别写地方名。让 TA 自己找。')
        .fontSize(WAFont.caption)
        .fontColor(WAColor.ink3)
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
  }

  // ---- 提示 ----

  @Builder
  hintSection() {
    Column({ space: 8 }) {
      Row() {
        WaMicroLabel({ text: '（可选）给找它的人一句提示' })
        Blank()
        Text(String(this.hint.length) + '/' + String(HINT_LIMIT))
          .fontSize(WAFont.micro)
          .fontColor(this.hint.length >= HINT_LIMIT ? WAColor.gold : WAColor.ink3)
      }
      .width('100%')

      TextArea({ placeholder: '不能直接说答案哦。', text: this.hint })
        .fontSize(WAFont.bodySm)
        .fontColor(WAColor.ink)
        .placeholderColor(WAColor.ink3)
        .height(64)
        .width('100%')
        .backgroundColor(WAColor.paper2)
        .borderRadius(WASize.cardRadiusSm)
        .onChange((value: string) => {
          this.hint = value.length > HINT_LIMIT ? value.slice(0, HINT_LIMIT) : value;
        })
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
  }

  // ---- 位置 ----

  @Builder
  locationSection() {
    Column({ space: 9 }) {
      Row({ space: 6 }) {
        Text('埋在这里')
          .fontSize(WAFont.micro)
          .fontColor(WAColor.ink3)
        Blank()
        if (this.locating) {
          Text('定位中…')
            .fontSize(WAFont.micro)
            .fontColor(WAColor.ink3)
        } else if (this.staleLocation) {
          Text('上次位置')
            .fontSize(WAFont.micro)
            .fontColor(WAColor.gold)
        } else if (this.point !== undefined) {
          Text('实时定位')
            .fontSize(WAFont.micro)
            .fontColor(WAColor.teal)
        }
      }
      .width('100%')

      Row({ space: 10 }) {
        SymbolGlyph($r('sys.symbol.pin'))
          .fontSize(WASize.iconSizeSm)
          .fontColor([this.staleLocation ? WAColor.gold : WAColor.amber])
          .renderingStrategy(SymbolRenderingStrategy.SINGLE)

        Column({ space: 2 }) {
          Text(this.areaLabel())
            .fontSize(WAFont.bodySm)
            .fontColor(WAColor.ink)
          Text(this.coordinateText())
            .fontSize(WAFont.micro)
            .fontColor(WAColor.ink3)
        }
        .alignItems(HorizontalAlign.Start)
        .layoutWeight(1)

        if (this.staleLocation || this.point === undefined) {
          Button('重试定位')
            .type(ButtonType.Capsule)
            .height(30)
            .padding({ left: 12, right: 12 })
            .fontSize(WAFont.micro)
            .fontColor(WAColor.ink2)
            .backgroundColor(WAColor.paper2)
            .onClick(() => {
              this.locate();
            })
        }
      }
      .width('100%')

      if (this.errorText.length > 0) {
        Text(this.errorText)
          .fontSize(WAFont.caption)
          .fontColor(WAColor.ember)
          .width('100%')
      }
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
    .padding(14)
    .backgroundColor(WAColor.paper)
    .borderRadius(WASize.cardRadius)
    .border({
      width: 1,
      color: this.staleLocation ? WAColor.gold : WAColor.line,
      radius: WASize.cardRadius
    })
  }

  // ---- 底部 CTA ----

  @Builder
  bottomBar() {
    Column({ space: 6 }) {
      WaPrimaryButton({
        title: this.ctaTitle(),
        large: true,
        isActive: this.canBury(),
        onTap: () => {
          this.bury();
        }
      })

      Text('埋下后，它会一直留在这个位置，等一个人来。')
        .fontSize(WAFont.micro)
        .fontColor(WAColor.ink3)
    }
    .width('100%')
    .padding({
      left: WASize.pagePadding,
      right: WASize.pagePadding,
      top: 12,
      bottom: 16
    })
    .backgroundColor(WAColor.cream)
    .border({ width: { top: 1 }, color: WAColor.line })
  }

  // ============================================================
  // 完成态
  // ============================================================

  @Builder
  doneStage() {
    Column({ space: 0 }) {
      Scroll() {
        Column({ space: 16 }) {
          this.header()

          Column({ space: 10 }) {
            Stack({ alignContent: Alignment.Center }) {
              Circle()
                .width(120)
                .height(120)
                .fill(WAColor.amberSoft)

              SymbolGlyph($r('sys.symbol.checkmark_circle'))
                .fontSize(52)
                .fontColor([WAColor.amber])
                .renderingStrategy(SymbolRenderingStrategy.SINGLE)
            }

            Text('已埋下。')
              .fontSize(26)
              .fontWeight(FontWeight.Bold)
              .fontColor(WAColor.ink)

            Text(this.buriedArea + ' · 等一个人来找到。')
              .fontSize(WAFont.bodySm)
              .fontColor(WAColor.ink2)
              .textAlign(TextAlign.Center)

            if (this.message.length > 0) {
              Text(this.message)
                .fontSize(WAFont.caption)
                .fontColor(WAColor.ink3)
                .textAlign(TextAlign.Center)
                .maxLines(2)
                .textOverflow({ overflow: TextOverflow.Ellipsis })
            }

            Text('+30 惊喜值')
              .fontSize(WAFont.caption)
              .fontColor(WAColor.amber)
              .margin({ top: 2 })
          }
          .width('100%')
          .alignItems(HorizontalAlign.Center)
          .padding({ top: 30, bottom: 20 })
        }
        .width('100%')
        .constraintSize({ maxWidth: WASize.contentMaxWidth })
        .padding({ left: WASize.pagePadding, right: WASize.pagePadding, top: 8 })
      }
      .layoutWeight(1)
      .scrollBar(BarState.Off)

      Column({ space: 8 }) {
        WaPrimaryButton({
          title: '去寻宝看看',
          large: true,
          onTap: () => {
            this.onClose();
          }
        })

        WaQuietButton({
          title: '再埋一个',
          onTap: () => {
            this.resetForAnother();
          }
        })
      }
      .width('100%')
      .padding({
        left: WASize.pagePadding,
        right: WASize.pagePadding,
        top: 12,
        bottom: 16
      })
    }
    .width('100%')
    .height('100%')
  }
}
