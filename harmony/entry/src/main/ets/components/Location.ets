/**
 * 盲走 BlindWalk · HarmonyOS ArkUI — 首页定位 / 权限小工具
 *
 * 位置权限申请走 abilityAccessCtrl.requestPermissionsFromUser（module.json5 已声明
 * ohos.permission.LOCATION / APPROXIMATELY_LOCATION）。
 * 拿不到定位（拒绝 / 关闭 / 超时）时由调用方降级到演示模式，UI 必须显式标「演示」。
 *
 * ⚠️ 待 DevEco 验证：geoLocationManager 的 API 12 写法（getCurrentLocation / on('locationChange')）。
 */

import { abilityAccessCtrl, common, Permissions } from '@kit.AbilityKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { geoLocationManager } from '@kit.LocationKit';
import { sensor } from '@kit.SensorServiceKit';
import { GeoPoint } from '../core/types';

const LOCATION_PERMISSIONS: Permissions[] = [
  'ohos.permission.APPROXIMATELY_LOCATION',
  'ohos.permission.LOCATION'
];

/** 申请定位权限；已授权时也返回 true（系统不会重复弹窗）。 */
export async function requestLocationPermission(context: common.UIAbilityContext): Promise<boolean> {
  try {
    const atManager: abilityAccessCtrl.AtManager = abilityAccessCtrl.createAtManager();
    const result = await atManager.requestPermissionsFromUser(context, LOCATION_PERMISSIONS);
    if (result === undefined || result.authResults === undefined || result.authResults.length === 0) {
      return false;
    }
    let granted: boolean = true;
    for (let i = 0; i < result.authResults.length; i++) {
      if (result.authResults[i] !== 0) {
        granted = false;
      }
    }
    return granted;
  } catch (err) {
    const error = err as BusinessError;
    return false;
  }
}

/** 单次定位（带超时）；失败时 reject，由调用方降级到演示模式。 */
export function getCurrentLocationOnce(timeoutMs: number): Promise<GeoPoint> {
  return new Promise<GeoPoint>((resolve: (value: GeoPoint) => void, reject: (reason: Error) => void) => {
    try {
      if (!geoLocationManager.isLocationEnabled()) {
        reject(new Error('location_disabled'));
        return;
      }
      const request: geoLocationManager.CurrentLocationRequest = {
        priority: geoLocationManager.LocationRequestPriority.FIRST_FIX,
        scenario: geoLocationManager.LocationRequestScenario.UNSET,
        maxAccuracy: 100,
        timeoutMs: timeoutMs
      };
      geoLocationManager.getCurrentLocation(request)
        .then((location: geoLocationManager.Location) => {
          const point: GeoPoint = {
            latitude: location.latitude,
            longitude: location.longitude
          };
          resolve(point);
        })
        .catch((err: BusinessError) => {
          reject(new Error('location_failed'));
        });
    } catch (err) {
      reject(new Error('location_exception'));
    }
  });
}

/**
 * 持续监听位置变化（旅程页用）。
 * 返回的句柄在组件 aboutToDisappear 里必须 stop()。
 */
/**
 * 罗盘：@ohos.sensor 的 ORIENTATION（alpha 绕 z 轴逆时针，0=北）。
 * 地图「朝上」= 设备朝向，这样用户转身时地图跟着转。
 * ⚠️ 待 DevEco 验证：sensor.on(sensor.SensorId.ORIENTATION) 的 API 12 写法。
 */
export class CompassWatcher {
  private active: boolean = false;
  private heading: number = -1;
  private listener: (data: sensor.OrientationResponse) => void;

  constructor(private onHeading: (heading: number) => void) {
    this.listener = (data: sensor.OrientationResponse) => {
      const alpha: number = data.alpha;
      if (typeof alpha !== 'number' || isNaN(alpha)) {
        return;
      }
      const raw: number = ((360 - alpha) % 360 + 360) % 360;
      if (this.heading < 0) {
        this.heading = raw;
      } else {
        const delta: number = ((raw - this.heading + 540) % 360) - 180;
        this.heading = (this.heading + delta * 0.35 + 360) % 360;
      }
      this.onHeading(this.heading);
    };
  }

  start(): boolean {
    if (this.active) {
      return true;
    }
    try {
      sensor.on(sensor.SensorId.ORIENTATION, this.listener, { interval: 100000000 });
      this.active = true;
      return true;
    } catch (err) {
      this.active = false;
      return false;
    }
  }

  stop(): void {
    if (!this.active) {
      return;
    }
    try {
      sensor.off(sensor.SensorId.ORIENTATION, this.listener);
    } catch (err) {
      /* ignore */
    }
    this.active = false;
  }
}

export class GeoWatcher {
  private active: boolean = false;
  private listener: (location: geoLocationManager.Location) => void;
  private request: geoLocationManager.LocationRequest;

  private onPollPoint: (point: GeoPoint) => void;

  constructor(onPoint: (point: GeoPoint) => void) {
    this.onPollPoint = onPoint;
    this.request = {
      priority: geoLocationManager.LocationRequestPriority.FIRST_FIX,
      scenario: geoLocationManager.LocationRequestScenario.UNSET,
      timeInterval: 1,
      distanceInterval: 2
    };
    this.listener = (location: geoLocationManager.Location) => {
      const point: GeoPoint = {
        latitude: location.latitude,
        longitude: location.longitude
      };
      this.lastFixAt = Date.now();
      this.updateMoveHeading(point);
      onPoint(point);
    };
  }

  start(): boolean {
    if (this.active) {
      return true;
    }
    try {
      geoLocationManager.on('locationChange', this.request, this.listener);
      this.active = true;
      this.startPollFallback();
      return true;
    } catch (err) {
      const error = err as BusinessError;
      this.active = false;
      return false;
    }
  }

  stop(): void {
    if (!this.active) {
      return;
    }
    try {
      geoLocationManager.off('locationChange', this.listener);
    } catch (err) {
      const error = err as BusinessError;
    }
    this.active = false;
  }
}
