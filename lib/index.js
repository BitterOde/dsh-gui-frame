/**
 * dsh-gui-frame 包入口（**构建产物**，由 scripts/build-host.mjs 生成，请勿手改）。
 *
 * 真正的宿主半区在 ./host/index.js（= src/host/** 的构建产物）；这里只做转发，
 * 使 package.json 的 main / exports["."] 与源码布局解耦。
 *
 * 形状契约：name === cordis.patch.yml 的 loader entry id（"gui-frame"）；
 * inject 为空数组（服务缺席不得悬置插件）；apply 同步且返回 undefined。
 */
export { name, inject, apply } from './host/index.js';
export { default } from './host/index.js';
