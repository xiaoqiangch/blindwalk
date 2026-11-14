/**
 * 步迷 Walkaholic · HarmonyOS ArkUI — 账号面板（parity.md §4）
 *
 * 入口在「我的 → 设置 → 账号」。未登录也能用（本地单机），登录只是多两种能力：
 *   同步到账号（整包覆盖云端） / 从账号恢复（覆盖本机）
 *
 * 契约：account/docs/API.md（register / login / logout / me / PUT me/profile / DELETE me）
 * 网络与 Cookie 管理在 core/account.ts（鸿蒙 http 不自动存 Cookie，这里手动带）。
 *
 * 服务地址可配，默认 https://xqlounge.top（公网）。
 */

import { promptAction } from '@kit.ArkUI';
import {
  ACCOUNT_BASE_DEFAULT,
  AccountConfig,
  AccountUser,
  accountStatusText,
  deleteAccount,
  isLoggedIn,
  login,
  logout,
  me,
  normalizeBaseUrl,
  pushProfile,
  readAccountConfig,
  register,
  writeAccountConfig
} from '../core/account';
import { KeyValueStore } from '../core/contract';
import { HttpClient } from '../core/http';
import { WAColor, WAFont, WASize } from '../theme/Theme';

/** 面板状态 */
const MODE_IDLE: string = 'idle';
const MODE_BUSY: string = 'busy';

@Component
export struct WaAccountPanel {
  @Prop revision: number = 0;

  /** 由 Index 注入：PreferencesKV（持久化 Cookie / 配置） */
  kv: KeyValueStore | undefined = undefined;
  /** 由 Index 注入：HarmonyHttpClient */
  http: HttpClient | undefined = undefined;

  onBack: () => void = () => {
  };
  /** 本机数据整包（同步到账号用）；由 Index 提供 */
  buildPayload: () => Record<string, Object> = () => {
    const empty: Record<string, Object> = {};
    return empty;
  };
  /** 从账号恢复后把 payload 写回本机；由 Index 提供 */
  applyPayload: (payload: Record<string, Object>) => void = () => {
  };
  onChanged: () => void = () => {
  };

  @State private config: AccountConfig = { baseUrl: ACCOUNT_BASE_DEFAULT };
  @State private mode: string = MODE_IDLE;
  @State private message: string = '';
  @State private messageBad: boolean = false;
  @State private baseUrlText: string = ACCOUNT_BASE_DEFAULT;
  @State private usernameText: string = '';
  @State private passwordText: string = '';
  @State private deletePassword: string = '';
  @State private confirmDelete: boolean = false;
  @State private showLogin: boolean = true;

  aboutToAppear(): void {
    this.load();
  }

  private load(): void {
    if (this.kv === undefined) return;
    const config: AccountConfig = readAccountConfig(this.kv);
    this.config = config;
    this.baseUrlText = config.baseUrl;
  }

  private loggedIn(): boolean {
    return isLoggedIn(this.config);
  }

  private username(): string {
    if (this.config.user === undefined) return '';
    return this.config.user.username;
  }

  private showMessage(text: string, bad: boolean): void {
    this.message = text;
    this.messageBad = bad;
    promptAction.showToast({ message: text, duration: 2200 });
  }

  private saveBaseUrl(): void {
    if (this.kv === undefined) return;
    const normalized: string = normalizeBaseUrl(this.baseUrlText);
    this.baseUrlText = normalized;
    const next: AccountConfig = {
      baseUrl: normalized,
      user: this.config.user,
      cookie: this.config.cookie
    };
    writeAccountConfig(this.kv, next);
    this.config = next;
    this.showMessage('服务地址已保存', false);
  }

  // ============================================================
  // 操作
  // ============================================================

  private async doLogin(): Promise<void> {
    if (this.kv === undefined || this.http === undefined || this.mode === MODE_BUSY) return;
    this.mode = MODE_BUSY;
    const baseUrl: string = normalizeBaseUrl(this.baseUrlText);
    writeAccountConfig(this.kv, { baseUrl: baseUrl, user: this.config.user, cookie: this.config.cookie });
    const result = await login(this.http, this.kv, baseUrl, this.usernameText, this.passwordText);
    this.mode = MODE_IDLE;
    if (!result.ok) {
      this.showMessage(result.error === undefined ? '登录失败' : result.error, true);
      return;
    }
    this.passwordText = '';
    this.load();
    this.showMessage('已登录：' + this.username(), false);
    this.onChanged();
  }

  private async doRegister(): Promise<void> {
    if (this.kv === undefined || this.http === undefined || this.mode === MODE_BUSY) return;
    this.mode = MODE_BUSY;
    const baseUrl: string = normalizeBaseUrl(this.baseUrlText);
    writeAccountConfig(this.kv, { baseUrl: baseUrl, user: this.config.user, cookie: this.config.cookie });
    const result = await register(this.http, this.kv, baseUrl, this.usernameText, this.passwordText);
    this.mode = MODE_IDLE;
    if (!result.ok) {
      this.showMessage(result.error === undefined ? '注册失败' : result.error, true);
      return;
    }
    this.passwordText = '';
    this.load();
    this.showMessage('已注册并登录：' + this.username(), false);
    this.onChanged();
  }

  private async doLogout(): Promise<void> {
    if (this.kv === undefined || this.http === undefined || this.mode === MODE_BUSY) return;
    this.mode = MODE_BUSY;
    await logout(this.http, this.kv, this.config);
    this.mode = MODE_IDLE;
    this.load();
    this.showMessage('已退出登录', false);
    this.onChanged();
  }

  private async doSync(): Promise<void> {
    if (this.kv === undefined || this.http === undefined || this.mode === MODE_BUSY) return;
    this.mode = MODE_BUSY;
    const payload: Record<string, Object> = this.buildPayload();
    const result = await pushProfile(this.http, this.config, payload);
    this.mode = MODE_IDLE;
    if (!result.ok) {
      this.showMessage(result.error === undefined ? '同步失败' : result.error, true);
      return;
    }
    this.showMessage('已同步到账号', false);
  }

  private async doRestore(): Promise<void> {
    if (this.kv === undefined || this.http === undefined || this.mode === MODE_BUSY) return;
    this.mode = MODE_BUSY;
    const result = await me(this.http, this.kv, this.config);
    this.mode = MODE_IDLE;
    if (!result.ok) {
      this.showMessage(result.error === undefined ? '恢复失败' : result.error, true);
      this.load();
      return;
    }
    const payload: Record<string, Object> | undefined = result.value === undefined
      ? undefined
      : result.value.profile as Record<string, Object> | undefined;
    if (payload === undefined) {
      this.showMessage('账号里还没有数据，先「同步到账号」一次', true);
      return;
    }
    this.applyPayload(payload);
    this.load();
    this.showMessage('已从账号恢复（覆盖本机）', false);
    this.onChanged();
  }

  private async doDelete(): Promise<void> {
    if (this.kv === undefined || this.http === undefined || this.mode === MODE_BUSY) return;
    if (this.deletePassword.length === 0) {
      this.showMessage('要输入密码才能删号', true);
      return;
    }
    this.mode = MODE_BUSY;
    const result = await deleteAccount(this.http, this.kv, this.config, this.deletePassword);
    this.mode = MODE_IDLE;
    if (!result.ok) {
      this.showMessage(result.error === undefined ? '删除失败' : result.error, true);
      return;
    }
    this.deletePassword = '';
    this.confirmDelete = false;
    this.load();
    this.showMessage('账号已删除', false);
    this.onChanged();
  }

  // ============================================================
  // 区块
  // ============================================================

  @Builder
  header() {
    Row({ space: 8 }) {
      Text('‹')
        .fontSize(WAFont.titleSm)
        .fontColor(WAColor.ink2)
        .textAlign(TextAlign.Center)
        .width(34)
        .height(34)
        .backgroundColor(WAColor.paper)
        .borderRadius(17)
        .border({ width: 1, color: WAColor.line, radius: 17 })
        .onClick(() => {
          this.onBack();
        })

      Text('账号')
        .fontSize(WAFont.hero)
        .fontWeight(FontWeight.Bold)
        .fontColor(WAColor.ink)

      Blank()

      Text(accountStatusText(this.config))
        .fontSize(WAFont.captionSm)
        .fontColor(this.loggedIn() ? WAColor.teal : WAColor.ink3)
    }
    .width('100%')
    .padding({ bottom: 8 })
  }

  @Builder
  baseUrlRow() {
    Column({ space: 6 }) {
      Text('账号服务地址')
        .fontSize(WAFont.micro)
        .fontColor(WAColor.ink3)
        .letterSpacing(0.8)

      Row({ space: 8 }) {
        TextInput({ placeholder: ACCOUNT_BASE_DEFAULT, text: this.baseUrlText })
          .height(40)
          .fontSize(WAFont.captionSm)
          .layoutWeight(1)
          .backgroundColor(WAColor.paper2)
          .borderRadius(WASize.cardRadiusXs)
          .border({ width: 1, color: WAColor.line, radius: WASize.cardRadiusXs })
          .onChange((value: string) => {
            this.baseUrlText = value;
          })

        Button() {
          Text('保存')
            .fontSize(WAFont.captionSm)
            .fontColor(WAColor.ink)
        }
        .type(ButtonType.Capsule)
        .height(40)
        .padding({ left: 16, right: 16 })
        .backgroundColor(WAColor.amberSoftStrong)
        .border({ width: 1, color: WAColor.amberBorder, radius: WASize.chipRadius })
        .onClick(() => {
          this.saveBaseUrl();
        })
      }
      .width('100%')

      Text('默认连公网 https://xqlounge.top。登录是可选的，不登录也能正常用。')
        .fontSize(WAFont.microSm)
        .fontColor(WAColor.ink3)
        .width('100%')
        .lineHeight(16)
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
  }

  @Builder
  loginForm() {
    Column({ space: 10 }) {
      Column({ space: 6 }) {
        Text('用户名')
          .fontSize(WAFont.micro)
          .fontColor(WAColor.ink3)
          .letterSpacing(0.8)
        TextInput({ placeholder: '3–24 个字符', text: this.usernameText })
          .height(42)
          .fontSize(WAFont.caption)
          .backgroundColor(WAColor.paper2)
          .borderRadius(WASize.cardRadiusXs)
          .border({ width: 1, color: WAColor.line, radius: WASize.cardRadiusXs })
          .onChange((value: string) => {
            this.usernameText = value;
          })
      }
      .alignItems(HorizontalAlign.Start)
      .width('100%')

      Column({ space: 6 }) {
        Text('密码')
          .fontSize(WAFont.micro)
          .fontColor(WAColor.ink3)
          .letterSpacing(0.8)
        TextInput({ placeholder: '至少 6 位', text: this.passwordText })
          .type(InputType.Password)
          .height(42)
          .fontSize(WAFont.caption)
          .backgroundColor(WAColor.paper2)
          .borderRadius(WASize.cardRadiusXs)
          .border({ width: 1, color: WAColor.line, radius: WASize.cardRadiusXs })
          .onChange((value: string) => {
            this.passwordText = value;
          })
      }
      .alignItems(HorizontalAlign.Start)
      .width('100%')

      Button() {
        Text(this.mode === MODE_BUSY ? '请稍候…' : '登录')
          .fontSize(WAFont.titleSm)
          .fontWeight(FontWeight.Medium)
          .fontColor(WAColor.ink)
      }
      .type(ButtonType.Capsule)
      .height(48)
      .width('100%')
      .backgroundColor(WAColor.amber)
      .enabled(this.mode !== MODE_BUSY)
      .opacity(this.mode === MODE_BUSY ? 0.6 : 1)
      .onClick(() => {
        this.doLogin();
      })

      Button() {
        Text('注册并登录')
          .fontSize(WAFont.caption)
          .fontColor(WAColor.ink2)
      }
      .type(ButtonType.Capsule)
      .height(40)
      .width('100%')
      .backgroundColor(WAColor.paper2)
      .border({ width: 1, color: WAColor.line, radius: WASize.chipRadius })
      .enabled(this.mode !== MODE_BUSY)
      .onClick(() => {
        this.doRegister();
      })
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
  }

  @Builder
  loggedInForm() {
    Column({ space: 10 }) {
      Column({ space: 4 }) {
        Text('当前账号')
          .fontSize(WAFont.micro)
          .fontColor(WAColor.ink3)
        Text(this.username())
          .fontSize(WAFont.titleSm)
          .fontWeight(FontWeight.Medium)
          .fontColor(WAColor.ink)
      }
      .alignItems(HorizontalAlign.Start)
      .width('100%')

      this.actionRow('同步到账号（覆盖云端）', true, () => {
        this.doSync();
      })
      this.actionRow('从账号恢复（覆盖本机）', false, () => {
        this.doRestore();
      })
      this.actionRow('退出登录', false, () => {
        this.doLogout();
      })

      if (!this.confirmDelete) {
        Button() {
          Text('删除账号')
            .fontSize(WAFont.captionSm)
            .fontColor(WAColor.ember)
        }
        .type(ButtonType.Capsule)
        .height(36)
        .width('100%')
        .backgroundColor(Color.Transparent)
        .onClick(() => {
          this.confirmDelete = true;
        })
      } else {
        Column({ space: 8 }) {
          Text('删除账号会清掉云端数据，不可撤销。输入密码确认：')
            .fontSize(WAFont.microSm)
            .fontColor(WAColor.ember)
            .width('100%')
          TextInput({ placeholder: '账号密码', text: this.deletePassword })
            .type(InputType.Password)
            .height(40)
            .fontSize(WAFont.caption)
            .backgroundColor(WAColor.paper2)
            .borderRadius(WASize.cardRadiusXs)
            .border({ width: 1, color: WAColor.line, radius: WASize.cardRadiusXs })
            .onChange((value: string) => {
              this.deletePassword = value;
            })
          Row({ space: 8 }) {
            Button() {
              Text('取消')
                .fontSize(WAFont.captionSm)
                .fontColor(WAColor.ink2)
            }
            .type(ButtonType.Capsule)
            .height(38)
            .layoutWeight(1)
            .backgroundColor(WAColor.paper2)
            .border({ width: 1, color: WAColor.line, radius: WASize.chipRadius })
            .onClick(() => {
              this.confirmDelete = false;
              this.deletePassword = '';
            })

            Button() {
              Text('确认删除')
                .fontSize(WAFont.captionSm)
                .fontColor(WAColor.cream)
            }
            .type(ButtonType.Capsule)
            .height(38)
            .layoutWeight(1)
            .backgroundColor(WAColor.ember)
            .onClick(() => {
              this.doDelete();
            })
          }
          .width('100%')
        }
        .width('100%')
      }
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
  }

  @Builder
  actionRow(title: string, primary: boolean, action: () => void) {
    Button() {
      Text(title)
        .fontSize(WAFont.caption)
        .fontWeight(primary ? FontWeight.Medium : FontWeight.Regular)
        .fontColor(primary ? WAColor.ink : WAColor.ink2)
    }
    .type(ButtonType.Capsule)
    .height(44)
    .width('100%')
    .backgroundColor(primary ? WAColor.amber : WAColor.paper2)
    .border({ width: primary ? 0 : 1, color: WAColor.line, radius: WASize.chipRadius })
    .enabled(this.mode !== MODE_BUSY)
    .onClick(() => {
      action();
    })
  }

  build() {
    Column({ space: 0 }) {
      Scroll() {
        Column({ space: 14 }) {
          this.header()

          Column({ space: 14 }) {
            this.baseUrlRow()

            Divider().strokeWidth(1).color(WAColor.line)

            if (this.loggedIn()) {
              this.loggedInForm()
            } else {
              this.loginForm()
            }

            if (this.message.length > 0) {
              Text(this.message)
                .fontSize(WAFont.captionSm)
                .fontColor(this.messageBad ? WAColor.ember : WAColor.teal)
                .width('100%')
            }
          }
          .width('100%')
          .alignItems(HorizontalAlign.Start)
          .padding(16)
          .backgroundColor(WAColor.paper)
          .borderRadius(WASize.cardRadius)
          .border({ width: 1, color: WAColor.line, radius: WASize.cardRadius })
        }
        .width('100%')
        .constraintSize({ maxWidth: WASize.contentMaxWidth })
        .padding({
          left: WASize.pagePadding,
          right: WASize.pagePadding,
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
    .backgroundColor(WAColor.cream)
  }
}