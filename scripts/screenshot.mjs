#!/usr/bin/env node
/**
 * Walkaholic 截图流水线：用 Chrome DevTools Protocol 精确模拟 390×844 @2x 视口。
 * 为什么不用 --screenshot：Chrome headless 有最小窗口限制（约 500×701），
 * 会把 390 宽视口抬到 500，触发原型的桌面设备外框模式，截出来是裁切的。
 *
 * 用法：node scripts/screenshot.mjs
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const WEB = path.join(ROOT, "prototype", "web");
const OUT = path.join(ROOT, "screenshots");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const RUN_ID = `${process.pid}-${Date.now()}`;
const PORT = 9400 + (process.pid % 400);
const UDD = `/tmp/walkaholic-cdp-${RUN_ID}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const withTimeout = (p, ms, label) =>
  Promise.race([
    p,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} 超时`)), ms)),
  ]);

const BASE = "file://" + WEB + "/index.html";
const SHOTS = [
  ["01-home.png", BASE + "?demo=1#/home", 390, 844],
  ["02-setup.png", BASE + "?demo=1#/setup", 390, 844],
  ["03-journey.png", BASE + "?demo=1#/journey", 390, 844],
  ["04-reveal.png", BASE + "?demo=1#/reveal", 390, 844],
  ["05-cards.png", BASE + "?demo=1#/cards", 390, 844],
  ["06-social.png", BASE + "?demo=1#/social", 390, 844],
  ["07-profile.png", BASE + "?demo=1#/profile", 390, 844],
  ["08-achievements.png", BASE + "?demo=1#/achievements", 390, 844],
  ["09-watch.png", "file://" + WEB + "/watch.html", 760, 360],
];

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.events = new Map();
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      } else if (msg.method) {
        const list = this.events.get(msg.method) || [];
        this.events.set(msg.method, []);
        list.forEach((fn) => fn(msg.params));
      }
    });
    ws.addEventListener("close", () => {
      for (const { reject } of this.pending.values()) reject(new Error("WebSocket 已关闭"));
      this.pending.clear();
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    this.ws.send(JSON.stringify(payload));
    return withTimeout(
      new Promise((resolve, reject) => this.pending.set(id, { resolve, reject })),
      15000,
      method
    );
  }
}

async function connectWS(url) {
  const ws = new WebSocket(url);
  await withTimeout(
    new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve, { once: true });
      ws.addEventListener("error", reject, { once: true });
    }),
    5000,
    "WebSocket 连接"
  );
  return new CDP(ws);
}

async function waitForChrome(timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (res.ok) return (await res.json()).webSocketDebuggerUrl;
    } catch (_) {}
    await sleep(250);
  }
  throw new Error("Chrome CDP 启动超时");
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  rmSync(UDD, { recursive: true, force: true });
  mkdirSync(UDD, { recursive: true });

  const chrome = spawn(
    CHROME,
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-crash-reporter",
      "--disable-breakpad",
      "--no-first-run",
      "--no-default-browser-check",
      "--hide-scrollbars",
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${UDD}`,
      "about:blank",
    ],
    { stdio: "ignore" }
  );

  const cleanup = () => {
    try {
      chrome.kill("SIGKILL");
    } catch (_) {}
    rmSync(UDD, { recursive: true, force: true });
  };
  process.on("exit", cleanup);
  process.on("SIGINT", () => process.exit(130));
  process.on("SIGTERM", () => process.exit(143));

  try {
    const browserURL = await waitForChrome();
    const browser = await connectWS(browserURL);
    const { targetId } = await browser.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: true });

    await browser.send("Page.enable", {}, sessionId);
    await browser.send("Runtime.enable", {}, sessionId);
    await browser.send(
      "Emulation.setEmulatedMedia",
      { features: [{ name: "prefers-reduced-motion", value: "reduce" }] },
      sessionId
    );

    for (const [name, url, width, height] of SHOTS) {
      await browser.send(
        "Emulation.setDeviceMetricsOverride",
        { width, height, deviceScaleFactor: 2, mobile: width < 500 },
        sessionId
      );
      await browser.send("Page.navigate", { url }, sessionId);
      await sleep(1500);
      const shot = await browser.send(
        "Page.captureScreenshot",
        { format: "png", fromSurface: true, captureBeyondViewport: false },
        sessionId
      );
      const bytes = Buffer.from(shot.data, "base64");
      if (bytes.length < 5000) throw new Error(`${name} 截图过小：${bytes.length}B`);
      writeFileSync(path.join(OUT, name), bytes);
      console.log("ok  " + name + "  " + width + "×" + height + " @2x");
    }

    browser.send("Browser.close").catch(() => {});
    await sleep(200);
  } finally {
    cleanup();
  }
}

main().catch((err) => {
  console.error("截图失败:", err.message);
  process.exit(1);
});
