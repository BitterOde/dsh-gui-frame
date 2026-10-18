/**
 * public-surface.test.mjs —— 独立复验（一）：**L1 公开面冻结**。
 *
 * 覆盖验收：
 *   ① 存在单测做公开面**逐字节比对**，且覆盖**服务成员 / components 名 / slot 键 / inject 列表 / 错误码集合**；
 *   ② 声明 ↔ 运行期 ↔ 快照**三方一致**：服务成员与能力集由**运行期反射**得来（原型链上的方法 + 取值器，
 *      以及实例自有字段，减掉载体字段 `ctx`），不是读实现方自带的 `describePublicSurface()` —— 那样等于让被验方自证。
 *
 * 独立性要点：
 *   - 快照由本文件**自己重新推导**并用自己的序列化器（`serializeSurface`）与之逐字节比对；
 *   - 服务名也不是读常量，而是**运行期取证**：跑一次真 `provideService(ctx)`，看它到底 provide 了哪个名字；
 *   - 错误码走**源码文本块扫描**（两个冻结数组块），而不是读 `ALL_CODES`；另加一条「src 里用到的码 ⊆ 冻结集合」。
 * 只读：本文件不写任何文件（写盘在 TEMP 副本里做）。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  SNAPSHOT_PATH,
  SURFACE_KEYS,
  collectCodesFromText,
  createCtx,
  listFilesRecursive,
  readSnapshotJson,
  readSnapshotText,
  serializeSurface,
  srcPath,
} from './harness.mjs';

const load = (rel) => import(pathToFileURL(srcPath(...rel.split('/'))).href);

const [serviceFace, componentsMod, errorsMod, serviceMod] = await Promise.all([
  load('client/contracts/service-face.mjs'),
  load('client/contracts/components.mjs'),
  load('client/contracts/errors.mjs'),
  load('client/service.mjs'),
]);

/** 运行期成员：整条原型链上的方法 + 取值器（排除 `__` 内部面与 constructor）。 */
function prototypeMembers(instance) {
  const methods = new Set();
  const getters = new Set();
  for (let proto = Object.getPrototypeOf(instance); proto !== null && proto !== Object.prototype; proto = Object.getPrototypeOf(proto)) {
    for (const [name, desc] of Object.entries(Object.getOwnPropertyDescriptors(proto))) {
      if (name === 'constructor' || name.startsWith('__')) continue;
      if (typeof desc.value === 'function') methods.add(name);
      else if (typeof desc.get === 'function') getters.add(name);
    }
  }
  return { methods: [...methods].sort(), getters: [...getters].sort() };
}

/** 某个命名空间面自身的公开成员（原型上的非 `__` 成员）。 */
function faceMembers(face) {
  return Object.getOwnPropertyNames(Object.getPrototypeOf(face))
    .filter((name) => name !== 'constructor' && !name.startsWith('__'))
    .sort();
}

/** 由**实现 + 声明 + 运行期**重新推导公开面（顺序恒为 `SURFACE_KEYS`）。 */
function deriveSurface() {
  const provider = createCtx({ label: 'provider' });
  const result = serviceMod.provideService(provider, {});
  const service = result.service;
  const { methods, getters } = prototypeMembers(service);
  const carrier = [...serviceFace.SERVICE_CARRIER_FIELDS];
  const ownFields = Object.keys(service).filter((name) => !name.startsWith('__'));
  const members = [...new Set([...methods, ...getters, ...ownFields])].filter((name) => !carrier.includes(name)).sort();
  const codes = collectCodesFromText(readFileSync(srcPath('client', 'contracts', 'errors.mjs'), 'utf8'));
  const values = {
    service: [...provider.provided.keys()].join(','), // 运行期取证：provide 的真实名字
    version: service.version,
    capabilities: [...service.capabilities].sort(),
    serviceMembers: members,
    components: [...componentsMod.COMPONENT_NAMES].sort(),
    slots: [...serviceFace.CONSUMED_SLOT_KEYS].sort(),
    inject: [...serviceFace.PLATFORM_SERVICE_KEYS].sort(),
    errorCodes: codes,
  };
  const surface = {};
  for (const key of SURFACE_KEYS) surface[key] = values[key];
  return { surface, service, provider, result, methods, getters, ownFields, codes };
}

test('公开面逐字节比对：服务成员 / components 名 / slot 键 / inject 列表 / 错误码集合', () => {
  const derived = deriveSurface();
  assert.equal(derived.result.owned, true, '服务必须真的被 provide —— 上面的字段全是从运行期实例上取的');
  assert.equal(derived.surface.service, 'gui-frame', '服务名必须由运行期取证（provide 的真实名字）');

  // ① 字段顺序也是契约
  assert.deepEqual(Object.keys(derived.surface), [...SURFACE_KEYS]);
  for (const key of ['capabilities', 'serviceMembers', 'components', 'slots', 'inject', 'errorCodes']) {
    assert.ok(Array.isArray(derived.surface[key]) && derived.surface[key].length > 0, `${key} 必须是非空数组`);
  }

  // ② 逐字节比对
  const onDisk = readSnapshotText();
  assert.equal(
    serializeSurface(derived.surface),
    onDisk,
    `公开面与快照档 ${SNAPSHOT_PATH} 不一致：改公开面就必须显式跑 node scripts/public-surface.mjs --write 并提交 diff`,
  );
  assert.equal(onDisk.includes('\r'), false, '快照必须是 LF 换行（跨平台逐字节稳定）');
  assert.equal(onDisk.endsWith('\n'), true, '快照必须以换行结尾');
  const parsed = readSnapshotJson();
  assert.deepEqual(Object.keys(parsed), [...SURFACE_KEYS], '磁盘快照的键顺序必须等于契约顺序');

  // ③ 六个必覆盖集合逐条点名（防止「字段在但内容被偷换」）
  //    ★ 期望值**一律从实现/声明派生**：本文件不写死任何条数（写死 12/5 会被合法扩表打红）
  assert.deepEqual(parsed.capabilities, [...serviceFace.CAPABILITIES].sort(), 'capabilities 必须逐条等于声明表');
  assert.deepEqual(parsed.serviceMembers, [...serviceFace.SERVICE_MEMBERS].sort(), 'serviceMembers 必须逐条等于声明表');
  assert.deepEqual(parsed.components, [...componentsMod.COMPONENT_NAMES].sort(), 'components 必须逐条等于名字表');
  assert.deepEqual(parsed.slots, [...serviceFace.CONSUMED_SLOT_KEYS].sort(), 'slots 必须逐条等于收取的座位键');
  assert.deepEqual(parsed.inject, [...serviceFace.PLATFORM_SERVICE_KEYS].sort(), 'inject 必须逐条等于软探测的服务名');
  assert.deepEqual(parsed.errorCodes, derived.codes, '错误码全集必须逐条等于源码两块数组的文本扫描结果（族结构判据见「错误码族结构性判据：两族互不重叠、每码带族前缀」）');

  // ④ 快照必须真的有内容可比（不是空档）
  assert.ok(onDisk.length > 400, `快照档过小（${onDisk.length} 字节）⇒ 比对没有意义`);
});

test('声明 ↔ 运行期 ↔ 快照三方一致（成员来自原型链反射，不是读常量）', () => {
  const derived = deriveSurface();
  const parsed = readSnapshotJson();

  // 服务成员：实现（原型链 + 实例键）=== 声明 === 快照
  const declaredMembers = [...serviceFace.SERVICE_MEMBERS].sort();
  assert.deepEqual(derived.surface.serviceMembers, declaredMembers, '实现里能调到的公开成员必须与声明逐条一致');
  assert.deepEqual(declaredMembers, parsed.serviceMembers);
  assert.deepEqual(derived.methods, [...serviceFace.SERVICE_METHODS].sort(), '原型方法集合必须等于声明的方法集');
  assert.deepEqual(derived.getters, [...serviceFace.SERVICE_NAMESPACES].sort(), '原型取值器集合必须等于声明的命名空间集');
  for (const field of serviceFace.SERVICE_FIELDS) {
    assert.ok(derived.ownFields.includes(field), `实例必须自带字段 ${field}`);
    assert.equal(field in derived.service, true);
  }
  assert.deepEqual(derived.ownFields.filter((name) => !serviceFace.SERVICE_CARRIER_FIELDS.includes(name)).sort(), [...serviceFace.SERVICE_FIELDS].sort());

  // 三个命名空间内部的成员也真的实现了（声明表 NAMESPACE_MEMBERS 是契约的一部分）
  for (const [namespace, names] of Object.entries(serviceFace.NAMESPACE_MEMBERS)) {
    const face = derived.service[namespace];
    assert.notEqual(face, undefined, `命名空间 ${namespace} 必须可读`);
    assert.deepEqual(faceMembers(face), [...names].sort(), `${namespace} 的成员集合必须与声明逐条一致`);
  }

  // 能力集
  assert.deepEqual(derived.surface.capabilities, [...serviceFace.CAPABILITIES].sort());
  assert.deepEqual(parsed.capabilities, [...serviceFace.CAPABILITIES].sort());
  // ★ 原断言是「`CAPABILITY_SLICES` 的键集**恰好等于**能力集」。
  //   在 v1 的服务面上不成立，而且**不该**成立：能力集是「本包对外承诺的三项」
  //   （dock / overlay / panel），切片映射里另有 `theme`（主题守门：有切片、无对外命名空间）
  //   与 `layout: null`（无需切片）。原断言在这里比的是「映射表规模」，与它想守的机制无关。
  //   换成三条贴着真机制、且**更严**的判据（删能力 / 漏映射 / 塞悬空切片 / 白名单留空口子都会变红）：
  //     ① 每个能力都必须有切片口径（键存在；值 `null` ＝「无需切片」）；
  //     ② 能力指向的切片名必须落在 `SLICE_NAMES` 白名单内（`null` 除外）；
  //     ③ 白名单里**每个**切片名都必须真被某个能力用上（不许留没人用的切片口子）。
  const sliceOf = serviceFace.CAPABILITY_SLICES;
  const sliceNames = [...serviceFace.SLICE_NAMES].sort();
  for (const name of serviceFace.CAPABILITIES) {
    assert.ok(Object.prototype.hasOwnProperty.call(sliceOf, name), `能力 ${name} 必须有 CAPABILITY_SLICES 口径（null ＝ 无需切片）`);
  }
  for (const [name, slice] of Object.entries(sliceOf)) {
    if (slice === null) continue;
    assert.ok(sliceNames.includes(slice), `能力 ${name} 指向的切片 ${slice} 不在 SLICE_NAMES 白名单里`);
  }
  const usedSlices = [...new Set(Object.values(sliceOf).filter((slice) => slice !== null))].sort();
  assert.deepEqual(usedSlices, sliceNames, 'SLICE_NAMES 里的每个切片名都必须被某个能力用上（白名单不许留空口子）');

  // components：名字集 === props 表键集
  assert.deepEqual(Object.keys(componentsMod.COMPONENT_PROPS).sort(), [...componentsMod.COMPONENT_NAMES].sort());

  // 错误码：文本扫描 === 导出集 === 快照
  assert.notEqual(derived.codes, null, '错误码块扫描失败（ERROR_CODES / WARNING_CODES / ALL_CODES 三个锚点必须都在）');
  assert.deepEqual(derived.codes, [...errorsMod.ALL_CODES].sort(), '两个冻结数组块里的码必须逐条等于导出的 ALL_CODES');
  assert.deepEqual(derived.codes, parsed.errorCodes);

  // src/** 里用到的码不得超出冻结集合（"每个码都必须可达"的反向：不许顺手写新码）
  const used = new Set();
  for (const file of listFilesRecursive(srcPath()).filter((entry) => entry.rel.endsWith('.mjs'))) {
    for (const match of readFileSync(file.full, 'utf8').matchAll(/GUIF-[EW]-[A-Z0-9-]+/g)) used.add(match[0]);
  }
  const outside = [...used].filter((code) => !parsed.errorCodes.includes(code) && code !== 'GUIF-W-UNKNOWN');
  assert.deepEqual(outside, [], `src 里出现了未冻结的错误码：${outside.join('、')}`);
  assert.equal(parsed.errorCodes.includes('GUIF-W-UNKNOWN'), false, '显示兜底码（formatDiagnostic 用）不属于契约集合');
});

test('错误码族结构性判据：两族互不重叠、每码带族前缀、全集逐条等于 ALL_CODES（不写死条数）', () => {
  const parsed = readSnapshotJson();
  const derived = deriveSurface();
  const { ERROR_CODES, WARNING_CODES, ALL_CODES } = errorsMod;

  // ① 每码必须带族前缀，且前缀与所在数组一致（写死计数换成前缀结构：合法扩表不再是红）
  for (const code of ERROR_CODES) assert.match(code, /^GUIF-E-/, `GUIF-E-* 数组里出现了不带该前缀的码：${code}`);
  for (const code of WARNING_CODES) assert.match(code, /^GUIF-W-/, `GUIF-W-* 数组里出现了不带该前缀的码：${code}`);
  for (const code of parsed.errorCodes) {
    assert.match(code, /^GUIF-[EW]-/, `快照里出现了既非 GUIF-E- 也非 GUIF-W- 的码：${code}`);
  }

  // ② 两族互不重叠；全集恰好是两族之并（不多不少、无重复）
  assert.deepEqual(ERROR_CODES.filter((code) => WARNING_CODES.includes(code)), [], '两族不得有交集');
  assert.equal(new Set(ALL_CODES).size, ALL_CODES.length, 'ALL_CODES 不得有重复项');
  assert.deepEqual(
    [...ALL_CODES].sort(),
    [...ERROR_CODES, ...WARNING_CODES].sort(),
    `ALL_CODES 必须恰好是两族之并：${ERROR_CODES.length} E + ${WARNING_CODES.length} W（条数只作诊断输出，不作判据）`,
  );

  // ③ 按前缀从**快照**重新分族 ⇒ 必须与实现的两族逐条相等（这才是替代「12 / 5」的结构判据）
  const byPrefix = { E: [], W: [] };
  for (const code of parsed.errorCodes) byPrefix[/^GUIF-([EW])-/.exec(code)[1]].push(code);
  assert.deepEqual([...byPrefix.E].sort(), [...ERROR_CODES].sort(), '快照里的 GUIF-E-* 集合必须逐条等于 ERROR_CODES');
  assert.deepEqual([...byPrefix.W].sort(), [...WARNING_CODES].sort(), '快照里的 GUIF-W-* 集合必须逐条等于 WARNING_CODES');
  // 两族都必须非空（整族被删空要有人看见）；这是下界，不是写死条数
  assert.ok(byPrefix.E.length > 0, 'GUIF-E-* 族不得为空');
  assert.ok(byPrefix.W.length > 0, 'GUIF-W-* 族不得为空');

  // ④ ★ 强判据（去计数**不得**导致放松）：三条独立路径的全集逐条相等
  assert.deepEqual([...parsed.errorCodes].sort(), [...ALL_CODES].sort(), '快照全集必须逐条等于 ALL_CODES');
  assert.deepEqual(derived.codes, [...ALL_CODES].sort(), '源码文本块扫描的全集必须逐条等于 ALL_CODES');
  assert.deepEqual(derived.codes, [...parsed.errorCodes].sort(), '文本扫描全集必须逐条等于快照全集');
});

test('自守：本文件（验证资产）不得再出现写死的公开面条数（静态扫描）', () => {
  const source = readFileSync(fileURLToPath(import.meta.url), 'utf8');
  const collections = ['errorCodes', 'serviceMembers', 'components', 'slots', 'inject', 'capabilities'];
  // 形如 `.length, 12` / `.length === 6` / `.length >= 3`；`> 0`（非空下界）不算写死条数
  const hardCount = /\.length\s*(?:,|===|==|!==|>=|<=|>|<)\s*(?!0\b)\d+/;
  const offenders = [];
  source.split(/\r?\n/).forEach((line, index) => {
    if (!collections.some((name) => line.includes(name))) return;
    if (hardCount.test(line)) offenders.push(`L${index + 1}：${line.trim()}`);
  });
  assert.deepEqual(offenders, [], `验证资产里又出现了写死的公开面条数（应从实现/声明派生）：\n  - ${offenders.join('\n  - ')}`);
  assert.ok(collections.every((name) => source.includes(name)), '六个集合名必须都在本文件里被点名（否则本扫描是空转）');
});
