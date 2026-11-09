#!/usr/bin/env node
/**
 * BlindWalk Web 原型端到端冒烟测试：
 * 抽盒 → 模拟步行 → 到达揭晓 → 收进图鉴 → 图鉴/圈子/成就/我的 路由检查。
 * 用法：node scripts/smoke-test.mjs
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const WEB = path.join(ROOT, "prototype", "web");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const RUN_ID = `${process.pid}-${Date.now()}`;
const PORT = 9900 + (process.pid % 90);
const UDD = `/tmp/blindwalk-smoke-${RUN_ID}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Map();
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      } else if (msg.method) {
        (this.listeners.get(msg.method) || []).forEach((fn) => fn(msg.params));
      }
    });
  }
  on(method, fn) {
    const list = this.listeners.get(method) || [];
    list.push(fn);
    this.listeners.set(method, list);
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    this.ws.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
}

async function connectWS(url) {
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  return new CDP(ws);
}

async function main() {
  const chrome = spawn(
    CHROME,
    [
      "--headless=new", "--no-sandbox", "--disable-gpu",
      "--disable-crash-reporter", "--disable-breakpad",
      "--no-first-run", "--no-default-browser-check", "--hide-scrollbars",
      `--remote-debugging-port=${PORT}`, `--user-data-dir=${UDD}`, "about:blank",
    ],
    { stdio: "ignore" }
  );
  const cleanup = () => {
    try { chrome.kill("SIGKILL"); } catch (_) {}
  };
  process.on("exit", cleanup);

  let fail = 0;
  const check = (name, ok, detail = "") => {
    console.log(`${ok ? "✅" : "❌"} ${name}${ok ? "" : "  " + detail}`);
    if (!ok) fail++;
  };
  const wait = (ms) => sleep(ms);

  try {
    let wsURL = null;
    for (let i = 0; i < 60 && !wsURL; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
        if (res.ok) wsURL = (await res.json()).webSocketDebuggerUrl;
      } catch (_) {}
      if (!wsURL) await wait(250);
    }
    if (!wsURL) throw new Error("Chrome 启动失败");

    const browser = await connectWS(wsURL);
    const { targetId } = await browser.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: true });
    await browser.send("Page.enable", {}, sessionId);
    await browser.send("Emulation.setDeviceMetricsOverride",
      { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }, sessionId);

    const exceptions = [];
    browser.on("Runtime.exceptionThrown", (p) => exceptions.push(p.exceptionDetails.text || "JS error"));
    await browser.send("Runtime.enable", {}, sessionId);

    const goto = async (url) => {
      await browser.send("Page.navigate", { url }, sessionId);
      await wait(1200);
    };
    const evalJS = async (expression) => {
      const r = await browser.send("Runtime.evaluate",
        { expression, awaitPromise: true, returnByValue: true }, sessionId);
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
      return r.result.value;
    };
    const click = (sel) => evalJS(`(() => { const n = document.querySelector(${JSON.stringify(sel)}); if (!n) return false; n.click(); return true; })()`);
    const text = () => evalJS("document.body.innerText.replace(/\\s+/g, ' ')");
    const hash = () => evalJS("location.hash");

    const BASE = "file://" + WEB + "/index.html";
    await goto(BASE + "?fresh=1#/home");
    check("首页加载", (await text()).includes("今天，想去哪儿？"));

    await click('[data-action="open-setup"]');
    await wait(500);
    check("打开抽盒 sheet", (await text()).includes("这次的盲盒，你想要什么？"));

    await click('[data-action="shake"]');
    let entered = false;
    for (let i = 0; i < 14 && !entered; i++) {
      await wait(500);
      entered = (await hash()).includes("/journey");
    }
    check("摇盒后进入旅程", entered, await hash());
    const journeyText = await text();
    check("旅程显示剩余距离", /还有\s*\d+\s*米/.test(journeyText), journeyText.slice(0, 80));
    check("旅程不泄露目的地", !journeyText.includes("旧码头边的石阶"));

    let arrived = false;
    for (let i = 0; i < 14 && !arrived; i++) {
      await click('[data-action="walk"]');
      await wait(450);
      const t = await text();
      if (t.includes("揭晓盲盒") || t.includes("为什么是这里")) arrived = true;
    }
    await wait(1500);
    check("模拟步行到达揭晓", arrived || (await text()).includes("揭晓盲盒"));

    // 第一段：开盒动画 → 揭晓盲盒按钮
    await click('[data-action="collect"]');
    await wait(1600);
    check("开盒后显示地点卡", (await text()).includes("为什么是这里"));
    // 第二段：收进图鉴
    await click('[data-action="collect"]');
    await wait(1000);
    const afterCollect = await text();
    check("收进图鉴 toast", afterCollect.includes("已收录") || afterCollect.includes("惊喜值"), afterCollect.slice(-120));

    await evalJS("location.hash = '#/cards'");
    await wait(700);
    check("图鉴路由", (await text()).includes("回忆册"));

    await goto(BASE + "?demo=1#/social");
    const socialText = await text();
    check("圈子路由", socialText.includes("同频码") || socialText.includes("K7M2QX"), socialText.slice(0, 60));
    check("圈子榜单含 305", socialText.includes("305"), socialText.slice(0, 120));

    await evalJS("location.hash = '#/achievements'");
    await wait(700);
    check("成就路由", (await text()).includes("第一次拆盒"));

    await evalJS("location.hash = '#/profile'");
    await wait(700);
    check("我的路由", (await text()).includes("散步 Lv."));

    check("无未捕获 JS 异常", exceptions.length === 0, exceptions.join(" | "));
  } finally {
    cleanup();
  }

  if (fail) {
    console.error(`\n冒烟测试失败 ${fail} 项`);
    process.exit(1);
  }
  console.log("\n全部冒烟测试通过");
}

main().catch((err) => {
  console.error("冒烟测试异常:", err.message);
  process.exit(1);
});
