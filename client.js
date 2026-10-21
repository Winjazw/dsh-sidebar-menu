/**
 * dsh-sidebar-menu — 自定义左侧「全局面板」菜单里哪些项显示、哪些隐藏。
 *
 * 左侧那排菜单（插件 / 插件市场 / 自动化任务 / 上下文洞察 / 任务看板 / 记忆系统 / MCP 连接器 …）
 * 是 `sidebar.panellist` 这个 list slot 的投影：每一项都是某个插件注册的一行。
 * 本插件做两件事：
 *   1. 在侧栏底部 `sidebar.footer.action` 加一个入口按钮；
 *   2. 在 `shell.overlay` 里放一个设置面板，逐项勾选显示/隐藏，选择存 localStorage。
 *
 * 隐藏的实现：包住 `ctx.slots.entriesOfSlot('sidebar.panellist')` 的返回值做过滤。
 * 侧栏自己就是靠 `ctx.slots.subscribe('sidebar.panellist', syncPanels)` +
 * `entriesOfSlot(...)` 得到菜单清单的（见 dsh-client-ui-sidebar/lib/client.js），
 * 所以过滤这一处即可让菜单增删；改动后再注册一次「哨兵条目」触发侧栏重算。
 */
window.__ModuleLoader__.load({
  id: '@local/sidebar-menu',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    /** 本插件自己的 locale 命名空间。 */
    const NS = 'sidebar-menu';
    /** 左侧菜单对应的 slot。 */
    const PANEL_SLOT = 'sidebar.panellist';
    /** 永远不会渲染的哨兵条目 id：只用来触发侧栏重算菜单。 */
    const SENTINEL_ID = '__sidebar-menu_sentinel__';
    /** 隐藏清单的存储键。 */
    const STORAGE_KEY = 'dsh-sidebar-menu.hidden.v1';
    /** 注入样式表的标记。 */
    const CSS_MARK = '@local/sidebar-menu';

    const DICT = {
      zh: {
        button: '设置左侧菜单',
        title: '左侧菜单设置',
        hint: '取消勾选的项会从左侧菜单隐藏，随时可以在这里恢复。',
        showAll: '全部显示',
        hideAll: '全部隐藏',
        undo: '恢复',
        undone: '没有可恢复的上一步',
        done: '完成',
        empty: '当前没有可配置的菜单项',
        unavailable: '当前版本没有提供可过滤的菜单清单，无法隐藏菜单项。',
      },
      en: {
        button: 'Configure sidebar menu',
        title: 'Sidebar menu',
        hint: 'Unchecked items are hidden from the sidebar menu. Restore them here at any time.',
        showAll: 'Show all',
        hideAll: 'Hide all',
        undo: 'Restore',
        undone: 'Nothing to restore',
        done: 'Done',
        empty: 'No configurable menu items',
        unavailable: 'This Harness version exposes no menu list, so items cannot be hidden.',
      },
    };

    //#region 文案

    let t = (key) => (DICT.zh[key] === undefined ? key : DICT.zh[key]);

    function adoptLocale(ctx) {
      let locale;
      try {
        locale = typeof ctx.get === 'function' ? ctx.get('locale') : undefined;
      } catch (error) {
        locale = undefined;
      }
      if (!locale || typeof locale.register !== 'function' || typeof locale.bind !== 'function') return;
      try {
        ctx.effect(() => locale.register(NS, DICT), 'sidebar-menu: dictionaries');
        const bound = locale.bind(NS);
        t = (key) => {
          let value;
          try {
            value = bound(key);
          } catch (error) {
            value = undefined;
          }
          if (typeof value === 'string' && value !== '' && value !== key) return value;
          return DICT.zh[key] === undefined ? key : DICT.zh[key];
        };
        if (typeof locale.subscribe === 'function') {
          ctx.effect(() => locale.subscribe(() => emit()), 'sidebar-menu: locale');
        }
      } catch (error) {
        // 保留内置中文兜底，语言服务异常不影响功能。
      }
    }

    //#endregion

    //#region 状态

    /** 运行时引用：apply 时填充。 */
    const api = {
      slots: undefined,
      sentinel: undefined,
      handle: undefined,
      supported: false,
      rawEntries: undefined,
      poke: undefined,
    };

    const listeners = new Set();

    const state = {
      /** 已隐藏的面板 id 数组。 */
      hidden: readHidden(),
      /** 设置面板是否打开。 */
      open: false,
      /** 上一步的隐藏清单（供「恢复」撤销）。 */
      undo: [],
    };

    function readHidden() {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter((id) => typeof id === 'string' && id !== '');
      } catch (error) {
        return [];
      }
    }

    function persist() {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state.hidden));
      } catch (error) {
        // localStorage 不可用时只在本次会话内生效。
      }
    }

    function subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }

    function emit() {
      listeners.forEach((listener) => {
        try {
          listener();
        } catch (error) {
          // 单个订阅者异常不影响其他订阅者。
        }
      });
    }

    function isHidden(id) {
      return id === SENTINEL_ID || state.hidden.indexOf(id) !== -1;
    }

    /** 应用新的隐藏清单；`record` 为 true 时先把旧清单压进撤销栈。 */
    function setHidden(next, record) {
      const before = state.hidden;
      if (record !== false && sameList(before, next) === false) {
        state.undo.push(before);
        if (state.undo.length > 20) state.undo.shift();
      }
      state.hidden = next;
      persist();
      if (api.poke) api.poke();
      emit();
    }

    function sameList(a, b) {
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
      return true;
    }

    /** 恢复上一步。 */
    function undoStep() {
      if (state.undo.length === 0) return;
      const previous = state.undo.pop();
      state.hidden = previous;
      persist();
      if (api.poke) api.poke();
      emit();
    }

    /** 全部隐藏。 */
    function hideAll() {
      const ids = listPanels().map((row) => row.id);
      if (ids.length === 0) return;
      setHidden(ids);
    }

    function toggle(id) {
      const next = state.hidden.filter((item) => item !== id);
      if (next.length === state.hidden.length) next.push(id);
      setHidden(next);
    }

    function showAll() {
      if (state.hidden.length === 0) return;
      setHidden([]);
    }

    function openMenu() {
      state.open = true;
      emit();
    }

    function closeMenu() {
      state.open = false;
      emit();
    }

    //#endregion

    //#region 面板清单

    function labelOf(options) {
      let value = options.label;
      try {
        if (typeof value === 'function') value = value();
      } catch (error) {
        value = undefined;
      }
      if (typeof value === 'string' && value.trim() !== '') return value.trim();
      return String(options.id);
    }

    function listPanels() {
      if (!api.slots) return [];
      let entries = [];
      try {
        const read = api.rawEntries || ((key) => api.slots.entriesOfSlot(key));
        entries = read(PANEL_SLOT) || [];
      } catch (error) {
        entries = [];
      }
      const rows = [];
      for (const entry of entries) {
        const options = entry && entry.options;
        if (!options || typeof options.id !== 'string' || options.id === '') continue;
        if (options.id === SENTINEL_ID) continue;
        rows.push({
          id: options.id,
          order: typeof options.order === 'number' ? options.order : 0,
          label: labelOf(options),
        });
      }
      rows.sort((a, b) => (a.order - b.order) || a.label.localeCompare(b.label));
      return rows;
    }

    //#endregion

    //#region 隐藏机制

    function disposeHandle(handle) {
      if (!handle) return;
      try {
        if (typeof handle === 'function') handle();
        else if (typeof handle.dispose === 'function') handle.dispose();
        else if (typeof handle[Symbol.dispose] === 'function') handle[Symbol.dispose]();
      } catch (error) {
        // 已被释放的句柄忽略。
      }
    }

    /**
     * 过滤 `entriesOfSlot('sidebar.panellist')`：剔除哨兵条目与被隐藏的面板。
     * 只影响这一个 key，其他 slot 与调用方完全照旧。
     */
    function installFilter(ctx) {
      const slots = ctx.slots;
      if (!slots || typeof slots.entriesOfSlot !== 'function') return false;
      const original = slots.entriesOfSlot;
      const hadOwn = Object.prototype.hasOwnProperty.call(slots, 'entriesOfSlot');
      const previousOwn = hadOwn ? slots.entriesOfSlot : undefined;

      // 列表用「我之前的实现」读，这样已隐藏的项仍在，可与别人已有的过滤叠加。
      api.rawEntries = (key) => (previousOwn || original).apply(slots, [key]);

      const filtered = function entriesOfSlot(key) {
        const list = (previousOwn || original).apply(slots, arguments);
        if (key !== PANEL_SLOT || !Array.isArray(list)) return list;
        const out = [];
        for (const entry of list) {
          const id = entry && entry.options ? entry.options.id : undefined;
          if (typeof id === 'string' && isHidden(id)) continue;
          out.push(entry);
        }
        return out;
      };

      ctx.effect(() => {
        try {
          slots.entriesOfSlot = filtered;
        } catch (error) {
          return () => {};
        }
        api.supported = true;
        return () => {
          try {
            if (hadOwn) slots.entriesOfSlot = previousOwn;
            else delete slots.entriesOfSlot;
          } catch (error) {
            // 还原失败时保持现状，最坏情况是菜单少几行。
          }
          api.supported = false;
        };
      }, 'sidebar-menu: panel filter');

      return true;
    }

    /**
     * 重新注册一次哨兵条目，让侧栏 `subscribe('sidebar.panellist', syncPanels)` 重算菜单。
     * 哨兵自身永远被上面的过滤器剔除，不会出现在菜单里。
     */
    function installPoke(ctx) {
      const slots = ctx.slots;
      api.poke = () => {
        try {
          disposeHandle(api.sentinel);
          api.sentinel = slots.register(
            { name: PANEL_SLOT, id: SENTINEL_ID, order: 1e9, label: 'sidebar-menu' },
            () => null,
          );
        } catch (error) {
          // 注册失败只影响「立即刷新」，下次重载仍会按存储的清单生效。
        }
      };
      api.poke();
      ctx.effect(() => () => disposeHandle(api.sentinel), 'sidebar-menu: sentinel');
    }

    //#endregion

    //#region 样式

    const CSS = [
      '.dsm-foot-btn{box-sizing:border-box;width:28px;height:28px;flex:none;display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:var(--dsw-radius-sm,6px);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;transition:background-color .15s ease,color .15s ease}',
      '.dsm-foot-btn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      '.dsm-foot-btn:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-2px}',
      '.dsm-backdrop{position:fixed;inset:0;z-index:260;pointer-events:auto;display:flex;align-items:center;justify-content:center;padding:24px;background:var(--dsw-alias-bg-mask-1,rgba(0,0,0,.55));animation:dsm-fade .12s ease-out}',
      '.dsm-panel{box-sizing:border-box;width:380px;max-width:100%;max-height:min(560px,calc(100vh - 96px));display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-1,#232326);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;box-shadow:var(--dsw-shadow-lv2,0 16px 48px rgba(0,0,0,.5));overflow:hidden;outline:none;animation:dsm-pop .14s ease-out}',
      '.dsm-head{display:flex;flex-direction:column;gap:4px;padding:16px 16px 10px}',
      '.dsm-title{font-size:14px;font-weight:600;line-height:20px}',
      '.dsm-hint{font-size:12px;line-height:17px;color:var(--dsw-alias-label-secondary)}',
      '.dsm-list{display:flex;flex-direction:column;gap:2px;padding:2px 8px 8px;overflow-y:auto;scrollbar-width:thin}',
      '.dsm-empty{padding:10px 8px;font-size:12px;line-height:17px;color:var(--dsw-alias-label-secondary)}',
      '.dsm-row{box-sizing:border-box;width:100%;min-height:40px;display:flex;align-items:center;gap:12px;padding:8px 10px;border:0;border-radius:8px;background:transparent;color:inherit;font:inherit;font-size:13px;line-height:18px;text-align:left;cursor:pointer;transition:background-color .15s ease}',
      '.dsm-row:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.dsm-row:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-2px}',
      '.dsm-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dsm-switch{position:relative;flex:none;width:34px;height:20px;border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-label-secondary) 32%,transparent);transition:background-color .16s ease}',
      '.dsm-switch.dsm-on{background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary,#4d6bfe))}',
      '.dsm-switch.dsm-on .dsm-knob{transform:translateX(14px)}',
      '.dsm-knob{position:absolute;top:2px;left:2px;display:block;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.35);transition:transform .16s ease,background-color .16s ease}',
      '.dsm-switch.dsm-on .dsm-knob{background:var(--dsw-alias-label-primary-foreground,#fff)}',
      '.dsm-foot{display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:10px 16px 14px;border-top:1px solid var(--dsw-alias-border-l1)}',
      '.dsm-foot .dsm-lead{margin-right:auto}',
      '.dsm-btn{box-sizing:border-box;height:30px;display:inline-flex;align-items:center;justify-content:center;padding:0 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12.5px;cursor:pointer;transition:background-color .15s ease,filter .15s ease}',
      '.dsm-btn:hover:enabled{background:var(--dsw-alias-interactive-bg-hover)}',
      '.dsm-btn:disabled{opacity:.45;cursor:default}',
      '.dsm-btn.dsm-primary{background:var(--dsw-alias-button-primary-fill,#4d6bfe);border-color:transparent;color:var(--dsw-alias-label-primary-foreground,#fff)}',
      '.dsm-btn.dsm-primary:hover:enabled{filter:brightness(1.06)}',
      '@keyframes dsm-fade{from{opacity:0}to{opacity:1}}',
      '@keyframes dsm-pop{from{opacity:0;transform:translateY(6px) scale(.99)}to{opacity:1;transform:none}}',
      '@media (prefers-reduced-motion:reduce){.dsm-backdrop,.dsm-panel,.dsm-switch,.dsm-knob{animation:none;transition:none}}',
    ].join('\n');

    function ensureCss() {
      try {
        if (document.querySelector('style[data-plugin-css="' + CSS_MARK + '"]')) return;
        const style = document.createElement('style');
        style.dataset.plugin = CSS_MARK;
        style.dataset.pluginCss = CSS_MARK;
        style.textContent = CSS;
        document.head.appendChild(style);
      } catch (error) {
        // 注入失败时退化为无样式，功能仍可用。
      }
    }

    //#endregion

    //#region 组件

    /** 侧栏底部的入口按钮。 */
    function FooterButton() {
      return h(
        'button',
        {
          type: 'button',
          className: 'dsm-foot-btn',
          title: t('button'),
          'aria-label': t('button'),
          'aria-haspopup': 'dialog',
          onClick: (event) => {
            event.preventDefault();
            event.stopPropagation();
            openMenu();
          },
        },
        h(
          'svg',
          {
            viewBox: '0 0 16 16',
            width: 16,
            height: 16,
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 1.4,
            strokeLinecap: 'round',
            'aria-hidden': true,
          },
          h('path', { d: 'M2.25 5h11.5' }),
          h('circle', { cx: 6, cy: 5, r: 1.6, fill: 'var(--dsw-alias-bg-layer-1,#232326)', stroke: 'currentColor' }),
          h('path', { d: 'M2.25 11h11.5' }),
          h('circle', { cx: 10.5, cy: 11, r: 1.6, fill: 'var(--dsw-alias-bg-layer-1,#232326)', stroke: 'currentColor' }),
        ),
      );
    }

    /** 设置面板。 */
    function MenuOverlay() {
      const [, bump] = React.useState(0);
      const panelRef = React.useRef(null);

      React.useEffect(() => subscribe(() => bump((value) => value + 1)), []);

      React.useEffect(() => {
        if (!state.open) return undefined;
        const node = panelRef.current;
        if (node && typeof node.focus === 'function') node.focus();
        const onKeyDown = (event) => {
          if (event.key !== 'Escape') return;
          event.preventDefault();
          event.stopPropagation();
          closeMenu();
        };
        window.addEventListener('keydown', onKeyDown, true);
        return () => window.removeEventListener('keydown', onKeyDown, true);
      }, [state.open]);

      if (!state.open) return null;

      const rows = listPanels();
      const empty = (key) => h('div', { className: 'dsm-empty' }, t(key));
      const body = !api.supported
        ? empty('unavailable')
        : rows.length === 0
          ? empty('empty')
          : rows.map((row) => {
          const on = !isHidden(row.id);
          return h(
            'button',
            {
              key: row.id,
              type: 'button',
              role: 'switch',
              'aria-checked': on,
              className: 'dsm-row',
              onClick: () => toggle(row.id),
            },
            h('span', { className: 'dsm-label' }, row.label),
            h(
              'span',
              { className: on ? 'dsm-switch dsm-on' : 'dsm-switch', 'aria-hidden': true },
              h('span', { className: 'dsm-knob' }),
            ),
          );
        });

      return h(
        'div',
        {
          className: 'dsm-backdrop',
          onMouseDown: (event) => {
            if (event.target === event.currentTarget) closeMenu();
          },
        },
        h(
          'div',
          {
            className: 'dsm-panel',
            role: 'dialog',
            'aria-modal': 'true',
            'aria-label': t('title'),
            tabIndex: -1,
            ref: panelRef,
          },
          h(
            'div',
            { className: 'dsm-head' },
            h('div', { className: 'dsm-title' }, t('title')),
            h('div', { className: 'dsm-hint' }, t('hint')),
          ),
          h('div', { className: 'dsm-list' }, body),
          h(
            'div',
            { className: 'dsm-foot' },
            h(
              'button',
              {
                type: 'button',
                className: 'dsm-btn dsm-lead',
                disabled: rows.length === 0 || state.hidden.length >= rows.length,
                onClick: hideAll,
              },
              t('hideAll'),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'dsm-btn',
                disabled: state.undo.length === 0,
                onClick: undoStep,
              },
              t('undo'),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'dsm-btn',
                disabled: state.hidden.length === 0,
                onClick: showAll,
              },
              t('showAll'),
            ),
            h('button', { type: 'button', className: 'dsm-btn dsm-primary', onClick: closeMenu }, t('done')),
          ),
        ),
      );
    }

    //#endregion

    /**
     * 注册一个 slot 条目；宿主没有这个 slot（老/新版本改名）时静默跳过，
     * 不影响其它 slot 与本插件其余部分。
     */
    function contribute(key, id, component) {
      const slots = api.slots;
      if (!slots || typeof slots.inject !== 'function' || typeof slots.register !== 'function') return;
      try {
        slots.inject(key, () => {
          try {
            const handle = slots.register({ name: key, id, order: 60 }, component);
            return () => disposeHandle(handle);
          } catch (error) {
            return undefined;
          }
        });
      } catch (error) {
        // 该版本没有这个 slot：跳过这一个入口即可。
      }
    }

    function apply(ctx) {
      try {
        ensureCss();
      } catch (error) {
        // 无样式也不影响功能。
      }
      adoptLocale(ctx);
      api.slots = ctx && ctx.slots;

      // 没有 slots 服务（极老/极新的宿主）时什么都不做，绝不影响侧栏本身。
      if (!api.slots) return;

      installFilter(ctx);
      installPoke(ctx);

      contribute('sidebar.footer.action', 'sidebar-menu', FooterButton);
      contribute('shell.overlay', 'sidebar-menu', MenuOverlay);
    }

    return { name: '@local/sidebar-menu', inject: ['slots'], apply };
  },
});
