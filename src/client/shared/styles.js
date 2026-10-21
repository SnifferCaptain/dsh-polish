    // ----------------------------------------------------------------- styles

    function upsertStyle(id, css) {
      if (typeof document === 'undefined') return null
      var el = document.getElementById(id)
      if (el === null) {
        el = document.createElement('style')
        el.id = id
        el.setAttribute('data-plugin', 'dsh-polish')
        document.head.appendChild(el)
      }
      if (el.textContent !== css) el.textContent = css
      return el
    }

    function engineCss(lines, collapseMs) {
      var maxPx = Math.round(lines * LINE_PX)
      // 0.4.56: rc.1 的 DisclosureRow 在 [data-open] 下多了一层
      // div[data-disclosure-header] 头包装（data-disclosure-row 内移）——
      // 选择器必须把它排除，否则裁剪/折叠动画会落到头包装上、落不到正文。
      var body = '[' + PREVIEW_ATTR + '="1"][data-variant="think"][data-state="running"] > [data-open] > :not([data-disclosure-row]):not([data-disclosure-header])'
      var folding = '[' + COLLAPSING_ATTR + '="1"][data-variant="think"] > [data-open] > :not([data-disclosure-row]):not([data-disclosure-header])'
      return [
        '/* dsh-polish: rolling ' + lines + '-line reasoning preview */',
        '/* 0.4.53: 预览窗口（未展开）锁定底部、禁止自由滚动——overflow hidden',
        '   后用户无法滚动该窗口（滚轮被 overscroll-behavior 挡住不冒泡到页面），',
        '   要看内容请展开。0.4.55: 去掉 CSS 平滑滚动（smooth）——Chromium 实测该属性下',
        '   下 plain scrollTop 赋值不生效（平滑动画被流式更新打断、窗口钉死顶端），',
        '   程序化钉底改走 behavior:instant 跳转。 */',
        body + ' {',
        '  max-height: ' + maxPx + 'px;',
        '  overflow-y: hidden;',
        '  overflow-x: hidden;',
        '  overscroll-behavior: contain;',
        '  scrollbar-width: none;',
        '}',
        body + '::-webkit-scrollbar { width: 0; height: 0; }',
        /* Elapsed-time chip on the reasoning header. Tabular numerals keep the
           digits a constant width so the seconds do not wiggle as they tick;
           it is the header's last child, so growing width pushes nothing. */
        '.dshp-think-time { pointer-events: none; font-variant-numeric: tabular-nums; font-size: 12px; line-height: 1; opacity: .7; color: var(--dsw-alias-label-secondary); margin-left: 8px; white-space: nowrap; }',
        folding + ' {',
        '  max-height: 0 !important;',
        '  opacity: 0;',
        '  overflow: hidden !important;',
        '  padding-top: 0 !important;',
        '  padding-bottom: 0 !important;',
        '  transition: max-height ' + collapseMs + 'ms ease, opacity ' + Math.max(20, collapseMs - 20) + 'ms ease, padding ' + collapseMs + 'ms ease;',
        '}',
        '@media (prefers-reduced-motion: reduce) {',
        '  ' + folding + ' { transition: none; }',
        '}',
      ].join('\n')
    }

    var FORM_CSS = [
      '.dshp-form { display: flex; flex-direction: column; gap: 16px; padding: 2px 0; min-width: 0; max-width: 100%; }',
      '.dshp-field { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }',
      /* 0.4.37：内容重的设置页（prompts）用单列纵向版式。
         旧 .dshp-field 的横向「标签|控件」在控件很宽时会把 min-width:0 的
         标签列压成单字宽（用户截图里的「提示词预览」竖排 bug）。 */
      '.dshp-section { display: flex; flex-direction: column; gap: 10px; }',
      '.dshp-section-head { display: flex; flex-direction: column; gap: 2px; }',
      '.dshp-card { display: flex; flex-direction: column; gap: 10px; padding: 12px; min-width: 0; border: .5px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); }',
      '.dshp-vfield { display: flex; flex-direction: column; gap: 6px; }',
      '.dshp-preview { margin: 0; padding: 10px 12px; min-height: 96px; max-height: 360px; overflow: auto; border: .5px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-markdown-code-block, var(--dsw-alias-bg-layer-2)); color: var(--dsw-alias-label-primary); font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 12px; line-height: 1.55; white-space: pre-wrap; word-break: break-word; }',
      /* 0.4.94：预览下方的说明行（标题 + 计数）——不再是 <pre> 的子节点。 */
      '.dshp-preview-meta { display: flex; align-items: center; gap: 8px; flex-wrap: nowrap; min-width: 0; }',
      /* 0.4.94：预览下方的说明行（标题 + 计数）——不再是 <pre> 的子节点。 */
      '.dshp-preview-meta { display: flex; align-items: center; gap: 8px; flex-wrap: nowrap; min-width: 0; }',
      /* 0.4.94：预览下方的说明行（标题 + 计数）——不再是 <pre> 的子节点。 */
      '.dshp-preview-meta { display: flex; align-items: center; gap: 8px; flex-wrap: nowrap; min-width: 0; }',
      '.dshp-radio-row { display: flex; align-items: center; gap: 8px; width: 100%; padding: 6px 8px; border-radius: 8px; cursor: pointer; color: var(--dsw-alias-label-primary); }',
      '.dshp-radio-row:hover { background: var(--dsw-alias-interactive-bg-hover); }',
      '.dshp-radio-row[aria-current="true"] { background: var(--dsw-alias-bg-layer-2); }',
      '.dshp-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }',
      '.dshp-label { display: flex; align-items: center; gap: 8px; color: var(--dsw-alias-label-primary); font-size: 14px; line-height: 22px; }',
      '.dshp-hint { color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; min-width: 0; overflow-wrap: anywhere; }',
      '.dshp-tag { font-size: 11px; line-height: 16px; padding: 0 6px; border-radius: 4px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); }',
      /* 0.4.77：模式 radio 标签（此前用了未定义的 .dshp-radio 类，渲染成裸行内）。 */
      '.dshp-radio { display: flex; align-items: center; gap: 6px; cursor: pointer; }',
      '.dshp-control { display: flex; align-items: center; gap: 10px; flex: 0 0 auto; }',
      '.dshp-number { box-sizing: border-box; width: 92px; height: 32px; padding: 0 10px; border-radius: 8px; border: .5px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); font: inherit; font-size: 14px; text-align: right; }',
      '.dshp-number:focus { outline: none; border-color: var(--dsw-alias-border-l2); }',
      /* 0.4.72：session-slim 设置卡的分栏字段（小号标签 + 全宽文本框）。 */
      '.dshp-flabel { color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }',
      '.dshp-text-input { box-sizing: border-box; width: 100%; height: 32px; padding: 0 10px; border-radius: 8px; border: .5px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; }',
      '.dshp-text-input::placeholder { color: var(--dsw-alias-label-tertiary); }',
      '.dshp-text-input:focus { outline: none; border-color: var(--dsw-alias-border-l2); }',
      '.dshp-btn-sm { height: 26px; padding: 0 10px; border-radius: 13px; border: .5px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; line-height: 20px; cursor: pointer; white-space: nowrap; flex: 0 0 auto; max-width: 100%; overflow: hidden; text-overflow: ellipsis; }',
      '.dshp-btn-sm:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); }',
      '.dshp-btn-sm:disabled { opacity: .45; cursor: default; }',
      '.dshp-select { box-sizing: border-box; height: 32px; padding: 0 10px; border-radius: 8px; border: .5px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); font: inherit; font-size: 14px; }',
      '.dshp-select:focus { outline: none; border-color: var(--dsw-alias-border-l2); }',
      /* 0.4.77：多行输入专用（此前 textarea 误用 32px 高的 .dshp-select 类）。 */
      '.dshp-textarea { box-sizing: border-box; width: 100%; min-height: 56px; padding: 8px 10px; border-radius: 8px; border: .5px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; line-height: 1.5; resize: vertical; }',
      '.dshp-textarea::placeholder { color: var(--dsw-alias-label-tertiary); }',
      '.dshp-textarea:focus { outline: none; border-color: var(--dsw-alias-border-l2); }',
      '.dshp-switch { position: relative; flex: 0 0 auto; width: 40px; height: 22px; padding: 0; border: none; border-radius: 11px; background: var(--dsw-alias-border-l2); cursor: pointer; transition: background .15s ease; }',
      '.dshp-switch[aria-checked="true"] { background: var(--dsw-alias-button-primary-fill); }',
      '.dshp-knob { position: absolute; top: 2px; left: 2px; width: 18px; height: 18px; border-radius: 50%; background: var(--dsw-alias-switch-thumb); transition: transform .15s ease; }',
      '.dshp-switch[aria-checked="true"] .dshp-knob { transform: translateX(18px); }',
      '.dshp-footer { display: flex; align-items: center; gap: 12px; }',
      /* 0.4.94：按钮不许被挤换行——nowrap + flex 不收缩 + 溢出省略。
         此前 .dshp-btn 只有固定高度，行内 flex 收缩时按钮里的文字会换行，
         固定高度装不下就溢出到按钮外面（用户截图：刷新按钮文字溢出组件）。 */
      '.dshp-btn { height: 32px; padding: 0 14px; border-radius: 16px; border: .5px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: inherit; font-size: 14px; line-height: 22px; cursor: pointer; white-space: nowrap; flex: 0 0 auto; max-width: 100%; overflow: hidden; text-overflow: ellipsis; }',
      '.dshp-btn:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); }',
      '.dshp-btn:disabled { opacity: .45; cursor: default; }',
      '.dshp-btn-primary { background: var(--dsw-alias-button-primary-fill); color: var(--dsw-alias-label-primary-foreground); border-color: transparent; }',
      '.dshp-btn-primary:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover); }',
      '.dshp-number:focus-visible, .dshp-select:focus-visible, .dshp-textarea:focus-visible, .dshp-btn:focus-visible, .dshp-switch:focus-visible, .dshp-text-input:focus-visible, .dshp-btn-sm:focus-visible { outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: 2px; }',
      '.dshp-note { color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; min-width: 0; overflow-wrap: anywhere; }',
    ].join('\n')

