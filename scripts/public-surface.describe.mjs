/**
 * public-surface.describe.mjs —— **L1 公开面快照**的描述器与序列化器。
 *
 * 为什么留在 `scripts/` 而不放 `src/client/contracts/`：本文件是**工具件**（生成与校验快照档），
 * 不是客户端运行时的一部分；而构建器把 `src/client` 下每个 `.mjs` 都打进客户端产物 ——
 * 放回去等于把一段只有脚本与单测用的代码塞进交付产物。
 *
 * 快照要拦住的漂移，恰好是「改了一行代码，没人注意公开面变了」这类事故：
 * ```
 * { service, version, capabilities, serviceMembers,
 *   components, slots, inject, errorCodes }
 * ```
 * 六个集合全部**排序**后写进 `tests/contracts/public-surface.json`，比对方式是**逐字节**：
 *  - 服务成员（`serviceMembers`）：`SERVICE_METHODS + SERVICE_NAMESPACES + SERVICE_FIELDS`
 *  - 组件名（`components`）：对外暴露的复合组件清单
 *  - 收取的 slot 键（`slots`）：坞必须成对注册的座位
 *  - inject 列表（`inject`）：本包**软探测**的平台服务名（不用 Cordis 的 inject 声明）
 *  - 错误码集合（`errorCodes`）：`GUIF-E-*` + `GUIF-W-*`
 *
 * 三件必须一起看的事：
 *  ① 本文件**只描述**，不实现 —— 实现见 `src/client/service.mjs`；声明见 `src/client/contracts/*.mjs`；
 *     单测 `tests/unit/service.test.mjs` 把「声明 ↔ 实现 ↔ 快照档」三者对起来（任一侧改动静默不了）。
 *  ② 重新生成 / 校验：`node scripts/public-surface.mjs --write`（改）/ `--check`（默认，只校验）。
 *     **改了公开面就必须显式跑 --write 并提交快照 diff** —— 这正是快照存在的意义。
 *  ③ 本文件**零副作用**：纯函数，无 fs、无 DOM。
 */
import { ALL_CODES } from '../src/client/contracts/errors.mjs';
import { COMPONENT_NAMES } from '../src/client/contracts/components.mjs';
import { CAPABILITIES, CONSUMED_SLOT_KEYS, PLATFORM_SERVICE_KEYS, SERVICE_MEMBERS, SERVICE_NAME, SERVICE_VERSION } from '../src/client/contracts/service-face.mjs';

/** 快照档路径（相对包根，posix）。测试与脚本共用它，避免两处写死。 */
export const PUBLIC_SURFACE_PATH = 'tests/contracts/public-surface.json';

/** 快照字段全集**及其顺序**（顺序也是契约：序列化后要逐字节稳定）。 */
export const SURFACE_KEYS = Object.freeze(['service', 'version', 'capabilities', 'serviceMembers', 'components', 'slots', 'inject', 'errorCodes']);

/** 排序副本（快照里所有集合都要排序 —— 顺序无关的集合不许因插入顺序变化而漂移）。 */
function sorted(values) {
  return [...values].sort();
}

/** 公开面描述对象（纯数据，键顺序**恒为** `SURFACE_KEYS`）。 */
export function describePublicSurface() {
  return {
    service: SERVICE_NAME,
    version: SERVICE_VERSION,
    capabilities: sorted(CAPABILITIES),
    serviceMembers: sorted(SERVICE_MEMBERS),
    components: sorted(COMPONENT_NAMES),
    slots: sorted(CONSUMED_SLOT_KEYS),
    inject: sorted(PLATFORM_SERVICE_KEYS),
    errorCodes: sorted(ALL_CODES),
  };
}

/** 快照档的确切文本（`JSON.stringify(…, 2)` + 结尾换行；LF 换行，任何平台一致）。 */
export function serializePublicSurface() {
  return `${JSON.stringify(describePublicSurface(), null, 2)}\n`;
}

/** 集合是否与快照一致（返回不一致的字段名，便于断言消息直接指认）。 */
export function diffSurface(surface) {
  const expected = describePublicSurface();
  const problems = [];
  for (const key of SURFACE_KEYS) {
    const left = JSON.stringify(expected[key]);
    const right = JSON.stringify(surface === null || surface === undefined ? null : surface[key]);
    if (left !== right) problems.push(`${key}：期望 ${left}，实际 ${right}`);
  }
  return problems;
}
