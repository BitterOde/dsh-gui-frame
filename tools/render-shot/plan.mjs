// tools/render-shot/plan.mjs —— 由 render-shot.mjs 按职责拆分（块级逐字搬运，未改写实现）
// 页面计划 / 截图步骤 / 启动开关的构造

import { fontsReadyCommand, wakeFullPageCommand } from './expressions.mjs';

export function buildPagePlan(options) {
  const { url, width, height, fullPage = false } = options;
  const steps = [
    { method: 'Page.enable', params: {} },
    { method: 'Runtime.enable', params: {} },
    // deviceScaleFactor 固定为 1：Windows 上 125% 缩放会让"截 1280 宽"变成 1600 像素宽，
    // 与设计稿像素比对时对不上号。要高清图就显式放大视口，不要靠系统 DPI 漂。
    { method: 'Emulation.setDeviceMetricsOverride', params: { width, height, deviceScaleFactor: 1, mobile: false } },
    { method: 'Page.navigate', params: { url } },
    fontsReadyCommand(),
  ];
  if (fullPage) steps.push(wakeFullPageCommand());
  return steps;
}

/**
 * 量完高度后的收尾命令：整页要先把设备指标"撑"到内容高度再拍，
 * 否则 `captureBeyondViewport` 在部分版本上只给视口那一块。
 * 给了 `clip`（按选择器裁剪）时**只拍那一块**：不再撑设备指标（撑了会改布局），
 * 靠 `captureBeyondViewport` 保证"元素在折线以下"时也拍得到。
 */
export function buildCaptureSteps(options) {
  const { width, pageHeight, fullPage = false, clip = null } = options;
  const steps = [];
  if (clip !== null) {
    steps.push({
      method: 'Page.captureScreenshot',
      params: {
        format: 'png',
        fromSurface: true,
        captureBeyondViewport: true,
        clip: { x: clip.x, y: clip.y, width: clip.width, height: clip.height, scale: 1 },
      },
    });
    return steps;
  }
  if (fullPage) {
    steps.push({
      method: 'Emulation.setDeviceMetricsOverride',
      params: { width, height: pageHeight, deviceScaleFactor: 1, mobile: false },
    });
  }
  steps.push({
    method: 'Page.captureScreenshot',
    params: { format: 'png', fromSurface: true, captureBeyondViewport: fullPage },
  });
  return steps;
}

/** 浏览器启动开关。每一条都要能回答"不写它会怎样"。 */
export function buildLaunchArgs(options) {
  const { userDataDir, width, height, port, fullPage = false } = options;
  const args = [
    '--headless=new', // 无窗口：不抢焦点、不出现在任务栏（这是"不动电脑输入"的根）
    `--user-data-dir=${userDataDir}`, // 专属 profile：不和用户的浏览器会话搅在一起
    `--remote-debugging-port=${port}`, // CDP 入口（只绑回环）
    '--remote-debugging-address=127.0.0.1',
    '--remote-allow-origins=*', // Node 的 WebSocket 握手可能带 Origin，不给就 403
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu', // 无头下走软件光栅，避免驱动差异导致的空白帧
    '--hide-scrollbars', // 滚动条会占掉视口宽度，截图里多一条灰边
    '--mute-audio',
    '--incognito',
    '--disable-extensions',
    '--disable-default-apps',
    '--disable-sync',
    '--disable-component-update',
    '--disable-background-networking', // 不联网：不做后台探测/上报/组件更新
    '--disable-client-side-phishing-detection',
    '--disable-desktop-notifications',
    '--disable-features=Translate,MediaRouter,OptimizationHints,AcceptCHFrame',
    '--force-device-scale-factor=1',
    `--window-size=${width},${height}`,
    // 本地设计稿常带同目录的图片/字体；file:// 页面默认禁止跨文件 XHR，给这条省掉一类"图没出来"
    '--allow-file-access-from-files',
  ];
  if (fullPage) {
    // 借参考实现的做法：loading="lazy" 的图在整页截图时根本不进视口 ⇒ 直接全局关掉懒加载
    args.push('--blink-settings=imagesLazyLoadingEnabled=false');
  }
  return args;
}

// ── PNG 校验（纯函数）──────────────────────────────────────────────────────────

/** PNG 魔数：0x89 'P' 'N' 'G'。 */
