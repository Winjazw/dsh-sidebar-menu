# Changelog

本项目遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [0.2.0] — 2026-10-21

### 新增

- **全部隐藏**：一次隐藏清单里的所有面板，只留「新会话」与工作区。
- **恢复**：撤销上一步（最多 20 步，内存栈，仅当前会话）；「全部隐藏」之后可以精确退回隐藏前的选择。
- 按钮禁用态：无可隐藏项时「全部隐藏」灰、无隐藏项时「全部显示」灰、撤销栈空时「恢复」灰。

### 改进

- `package.json` 增加 `engines.dsh` 与 `dsh.compatibility.dshReleases`，接入 DSH 的 compatibility preflight：
  版本不满足时由 DSH 拒绝加载并打印原因，而不是半坏。
- `apply()` 三层降级：缺 `slots` 服务直接返回；缺 `sidebar.footer.action` / `shell.overlay` 逐个跳过；
  `entriesOfSlot` 不可包时面板显示「当前版本不支持」。
- 开关两态对比度修正（开启=主题主色轨道 + 前景色滑块；关闭=半透明轨道 + 白滑块）。
- 补齐 `icon.svg`、`locale/zh.json`、`locale/en.json`、README 与截图。

## [0.1.0] — 2026-10-20

### 新增

- 侧栏底部滑块图标入口，点了弹出「左侧菜单设置」面板。
- 逐项开关：隐藏/恢复左侧「全局面板」菜单里的任意一项，菜单实时更新。
- 选择持久化在 `localStorage`（`dsh-sidebar-menu.hidden.v1`）。
- 「全部显示」「完成」、`Esc` 关闭、点遮罩关闭；行是 `role="switch"` + `aria-checked`。
