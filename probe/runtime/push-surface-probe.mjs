// 探针 P5：推送半边（API Gateway 的 WebSocket mux 有没有第三方可订阅面）
//
// 要回答的只有一个问题：**API Gateway 的 WebSocket mux 有没有对第三方插件开放的可订阅面**？
// 做法：对网关的 node 侧与浏览器侧产物、以及它依赖的两个契约文件做定点抽取，逐条落成证据：
//   ① 浏览器侧 `ctx.connection.rpc.open` 是否存在（连接包的公开契约原文）
//   ② mux 的寻址单位是什么（客户端 mux 与 host mux 的 open/opener 契约）
//   ③ 两个"可以接管"的入口是不是单占位（registerRemoteEvents / registerGenerationSource）
//   ④ 客户端命名空间从哪来（ClientRemoteService 的装配选择）
//   ⑤ 页面能否从全局塞入自己的流载体（__DSH_TRANSPORT__.openStream 的适用条件）
// 只读：不写 profile、不监听端口、不碰正在跑的 GUI。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveDshInstallDir } from './platform.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const pkgRoot = join(resolveDshInstallDir(), 'node_modules', '@deepseek-ai')
const evidenceDir = join(here, '..', 'evidence')

const files = {
  gatewayHost: join(pkgRoot, 'dsh-api-gateway', 'lib', 'index.js'),
  gatewayClient: join(pkgRoot, 'dsh-api-gateway', 'lib', 'client.js'),
  gatewayHostTypes: join(pkgRoot, 'dsh-api-gateway', 'lib', 'types', 'index.d.ts'),
  streamClientTypes: join(pkgRoot, 'dsh-api-gateway', 'lib', 'types', 'client', 'stream-client.d.ts'),
  streamServerTypes: join(pkgRoot, 'dsh-api-gateway', 'lib', 'types', 'stream-server.d.ts'),
  streamProtocolTypes: join(pkgRoot, 'dsh-api-gateway', 'lib', 'types', 'stream-protocol.d.ts'),
  gatewayClientTypes: join(pkgRoot, 'dsh-api-gateway', 'lib', 'types', 'client', 'index.d.ts'),
  connectionRpcTypes: join(pkgRoot, 'dsh-client-connection', 'lib', 'types', 'rpc.d.ts'),
  connectionClientTypes: join(pkgRoot, 'dsh-client-connection', 'lib', 'types', 'client', 'index.d.ts'),
  typertRegistryTypes: join(pkgRoot, 'dsh-typert-registry', 'lib', 'types', 'index.d.ts'),
}

/** 抓一个锚点附近的原文（用于取证引用）。 */
function grab(text, anchor, before = 0, after = 300) {
  const at = text.indexOf(anchor)
  if (at === -1) return { anchor, found: false }
  return { anchor, found: true, offset: at, slice: text.slice(Math.max(0, at - before), at + anchor.length + after) }
}

const read = (path) => readFileSync(path, 'utf8')
const slices = {}
const write = (name, content) => {
  const path = join(evidenceDir, name)
  writeFileSync(path, content, 'utf8')
  return path
}

const connectionRpcTypes = read(files.connectionRpcTypes)
const connectionClientTypes = read(files.connectionClientTypes)
const gatewayHost = read(files.gatewayHost)
const streamClientTypes = read(files.streamClientTypes)
const gatewayClientTypes = read(files.gatewayClientTypes)

// ① 浏览器侧 rpc.open 的原文（一句定性）
slices.browserRpcOpen = grab(connectionRpcTypes, 'readonly open?:', 600, 300)
slices.connectionHandleSoleSource = grab(connectionClientTypes, 'registerGenerationSource(source', 400, 120)
slices.connectionHandleStart = grab(connectionClientTypes, 'API Gateway owns the loop; a second call throws', 500, 60)
slices.transportHooksOpenStream = grab(connectionClientTypes, 'Worker-local Gateway stream carrier', 400, 200)

// ② mux 的寻址单位
slices.muxClientOpen = grab(streamClientTypes, 'open(endpoint: string', 700, 300)
slices.muxServerOpener = grab(read(files.streamServerTypes), 'export type RemoteStreamOpener', 0, 260)
slices.remoteStreamOptions = grab(read(join(pkgRoot, 'dsh-api-gateway', 'lib', 'types', 'client', 'remote-stream.d.ts')), 'Domain-owned operations used by', 0, 700)

// ③ 两个单占位入口
slices.registerRemoteEventsThrows = grab(gatewayHost, 'forwarded Remote event source is already registered', 300, 100)
slices.registerRemoteEventsDoc = grab(read(files.gatewayHostTypes), 'Register the sole application-selected forwarded-event source', 400, 300)

// ④ 客户端命名空间是装配选择的
slices.clientNamespacesDoc = grab(gatewayClientTypes, 'Client projection of generated Typert Remote descriptors', 0, 420)
slices.namespaceSetBuild = grab(read(files.gatewayClient), 'const namespaces = new Set([...direct.keys(), ...scoped.keys()])', 900, 200)

// ⑤ Typert 运行时注册面（若要走推送，这是必付的代价）
slices.typertRegister = grab(read(files.typertRegistryTypes), 'register(contribution: TypertContribution)', 300, 200)

const verdicts = {
  browserRpcOpenMissing: /Browser transports omit this method/.test(connectionRpcTypes) && !/open\?:/.test(connectionClientTypes),
  muxAddressesTypertEndpoints: /endpoint - Typert Remote stream endpoint/.test(streamClientTypes),
  remoteEventsSingleOccupant: /is already registered/.test(gatewayHost) && /sole application-selected forwarded-event source/.test(read(files.gatewayHostTypes)),
  generationSourceSoleAndStartThrows: /sole source defining Host generations/.test(connectionClientTypes) && /a second call throws/.test(connectionClientTypes),
  transportOpenStreamIsShellOwned: /Worker-local Gateway stream carrier; absent when the page uses the Gateway WebSocket/.test(connectionClientTypes),
  typertRegisterIsPublic: /register\(contribution: TypertContribution\)/.test(read(files.typertRegistryTypes)),
}

for (const [name, value] of Object.entries(slices)) {
  const body = value.found ? `# anchor: ${value.anchor}\n# offset: ${value.offset}\n\n${value.slice}\n` : `# anchor NOT FOUND: ${value.anchor}\n`
  write(`p5-${name}.txt`, body)
}

const report = {
  question: 'API Gateway 的 WebSocket mux 是否暴露可供第三方订阅的面？',
  // 证据档**不写本机绝对路径**：安装根一律记成 `<dsh-install>`（公开仓里不留用户名/盘符）。
  files: Object.fromEntries(Object.entries(files).map(([key, abs]) => [key, `<dsh-install>/${relative(pkgRoot, abs).split(sep).join('/')}`])),
  verdicts,
  slices: Object.fromEntries(Object.entries(slices).map(([name, value]) => [name, { anchor: value.anchor, found: value.found, offset: value.offset ?? null }])),
}
const evidencePath = join(evidenceDir, 'p5-push-surface.json')
mkdirSync(evidenceDir, { recursive: true })
writeFileSync(evidencePath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

console.log(`P5 完成，证据：${evidencePath}`)
for (const [key, value] of Object.entries(verdicts)) console.log(`  ${value ? 'PASS' : 'FAIL'}  ${key}`)
for (const [name, value] of Object.entries(slices)) if (!value.found) console.log(`  ⚠ 锚点未命中：${name} → ${value.anchor}`)
