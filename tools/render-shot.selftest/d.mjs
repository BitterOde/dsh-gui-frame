// tools/render-shot.selftest/d.mjs —— 由 render-shot.selftest.mjs 按职责拆分（块级逐字搬运，未改写实现）
// D 组：页面计划 / 截图步骤 / 启动开关的形状

import { assert, check } from './kit.mjs';
import { buildCaptureSteps, buildLaunchArgs, buildPagePlan, fontsReadyCommand, pageHeightCommand, wakeFullPageCommand } from '../render-shot.mjs';

export function runD() {
const FILE_URL = 'file:///D:/tmp/design.html';
check('D1 页面计划：先开域 → 定视口 → 再导航（顺序即语义）', () => {
  const plan = buildPagePlan({ url: FILE_URL, width: 800, height: 600, fullPage: false });
  assert(
    plan.map((step) => step.method).join(',') ===
      'Page.enable,Runtime.enable,Emulation.setDeviceMetricsOverride,Page.navigate,Runtime.evaluate',
    `计划顺序不对：${plan.map((step) => step.method).join(',')}`,
  );
  const metrics = plan[2].params;
  assert(metrics.width === 800 && metrics.height === 600, '视口尺寸没进设备指标');
  assert(metrics.deviceScaleFactor === 1, `deviceScaleFactor 必须是 1（否则系统 DPI 会让像素宽度漂），实得 ${metrics.deviceScaleFactor}`);
  assert(metrics.mobile === false, 'mobile 必须是 false');
  assert(plan[3].params.url === FILE_URL, `导航 URL 不对：${plan[3].params.url}`);
  assert(plan.length === 5, `非整页计划不该有唤醒步骤，实得 ${plan.length} 步`);
});
check('D2 整页计划多一步"唤醒"，且不去动视口高度', () => {
  const plan = buildPagePlan({ url: FILE_URL, width: 800, height: 600, fullPage: true });
  assert(plan.length === 6, `整页计划应有 6 步，实得 ${plan.length}`);
  assert(plan[5].method === 'Runtime.evaluate', '第 6 步应是唤醒用的 Runtime.evaluate');
  assert(plan[5].params.expression.includes('scrollBehavior'), '唤醒表达式应关掉平滑滚动（否则滚动扫描几乎不动）');
  assert(plan[2].params.height === 600, '整页模式下视口高度仍应是请求高度（内容高度是量出来的）');
});
check('D3 唤醒步骤与量高步骤是同一份字面量（不各写一遍）', () => {
  assert(wakeFullPageCommand().params.expression.includes('loading'), '唤醒表达式应处理 loading="lazy"');
  const height = pageHeightCommand();
  assert(height.method === 'Runtime.evaluate', `量高命令方法不对：${height.method}`);
  assert(height.params.returnByValue === true, '量高必须 returnByValue，否则拿到的是远程对象而不是数字');
  assert(height.params.expression.includes('scrollHeight'), '量高表达式应取 scrollHeight');
  assert(height.params.expression.includes('innerHeight'), '量高表达式应把视口高度算进上界（空页不能报 0）');
});
check('D4 等字体那步必须 awaitPromise（否则拿到的是 Promise 对象）', () => {
  const step = fontsReadyCommand();
  assert(step.method === 'Runtime.evaluate', 'D4：方法不对');
  assert(step.params.awaitPromise === true, 'awaitPromise 必须是 true');
  assert(step.params.expression.includes('fonts'), 'D4：表达式应等 fonts.ready');
});
check('D5 整页截图：先撑设备指标到内容高度，再带 captureBeyondViewport 拍', () => {
  const steps = buildCaptureSteps({ width: 800, height: 600, pageHeight: 2400, fullPage: true });
  assert(steps.length === 2, `整页收尾应是 2 步，实得 ${steps.length}`);
  assert(steps[0].method === 'Emulation.setDeviceMetricsOverride', `第一步应是撑设备指标，实得 ${steps[0].method}`);
  assert(steps[0].params.height === 2400, `设备指标高度应等于页面高度，实得 ${steps[0].params.height}`);
  assert(steps[0].params.width === 800, '撑高度不能改宽度');
  assert(steps[1].method === 'Page.captureScreenshot', `第二步应是截图，实得 ${steps[1].method}`);
  assert(steps[1].params.format === 'png', '截图格式必须是 png');
  assert(steps[1].params.captureBeyondViewport === true, '整页必须开 captureBeyondViewport');
  assert(steps[1].params.fromSurface === true, 'fromSurface 应为 true');
});
check('D6 视口截图：不撑高度、不开 captureBeyondViewport', () => {
  const steps = buildCaptureSteps({ width: 800, height: 600, pageHeight: null, fullPage: false });
  assert(steps.length === 1, `视口收尾应只有 1 步，实得 ${steps.length}`);
  assert(steps[0].method === 'Page.captureScreenshot', 'D6：最后一步应是截图');
  assert(steps[0].params.captureBeyondViewport === false, '视口模式不应越出视口');
});
check('D7 启动开关：无头 + 专属 profile + 回环 CDP 端口 + 断网', () => {
  const args = buildLaunchArgs({ userDataDir: 'C:\\tmp\\guif-1', width: 1280, height: 900, port: 9222, fullPage: false });
  assert(args.includes('--headless=new'), '必须是 --headless=new（无窗口 = 不抢焦点）');
  assert(!args.some((arg) => arg.includes('headless=old')), '不许退回旧无头模式');
  assert(args.includes('--user-data-dir=C:\\tmp\\guif-1'), '必须用专属 user-data-dir');
  assert(args.includes('--remote-debugging-port=9222'), 'CDP 端口没进开关');
  assert(args.includes('--remote-debugging-address=127.0.0.1'), 'CDP 只应绑回环');
  assert(args.includes('--disable-background-networking'), '必须断后台网络');
  assert(args.includes('--hide-scrollbars'), '应隐藏滚动条（否则截图多一条边）');
  assert(args.includes('--force-device-scale-factor=1'), '像素宽度必须与请求一致');
  assert(!args.some((arg) => arg.includes('blink-settings')), '非整页不该带懒加载开关');
});
check('D8 整页才追加"关掉懒加载"的 blink 开关', () => {
  const args = buildLaunchArgs({ userDataDir: 'X', width: 800, height: 600, port: 1, fullPage: true });
  assert(
    args.includes('--blink-settings=imagesLazyLoadingEnabled=false'),
    '整页模式应关掉图片懒加载（视口外的图否则根本不加载）',
  );
});

// ── E. 截图为空 / 非 PNG 的守门 ────────────────────────────────────────────────
}
