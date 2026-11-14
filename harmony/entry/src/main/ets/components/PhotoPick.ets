/**
 * 步迷 Walkaholic · HarmonyOS ArkUI — 照片选择与感知哈希
 *
 * 负责三件事：
 *   1. PhotoViewPicker 拉起系统相册选图（无需申请相册权限）；
 *   2. 把选中的图解码成 9×8 灰度，交给 core/surprise.ts 算 64 位 dHash；
 *   3. 复制到应用沙箱，拿到可长期引用的 URI（picker 返回的 media URI 是不稳定的）。
 *
 * 数据不出手机：照片只写到应用沙箱，不上传任何服务器。
 */

import { photoAccessHelper } from '@kit.MediaLibraryKit';
import { cameraPicker } from '@kit.CameraKit';
import { image } from '@kit.ImageKit';
import { fileIo as fs } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';
import { common } from '@kit.AbilityKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { computeDHash } from '../core/surprise';

/** dHash 采样尺寸：9 列 × 8 行（每行做 8 次相邻比较，共 64 位） */
const HASH_WIDTH: number = 9;
const HASH_HEIGHT: number = 8;

/** 沙箱内照片存放目录（相对 filesDir） */
const PHOTO_DIR: string = 'surprises';

export class PickedPhoto {
  /** 沙箱内文件路径（photoUri 字段用） */
  uri: string = '';
  /** 64 位 dHash（16 位十六进制） */
  hash: string = '';
  /** 照片像素宽度（展示用） */
  width: number = 0;
  /** 照片像素高度 */
  height: number = 0;
}

/**
 * 拉起系统相册选一张图。
 * 用户取消时返回 undefined（不抛错，调用方保持原状）。
 */
export async function pickPhotoFromAlbum(): Promise<string | undefined> {
  try {
    const picker: photoAccessHelper.PhotoViewPicker = new photoAccessHelper.PhotoViewPicker();
    const options: photoAccessHelper.PhotoSelectOptions = new photoAccessHelper.PhotoSelectOptions();
    options.MIMEType = photoAccessHelper.PhotoViewMIMETypes.IMAGE_TYPE;
    options.maxSelectNumber = 1;
    const result: photoAccessHelper.PhotoSelectResult = await picker.select(options);
    if (result.photoUris === undefined || result.photoUris.length === 0) {
      return undefined;
    }
    return result.photoUris[0];
  } catch (err) {
    const error = err as BusinessError;
    return undefined;
  }
}

/**
 * 拉起系统相机拍一张（无需申请相机权限，CameraPicker 是系统级免权限组件）。
 * 用户取消或失败时返回 undefined（调用方保持原状）。
 */
export async function takePhoto(): Promise<string | undefined> {
  try {
    const context: common.UIAbilityContext = getContext() as common.UIAbilityContext;
    const pickerProfile: cameraPicker.PickerProfile = {
      cameraPosition: cameraPicker.CameraPosition.BACK
    };
    const result: cameraPicker.PickerResult = await cameraPicker.pick(
      context, [cameraPicker.PickerMediaType.PHOTO], pickerProfile
    );
    if (result === undefined || result.resultCode !== 0) return undefined;
    if (result.resultUri === undefined || result.resultUri.length === 0) return undefined;
    return result.resultUri;
  } catch (err) {
    const error = err as BusinessError;
    return undefined;
  }
}

/**
 * 把 picker 给的 media URI 转成沙箱内的稳定文件 + 计算 dHash。
 *
 * 失败返回 undefined（调用方提示「这张照片读不出来」）。
 */
export async function adoptPhoto(
  context: common.UIAbilityContext,
  mediaUri: string
): Promise<PickedPhoto | undefined> {
  let source: image.ImageSource | undefined = undefined;
  let pixelMap: image.PixelMap | undefined = undefined;
  try {
    // ① 解码：只要缩略图级别就够算哈希，decodingOptions 直接降采样省内存
    const file: fs.File = fs.openSync(mediaUri, fs.OpenMode.READ_ONLY);
    try {
      source = image.createImageSource(file.fd);
    } finally {
      fs.closeSync(file);
    }
    if (source === undefined) {
      return undefined;
    }

    const info: image.ImageInfo = await source.getImageInfo();
    const decodeOptions: image.DecodingOptions = {
      desiredSize: { width: HASH_WIDTH, height: HASH_HEIGHT },
      desiredPixelFormat: image.PixelMapFormat.RGBA_8888
    };
    pixelMap = await source.createPixelMap(decodeOptions);
    if (pixelMap === undefined) {
      return undefined;
    }

    // ② 读像素 → 灰度数组（9×8）
    const gray: number[] = await readGray(pixelMap, HASH_WIDTH, HASH_HEIGHT);
    const hash: string = computeDHash(gray, HASH_WIDTH, HASH_HEIGHT);
    if (hash === '0000000000000000') {
      return undefined;
    }

    // ③ 复制到沙箱（media URI 只在本次授权内有效）
    const sandboxUri: string | undefined = copyToSandbox(context, mediaUri, hash);
    if (sandboxUri === undefined) {
      return undefined;
    }

    const picked: PickedPhoto = new PickedPhoto();
    picked.uri = sandboxUri;
    picked.hash = hash;
    picked.width = info.size.width;
    picked.height = info.size.height;
    return picked;
  } catch (err) {
    const error = err as BusinessError;
    return undefined;
  } finally {
    if (pixelMap !== undefined) {
      try {
        await pixelMap.release();
      } catch (err) {
        // 释放失败不影响结果
      }
    }
    if (source !== undefined) {
      try {
        await source.release();
      } catch (err) {
        // 同上
      }
    }
  }
}

/** 从 PixelMap 读 RGBA 并转灰度（需求尺寸的整数倍采样） */
async function readGray(
  pixelMap: image.PixelMap,
  width: number,
  height: number
): Promise<number[]> {
  const bufferSize: number = width * height * 4;
  const buffer: ArrayBuffer = new ArrayBuffer(bufferSize);
  await pixelMap.readPixelsToBuffer(buffer);
  const bytes: Uint8Array = new Uint8Array(buffer);

  const gray: number[] = [];
  for (let i = 0; i < width * height; i += 1) {
    const offset: number = i * 4;
    // 亮度公式（与 iOS 的 CIColorControls 灰度近似一致）
    const value: number =
      0.299 * bytes[offset] +
      0.587 * bytes[offset + 1] +
      0.114 * bytes[offset + 2];
    gray.push(value);
  }
  return gray;
}

/** 复制到沙箱 filesDir/surprises/<hash>.jpg，返回绝对路径 */
function copyToSandbox(
  context: common.UIAbilityContext,
  mediaUri: string,
  hash: string
): string | undefined {
  try {
    const dir: string = context.filesDir + '/' + PHOTO_DIR;
    if (!fs.accessSync(dir)) {
      fs.mkdirSync(dir);
    }
    const target: string = dir + '/' + hash + '.jpg';
    if (fs.accessSync(target)) {
      // 同一张照片（hash 相同）直接复用，不重复写盘
      return target;
    }
    const src: fs.File = fs.openSync(mediaUri, fs.OpenMode.READ_ONLY);
    try {
      fs.copyFileSync(src.fd, target);
    } finally {
      fs.closeSync(src);
    }
    return target;
  } catch (err) {
    const error = err as BusinessError;
    return undefined;
  }
}

/**
 * 沙箱照片是否还在（拾取记录长期引用时校验用）。
 * 文件被系统清理时返回 false，调用方应提示重新选择。
 */
export function photoExists(uri: string): boolean {
  if (uri.length === 0) {
    return false;
  }
  try {
    return fs.accessSync(uri);
  } catch (err) {
    return false;
  }
}

// ============================================================
// 相册（reach-in）：photoAccessHelper 的 PhotoViewPicker 是「拉取」模式，
// 选一张后拿到的是 media URI（只在本次授权内有效），所以 adoptPhoto 必须
// 立刻解码 + 复制到沙箱。下面是相机/相册两条入口的统一封装。
// ============================================================

/**
 * 拍一张照片并落到沙箱（相机 → 解码算 dHash → 复制进沙箱）。
 * 失败返回 undefined。
 */
export async function takeAndAdoptPhoto(context: common.UIAbilityContext): Promise<PickedPhoto | undefined> {
  const uri: string | undefined = await takePhoto();
  if (uri === undefined) return undefined;
  return adoptPhoto(context, uri);
}

/**
 * 从相册选一张并落到沙箱。
 * 失败返回 undefined。
 */
export async function pickAndAdoptPhoto(context: common.UIAbilityContext): Promise<PickedPhoto | undefined> {
  const uri: string | undefined = await pickPhotoFromAlbum();
  if (uri === undefined) return undefined;
  return adoptPhoto(context, uri);
}

/** 读取沙箱图片文件为 base64（上传账号 / data URL 用） */
export function readPhotoAsBase64(uri: string): string {
  if (uri.length === 0) return '';
  try {
    const file: fs.File = fs.openSync(uri, fs.OpenMode.READ_ONLY);
    try {
      const stat: fs.Stat = fs.statSync(file.fd);
      const buffer: ArrayBuffer = new ArrayBuffer(stat.size);
      fs.readSync(file.fd, buffer);
      const bytes: Uint8Array = new Uint8Array(buffer);
      return util.Base64Helper.encodeToStringSync(bytes);
    } finally {
      fs.closeSync(file);
    }
  } catch (err) {
    const error = err as BusinessError;
    return '';
  }
}

/** 沙箱图片 → data URL（JPEG；服务端 image/jpeg 白名单） */
export function photoDataURL(uri: string): string {
  const base64: string = readPhotoAsBase64(uri);
  if (base64.length === 0) return '';
  return 'data:image/jpeg;base64,' + base64;
}
