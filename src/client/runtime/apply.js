    // ------------------------------------------------------------------ apply

    var inject = ['slots', 'configForms']

    function apply(ctx) {
      upsertStyle(FORM_STYLE_ID, FORM_CSS)
      upsertStyle(DEPTH_STYLE_ID, DEPTH_CSS)

      // ---- component A: DOM engine, driven by its settings namespace.
      var engine = createEngine()
      var mirror = null
      try {
        mirror = ctx.configForms.describe()
      } catch (error) {
        mirror = null
      }

      function syncRenderer() {
        var read = readNamespace(ctx, NS_RENDERER, RENDERER_DEFAULTS)
        engine.setConfig({
          lines: num(read.value.lines, RENDERER_DEFAULTS.lines, 1, 20),
          collapseMs: num(read.value.collapseMs, RENDERER_DEFAULTS.collapseMs, 0, 2000),
          autoOpen: read.value.autoOpen !== false,
          showTime: read.value.showTime !== false,
          followMs: num(read.value.followMs, RENDERER_DEFAULTS.followMs, 0, 2000),
        })
        // The row switch is the component switch: when the Host stops serving
        // the namespace, its Loader entry is off, and so is the behaviour.
        if (read.served) engine.start()
        else engine.stop()
      }

      // ---- component B: the shipped 推理等级 row, rewritten as a slider.
      var patcher = createDepthPatcher()

      // ---- component C: up-arrow recall of this session's user messages.
      var history = createComposerHistory()

      // ---- component D: LRU ordering of the workspace groups. The engine is
      // created behind its own injection (it needs the workspaces/sessions
      // stores + remote.workspace) and stored here so syncLru can gate it.
      var lruEngine = null

      // ---- component E: completion / needs-attention alerts. Pure client — it
      // reads the viewed session's durable log through the always-on session
      // registry, so it needs no extra injection; the four toggles gate the
      // synthesized chime + system toast.
      var notifyEngine = createNotify()

      // ---- component I: chat visualization (```svg / ```mermaid fences →
      // diagrams). Pure client DOM enhancement — no extra ctx services — the
      // mermaid runtime arrives lazily through the client-modules chunk
      // protocol, so nothing heavy loads until a mermaid block actually shows.
      var visualizeEngine = createVisualize()

      function syncDepth() {
        var read = readNamespace(ctx, NS_DEPTH, DEPTH_DEFAULTS)
        depthConfigStore.set({
          showInComposer: read.value.showInComposer !== false,
          palette: DEPTH_PALETTES[read.value.palette] === undefined ? DEPTH_DEFAULTS.palette : read.value.palette,
          labels: read.value.labels !== false,
        })
        // Same rule as component A: no served namespace, no behaviour.
        if (read.served && read.value.showInComposer !== false) patcher.start()
        else patcher.stop()
      }

      function syncHistory() {
        var read = readNamespace(ctx, NS_HISTORY, HISTORY_DEFAULTS)
        history.setConfig({ enabled: read.served && read.value.enabled !== false })
      }

      function syncLru() {
        if (!lruEngine) return
        var read = readNamespace(ctx, NS_LRU, LRU_DEFAULTS)
        lruEngine.setConfig({
          enabled: read.served && read.value.enabled !== false,
          // 子智能体目录 LRU 是独立子开关（默认关），但同受行开关总闸约束。
          subagent: read.served && read.value.subagent === true,
        })
      }

      function syncNotify() {
        var read = readNamespace(ctx, NS_NOTIFY, NOTIFY_DEFAULTS)
        notifyEngine.setConfig({
          completeSound: read.served && read.value.completeSound === true,
          completeNotify: read.served && read.value.completeNotify === true,
          attentionSound: read.served && read.value.attentionSound === true,
          attentionNotify: read.served && read.value.attentionNotify === true,
        })
      }

      function syncVisualize() {
        var read = readNamespace(ctx, NS_VISUALIZE, VISUALIZE_DEFAULTS)
        visualizeEngine.setConfig({
          svg: read.served && read.value.svg !== false,
          mermaid: read.served && read.value.mermaid !== false,
        })
      }

      function syncAll() {
        syncRenderer()
        syncDepth()
        syncHistory()
        syncLru()
        syncNotify()
        syncVisualize()
        applyTimerActive(ctx)
      }

      ctx.effect(
        function () {
          if (mirror !== null && typeof mirror.subscribe === 'function') {
            var off = mirror.subscribe(syncAll)
            return function () {
              off()
            }
          }
          return function () {}
        },
        'dsh-polish: settings watch',
      )
      ctx.effect(
        function () {
          syncAll()
          history.start()
          notifyEngine.start()
          return function () {
            engine.stop()
            patcher.stop()
            history.stop()
            notifyEngine.stop()
            visualizeEngine.stop()
          }
        },
        'dsh-polish: thinking renderer',
      )

      // ---- component B needs the session Remote namespace for its writes, so
      // it lives behind its own injection: a deployment without `remote.session`
      // loses the slider only, never component A.
      ctx.inject(['remote', 'remote.session'], function (child) {
        // Always-on session capture: records the viewed session's Remote for
        // session-aware features (the thinking-time engine). Not gated by any
        // component row, so it is present whenever the parent dsh-polish row is
        // live — the time engine works even when composer-history is off.
        child.effect(
          function () {
            return child.slots.inject('conversation.input.right', function () {
              return child.slots.register(
                { name: 'conversation.input.right', id: 'dsh-polish:session-capture', order: 10 },
                makeSessionCapture(child),
              )
            })
          },
          'dsh-polish: session capture',
        )

        child.effect(
          function () {
            return child.configForms.whileServed([NS_DEPTH], function () {
              return child.slots.inject('conversation.input.right', function () {
                return child.slots.register(
                  { name: 'conversation.input.right', id: 'dsh-polish:thinking-depth', order: 40 },
                  makeSessionContext(child),
                )
              })
            })
          },
          'dsh-polish: thinking depth control',
        )

        // Component C: a hidden anchor per session, so the focused input can
        // find its session and the engine can reach `remote.session.page`.
        // Mounted unconditionally (exactly like the always-on session-capture
        // above) so the anchor + registry always exist. The anchor itself is inert
        // — the actual recall behaviour is still gated by the row's served state
        // via history.setConfig({ enabled }), so the component stays toggleable.
        child.effect(
          function () {
            return child.slots.inject('conversation.input.right', function () {
              return child.slots.register(
                { name: 'conversation.input.right', id: 'dsh-polish:composer-history', order: 50 },
                makeHistorySession(child, history),
              )
            })
          },
          'dsh-polish: composer history control',
        )

        // Component K (client half): per-(session, model) effort memory. It
        // watches the durable modelSelection projection of the mounted session
        // and answers the two spec moments with the selector's own calls —
        // save on effort change (immediate config write), restore on model
        // change (immediate selectModel with the remembered effort). Gated by
        // the keep-effort row switch (whileServed).
        child.effect(
          function () {
            return child.configForms.whileServed([NS_KEEP_EFFORT], function () {
              return child.slots.inject('conversation.input.right', function () {
                return child.slots.register(
                  { name: 'conversation.input.right', id: 'dsh-polish:keep-effort', order: 60 },
                  makeEffortKeeper(child),
                )
              })
            })
          },
          'dsh-polish: keep effort sync',
        )

        // 0.4.79: component M（会话瘦身）移入本注入块——页面新增
        // remote.session.modelCatalog() 读取（compact 模型下拉的数据源，
        // 与输入框模型选择器同一远程契约）。部署没有 remote.session 时
        // 整个瘦身页缺席（此前页面仍渲染但模型只能手填；此部署有该服务）。
        child.effect(
          function () {
            return child.configForms.whileServed([NS_SESSION_SLIM], function () {
              return child.slots.inject('settings.section', function () {
                return child.slots.register(
                  { name: 'settings.section', id: 'session-slim', order: 30, label: function () { return '会话瘦身' } },
                  makeSessionSlimSettingsPage(child),
                )
              })
            })
          },
          'dsh-polish: session slim settings section',
        )
      })

      // ---- timer clock: the most robust data channel. A fresh remote read of
      // the whole settings document every 1.5s (remote.settings.describe() —
      // the same call DSH's own settings mirror makes to reach the Host), which
      // bypasses the "did the event get forwarded / did the local mirror
      // subscription fire" uncertainty that left the icon blank. Gated behind its
      // own injection: a deployment without remote.settings simply has no clock.
      ctx.inject(['remote', 'remote.settings'], function (child) {
        child.effect(
          function () {
            return startTimerPoll(child.remote.settings)
          },
          'dsh-polish: timer settings poll',
        )
      })

      // ---- component F: 切换会话模式（「...」菜单）。需要 remote.agentPresets
      // （列预设）+ remote.settings（写 request / 读 result），所以放在自己的
      // 注入后面；部署没有这些 remote 命名空间就只是没有这个菜单。菜单项只在
      // 本行 served（行开关开）时出现（whileServed），行关则消失。
      ctx.inject(['remote', 'remote.agentPresets', 'remote.settings'], function (child) {
        child.effect(
          function () {
            return child.configForms.whileServed([NS_MODE_SWITCH], function () {
              return child.slots.inject('sidebar.workspaces.session.menu.item', function () {
                return child.slots.register(
                  {
                    name: 'sidebar.workspaces.session.menu.item',
                    id: 'dsh-polish:mode-switch',
                    order: 500,
                  },
                  makeModeSwitchMenu(child),
                )
              })
            })
          },
          'dsh-polish: mode switch menu',
        )
        child.effect(
          function () {
            return startModeSwitchResultPoll(child.remote.settings)
          },
          'dsh-polish: mode switch result poll',
        )
      })

      // ---- literal `$skill` picker. Typing either currency glyph never mutates
      // the draft; choosing a listed item (Tab / Enter / click) immediately
      // expands the token into the literal markdown reference [name](path).
      // configForms joins the child for the 0.4.62 diag sink (the Tab-select
      // forensics record into the keep-effort row's diagnostics).
      ctx.inject(['remote', 'remote.settings', 'configForms'], function (child) {
        child.effect(
          function () {
            return startSkillCatalogPoll(child.remote.settings)
          },
          'dsh-polish: skill catalog poll',
        )
        child.effect(
          function () {
            return child.slots.inject('conversation.input.overlay', function () {
              return child.slots.register(
                { name: 'conversation.input.overlay', id: 'dsh-polish:skill-mention-picker', order: 10 },
                makeSkillMentionPicker(child),
              )
            })
          },
          'dsh-polish: skill mention picker',
        )
      })

      // ---- component D: LRU ordering of the workspace groups. It needs the
      // workspaces/sessions stores and remote.workspace, so it sits behind its
      // own injection; a deployment without them simply leaves the list in
      // DSH's default order.
      ctx.inject(
        ['workspaces', 'sessions'],
        function (child) {
          child.effect(
            function () {
              lruEngine = createWorkspaceLru(child.workspaces, child.sessions)
              syncLru()
              lruEngine.start()
              return function () {
                lruEngine.stop()
                lruEngine = null
              }
            },
            'dsh-polish: workspace LRU order',
          )
        },
      )

      // ---- per-row configuration pages on the Plugins page.
      ctx.effect(
        function () {
          return ctx.slots.inject('plugins.row.config', function () {
            return ctx.slots.register({ name: 'plugins.row.config', key: ROW_KEY_RENDERER }, RendererPage)
          })
        },
        'dsh-polish: thinking renderer config page',
      )
      ctx.effect(
        function () {
          return ctx.slots.inject('plugins.row.config', function () {
            return ctx.slots.register({ name: 'plugins.row.config', key: ROW_KEY_DEPTH }, DepthPage)
          })
        },
        'dsh-polish: thinking depth config page',
      )
      ctx.effect(
        function () {
          return ctx.slots.inject('plugins.row.config', function () {
            return ctx.slots.register({ name: 'plugins.row.config', key: ROW_KEY_HISTORY }, HistoryPage)
          })
        },
        'dsh-polish: composer history config page',
      )
      ctx.effect(
        function () {
          return ctx.slots.inject('plugins.row.config', function () {
            return ctx.slots.register({ name: 'plugins.row.config', key: ROW_KEY_LRU }, LruPage)
          })
        },
        'dsh-polish: workspace LRU config page',
      )
      ctx.effect(
        function () {
          return ctx.slots.inject('plugins.row.config', function () {
            return ctx.slots.register({ name: 'plugins.row.config', key: ROW_KEY_SHELL_LOCAL }, ShellLocalPage)
          })
        },
        'dsh-polish: shell local config page',
      )
      ctx.effect(
        function () {
          return ctx.slots.inject('plugins.row.config', function () {
            return ctx.slots.register({ name: 'plugins.row.config', key: ROW_KEY_TIMER }, TimerPage)
          })
        },
        'dsh-polish: timer config page',
      )
      // 计时行首时钟：往会话行的 LEADING 插槽注册时钟。该插槽只在会话空闲
      // （非进行中/待审批/有完成未读）时由 DSH 渲染，所以这里出现的时钟
      // 恰好只覆盖「空闲且有活动计时器」的情形，进行中等状态不受影响。
      // 活动会话集合来自 host 的 volatile 设置 activeTimerSessionIds。
      ctx.effect(
        function () {
          return ctx.slots.inject('sidebar.session.row.leading', function () {
            return ctx.slots.register(
              { name: 'sidebar.session.row.leading', id: 'dsh-polish:timer-icon', order: 100 },
              makeTimerLeadingIcon(timerActiveStore),
            )
          })
        },
        'dsh-polish: timer row clock',
      )
      ctx.effect(
        function () {
          return ctx.slots.inject('plugins.row.config', function () {
            return ctx.slots.register({ name: 'plugins.row.config', key: ROW_KEY_NOTIFY }, NotifyPage)
          })
        },
        'dsh-polish: notify config page',
      )
      ctx.effect(
        function () {
          return ctx.slots.inject('plugins.row.config', function () {
            return ctx.slots.register({ name: 'plugins.row.config', key: ROW_KEY_VISUALIZE }, VisualizePage)
          })
        },
        'dsh-polish: visualize config page',
      )


      // ---- component J: custom system prompts. The row page is the live
      // kill switch (enabled); the real editor lives under Settings →
      // 提示词设置, registered only while the Host serves the namespace.
      ctx.effect(
        function () {
          return ctx.slots.inject('plugins.row.config', function () {
            return ctx.slots.register({ name: 'plugins.row.config', key: ROW_KEY_PROMPTS }, makePromptsRowPage(ctx))
          })
        },
        'dsh-polish: prompts config page',
      )
      ctx.effect(
        function () {
          return ctx.configForms.whileServed([NS_PROMPTS], function () {
            return ctx.slots.inject('settings.section', function () {
              return ctx.slots.register(
                { name: 'settings.section', id: 'prompts', order: 25, label: function () { return '提示词设置' } },
                makePromptsSettingsPage(ctx),
              )
            })
          })
        },
        'dsh-polish: prompts settings section',
      )
    }

    exports.name = 'dsh-polish'
    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
