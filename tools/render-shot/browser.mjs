// tools/render-shot/browser.mjs —— 由 render-shot.mjs 按职责拆分（块级逐字搬运，未改写实现）
// 浏览器可执行文件探测（候选表 / 只认存在的第一条）

import { existsSync } from 'node:fs';
import path from 'node:path';

export function browserCandidates(env = {}, platform = process.platform) {
  const out = [];
  const add = (value) => {
    if (typeof value === 'string' && value !== '' && !out.includes(value)) out.push(value);
  };
  // 显式覆盖优先（也是"本机没有 Chrome 只有 Edge / 装在非标准位置"的逃生口）
  add(env.GUIF_BROWSER_PATH);
  add(env.CHROME_PATH);
  add(env.PUPPETEER_EXECUTABLE_PATH);
  if (platform === 'win32') {
    const join = path.win32.join;
    const pf = env.PROGRAMFILES;
    const pfx86 = env['PROGRAMFILES(X86)'];
    const local = env.LOCALAPPDATA;
    if (pfx86) add(join(pfx86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
    if (pf) add(join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
    if (local) add(join(local, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
    if (pf) add(join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'));
    if (pfx86) add(join(pfx86, 'Google', 'Chrome', 'Application', 'chrome.exe'));
    if (local) {
      add(join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'));
      add(join(local, 'Chromium', 'Application', 'chrome.exe'));
    }
  } else if (platform === 'darwin') {
    add('/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge');
    add('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
    add('/Applications/Chromium.app/Contents/MacOS/Chromium');
  } else {
    add('/usr/bin/microsoft-edge');
    add('/usr/bin/microsoft-edge-stable');
    add('/usr/bin/google-chrome');
    add('/usr/bin/google-chrome-stable');
    add('/usr/bin/chromium');
    add('/usr/bin/chromium-browser');
  }
  return out;
}

/**
 * 找到第一个真实存在的候选。
 * @param {{env?:object, platform?:string, exists?:(p:string)=>boolean, explicit?:string|null}} [options]
 * @returns {{path:string, source:string}|null} `source` 说明"从哪条路找到的"（排查用）
 */
export function findBrowserExecutable(options = {}) {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const exists = options.exists ?? existsSync;
  const explicit = typeof options.explicit === 'string' && options.explicit !== '' ? options.explicit : null;
  if (explicit !== null) {
    return exists(explicit) ? { path: explicit, source: '--browser' } : null;
  }
  const pinned = [env.GUIF_BROWSER_PATH, env.CHROME_PATH, env.PUPPETEER_EXECUTABLE_PATH].filter(
    (value) => typeof value === 'string' && value !== '',
  );
  for (const candidate of browserCandidates(env, platform)) {
    if (exists(candidate)) return { path: candidate, source: pinned.includes(candidate) ? 'env' : 'auto' };
  }
  return null;
}

// ── 参数解析（纯函数）──────────────────────────────────────────────────────────

/** 把 `--k=v` 拆成 `['--k','v']`，`--k` 原样返回（两种写法都收）。 */
