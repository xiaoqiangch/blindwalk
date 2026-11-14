/**
 * 步迷 Walkaholic · HarmonyOS ArkUI — @ohos.data.preferences 的 KeyValueStore 实现
 *
 * 逻辑层 core/persistence.ts 只依赖 contract.KeyValueStore（纯 TS，可在 Node 测试），
 * HarmonyOS 的 preferences 实现由 UI 层注入（见 core/store.ts 的 initStore(kv) 注释）。
 *
 * 用法（pages/Index.ets）：
 *   const kv: PreferencesKV = new PreferencesKV(context);
 *   await kv.init();
 *   await initStore(kv);
 *
 * ⚠️ 待 DevEco 验证：@kit.ArkData 的 preferences 导入与 getSync / putSync / deleteSync 的 API 12 签名。
 */

import { preferences } from '@kit.ArkData';
import { common } from '@kit.AbilityKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { KeyValueStore } from '../core/contract';

const STORE_NAME: string = 'walkaholic_store';

export class PreferencesKV implements KeyValueStore {
  private context: common.UIAbilityContext;
  private store: preferences.Preferences | undefined = undefined;

  constructor(context: common.UIAbilityContext) {
    this.context = context;
  }

  /** 打开（或创建）preferences 文件；失败时 store 保持 undefined，所有读写降级为内存空实现。 */
  async init(): Promise<void> {
    try {
      this.store = await preferences.getPreferences(this.context, STORE_NAME);
    } catch (err) {
      const failure = err as BusinessError;
      this.store = undefined;
    }
  }

  getString(key: string): string | undefined {
    if (this.store === undefined) {
      return undefined;
    }
    try {
      const value: preferences.ValueType = this.store.getSync(key, '');
      if (typeof value === 'string' && value.length > 0) {
        return value as string;
      }
      return undefined;
    } catch (err) {
      return undefined;
    }
  }

  putString(key: string, value: string): void {
    if (this.store === undefined) {
      return;
    }
    try {
      this.store.putSync(key, value);
      this.store.flush().catch((err: BusinessError) => {
        const failure = err as BusinessError;
      });
    } catch (err) {
      const failure = err as BusinessError;
    }
  }

  delete(key: string): void {
    if (this.store === undefined) {
      return;
    }
    try {
      this.store.deleteSync(key);
      this.store.flush().catch((err: BusinessError) => {
        const failure = err as BusinessError;
      });
    } catch (err) {
      const failure = err as BusinessError;
    }
  }
}
