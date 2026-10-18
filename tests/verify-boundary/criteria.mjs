/**
 * criteria.mjs —— **独立判据集**（自己写的口径，不复用 tests/client 或 tests/unit 的任何断言）。
 *
 * 用法：
 *   node tests/verify-boundary/criteria.mjs            # 对包内 src/** 跑全部判据
 *   GUIF_VERIFY_ROOT=<TEMP副本> node .../criteria.mjs  # 对变异副本跑（反假绿）
 * 退出码：全部通过 0；任一判据失败 1。stdout 末行是 `VERIFY-RESULT <json>`。
 *
 * 判据分三组：
 *   R_* 运行时（真 jsdom + 真 react-dom 渲染，看 DOM 与 React 错误回调）
 *   S_* 静态（读 components.mjs / boundary.mjs 源码文本）
 *
 * ⚠ 判据写死 DOM 锚点（`data-guif-boundary="minimal"` / `data-guif-state="error"` /
 * `data-guif-panel`），**不 import 被测方的常量导出** —— 否则被测方改常量就能让判据跟着走。
 */
import {
  ANCHOR,
  ROOT,
  createPrimitivesStub,
  escaped,
  loadReact,
  loadSource,
  mountNode,
  panelAlive,
  readSourceText,
  safeMessage,
  setupDom,
} from './harness.mjs';

const results = [];
const record = (id, passed, detail) => results.push({ id, passed: Boolean(passed), detail: String(detail) });
const ok = (value) => value === true;

/** 造一个「渲染期必抛」的组件（错误消息带唯一标签，便于在多分支里分辨是谁抛的）。 */
function boom(react, label) {
  return function Boom() {
    throw new Error(label);
  };
}

export async function runCriteria() {
  await setupDom();
  const react = await loadReact();
  const el = react.createElement;
  const { createPanelComponents } = await loadSource('client/panel/index.mjs');
  const { createRenderBoundary, MINIMAL_ERROR_ATTR, MINIMAL_ERROR_KIND } = await loadSource('client/panel/boundary.mjs');
  const comps = createPanelComponents({
    seeds: { react, primitives: createPrimitivesStub(react) },
    note: () => {},
  });
  const boundaryFromSource = createRenderBoundary(react);

  // 判据自己写死的锚点（与被测方的导出交叉比对一次，防止锚点悄悄改名）
  record(
    'R_anchor_agreement',
    MINIMAL_ERROR_ATTR === 'data-guif-boundary' && MINIMAL_ERROR_KIND === 'minimal',
    `boundary 导出的最小节点锚点 = ${MINIMAL_ERROR_ATTR}=${MINIMAL_ERROR_KIND}`,
  );

  const hasMinimal = (result) => result.query(`[${ANCHOR.boundary}="${ANCHOR.minimal}"]`) !== null;
  const hasErrorState = (result) => result.query(`[${ANCHOR.state}="${ANCHOR.errorState}"]`) !== null;
  const domNonEmpty = (result) => result.html.replace(/\s/g, '') !== '';

  // ── R_A：边界 + 简单 fallback（原 repro A）────────────────────────────────────────────
  {
    const result = await mountNode(
      react,
      el(boundaryFromSource, {
        onError: () => {},
        renderError: (error) => el('div', { 'data-verify': 'fallback-a' }, `A:${safeMessage(error)}`),
      }, el(boom(react, 'VERIFY-A'))),
    );
    const escape = escaped(result);
    record(
      'R_A_simple_fallback',
      !escape.escaped && result.query('[data-verify="fallback-a"]') !== null && domNonEmpty(result),
      `escaped=${escape.escaped} fallback=${result.query('[data-verify="fallback-a"]') !== null} html=${result.html.slice(0, 80)}`,
    );
  }

  // ── R_B：fallback 里**再渲染同一个抛错子节点**（原 repro B，最隐蔽的那半）────────────────
  {
    const child = el(boom(react, 'VERIFY-B'));
    const result = await mountNode(
      react,
      el(boundaryFromSource, {
        renderError: (error) => el('div', { 'data-verify': 'fallback-b' }, `B:${safeMessage(error)}`, child),
      }, child),
    );
    const escape = escaped(result);
    record(
      'R_B_fallback_renders_throwing_child',
      !escape.escaped && domNonEmpty(result) && hasMinimal(result),
      `escaped=${escape.escaped} uncaught=${JSON.stringify(escape.uncaught)} minimalNode=${hasMinimal(result)} html=${result.html.slice(0, 120)}`,
    );
  }

  // ── R_C：真路径 <Panel><Boom/></Panel>（原 repro C；失败态的主用例）────────────────────
  const panelCase = async (id, children, extraProps = {}) => {
    const result = await mountNode(react, el(comps.Panel, { id, ...extraProps }, children));
    const escape = escaped(result);
    const alive = panelAlive(result, id);
    const passed = !escape.escaped && domNonEmpty(result) && alive.alive && alive.errorInsidePanel && !hasMinimal(result);
    return { result, escape, alive, passed };
  };

  {
    const { result, escape, alive, passed } = await panelCase('verify-c', el(boom(react, 'VERIFY-C')));
    record(
      'R_C_panel_catches_child',
      passed,
      `escaped=${escape.escaped} panelAlive=${alive.alive} header=${alive.header} body=${alive.body} errorInsidePanel=${alive.errorInsidePanel} minimalNode=${hasMinimal(result)} html=${result.html.slice(0, 140)}`,
    );
  }

  // ── R_D：边界 + ErrorState 形态的 fallback（原 repro D）───────────────────────────────
  {
    const result = await mountNode(
      react,
      el(comps.boundary, {
        onError: () => {},
        renderError: (error) => comps.ErrorState({ error }),
      }, el(boom(react, 'VERIFY-D'))),
    );
    const escape = escaped(result);
    record(
      'R_D_errorstate_fallback',
      !escape.escaped && hasErrorState(result) && domNonEmpty(result) && !hasMinimal(result),
      `escaped=${escape.escaped} errorState=${hasErrorState(result)} minimalNode=${hasMinimal(result)} html=${result.html.slice(0, 120)}`,
    );
  }

  // ── R_S1：形态一 —— Toolbar 的**子节点**抛错（Toolbar 自己不在 try/catch 里渲染 children）──
  {
    const { result, escape, alive, passed } = await panelCase(
      'verify-s1',
      el(comps.Toolbar, { id: 'verify-s1-toolbar' }, el(boom(react, 'VERIFY-S1'))),
    );
    record(
      'R_S1_toolbar_child_throws',
      passed,
      `escaped=${escape.escaped} errorInsidePanel=${alive.errorInsidePanel} minimalNode=${hasMinimal(result)} html=${result.html.slice(0, 140)}`,
    );
  }

  // ── R_S2：形态二 —— 深层嵌套（Panel > div > section > Toolbar > Boom）抛错 ──────────────
  {
    const deep = el('div', { 'data-verify': 'deep-outer' },
      el('section', { 'data-verify': 'deep-mid' },
        el(comps.Toolbar, { id: 'verify-s2-toolbar' },
          el('span', null, el('span', null, el(boom(react, 'VERIFY-S2')))))));
    const { result, escape, alive, passed } = await panelCase('verify-s2', deep);
    record(
      'R_S2_deep_nested_throws',
      passed,
      `escaped=${escape.escaped} errorInsidePanel=${alive.errorInsidePanel} minimalNode=${hasMinimal(result)} html=${result.html.slice(0, 140)}`,
    );
  }

  // ── R_S3：形态三 —— List 的 renderItem 返回一个**渲染期抛错**的组件（≠ renderItem 自己抛）──
  {
    const Thrower = boom(react, 'VERIFY-S3');
    const { result, escape, alive, passed } = await panelCase(
      'verify-s3',
      el(comps.List, { id: 'verify-s3-list', items: [{ id: 'row-1' }], renderItem: (item) => el(Thrower, { key: item.id }) }),
    );
    record(
      'R_S3_list_row_component_throws',
      passed,
      `escaped=${escape.escaped} errorInsidePanel=${alive.errorInsidePanel} minimalNode=${hasMinimal(result)} html=${result.html.slice(0, 140)}`,
    );
  }

  // ── R_E1：没有 renderError（壳的最裸用法）+ 子节点抛错 ⇒ 仍必须有节点，绝不空白 ─────────
  {
    const result = await mountNode(react, el(boundaryFromSource, null, el(boom(react, 'VERIFY-E1'))));
    const escape = escaped(result);
    record(
      'R_E1_no_renderError_still_renders',
      !escape.escaped && domNonEmpty(result) && hasMinimal(result),
      `escaped=${escape.escaped} minimalNode=${hasMinimal(result)} html=${result.html.slice(0, 120)}`,
    );
  }

  // ── R_E2：失败态**绝不渲染 null**（renderError 返回 null 时的兜底）─────────────────────
  {
    const result = await mountNode(
      react,
      el(boundaryFromSource, { renderError: () => null }, el(boom(react, 'VERIFY-E2'))),
    );
    const escape = escaped(result);
    record(
      'R_E2_failure_never_null',
      !escape.escaped && domNonEmpty(result) && hasMinimal(result),
      `escaped=${escape.escaped} minimalNode=${hasMinimal(result)} html=${result.html.slice(0, 120)}`,
    );
  }

  // ── R_E3：错误值本身有毒（message getter / toString 都抛）⇒ 兜底节点仍须画得出来 ────────
  {
    const poisoned = {};
    Object.defineProperty(poisoned, 'message', {
      get() { throw new Error('VERIFY-E3-message-getter'); },
    });
    Object.defineProperty(poisoned, 'toString', {
      value() { throw new Error('VERIFY-E3-toString'); },
    });
    const Poison = function PoisonThrower() { throw poisoned; };
    const result = await mountNode(react, el(boundaryFromSource, null, el(Poison)));
    const escape = escaped(result);
    record(
      'R_E3_poisoned_error_value',
      !escape.escaped && domNonEmpty(result) && hasMinimal(result),
      `escaped=${escape.escaped} minimalNode=${hasMinimal(result)} html=${result.html.slice(0, 160)}`,
    );
  }

  // ═══ 扩面全矩阵（8 处逃逸面 + 同类元素槽）＋ 两组负控 ═════════════════════════════════════
  // 判定口径（写死）：槽位抛错 ⇒ escaped=false + 渲染出**有文案**的错误态
  // （`data-guif-state="error"`、文本非空且含抛错消息）+ 不落兜底节点（落兜底 = fallback 自己又炸了）。
  const slotCase = async (node, expectMessage) => {
    const result = await mountNode(react, node);
    const escape = escaped(result);
    // 一个组件可能同时有多个错误态节点（例如 ErrorState 自身 + 被护住的 children 槽），
    // 所以取**全部**错误态节点的文本来判断「有文案」，只取第一个会误判。
    const errorNodes = result.queryAll(`[${ANCHOR.state}="${ANCHOR.errorState}"]`);
    const text = errorNodes.map((node2) => node2.textContent).join(' | ');
    const passed = !escape.escaped
      && errorNodes.length > 0
      && text.trim() !== ''
      && text.includes(expectMessage)
      && !hasMinimal(result);
    return { passed, detail: `escaped=${escape.escaped} errNodes=${errorNodes.length} text=${JSON.stringify(text.slice(0, 60))} minimalNode=${hasMinimal(result)}` };
  };

  const surfaceCases = [
    ['R_G1_panel_actions', 'GUIF-G1', () => el(comps.Panel, { id: 'g1', actions: el(boom(react, 'GUIF-G1')) })],
    ['R_G2_toolbar_children_standalone', 'GUIF-G2', () => el(comps.Toolbar, { id: 'g2' }, el(boom(react, 'GUIF-G2')))],
    ['R_G3_list_renderItem_element_standalone', 'GUIF-G3', () => el(comps.List, { id: 'g3', items: [{ id: 'r' }], renderItem: (item) => el(boom(react, 'GUIF-G3'), { key: item.id }) })],
    ['R_G4_list_children_standalone', 'GUIF-G4', () => el(comps.List, { id: 'g4', items: [1], renderItem: () => 'row' }, el(boom(react, 'GUIF-G4')))],
    ['R_G5_list_empty_slot_standalone', 'GUIF-G5', () => el(comps.List, { id: 'g5', items: [], empty: el(boom(react, 'GUIF-G5')) })],
    ['R_G6_keyvalue_children_standalone', 'GUIF-G6', () => el(comps.KeyValue, { entries: [['k', 'v']] }, el(boom(react, 'GUIF-G6')))],
    ['R_G7_toolbar_item_icon_standalone', 'GUIF-G7', () => el(comps.Toolbar, { id: 'g7', items: [{ id: 'i', icon: boom(react, 'GUIF-G7'), label: 'x' }] })],
    ['R_G8_empty_action_standalone', 'GUIF-G8', () => el(comps.Empty, { action: el(boom(react, 'GUIF-G8')) })],
    ['R_G9_empty_children_standalone', 'GUIF-G9', () => el(comps.Empty, null, el(boom(react, 'GUIF-G9')))],
    ['R_G10_errorstate_children_standalone', 'GUIF-G10', () => el(comps.ErrorState, { error: 'e' }, el(boom(react, 'GUIF-G10')))],
    ['R_G11_empty_description_standalone', 'GUIF-G11', () => el(comps.Empty, { description: el(boom(react, 'GUIF-G11')) })],
    ['R_G12_positive_control_in_panel_body', 'GUIF-G12', () => el(comps.Panel, { id: 'g12' }, el(boom(react, 'GUIF-G12')))],
  ];
  for (const [id, message, build] of surfaceCases) {
    const outcome = await slotCase(build(), message);
    record(id, outcome.passed, outcome.detail);
  }

  // 负控 A：不过度扩面 —— 纯数据 props（thunk 抛错）**不得**被变成错误态
  {
    const result = await mountNode(react, el(comps.Panel, {
      id: 'n1',
      label: () => { throw new Error('GUIF-N1-label'); },
      close: () => {},
    }, '正文'));
    const escape = escaped(result);
    const errorNode = result.query(`[${ANCHOR.state}="${ANCHOR.errorState}"]`);
    record(
      'R_N1_throwing_label_is_not_an_error_state',
      !escape.escaped && errorNode === null && result.text.includes('正文'),
      `escaped=${escape.escaped} errNode=${errorNode !== null} text=${JSON.stringify(result.text.slice(0, 40))}`,
    );
  }

  // 负控 B：行不为变 —— Panel.close 回调仍只在点击时触发一次
  {
    const tags = [];
    const result = await mountNode(react, el(comps.Panel, { id: 'n2', close: () => tags.push('close'), closeLabel: '关闭' }, '正文'));
    result.query('[data-guif-action="n2::close"]')?.click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    record(
      'R_N2_close_callback_still_fires_once',
      tags.length === 1 && result.query(`[${ANCHOR.state}="${ANCHOR.errorState}"]`) === null,
      `点击后 tags=${JSON.stringify(tags)} errNode=${result.query(`[${ANCHOR.state}="${ANCHOR.errorState}"]`) !== null}`,
    );
  }

  // 负控 C：行不为变 —— Toolbar items[].onSelect 仍只在点击时触发（图标槽的边界不影响动作）
  {
    const clicks = [];
    const result = await mountNode(react, el(comps.Toolbar, {
      id: 'n3',
      items: [{ id: 'refresh', label: '刷新', icon: comps.primitives.get('IconRefreshOutlineRegular'), onSelect: (id) => clicks.push(id) }],
    }));
    result.query('[data-guif-action="refresh"]')?.click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    record(
      'R_N3_onSelect_still_fires_once',
      clicks.length === 1 && clicks[0] === 'refresh',
      `点击后 clicks=${JSON.stringify(clicks)}`,
    );
  }

  // 负控 D：行不为变 —— List.getKey 每行恰好一次、参数是 (item, index)
  {
    const keys = [];
    const result = await mountNode(react, el(comps.List, {
      id: 'n4',
      items: [{ id: 'a' }, { id: 'b' }],
      getKey: (item, index) => { keys.push(`${item.id}:${index}`); return item.id; },
      renderItem: () => 'row',
    }));
    record(
      'R_N4_getKey_shape_unchanged',
      keys.length === 2 && keys.join(',') === 'a:0,b:1' && result.query(`[${ANCHOR.state}="${ANCHOR.errorState}"]`) === null,
      `keys=${JSON.stringify(keys)} rows=${result.queryAll('[data-guif-row]').length}`,
    );
  }

  // 空态矩阵：正向钉桩（默认/empty 渲染）+ 失败态反向钉桩（error 仍剥）+ loading 仅记录
  {
    const mark = 'M-MARK';
    const renderAt = async (stateValue) => {
      const props = { id: `m-${String(stateValue)}` };
      if (stateValue !== undefined) props.state = stateValue;
      const result = await mountNode(react, el(comps.Empty, props, el('span', null, mark)));
      return result.text.includes(mark);
    };
    const matrix = {};
    for (const value of [undefined, null, 'ready', 'empty', 'loading', 'error']) matrix[String(value)] = await renderAt(value);
    const defaultEmpty = matrix.undefined === true && matrix.null === true && matrix.ready === true && matrix.empty === true;
    record('R_M1_empty_renders_children_on_default_empty', defaultEmpty, `矩阵 ${JSON.stringify(matrix)}`);
    record('R_M2_error_state_still_strips_children', matrix.error === false, `state="error" 时 children 渲染=${matrix.error}（必须 false —— 失败态不回退）`);
    record('R_M3_loading_does_not_render_children', matrix.loading === false, `state="loading" 时 children 渲染=${matrix.loading}（既定裁定，仅记录）`);
  }

  // KeyValue **值槽**：曾与其余槽位同类地漏掉边界（壳渲染了调用方给的元素却没护住）。
  //
  // 收口后本判据**更强**：不逃逸 + 有含抛错文案的错误态 + 不落兜底节点。
  // ⚠ 这不是放宽判据：断言强度只增不减，判据跟着**事实**走。
  {
    // ① 元素值必须被接住（两种 entries 形态都测）
    const forms = [
      ['tuple', [['k', el(boom(react, 'GUIF-KV1'))]]],
      ['object', [{ key: 'k', value: el(boom(react, 'GUIF-KV1')) }]],
    ];
    for (const [form, entries] of forms) {
      const outcome = await slotCase(el(comps.KeyValue, { entries }), 'GUIF-KV1');
      record(`R_KV1_keyvalue_value_element_caught_${form}`, outcome.passed, outcome.detail);
    }

    // ② 字符串/数字值**不得**被套边界（不过度扩面）。边界在 DOM 上不可见，所以走**结构面**：
    //    不挂载，直接对 `KeyValue(props)` 返回的元素树数 `GuiFrameRenderBoundary` 节点。
    //    无 children、无元素值时应当 **0** 个边界；有元素值时恰好 **1** 个。
    const countBoundaries = (node, acc = { count: 0 }) => {
      if (node === null || node === undefined || typeof node === 'boolean') return acc;
      if (Array.isArray(node)) {
        for (const item of node) countBoundaries(item, acc);
        return acc;
      }
      if (typeof node !== 'object' || node.$$typeof === undefined) return acc;
      if (node.type === comps.boundary) acc.count += 1;
      countBoundaries(node.props?.children, acc);
      return acc;
    };
    const plain = countBoundaries(comps.KeyValue({ entries: [['k', '字符串'], ['n', 42], ['b', true]] })).count;
    const withElement = countBoundaries(comps.KeyValue({ entries: [['k', el('span', null, 'x')]] })).count;
    record(
      'R_KV2_plain_values_get_no_boundary',
      plain === 0 && withElement === 1,
      `纯数据值（字符串/数字/布尔）边界数=${plain}（须 0）；元素值边界数=${withElement}（须 1）`,
    );
  }

  // ═══ 静态判据 ═════════════════════════════════════════════════════════════════════════════
  const components = readSourceText('client/panel/components.mjs');
  const boundary = readSourceText('client/panel/boundary.mjs');

  // S_1：收口函数必须剥掉 children（第一层修复）
  {
    const body = /function errorProps\([\s\S]*?\n {2}\}/.exec(components)?.[0] ?? '';
    record(
      'S_1_errorProps_strips_children',
      /children:\s*null/.test(body),
      `errorProps 归一化片段 = ${body.replace(/\s+/g, '').slice(0, 200)}`,
    );
  }

  // S_2：**所有** errorView 调用点都喂 errorProps（或 stateView，而 stateView 的调用点又全喂 errorProps）
  {
    // 取「配对括号内的实参」——正则 `\([^)]*\)` 会在 `errorProps(props, error)` 这种嵌套调用上截断，
    // 也会把 `function stateView(state, props)` 的定义当成调用点，所以这里用索引扫描。
    const readArgs = (text, openIndex) => {
      let depth = 0;
      for (let i = openIndex; i < text.length; i += 1) {
        if (text[i] === '(') depth += 1;
        else if (text[i] === ')') {
          depth -= 1;
          if (depth === 0) return { args: text.slice(openIndex + 1, i), end: i };
        }
      }
      return null;
    };
    const splitTopLevel = (args) => {
      const parts = [];
      let depth = 0;
      let current = '';
      for (const char of args) {
        if (char === '(' || char === '[' || char === '{') depth += 1;
        if (char === ')' || char === ']' || char === '}') depth -= 1;
        if (char === ',' && depth === 0) {
          parts.push(current.trim());
          current = '';
          continue;
        }
        current += char;
      }
      if (current.trim() !== '') parts.push(current.trim());
      return parts;
    };
    const collectCalls = (name) => {
      const calls = [];
      const re = new RegExp(`${name}\\(`, 'g');
      let match;
      while ((match = re.exec(components)) !== null) {
        if (/function\s*$/.test(components.slice(Math.max(0, match.index - 10), match.index))) continue; // 定义处
        const read = readArgs(components, match.index + name.length);
        if (read === null) continue;
        calls.push({ args: read.args.trim(), end: read.end, offset: match.index });
      }
      return calls;
    };
    const errorViewCalls = collectCalls('errorView');
    const stateViewCalls = collectCalls('stateView');
    // stateView 的函数体范围（`errorView(props)` 只允许出现在这里）
    const stateViewBodyStart = components.indexOf('function stateView(');
    const stateViewCall = collectCalls('stateView')[0];
    void stateViewCall;
    const stateViewBodyEnd = (() => {
      if (stateViewBodyStart === -1) return -1;
      const body = readArgs(components, components.indexOf('(', stateViewBodyStart));
      // 函数体从 `{` 开始，用花括号配对找结束
      let depth = 0;
      let started = false;
      for (let i = (body?.end ?? stateViewBodyStart) + 1; i < components.length; i += 1) {
        if (components[i] === '{') {
          depth += 1;
          started = true;
        } else if (components[i] === '}') {
          depth -= 1;
          if (started && depth === 0) return i;
        }
      }
      return -1;
    })();
    const insideStateView = (offset) => stateViewBodyStart !== -1 && offset > stateViewBodyStart && offset < stateViewBodyEnd;
    const badDirect = errorViewCalls.filter((call) => {
      if (call.args.startsWith('errorProps(')) return false;
      return !insideStateView(call.offset);
    });
    const badStateView = stateViewCalls
      .map((call) => splitTopLevel(call.args))
      .filter((args) => args.length < 2 || !args[1].startsWith('errorProps('));
    record(
      'S_2_all_errorView_calls_collected',
      errorViewCalls.length >= 8 && badDirect.length === 0 && badStateView.length === 0,
      `errorView 调用点 ${errorViewCalls.length} 个；未收口的直接调用 ${badDirect.length} 个${badDirect.length > 0 ? ` → ${JSON.stringify(badDirect.map((call) => call.args))}` : ''}；stateView 调用点 ${stateViewCalls.length} 个、第二参数未收口 ${badStateView.length} 个${badStateView.length > 0 ? ` → ${JSON.stringify(badStateView)}` : ''}`,
    );
  }

  // S_3：Panel 的 renderError 必须走收口（失败态的直接肇事点）
  {
    const renderError = /renderError:\s*\(error\)\s*=>\s*errorView\(([^)]*)\)/.exec(components);
    record(
      'S_3_panel_renderError_collected',
      renderError !== null && renderError[1].trim().startsWith('errorProps('),
      `Panel.renderError = errorView(${renderError === null ? '<未匹配>' : renderError[1].trim()})`,
    );
  }

  // S_4：第三层保险在位（fallback 输出再套同类边界 + 失败态不返回 null）
  {
    const guardsFallbackOutput = /__guard\(/.test(boundary) && /return guardEnabled \? this\.__guard\(node\) : node;/.test(boundary);
    const neverNullOnFailure = /if \(!failed\) return null;/.test(boundary) && /const staticNode = minimalNode\(/.test(boundary);
    record(
      'S_4_boundary_third_layer_present',
      guardsFallbackOutput && neverNullOnFailure,
      `__guard 包裹 fallback 输出=${guardsFallbackOutput}；失败态兜底节点=${neverNullOnFailure}`,
    );
  }

  return { root: ROOT, results };
}

// ── CLI ────────────────────────────────────────────────────────────────────────────────────
const isCli = process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href;
if (isCli) {
  const report = await runCriteria();
  for (const row of report.results) console.log(`${row.passed ? 'PASS' : 'FAIL'}  ${row.id}  ${row.detail}`);
  const failed = report.results.filter((row) => !row.passed);
  console.log(`VERIFY-RESULT ${JSON.stringify({ root: report.root, total: report.results.length, failed: failed.map((row) => row.id) })}`);
  process.exitCode = failed.length === 0 ? 0 : 1;
}
