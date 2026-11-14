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
  private onHeading: (heading: number) => void;

  constructor(onHeading: (heading: number) => void) {
    this.onHeading = onHeading;
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

  /** 最近一次定位成功的时间戳（ms）；0 表示还没拿到过 */
  private lastFixAt: number = 0;
  /** 由最近两次定位点推算出的移动方向（度，0=北）；负值表示无法判断 */
  private moveHeading: number = -1;
  /** 上一次用于算方向的定位点 */
  private prevPoint: GeoPoint | undefined = undefined;
  /** 兜底轮询定时器句柄，-1 表示未启动 */
  private pollTimer: number = -1;

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
    if (this.pollTimer !== -1) {
      clearInterval(this.pollTimer);
      this.pollTimer = -1;
    }
  }

  /** 当前移动方向（度）；负值表示暂时无法判断 */
  heading(): number {
    return this.moveHeading;
  }

  /** 用相邻两次定位点推算移动方向，写入 moveHeading */
  private updateMoveHeading(point: GeoPoint): void {
    const now: number = Date.now();
    if (this.prevPoint === undefined) {
      this.prevPoint = point;
      this.lastFixAt = now;
      return;
    }
    const dLat: number = point.latitude - this.prevPoint.latitude;
    const dLon: number = point.longitude - this.prevPoint.longitude;
    const meters: number = Math.abs(dLat) + Math.abs(dLon);
    // 位移太小时方向不可靠，保留上一次结果
    if (meters > 0.00002) {
      this.moveHeading = Math.atan2(dLon, dLat) * 180 / Math.PI;
      if (this.moveHeading < 0) {
        this.moveHeading += 360;
      }
      this.prevPoint = point;
    }
    this.lastFixAt = now;
  }

  /** 兜底轮询：订阅式定位迟迟不来时，用单次定位补点 */
  private startPollFallback(): void {
    if (this.pollTimer !== -1) {
      return;
    }
    this.pollTimer = setInterval(() => {
      if (!this.active) {
        return;
      }
      // 已经有新鲜定位就不再打扰
      if (this.lastFixAt > 0 && Date.now() - this.lastFixAt < 8000) {
        return;
      }
      try {
        geoLocationManager.getCurrentLocation({
          priority: geoLocationManager.LocationRequestPriority.FIRST_FIX,
          scenario: geoLocationManager.LocationRequestScenario.UNSET,
          maxAccuracy: 0
        }, (err: BusinessError, location: geoLocationManager.Location) => {
          if (err) {
            return;
          }
          if (location === undefined || location === null) {
            return;
          }
          const point: GeoPoint = {
            latitude: location.latitude,
            longitude: location.longitude
          };
          this.updateMoveHeading(point);
          this.onPollPoint(point);
        });
      } catch (err) {
        const error = err as BusinessError;
      }
    }, 5000);
  }
}
