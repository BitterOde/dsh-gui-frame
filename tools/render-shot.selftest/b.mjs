// tools/render-shot.selftest/b.mjs —— 由 render-shot.selftest.mjs 按职责拆分（块级逐字搬运，未改写实现）
// B 组：浏览器探测的候选表与顺序

import { assert, check } from './kit.mjs';
import { existsSync, statSync } from 'node:fs';
import { browserCandidates, findBrowserExecutable } from '../render-shot.mjs';

export function runB() {
check('B1 win32 候选表含本机的两条 Edge 标准路径', () => {
  const candidates = browserCandidates({ PROGRAMFILES: 'C:\\PF', 'PROGRAMFILES(X86)': 'C:\\PFX86' }, 'win32');
  assert(
    candidates.includes('C:\\PFX86\\Microsoft\\Edge\\Application\\msedge.exe'),
    `候选表缺 Edge x86 路径：${JSON.stringify(candidates)}`,
  );
  assert(candidates.includes('C:\\PF\\Microsoft\\Edge\\Application\\msedge.exe'), '候选表缺 Edge x64 路径');
  assert(candidates.includes('C:\\PF\\Google\\Chrome\\Application\\chrome.exe'), '候选表缺 Chrome 路径');
});
check('B2 环境变量覆盖排在最前（逃生口）', () => {
  const candidates = browserCandidates({ GUIF_BROWSER_PATH: 'D:\\x\\msedge.exe', CHROME_PATH: 'D:\\y\\chrome.exe' });
  assert(candidates[0] === 'D:\\x\\msedge.exe', `GUIF_BROWSER_PATH 应是首选项，实得 ${candidates[0]}`);
  assert(candidates[1] === 'D:\\y\\chrome.exe', 'CHROME_PATH 应排第二');
});
check('B3 findBrowserExecutable 只认真实存在的第一条', () => {
  const targets = ['C:\\a.exe', 'C:\\b.exe', 'C:\\c.exe'];
  const hit = findBrowserExecutable({
    env: { GUIF_BROWSER_PATH: targets[0], CHROME_PATH: targets[1] },
    platform: 'win32',
    exists: (candidate) => candidate === 'C:\\b.exe',
  });
  assert(hit !== null && hit.path === 'C:\\b.exe', `应命中 CHROME_PATH 那条，实得 ${JSON.stringify(hit)}`);
  assert(hit.source === 'env', `来源应标 env，实得 ${hit.source}`);
});
check('B4 一个都不存在时返回 null（由调用方决定怎么报错）', () => {
  const hit = findBrowserExecutable({ env: {}, platform: 'win32', exists: () => false });
  assert(hit === null, `应返回 null，实得 ${JSON.stringify(hit)}`);
});
check('B5 --browser 指定的路径不存在时必须返回 null（不许偷偷回退到自动探测）', () => {
  const hit = findBrowserExecutable({
    env: {},
    platform: 'win32',
    exists: (candidate) => candidate !== 'C:\\missing.exe',
    explicit: 'C:\\missing.exe',
  });
  assert(hit === null, `显式路径不存在应返回 null，实得 ${JSON.stringify(hit)}`);
});
check('B6 本机标准路径里确实找得到浏览器（只查存在性，不启动）', () => {
  const hit = findBrowserExecutable({ env: process.env, platform: process.platform, exists: existsSync });
  assert(hit !== null, '本机按默认候选一条都没找到 Edge/Chrome/Chromium');
  assert(statSync(hit.path).isFile(), `命中的不是文件：${hit.path}`);
});

// ── C. 路径推导（临时目录里造一个最小 HTML）────────────────────────────────────
}
