/**
 * 盲走 BlindWalk · HarmonyOS Stage 模型入口 Ability
 *
 * 职责：加载 pages/Index、把窗口底色刷成奶油纸（避免状态栏下面出现白条）。
 * 状态初始化在 Index.ets 里 `await initStore(new PreferencesKV(context))`（可 await，更稳）。
 *
 * ⚠️ 待 DevEco 验证：windowStage.loadContent 回调签名 / setWindowBackgroundColor。
 */

import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { window } from '@kit.ArkUI';

const DOMAIN: number = 0x0000;
const TAG: string = 'BlindWalk';

export default class EntryAbility extends UIAbility {

  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    hilog.info(DOMAIN, TAG, 'BlindWalk onCreate');
  }

  onWindowStageCreate(windowStage: window.WindowStage): void {
    windowStage.loadContent('pages/Index', (err: BusinessError) => {
      if (err !== undefined && err.code) {
        hilog.error(DOMAIN, TAG, 'loadContent failed: %{public}s', JSON.stringify(err));
        return;
      }
      try {
        // 奶油纸底色：状态栏 / 手势条区域与页面同色
        windowStage.getMainWindowSync().setWindowBackgroundColor('#F3F5FB');
      } catch (error) {
        const failure = error as BusinessError;
        hilog.warn(DOMAIN, TAG, 'setWindowBackgroundColor failed: %{public}s', JSON.stringify(failure));
      }
      hilog.info(DOMAIN, TAG, 'loadContent ok');
    });
  }

  onWindowStageDestroy(): void {
    hilog.info(DOMAIN, TAG, 'onWindowStageDestroy');
  }

  onDestroy(): void {
    hilog.info(DOMAIN, TAG, 'onDestroy');
  }
}
