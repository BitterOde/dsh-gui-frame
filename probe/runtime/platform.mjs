// 探针用平台加载器：从**本机 DSH 安装目录**加载真平台库（@deepseek-ai/cordis +
// @deepseek-ai/cordis-plugin-loader），并保证两者共用同一份 cordis 实例
// （插件包节点里若另装一份 cordis，Service 身份不一致会让结论失真）。
//
// 只读：不写 profile、不碰 127.0.0.1:3080 上正在跑的 GUI、不监听任何端口。
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** 本机 DSH 安装目录（顺序：环境变量 → npm 全局 → 本包 junction 反推）。 */
export function resolveDshInstallDir() {
  const candidates = []
  if (process.env.DSH_INSTALL_DIR) candidates.push(process.env.DSH_INSTALL_DIR)
  if (process.env.APPDATA) candidates.push(join(process.env.APPDATA, 'npm', 'node_modules', '@deepseek-ai', 'dsh'))
  for (const dir of candidates) if (existsSync(join(dir, 'package.json'))) return dir
  const req = createRequire(import.meta.url)
  try {
    // 本包 devDeps 里 @deepseek-ai/cordis 是指向 DSH 安装的 junction：
    //   <dsh>/node_modules/@deepseek-ai/cordis/package.json → 上溯 4 级即 <dsh>
    return join(req.resolve('@deepseek-ai/cordis/package.json'), '..', '..', '..', '..')
  } catch {}
  throw new Error('探针：找不到本机 DSH 安装目录，请设 DSH_INSTALL_DIR 环境变量指向 @deepseek-ai/dsh 包根')
}

/** 加载真平台库。 */
export async function loadPlatform() {
  const root = resolveDshInstallDir()
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const req = createRequire(join(root, 'package.json'))
  const cordisUrl = pathToFileURL(req.resolve('@deepseek-ai/cordis')).href
  const loaderUrl = pathToFileURL(req.resolve('@deepseek-ai/cordis-plugin-loader')).href
  const cordis = await import(cordisUrl)
  const loader = await import(loaderUrl)
  return {
    dshInstallDir: root,
    dshVersion: manifest.version,
    cordisUrl,
    loaderUrl,
    Context: cordis.Context,
    Loader: loader.default ?? loader.Loader,
    cordisVersion: manifest.dependencies?.['@deepseek-ai/cordis'] ?? 'unknown',
  }
}
