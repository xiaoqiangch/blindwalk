/**
 * 步迷 Walkaholic · HarmonyOS — KeyValueStore 的官方实现（仅 .ets，Node 测试不包含）
 *
 * 为什么单独一个文件：
 * - core/persistence.ts 必须保持「不 import @ohos.*」的纯净性（Node 里可跑单元测试）；
 * - ArkTS 端由 UI 在这里注入 @ohos.data.preferences；
 * - 用法（pages/Index.ets）：`await initStore(new PreferencesKV(context))`。
 *
 * 注意：core/*.ts 里没有任何对 @ohos 的引用，这个文件是唯一的平台适配层。
 */

import { preferences } from '@kit.ArkData';
import { common } from '@kit.AbilityKit';
import { KeyValueStore } from './contract';

const PREFERENCES_NAME: string = 'walkaholic';

/** HarmonyOS 键值存储：包装 @ohos.data.preferences（API 12 / 5.0.0） */
export class PreferencesKV implements KeyValueStore {
  private store: preferences.Preferences;

  constructor(context: common.Context) {
    const options: preferences.Options = { name: PREFERENCES_NAME };
    this.store = preferences.getPreferencesSync(context, options);
  }

  getString(key: string): string | undefined {
    const value: preferences.ValueType = this.store.getSync(key, '');
    if (typeof value === 'string') {
      return value.length === 0 ? undefined : value;
    }
    return undefined;
  }

  putString(key: string, value: string): void {
    this.store.putSync(key, value);
    this.store.flush();
  }

  delete(key: string): void {
    this.store.deleteSync(key);
    this.store.flush();
  }
}
