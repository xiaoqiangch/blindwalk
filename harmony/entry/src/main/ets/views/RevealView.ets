/**
 * 步迷 Walkaholic · HarmonyOS ArkUI — 揭晓 Reveal（design-system §5.4）
 *
 * 视觉基准：prototype/web/app.js revealOpenHTML / revealCardHTML + screenshots/showcase.png
 * 两段：
 * 1. 开盒（1.2s，深色 ink 舞台：盒子抖动 → 盒盖弹飞 + 暖光 + 纸屑）→「这次，城市选了这个地方。」
 * 2. 卡片（稀有度 + 编号 + 类别 emoji + 地点名 + 区域/类别/地址 + 为什么是这里 + 小任务 + 收进图鉴/分享）
 *
 * 保密：只有本页（到达后）才展示 currentPlace.name / address / category。
 */

import { common } from '@kit.AbilityKit';
import { getStore } from '../core/store';
import { AppSnapshot, CollectResult, KeyValueStore } from '../core/contract';
import { Achievement, FeedPost, Place } from '../core/types';
import { HttpClient } from '../core/http';
import { AccountConfig, isLoggedIn, readAccountConfig } from '../core/account';
import { uploadCheckInPhoto } from '../core/surpriseRemote';
import { PickedPhoto, photoDataURL, pickAndAdoptPhoto, takeAndAdoptPhoto } from '../components/PhotoPick';
import {
  WaHairline,
  WaMicroLabel,
  WaRarityBadge,
  WaToastBar
} from '../components/Common';
import { emptyPlace, emptySnapshot, readSnapshot } from '../components/StoreBridge';
import {
  WAColor,
  WAFont,
  WASize,
  areaWord
} from '../theme/Theme';
import { clockHHMM } from '../components/Format';
import { categorySymbol } from '../components/WaSymbol';

const PARTICLE_INDEXES: number[] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

@Component
export struct RevealView {
  @Prop winWidth: number = 400;
  @Prop winHeight: number = 800;

  /** 收录完成 → 回图鉴（Index 切 tab） */
  onGoCards: () => void = () => {
  };
  onChanged: () => void = () => {
  };

  @State private snapshot: AppSnapshot = emptySnapshot();
  @State private showCard: boolean = false;
  @State private boxShake: number = 0;
  @State private lidUp: boolean = false;
  @State private lightOn: boolean = false;
  @State private particlesOut: boolean = false;
  @State private particlesFade: boolean = false;
  @State private hasCollected: boolean = false;
  @State private hasShared: boolean = false;
  @State private collecting: boolean = false;
  @State private taskDone: boolean = false;
  @State private toastText: string = '';
  @State private toastIcon: string = 'star_fill';
  @State private achievementText: string = '';

  /** 平台能力（拍到 / 选到的照片要落本机并尽力上传账号） */
  http: HttpClient | undefined = undefined;
  kv: KeyValueStore | undefined = undefined;

  /** 到达实拍：本地优先（离线也有），登录后上传账号（按地点存、可重拍覆盖） */
  @State private checkInUri: string = '';
  @State private checkInRemotePath: string = '';
  @State private uploadingPhoto: boolean = false;

  private stageTimers: number[] = [];
  private toastTimer: number = -1;

  aboutToAppear(): void {
    this.load();
    this.playOpening();
  }

  aboutToDisappear(): void {
    for (let i = 0; i < this.stageTimers.length; i++) {
      clearTimeout(this.stageTimers[i]);
    }
    this.stageTimers = [];
    if (this.toastTimer >= 0) {
      clearTimeout(this.toastTimer);
      this.toastTimer = -1;
    }
  }

  private load(): void {
    this.snapshot = readSnapshot(this.snapshot);
    this.loadExistingCheckInPhoto();
  }

  // ============================================================
  // 到达实拍
  // ============================================================

  private currentPlaceID(): string {
    const place: Place | undefined = this.snapshot.currentPlace;
    return place === undefined ? '' : place.id;
  }

  /** 已经有照片（本机或账号）就显示出来 */
  private loadExistingCheckInPhoto(): void {
    const placeID: string = this.currentPlaceID();
    if (placeID.length === 0 || this.checkInUri.length > 0) return;
    try {
      const photo = getStore().cardPhoto(placeID);
      if (photo === undefined) return;
      if (photo.local !== undefined && photo.local.length > 0) this.checkInUri = photo.local;
      if (photo.remote !== undefined) this.checkInRemotePath = photo.remote;
    } catch (err) {
      // 没有照片就是没有
    }
  }

  private uploadStatusText(): string {
    if (this.uploadingPhoto) return '上传中…';
    if (this.checkInRemotePath.length > 0) return '已上传 · 换机可找回';
    if (this.kv === undefined) return '仅存本机';
    const config: AccountConfig = readAccountConfig(this.kv);
    return isLoggedIn(config) ? '仅存本机（稍后可再上传）' : '仅存本机 · 登录后可同步';
  }

  /** 拍一张 / 换一张：先落本机（离线也有），再尽力上传账号 */
  private async capturePhoto(fromCamera: boolean): Promise<void> {
    if (this.uploadingPhoto) return;
    const context: common.UIAbilityContext = getContext() as common.UIAbilityContext;
    let picked: PickedPhoto | undefined = undefined;
    try {
      picked = fromCamera ? await takeAndAdoptPhoto(context) : await pickAndAdoptPhoto(context);
    } catch (err) {
      picked = undefined;
    }
    if (picked === undefined) return;

    this.checkInUri = picked.uri;
    this.checkInRemotePath = '';
    const placeID: string = this.currentPlaceID();
    if (placeID.length > 0) {
      try {
        getStore().attachCardPhoto(placeID, picked.uri);
      } catch (err) {
        // 卡片还没收录时挂不上，等收录后再补
      }
    }
    this.onChanged();
    this.uploadCheckInPhotoIfPossible(picked.uri, placeID);
  }

  private async uploadCheckInPhotoIfPossible(uri: string, placeID: string): Promise<void> {
    if (this.http === undefined || this.kv === undefined || placeID.length === 0) return;
    const config: AccountConfig = readAccountConfig(this.kv);
    if (!isLoggedIn(config)) return;
    const dataUrl: string = photoDataURL(uri);
    if (dataUrl.length === 0) return;
    this.uploadingPhoto = true;
    const path: string | undefined = await uploadCheckInPhoto(
      this.http, config, this.kv, placeID, dataUrl
    );
    this.uploadingPhoto = false;
    if (path === undefined) {
      this.showToast('照片已存本机，上传失败（网络或登录状态）', 'info_circle');
      return;
    }
    this.checkInRemotePath = path;
    try {
      getStore().attachCardPhoto(placeID, uri, path);
    } catch (err) {
      // 同上
    }
    this.showToast('照片已上传到账号', 'checkmark_circle');
    this.onChanged();
  }

  /** 到达实拍区块（与 iOS RevealView.checkInPhotoSection 同语义） */
  @Builder
  checkInPhotoSection() {
    Column({ space: 6 }) {
      if (this.checkInUri.length > 0) {
        Stack({ alignContent: Alignment.TopStart }) {
          Image(this.checkInUri)
            .width('100%')
            .height(168)
            .objectFit(ImageFit.Cover)
            .borderRadius(WASize.cardRadiusSm)
            .border({ width: 1, color: WAColor.line, radius: WASize.cardRadiusSm })
            .alt($r('app.media.app_icon'))

          Text('你拍的')
            .fontSize(WAFont.micro)
            .fontWeight(FontWeight.Bold)
            .fontColor(WAColor.iconOnBrand)
            .padding({ left: 9, right: 9 })
            .height(22)
            .backgroundColor('#9E182431')
            .borderRadius(WASize.chipRadius)
            .margin(10)
        }
        .width('100%')

        Row({ space: 10 }) {
          Text('重拍')
            .fontSize(WAFont.captionSm)
            .fontWeight(FontWeight.Medium)
            .fontColor(WAColor.ink2)
            .onClick(() => {
              this.capturePhoto(true);
            })
          Text('换一张')
            .fontSize(WAFont.captionSm)
            .fontWeight(FontWeight.Medium)
            .fontColor(WAColor.ink2)
            .onClick(() => {
              this.capturePhoto(false);
            })
          Blank()
          Text(this.uploadStatusText())
            .fontSize(WAFont.microSm)
            .fontColor(this.checkInRemotePath.length > 0 ? WAColor.teal : WAColor.ink3)
            .maxLines(1)
        }
        .width('100%')
      } else {
        Row({ space: 10 }) {
          Button() {
            Row({ space: 6 }) {
              SymbolGlyph($r('sys.symbol.pin'))
                .fontSize(WAFont.caption)
                .fontColor([WAColor.ink])
                .renderingStrategy(SymbolRenderingStrategy.SINGLE)
              Text('拍一张 · 记下这一刻')
                .fontSize(WAFont.caption)
                .fontWeight(FontWeight.Medium)
                .fontColor(WAColor.ink)
            }
          }
          .type(ButtonType.Normal)
          .height(44)
          .layoutWeight(1)
          .backgroundColor(WAColor.amberSoft)
          .borderRadius(WASize.cardRadiusSm)
          .border({
            width: 1,
            color: WAColor.amberBorder,
            radius: WASize.cardRadiusSm,
            style: BorderStyle.Dashed
          })
          .onClick(() => {
            this.capturePhoto(true);
          })

          Button() {
            SymbolGlyph($r('sys.symbol.square_grid_2x2'))
              .fontSize(WAFont.titleSm)
              .fontColor([WAColor.ink2])
              .renderingStrategy(SymbolRenderingStrategy.SINGLE)
          }
          .type(ButtonType.Normal)
          .width(44)
          .height(44)
          .backgroundColor(WAColor.paper2)
          .borderRadius(WASize.cardRadiusSm)
          .border({ width: 1, color: WAColor.line, radius: WASize.cardRadiusSm })
          .onClick(() => {
            this.capturePhoto(false);
          })
        }
        .width('100%')
      }
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
  }

  private place(): Place | undefined {
    return this.snapshot.currentPlace;
  }

  private placeSafe(): Place {
    const place: Place | undefined = this.snapshot.currentPlace;
    return place === undefined ? emptyPlace() : place;
  }

  private isShort(): boolean {
    return this.winHeight < WASize.shortHeightBreakpoint;
  }

  private serialText(): string {
    const serial: string | undefined = this.snapshot.revealSerial;
    return 'No.' + (serial === undefined ? '----' : serial);
  }

  private placeMeta(place: Place): string {
    let meta: string = areaWord(place.area) + ' · ' + place.category;
    if (place.address !== undefined && place.address.length > 0) {
      meta = meta + ' · ' + place.address;
    }
    return meta;
  }

  /** 来源标签（parity.md §1：编辑精选 / 真实地标 / 演示） */
  private sourceLabel(place: Place): string {
    if (place.source === 'curated') return '编辑精选';
    if (place.source === 'amap') return '高德地图 · 真实地点';
    if (place.source === 'baidu') return '百度地图 · 真实地点';
    if (place.source === 'osm') return 'OpenStreetMap · 真实地点';
    if (place.source === 'wiki') return '维基百科 · 真实地标';
    return '演示模式 · 内置地点';
  }

  private hasPhoto(place: Place): boolean {
    return place.photoUrl !== undefined && place.photoUrl.length > 0;
  }

  private isCurated(place: Place): boolean {
    return place.source === 'curated';
  }

  // ============================================================
  // 开盒动画
  // ============================================================

  private playOpening(): void {
    // 盒子抖动 600ms（±6° 三次）
    animateTo({
      duration: 100,
      curve: Curve.EaseInOut,
      iterations: 6,
      playMode: PlayMode.Alternate
    }, () => {
      this.boxShake = 6;
    });

    // 盒盖弹开 + 暖光 + 纸屑
    this.stageTimers.push(setTimeout(() => {
      animateTo({ duration: 450, curve: Curve.Friction }, () => {
        this.lidUp = true;
        this.lightOn = true;
        this.particlesOut = true;
      });
    }, 700));

    // 纸屑淡出
    this.stageTimers.push(setTimeout(() => {
      animateTo({ duration: 520, curve: Curve.EaseOut }, () => {
        this.particlesFade = true;
      });
    }, 1050));

    // 1.2s 后切到卡片（先让 store 进入 revealed 态）
    this.stageTimers.push(setTimeout(() => {
      getStore().confirmReveal();
      this.load();
      animateTo({ duration: 520, curve: Curve.EaseOut }, () => {
        this.showCard = true;
      });
    }, 1200));
  }

  // ============================================================
  // Toast
  // ============================================================

  private showToast(text: string, icon: string): void {
    this.toastText = text;
    this.toastIcon = icon;
    if (this.toastTimer >= 0) {
      clearTimeout(this.toastTimer);
    }
    this.toastTimer = setTimeout(() => {
      this.toastText = '';
      this.toastTimer = -1;
    }, 2600);
  }

  private showAchievement(achievement: Achievement): void {
    this.achievementText = '成就解锁 · ' + achievement.name;
    this.stageTimers.push(setTimeout(() => {
      this.achievementText = '';
    }, 3400));
  }

  // ============================================================
  // 交互
  // ============================================================

  private collectCard(): void {
    if (this.collecting) {
      return;
    }
    if (this.hasCollected) {
      this.onGoCards();
      return;
    }

    const result: CollectResult | undefined = getStore().collectCurrentPlace();
    if (result === undefined) {
      this.showToast('这张卡已经在图鉴里了。', 'checkmark_circle');
      this.hasCollected = true;
      this.onChanged();
      return;
    }

    this.hasCollected = true;
    // 到达实拍：如果先拍了照片、之后再收录，这里补挂到卡片上
    if (this.checkInUri.length > 0) {
      const placeID: string = result.card.placeID;
      try {
        getStore().attachCardPhoto(placeID, this.checkInUri,
          this.checkInRemotePath.length > 0 ? this.checkInRemotePath : undefined);
      } catch (err) {
        // 照片挂不上不影响收录
      }
    }
    this.load();
    this.onChanged();

    // 卡片缩小飞向 Tab 图鉴，飞完再落回原位
    animateTo({ duration: 520, curve: Curve.Friction }, () => {
      this.collecting = true;
    });
    this.stageTimers.push(setTimeout(() => {
      animateTo({ duration: 420, curve: Curve.EaseOut }, () => {
        this.collecting = false;
      });
    }, 620));

    this.showToast('已收录 · 惊喜值 +' + result.xpGained, 'star_fill');

    // 成就 toast 延后 600ms
    if (result.newAchievements.length > 0) {
      this.stageTimers.push(setTimeout(() => {
        this.showAchievement(result.newAchievements[0]);
      }, 640));
    }
  }

  private shareToCircle(): void {
    if (this.collecting) {
      return;
    }
    const place: Place | undefined = this.place();
    if (place === undefined) {
      this.showToast('还没有可以分享的地点。', 'info_circle');
      return;
    }
    const post: FeedPost | undefined = getStore().share('走到了「' + place.name + '」。');
    if (post === undefined) {
      this.showToast('分享没成功，再试一次。', 'info_circle');
      return;
    }
    this.hasShared = true;
    this.onChanged();
    this.showToast('已发布到圈子', 'heart_fill');
  }

  private toggleTaskDone(): void {
    if (this.collecting) {
      return;
    }
    this.taskDone = !this.taskDone;
  }

  // ============================================================
  // 开盒舞台
  // ============================================================

  @Builder
  particlePiece(index: number) {
    Row()
      .width(5 + (index % 3) * 2)
      .height(7 + (index % 3) * 2)
      .backgroundColor(index % 2 === 0 ? WAColor.amber : WAColor.ember)
      .borderRadius(1.5)
      .rotate({ angle: index * 30 + (this.particlesOut ? 150 : 0) })
      .translate({
        x: this.particlesOut
          ? Math.cos(index / 12 * Math.PI * 2) * (100 + (index % 3) * 28)
          : Math.cos(index / 12 * Math.PI * 2) * 12,
        y: this.particlesOut
          ? Math.sin(index / 12 * Math.PI * 2) * (100 + (index % 3) * 28)
          : Math.sin(index / 12 * Math.PI * 2) * 12
      })
      .opacity(this.particlesFade ? 0 : (this.particlesOut ? 1 : 0))
  }

  @Builder
  openingStage() {
    Stack({ alignContent: Alignment.Center }) {
      // 深色舞台 + 暖光
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor(WAColor.stage)

      Circle()
        .width(300)
        .height(300)
        .fill(this.lightOn ? '#73E89B4C' : '#00E89B4C')
        .blur(46)
        .translate({ y: -this.winHeight * 0.08 })

      Column({ space: 26 }) {
        Stack({ alignContent: Alignment.Center }) {
          // 纸屑
          ForEach(PARTICLE_INDEXES, (index: number) => {
            this.particlePiece(index)
          }, (index: number) => String(index))

          // 盒盖
          Row()
            .width(156)
            .height(35)
            .backgroundColor(WAColor.kraftLid)
            .borderRadius(5)
            .border({ width: 1.8, color: '#E6171410', radius: 5 })
            .rotate({ angle: this.lidUp ? -26 : 0 })
            .translate({ x: this.lidUp ? 36 : 0, y: this.lidUp ? -148 : -38 })

          // 盒体
          Column() {
            Text('?')
              .fontSize(50)
              .fontWeight(FontWeight.Bold)
              .fontColor(WAColor.ink)
          }
          .width(140)
          .height(92)
          .justifyContent(FlexAlign.Center)
          .backgroundColor(WAColor.kraftBody)
          .borderRadius(8)
          .border({ width: 1.8, color: '#E6171410', radius: 8 })
          .translate({ y: 26 })
        }
        .width(320)
        .height(246)
        .rotate({ angle: this.lidUp ? 0 : this.boxShake })

        Text('这次，城市选了这个地方。')
          .fontSize(WAFont.bodySm)
          .fontColor(this.lightOn ? WAColor.creamOnStage : WAColor.creamOnStageDim)
          .textAlign(TextAlign.Center)
          .padding({ left: 40, right: 40 })
      }
      .width('100%')
      .translate({ y: -30 })
    }
    .width('100%')
    .height('100%')
  }

  // ============================================================
  // 卡片舞台
  // ============================================================

  @Builder
  stageBar() {
    Row() {
      Text(clockHHMM())
        .fontSize(13)
        .fontWeight(FontWeight.Medium)
        .fontColor(WAColor.creamOnStage)

      Blank()

      if (this.hasCollected) {
        Stack({ alignContent: Alignment.Center }) {
          SymbolGlyph($r('sys.symbol.xmark'))
            .fontSize(WAFont.caption)
            .fontColor([WAColor.creamOnStageDim])
            .renderingStrategy(SymbolRenderingStrategy.SINGLE)
        }
        .width(30)
        .height(30)
        .backgroundColor(WAColor.stageClose)
        .borderRadius(15)
        .onClick(() => {
          this.onGoCards();
          })
      }
    }
    .width('100%')
    .height(46)
    .padding({ left: WASize.pagePadding, right: WASize.pagePadding })
  }

  @Builder
  taskCard(place: Place) {
    Row({ space: 10 }) {
      Column({ space: 4 }) {
        Row({ space: 3 }) {
          SymbolGlyph($r('sys.symbol.warning'))
            .fontSize(WAFont.micro)
            .fontColor([WAColor.gold])
            .renderingStrategy(SymbolRenderingStrategy.SINGLE)
            .fontSize(WAFont.micro)
          WaMicroLabel({ text: '小任务：' })
        }
        Text(place.task)
          .fontSize(WAFont.caption)
          .fontColor(WAColor.ink)
          .lineHeight(21)
          .layoutWeight(1)
      }
      .alignItems(HorizontalAlign.Start)
      .layoutWeight(1)

      Text(this.taskDone ? '已完成' : '完成后点一下')
        .fontSize(WAFont.micro)
        .fontColor(this.taskDone ? WAColor.teal : WAColor.ink3)
        .onClick(() => {
          this.toggleTaskDone();
        })
    }
    .width('100%')
    .padding({ left: 12, right: 12, top: 10, bottom: 10 })
    .backgroundColor(WAColor.paper2)
    .borderRadius(WASize.cardRadiusSm)
    .border({ width: 1, color: WAColor.line, radius: WASize.cardRadiusSm })
  }

  @Builder
  revealCard(place: Place) {
    Column({ space: 0 }) {
      Row() {
        Text(this.serialText())
          .fontSize(WAFont.micro)
          .fontWeight(FontWeight.Medium)
          .fontColor(WAColor.ink3)
          .letterSpacing(1)
        Blank()
        WaRarityBadge({ rarity: place.rarity })
      }
      .width('100%')
      .padding({ bottom: 13 })

      // 实景照片（只有到达后才展示；photoUrl 在 walking 阶段被 mask 掉）
      if (this.hasPhoto(place)) {
        Column({ space: 4 }) {
          Image(place.photoUrl)
            .width('100%')
            .height(this.isShort() ? 132 : 168)
            .objectFit(ImageFit.Cover)
            .borderRadius(WASize.cardRadiusSm)
            .border({ width: 1, color: WAColor.line, radius: WASize.cardRadiusSm })
            .alt($r('app.media.app_icon'))

          if (place.photoCredit !== undefined && place.photoCredit.length > 0) {
            Text('图片：' + place.photoCredit)
              .fontSize(WAFont.microSm)
              .fontColor(WAColor.ink3)
              .width('100%')
              .textAlign(TextAlign.End)
          }
        }
        .width('100%')
        .padding({ bottom: 8 })
      }

      Column({ space: 7 }) {
        SymbolGlyph($r('sys.symbol.' + categorySymbol(place.category)))
          .fontSize(46)
          .fontColor([WAColor.amber])
          .renderingStrategy(SymbolRenderingStrategy.SINGLE)
        Text(place.name)
          .fontSize(WAFont.title)
          .fontWeight(FontWeight.Bold)
          .fontColor(WAColor.ink)
          .textAlign(TextAlign.Center)
          .maxLines(2)
        Text(this.placeMeta(place))
          .fontSize(WAFont.micro)
          .fontColor(WAColor.ink3)
          .textAlign(TextAlign.Center)
          .maxLines(2)

        // 来源标签：编辑精选 / 真实地标 / 演示
        Row({ space: 5 }) {
          SymbolGlyph($r('sys.symbol.' + (this.isCurated(place) ? 'star_fill' : (place.source === 'catalog' ? 'info_circle' : 'pin'))))
            .fontSize(WAFont.micro)
            .fontColor([WAColor.ink3])
            .renderingStrategy(SymbolRenderingStrategy.SINGLE)
          Text(this.sourceLabel(place))
            .fontSize(WAFont.microSm)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.isCurated(place) ? WAColor.amberDeep
              : (place.source === 'catalog' ? WAColor.ink3 : WAColor.teal))
        }
        .padding({ left: 9, right: 9, top: 3, bottom: 3 })
        .backgroundColor(this.isCurated(place) ? WAColor.amberSoft
          : (place.source === 'catalog' ? WAColor.paper2 : WAColor.tealSoft))
        .borderRadius(WASize.chipRadius)

        if (place.summary !== undefined && place.summary.length > 0) {
          Text(place.summary)
            .fontSize(WAFont.captionSm)
            .fontColor(WAColor.ink3)
            .textAlign(TextAlign.Center)
            .maxLines(3)
            .lineHeight(19)
        }
      }
      .width('100%')
      .padding({ bottom: 11 })

      WaHairline()

      Column() {
        this.checkInPhotoSection()
      }
      .margin({ top: 12 })

      WaHairline()

      Column({ space: 6 }) {
        WaMicroLabel({ text: '为什么是这里：' })
        Text(place.why)
          .fontSize(WAFont.caption)
          .fontColor(WAColor.ink2)
          .lineHeight(21)
      }
      .alignItems(HorizontalAlign.Start)
      .width('100%')
      .padding({ top: 12, bottom: 12 })

      WaHairline()

      Column() {
        this.taskCard(place)
      }
      .margin({ top: 12 })

      Row({ space: 8 }) {
        Button() {
          Text(this.hasCollected ? '去看看图鉴' : '收进图鉴')
            .fontSize(WAFont.bodySm)
            .fontWeight(FontWeight.Medium)
            .fontColor(WAColor.ink)
            .maxLines(1)
        }
        .type(ButtonType.Capsule)
        .height(46)
        .layoutWeight(1)
        .backgroundColor(WAColor.amber)
        .shadow({ radius: 12, color: WAColor.shadow, offsetX: 0, offsetY: 6 })
        .onClick(() => {
          this.collectCard();
        })

        Button() {
          Text(this.hasShared ? '已分享' : '分享')
            .fontSize(WAFont.bodySm)
            .fontWeight(FontWeight.Medium)
            .fontColor(WAColor.ink2)
        }
        .type(ButtonType.Capsule)
        .height(46)
        .width(96)
        .backgroundColor(Color.Transparent)
        .border({ width: 1, color: WAColor.line, radius: WASize.chipRadius })
        .enabled(!this.hasShared)
        .opacity(this.hasShared ? 0.5 : 1)
        .onClick(() => {
          this.shareToCircle();
        })
      }
      .width('100%')
      .margin({ top: 14 })

      if (this.hasCollected) {
        Text('它现在是你的了。')
          .fontSize(WAFont.micro)
          .fontColor(WAColor.ink3)
          .width('100%')
          .textAlign(TextAlign.Center)
          .margin({ top: 9 })
      }
    }
    .width('100%')
    .padding({ left: 20, right: 20, top: 17, bottom: 18 })
    .backgroundColor(WAColor.paper)
    .borderRadius(WASize.cardRadius)
    .shadow({ radius: 20, color: '#33000000', offsetX: 0, offsetY: 6 })
    .rotate({ angle: -1.2 })
    .scale({
      x: this.collecting ? 0.26 : 1,
      y: this.collecting ? 0.26 : 1
    })
    .opacity(this.collecting ? 0 : 1)
    .translate({ y: this.collecting ? 250 : 0 })
  }

  @Builder
  cardStage() {
    Stack({ alignContent: Alignment.TopStart }) {
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor(WAColor.stage)

      Circle()
        .width(360)
        .height(360)
        .fill('#14E89C4C')
        .blur(60)
        .translate({ x: this.winWidth * 0.25, y: -80 })

      Column({ space: 0 }) {
        this.stageBar()

        Scroll() {
          Column({ space: 0 }) {
            this.revealCard(this.placeSafe())

            Text('这个地点，只为你亮一次。')
              .fontSize(WAFont.micro)
              .fontColor(WAColor.creamOnStageDim)
              .textAlign(TextAlign.Center)
              .width('100%')
              .margin({ top: 14 })
          }
          .width('100%')
          .constraintSize({ maxWidth: 460 })
          .padding({ left: 26, right: 26, top: 12, bottom: 30 })
        }
        .layoutWeight(1)
        .scrollBar(BarState.Off)
      }
      .width('100%')
      .height('100%')
    }
    .width('100%')
    .height('100%')
  }

  @Builder
  emptyStage() {
    Column({ space: 10 }) {
      Text('今晚的盲盒还没准备好。')
        .fontSize(WAFont.body)
        .fontColor(WAColor.creamOnStage)
      Text('再走一会儿。')
        .fontSize(WAFont.caption)
        .fontColor(WAColor.creamOnStageDim)
    }
    .width('100%')
    .height('100%')
    .justifyContent(FlexAlign.Center)
    .backgroundColor(WAColor.stage)
  }

  build() {
    Stack({ alignContent: Alignment.TopStart }) {
      if (this.showCard) {
        if (this.place() === undefined) {
          this.emptyStage()
        } else {
          this.cardStage()
        }
      } else {
        this.openingStage()
      }

      // 底部 toast 堆叠
      Column({ space: 8 }) {
        if (this.achievementText.length > 0) {
          WaToastBar({
            text: this.achievementText,
            iconName: 'star_fill',
            amber: true
          })
        }
        if (this.toastText.length > 0) {
          WaToastBar({
            text: this.toastText,
            iconName: this.toastIcon,
            amber: false
          })
        }
      }
      .width('100%')
      .height('100%')
      .padding({ left: WASize.pagePadding, right: WASize.pagePadding, bottom: 40 })
      .justifyContent(FlexAlign.End)
      .hitTestBehavior(HitTestMode.None)
    }
    .width('100%')
    .height('100%')
  }
}
