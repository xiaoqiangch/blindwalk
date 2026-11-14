/**
 * 步迷 Walkaholic · HarmonyOS ArkUI — 异步 / 系统提示小工具
 *
 * 只做两件事：可控延迟（动画时序）、系统 toast / 剪贴板。
 * ⚠️ 待 DevEco 验证：@kit.BasicServicesKit 的 pasteboard 导入方式。
 */

import { promptAction } from '@kit.ArkUI';
import { BusinessError, pasteboard } from '@kit.BasicServicesKit';

/** 延迟（动画时序用；不依赖 UI） */
export function waSleep(milliseconds: number): Promise<void> {
  return new Promise<void>((resolve: () => void) => {
    setTimeout(() => {
      resolve();
    }, milliseconds);
  });
}

/** 系统 toast（一次性提示用；带样式的 toast 用 WaToastBar） */
export function waToast(message: string): void {
  promptAction.showToast({ message: message, duration: 2000 });
}

/** 复制文本到剪贴板（圈子「同频」用） */
export function waCopyText(text: string): Promise<void> {
  return new Promise<void>((resolve: () => void) => {
    try {
      const data: pasteboard.PasteData = pasteboard.createData(pasteboard.MIMETYPE_TEXT_PLAIN, text);
      pasteboard.getSystemPasteboard().setData(data)
        .then(() => {
          resolve();
        })
        .catch((err: BusinessError) => {
          const error = err as BusinessError;
          resolve();
        });
    } catch (err) {
      const error = err as BusinessError;
      resolve();
    }
  });
}
