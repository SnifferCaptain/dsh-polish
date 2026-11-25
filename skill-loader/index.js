import z from '@deepseek-ai/schemastery'

/**
 * 统一 skill 加载器（组件 G）：把多个 agent 工具的个人 skill 目录聚合注册进
 * DSH 的 skill registry（ctx.skills），让它们的 skill 能在 composer 里被引用。
 *
 * —— 为什么需要它 ——
 *   DSH 的 skill 注册表（@deepseek-ai/dsh-skill）是开着的。本行通过 DSH 抽象 fs
 *   provider 扫描常见个人根（~/.dsh/skills、~/.codex/skills、~/.claude/skills、~/.opencode/skills）；
 *   若 profile 启用了原生 filesystem，可在 roots 配置里移除已被接管的根，避免重复。
 * 自定义根（customRoots，设置页编辑）：每个文件夹递归扫描，深度上限 3 层（一个
 *   文件夹下的第 1～3 层子目录里找 SKILL.md；找到 skill 的目录不再往下走）。自定义根
 *   跳过点开头的目录与 node_modules。单个自定义根读失败只记日志，不影响其他根。
 * 扫描时机：不做定时扫描。启动时扫一次；设置页改了自定义根，或 Client 的 picker 打开
 *   （写入 request.nonce）时，最多每 2 秒重扫一次并刷新 catalog。
 * 增量缓存：列目录时拿到每个 SKILL.md 的 version，version 不变就复用上次解析结果，
 *   不重读文件；本次扫描没见到的缓存条目会被丢弃。
 *
 * —— 格式 ——
 *   各 agent（DSH / Codex / Claude Code / opencode）共用同一套 Agent Skills 的
 * SKILL.md 标准：YAML frontmatter（必须 name + description，可选 whenToUse、
 * disable-model-invocation、user-invocable）+ Markdown 正文。本行直接照
 * dsh-skill-filesystem 的解析逻辑读 frontmatter + 正文，name 用 frontmatter 里的
 * （不是目录名），且必须通过 kebab-case 校验（^[a-z0-9]+(?:-[a-z0-9]+)*$）。
 *
 * —— 同名冲突 ——
 *   registry 本身会按 rank 给同名 skill 选一个赢家（另一个被隐藏）。但我们希望
 * 冲突时两个都能用，所以在 provider 的 list() 里：若某个 name 出现在 >=2 个根，
 * 就给这些候选的 name 加 -<source> 后缀（如 shared-skill-codex / shared-skill-claude），
 * 让它们各自独立。唯一的 skill 保持原 name（不加后缀）。
 *
 * —— 注册契约（与 dsh-skill-filesystem 的 provider 完全对齐）——
 *   provider.list() 返回候选数组，每项：
 *     { name, description, whenToUse?, invocation:{modelInvocable,userInvocable},
 *       provider, source, rank, locator:{path,directory},
 *       resourceBase:{kind:"directory",path}, path, metadata? }
 *   provider.get(candidate, options) 读 SKILL.md 返回完整定义（含必填的 trimmed `content` 正文）。
 *   locator.path = 该 skill 的 SKILL.md 绝对路径；resourceBase.path = skill 目录
 *   （references/、agents/ 等子目录随目录一起可访问）。
 *
 * —— mention 展开（0.4.42 起）——
 *   Client picker 在选中 `$skill` 的瞬间（Tab/Enter/点选）把输入的 token 直接
 *   展开成字面 markdown 引用 [name](SKILL.md 绝对路径) 写进对话框——用户可见、
 *   可继续编辑的纯文本；没有隐藏标记、没有 DOM 装饰、没有发送时改写
 *   （对话框里是什么就发什么）。本文件只注册 skill provider 并维护供 Client
 *   轮询的 catalog（含 path），发送侧不再挂任何水幕改写。
 *   （0.4.35 的 U+2063 私有标记 + 发送时改写已整体移除：那套机制与 Lexical
 *   的实时 DOM 脱钩，空对话框下的 token 无法选中，输入还会掉字。）
 */

// kebab-case skill 名（与 @deepseek-ai/dsh-skill 的 isSkillName 一致；不直接 import
// 它，避免给本行加一个 @deepseek-ai/dsh-skill 的 peer 依赖——它只是个小正则）。
var SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
function isSkillName(name) {
  return typeof name === 'string' && SKILL_NAME.test(name)
}

// ~ 展开到 HOME；实际 canonicalization 交给 DSH 的抽象 fs.resolve。
function expandHome(p) {
  if (typeof p !== 'string' || p.length === 0) return p
  var home = typeof process !== 'undefined' && process.env ? process.env.USERPROFILE || process.env.HOME : ''
  if (p === '~') return home || p
  if (home && p.charAt(0) === '~' && (p.charAt(1) === '/' || p.charAt(1) === '\\')) {
    return home.replace(/[\\\\/]+$/, '') + '/' + p.slice(2)
  }
  return p
}

export const Config = z.object({
  /** 总开关（镜像本行 Loader 行开关）。 */
  enabled: z.boolean().default(true).volatile(),
  /** skill 根列表。path 支持 ~ 展开；source 是来源标签（也是冲突后缀用的 token）。
   * 默认覆盖四个常见个人根，确保 native skill-filesystem 未启用时仍可用；若
   * profile 同时启用了 native row，可在 roots 中只保留未被其接管的根，避免
   * 重复。 */
  roots: z
    .array(
      z.object({
        path: z.string(),
        source: z.string(),
        rank: z.number().default(400),
        skipSystem: z.boolean().default(true),
      }),
    )
    .default([
      { path: '~/.dsh/skills', source: 'dsh', rank: 400, skipSystem: true },
      { path: '~/.codex/skills', source: 'codex', rank: 400, skipSystem: true },
      { path: '~/.claude/skills', source: 'claude', rank: 400, skipSystem: true },
      { path: '~/.opencode/skills', source: 'opencode', rank: 400, skipSystem: true },
    ]),
  /** 同名冲突时才加 -<source> 后缀（true，默认）；false 则交给 registry 按 rank 选赢家。 */
  suffixOnlyConflicts: z.boolean().default(true).volatile(),
  /** 用户自定义的 skill 文件夹（设置页的列表编辑，volatile，运行时读取，改动即时生效）。 */
  customRoots: z.array(z.string()).default([]).volatile(),
  /** Client 的「请求重扫」通道（volatile）：picker 打开时写入新的 nonce，host 轮询到后重扫。 */
  request: z.object({ nonce: z.number() }).default({}).volatile(),
  /** Client picker catalog: summaries only, refreshed by the Host (volatile, no bodies). */
  catalog: z.array(z.object({
    name: z.string(),
    description: z.string(),
    source: z.string(),
    path: z.string(),
  })).default([]).volatile(),
})

// Skill registry, sandboxed filesystem, remote-visible settings, and timer.
export const inject = ['skills', 'fs', 'settings', 'timer']

const PROVIDER = 'dsh-polish-skill-loader'

// 自定义根的递归深度上限（第 1～3 层子目录）。
var CUSTOM_MAX_DEPTH = 3
// 单次扫描每个根最多访问的目录数，防止误指到超大目录树时把宿主卡住。
var MAX_DIRS_PER_ROOT = 2000
// 两次重扫之间的最小间隔（毫秒）。picker 连续打开只触发一次扫描。
var RESCAN_MIN_GAP_MS = 2000
// host 轮询 settings（读内存，不碰磁盘）的间隔。
var POLL_MS = 1000

/** 把自定义文件夹路径转成一个根描述；source 取文件夹名的 kebab 形式，并避开已占用的 source。 */
function customRootsFrom(paths, takenSources, takenPaths) {
  var out = []
  for (var i = 0; i < paths.length; i++) {
    var full = expandHome(String(paths[i] || '').trim())
    if (!full || takenPaths[full]) continue
    takenPaths[full] = true
    var parts = full.split(/[\\/]+/).filter(Boolean)
    var base = (parts.length > 0 ? parts[parts.length - 1] : '').toLowerCase()
    var slug = base.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'custom'
    var source = slug
    var n = 2
    while (takenSources[source]) source = slug + '-' + n++
    takenSources[source] = true
    out.push({ path: full, source: source, rank: 400, skipSystem: true, maxDepth: CUSTOM_MAX_DEPTH, custom: true })
  }
  return out
}

/** 读 settings 里本行的运行时值（customRoots 与 request）。读失败或行不存在时返回 null。 */
function readLiveRow(ctx) {
  try {
    var rows = ctx.settings && typeof ctx.settings.describe === 'function' ? ctx.settings.describe() : []
    for (var n = 0; n < rows.length; n++) {
      if (!rows[n] || rows[n].ns !== 'dsh-polish:skill-loader') continue
      var value = rows[n].value || {}
      return {
        customRoots: Array.isArray(value.customRoots) ? value.customRoots.filter(function (p) { return typeof p === 'string' }) : [],
        nonce: value.request && typeof value.request.nonce === 'number' ? value.request.nonce : 0,
      }
    }
  } catch (error) {}
  return null
}

/** 跳过规则：`.system` 只在 skipSystem 为真时跳过；自定义根另外跳过点开头的目录与 node_modules。 */
function skipEntry(entry, root) {
  if (root.skipSystem && entry.name === '.system') return true
  if (root.custom && (entry.name.charAt(0) === '.' || entry.name === 'node_modules')) return true
  return false
}

function warn(ctx, message) {
  if (ctx && ctx.logger && typeof ctx.logger.warn === 'function') ctx.logger.warn(message)
}

/** 一个 skill 根目录的发现 + 解析结果（候选，未做冲突后缀）。 */
class SkillProvider {
  constructor(ctx, control, config, shared) {
    this.ctx = ctx
    this.fs = ctx.fs
    this.control = control || {}
    this.name = PROVIDER
    this.config = config || {}
    // 跨 list() 调用共享的状态：解析缓存与「取自定义根的方式」。
    this.shared = shared
    // 内置根（不变）：{ path, source, rank, skipSystem, maxDepth: 1 }
    this.staticRoots = (config && config.roots ? config.roots : []).map(function (r) {
      return {
        path: expandHome(r.path),
        source: r.source,
        rank: r.rank,
        skipSystem: r.skipSystem !== false,
        maxDepth: 1,
        custom: false,
      }
    })
    this.suffixOnlyConflicts = !(config && config.suffixOnlyConflicts === false)
  }

  /** 当前生效的自定义根：优先读 settings 的运行时值，读不到时退回 yml 里的初始值。 */
  currentCustomRoots() {
    var live = this.shared ? this.shared.liveCustomRoots() : null
    var paths = live && Array.isArray(live) ? live : Array.isArray(this.config.customRoots) ? this.config.customRoots : []
    var takenSources = Object.create(null)
    var takenPaths = Object.create(null)
    for (var i = 0; i < this.staticRoots.length; i++) {
      takenSources[this.staticRoots[i].source] = true
      takenPaths[this.staticRoots[i].path] = true
    }
    return customRootsFrom(paths, takenSources, takenPaths)
  }

  /** 扫描所有根、聚合候选、处理同名冲突（加 -<source> 后缀）。 */
  async list(options) {
    var signal = options && options.signal ? options.signal : this.control.signal
    var roots = this.staticRoots.concat(this.currentCustomRoots())
    var perRoot = []
    var seenKeys = Object.create(null)
    var self = this
    for (var i = 0; i < roots.length; i++) {
      if (signal && signal.throwIfAborted) signal.throwIfAborted()
      try {
        perRoot.push(await this.discoverRoot(roots[i], signal, seenKeys))
      } catch (error) {
        if (signal && signal.aborted) throw error
        // 内置根的错误照旧抛出；自定义根的错误只记日志，其余根照常使用。
        if (!roots[i].custom) throw error
        warn(self.ctx, '[dshp skill-loader] 自定义文件夹读取失败，已跳过：' + roots[i].path + '（' + (error && error.message ? error.message : error) + '）')
        perRoot.push([])
      }
    }
    // 解析缓存只保留本次扫描见到的条目，已删除或已改版本的旧条目随之丢弃。
    if (this.shared) {
      var kept = new Map()
      var keys = Object.keys(seenKeys)
      for (var k = 0; k < keys.length; k++) {
        if (this.shared.parsed.has(keys[k])) kept.set(keys[k], this.shared.parsed.get(keys[k]))
      }
      this.shared.parsed = kept
    }
    // 汇总：name -> 出现过的 root.source 集合（用于判断冲突）。
    var byName = Object.create(null)
    var all = []
    for (var r = 0; r < perRoot.length; r++) {
      for (var s = 0; s < perRoot[r].length; s++) {
        var cand = perRoot[r][s]
        all.push(cand)
        if (!byName[cand.name]) byName[cand.name] = Object.create(null)
        byName[cand.name][cand.source] = true
      }
    }
    // 冲突 = 该 name 出现在 >=2 个不同 source。
    var result = []
    for (var k = 0; k < all.length; k++) {
      var c = all[k]
      var sources = byName[c.name] || {}
      var sourceCount = 0
      for (var key in sources) sourceCount++
      var isConflict = sourceCount >= 2
      var finalName = c.name
      if (this.suffixOnlyConflicts && isConflict) {
        finalName = c.name + '-' + c.source
        if (!isSkillName(finalName)) {
          // 加后缀后非法（理论上 source 都是 kebab-case 不会发生）——退回到 registry 按 rank 选。
          warn(this.ctx, '[dshp skill-loader] 冲突后缀后名字非法，跳过：' + finalName)
          continue
        }
      }
      var out = {}
      for (var f in c) out[f] = c[f]
      out.name = finalName
      result.push(out)
    }
    // 排序：按 name，便于稳定展示。
    result.sort(function (a, b) {
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0
    })
    return result
  }

  /** 读某个候选的 SKILL.md，返回完整 skill 定义。 */
  async get(candidate, options) {
    var locator = candidate.locator
    var parsed = await parseSkillFile(locator, this.ctx, options && options.signal)
    if (parsed === void 0) return void 0
    var expectedName = candidate.baseName || candidate.name
    if (parsed.name !== expectedName) {
      warn(this.ctx, '[dshp skill-loader] skill 名在 list/get 之间变化，忽略：' + expectedName)
      return void 0
    }
    return {
      name: candidate.name,
      description: parsed.description,
      whenToUse: parsed.whenToUse,
      invocation: parsed.invocation,
      source: candidate.source,
      provider: this.name,
      // The skill service requires the markdown body for skills.get().
      content: parsed.content.trim(),
      rank: candidate.rank,
      resourceBase: {
        kind: 'directory',
        path: locator.directory,
      },
      path: parsed.path,
      metadata: parsed.metadata,
    }
  }

  /**
   * 发现一个根下的所有 skill。根下的 *.md 扁平文件与第 1 层子目录总是会被看；
   * 更深的层级只在 root.maxDepth > 1（自定义根）时才看。找到 SKILL.md 的目录即为 skill，
   * 不再往下走，避免把 references/、agents/ 等资源目录当成 skill 扫描。
   */
  async discoverRoot(root, signal, seenKeys) {
    if (signal && signal.throwIfAborted) signal.throwIfAborted()
    var rootTarget
    try {
      rootTarget = await this.fs.resolve(root.path, { signal: signal })
    } catch (error) {
      if (isAbsentError(error)) return []
      throw error
    }
    var entries
    try {
      entries = await this.fs.listDir(rootTarget, signal)
    } catch (error) {
      if (isAbsentError(error)) return []
      throw error
    }
    entries = Array.isArray(entries) ? entries.slice() : []
    entries.sort(function (a, b) {
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0
    })
    var skills = []
    var budget = { dirs: MAX_DIRS_PER_ROOT }
    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i]
      if (skipEntry(entry, root)) continue
      if (entry.type === 'directory' && entry.name === '.system' && !root.custom) {
        // With skipSystem false, `.system` is a folder of skills (Codex layout:
        // skills/.system/<skill>/SKILL.md), so scan it as a root of its own.
        const systemRoot = Object.assign({}, root, { path: joinDisplay(root.path, '.system') })
        for (const skill of await this.discoverRoot(systemRoot, signal, seenKeys)) skills.push(skill)
        continue
      }
      if (entry.type === 'directory') {
        await this.visitDir(root, entry, 1, joinDisplay(root.path, entry.name), budget, skills, seenKeys, signal)
      } else if (entry.type === 'file' && entry.name.endsWith('.md')) {
        var locator = {
          target: entry.target,
          path: displayPath(entry.target, joinDisplay(root.path, entry.name)),
          directory: displayPath(rootTarget, root.path),
        }
        var flat = await this.loadSkill(root, locator, entry.version, seenKeys, signal)
        if (flat) skills.push(flat)
      }
    }
    if (budget.exhausted) warn(this.ctx, '[dshp skill-loader] 目录数超过上限（' + MAX_DIRS_PER_ROOT + '），本根只扫描了一部分：' + root.path)
    return skills
  }

  /** 访问一个目录：有 SKILL.md 就收为 skill；否则在深度允许时继续访问子目录。 */
  async visitDir(root, dir, depth, displayDir, budget, out, seenKeys, signal) {
    if (signal && signal.throwIfAborted) signal.throwIfAborted()
    if (budget.dirs <= 0) {
      budget.exhausted = true
      return
    }
    budget.dirs -= 1
    var children
    try {
      children = await this.fs.listDir(dir.target, signal)
    } catch (error) {
      if (isAbsentError(error)) return
      throw error
    }
    children = Array.isArray(children) ? children : []
    var skillFile = children.find(function (child) { return child.type === 'file' && child.name === 'SKILL.md' })
    if (skillFile) {
      var locator = {
        target: skillFile.target,
        path: displayPath(skillFile.target, displayDir + '/SKILL.md'),
        directory: displayPath(dir.target, displayDir),
      }
      var skill = await this.loadSkill(root, locator, skillFile.version, seenKeys, signal)
      if (skill) out.push(skill)
      return
    }
    if (depth >= root.maxDepth) return
    children.sort(function (a, b) {
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0
    })
    for (var i = 0; i < children.length; i++) {
      var child = children[i]
      if (child.type !== 'directory' || skipEntry(child, root)) continue
      await this.visitDir(root, child, depth + 1, displayDir + '/' + child.name, budget, out, seenKeys, signal)
    }
  }

  /**
   * 解析一个 SKILL.md（或扁平 .md）并组装成候选。列目录时拿到的 version 不变，
   * 就直接复用上次的解析结果；version 缺失时每次都解析（不冒险用旧结果）。
   */
  async loadSkill(root, locator, version, seenKeys, signal) {
    var targetKey = locator.target && locator.target.targetKey ? locator.target.targetKey : null
    var cacheKey = targetKey !== null && version !== undefined && version !== null ? targetKey + '\n' + String(version) : null
    var parsed
    if (cacheKey !== null && this.shared && this.shared.parsed.has(cacheKey)) {
      parsed = this.shared.parsed.get(cacheKey).value
    } else {
      parsed = await parseSkillFile(locator, this.ctx, signal)
      if (cacheKey !== null && this.shared) this.shared.parsed.set(cacheKey, { value: parsed })
    }
    if (cacheKey !== null && seenKeys) seenKeys[cacheKey] = true
    if (parsed === void 0) return null
    return {
      name: parsed.name,
      baseName: parsed.name,
      description: parsed.description,
      whenToUse: parsed.whenToUse,
      invocation: parsed.invocation,
      provider: this.name,
      source: root.source,
      rank: root.rank,
      locator: locator,
      resourceBase: { kind: 'directory', path: locator.directory },
      path: parsed.path,
      metadata: parsed.metadata,
    }
  }
}

// ---- SKILL.md 读取 + 解析（走 DSH 的抽象 fs，保持沙箱/执行世界边界）----

function joinDisplay(base, name, leaf) {
  var value = String(base || '').replace(/[\\\\/]+$/, '') + '/' + String(name || '')
  return leaf === undefined ? value : value + '/' + String(leaf)
}

function displayPath(target, fallback) {
  return target && typeof target.displayPath === 'string' && target.displayPath ? target.displayPath : fallback
}

function isAbsentError(error) {
  return error && (error.code === 'ENOENT' || error.code === 'ENOTDIR' || error.code === 'FS_NOT_FOUND' || error.code === 'FS_NOT_DIRECTORY')
}

async function readSkillText(ctx, locator, signal) {
  if (signal && signal.throwIfAborted) signal.throwIfAborted()
  try {
    var target = locator && locator.target ? locator.target : locator
    var path = locator && locator.path ? locator.path : String(target && target.displayPath ? target.displayPath : locator)
    return { path: path, content: await ctx.fs.readText(target, signal) }
  } catch (error) {
    if (signal && signal.throwIfAborted) {
      try {
        signal.throwIfAborted()
      } catch (_) {}
    }
    if (isAbsentError(error)) return void 0
    throw error
  }
}

async function parseSkillFile(locator, ctx, signal) {
  var raw = await readSkillText(ctx, locator, signal)
  var path = raw === void 0 ? locator && locator.path ? locator.path : String(locator) : raw.path
  if (raw === void 0) return void 0
  var parsed
  try {
    parsed = parseFrontmatter(raw.content)
  } catch (error) {
    warn(ctx, '[dshp skill-loader] 忽略 ' + path + '：frontmatter 解析失败：' + (error && error.message ? error.message : error))
    return void 0
  }
  if (!parsed) {
    warn(ctx, '[dshp skill-loader] 忽略 ' + path + '：缺少 YAML frontmatter')
    return void 0
  }
  var name = stringField(parsed.data, 'name')
  var description = stringField(parsed.data, 'description')
  if (name === void 0 || description === void 0) {
    warn(ctx, '[dshp skill-loader] 忽略 ' + path + '：frontmatter 需要 name 和 description')
    return void 0
  }
  if (!isSkillName(name)) {
    warn(ctx, '[dshp skill-loader] 忽略 ' + path + '：非法 skill 名「' + name + '」')
    return void 0
  }
  var invocation
  try {
    invocation = parseInvocationPolicy(parsed.data)
  } catch (error) {
    warn(ctx, '[dshp skill-loader] 忽略 ' + path + '：invocation frontmatter 非法：' + (error && error.message ? error.message : error))
    return void 0
  }
  return {
    name: name,
    description: description,
    whenToUse: optionalString(parsed.data, 'whenToUse'),
    invocation: invocation,
    path: raw.path,
    // Keep the markdown body separate from frontmatter. DSH's skill registry
    // requires it for `skills.get()` and the model-facing skill tool.
    content: parsed.body.trim(),
    metadata: optionalMetadata(parsed.data),
  }
}

/**
 * 极简 YAML 解析器：只解析 skill frontmatter 用到的子集——顶层 `key: value` 行、
 * 引号/无引号标量、块标量（| / >，含 +/- 变体）、注释与空行。SKILL.md 的
 * frontmatter 就是这种扁平键值（name/description/whenToUse/布尔开关/metadata 对象
 * 我们只取前几个标量，metadata 对象按原样留给可选字段时不强求解析嵌套）。
 * 不依赖第三方 yaml 包——因为 Cordis 组合的 import 解析器只解析已声明的
 * @deepseek-ai/* peer 依赖（从 asar），不解析 profile 父级 node_modules 里的第三方包，
 * 而 asar 里也没有可直接 import 的 yaml 入口。
 */
function parseSimpleYaml(text) {
  var data = Object.create(null)
  var lines = text.split(/\r?\n/)
  var i = 0
  while (i < lines.length) {
    var line = lines[i]
    var trimmed = line.trim()
    if (trimmed === '' || trimmed.charAt(0) === '#') { i++; continue }
    var m = line.match(/^([A-Za-z0-9_.-]+):(?:\s+(.*))?$/)
    if (!m) { i++; continue }
    var key = m[1]
    var value = (m[2] === undefined ? '' : m[2]).trim()
    if (value === '|' || value === '>' || value === '|-' || value === '>-' || value === '|+' || value === '>+') {
      var block = []
      i++
      while (i < lines.length && (lines[i].trim() === '' || /^\s+/.test(lines[i]))) {
        block.push(lines[i].trim())
        i++
      }
      data[key] = block.join(value.charAt(0) === '>' ? ' ' : '\n').trim()
      continue
    }
    if (
      (value.charAt(0) === '"' && value.charAt(value.length - 1) === '"' && value.length >= 2) ||
      (value.charAt(0) === "'" && value.charAt(value.length - 1) === "'" && value.length >= 2)
    ) {
      var q = value.charAt(0)
      var inner = value.slice(1, -1)
      if (q === '"') inner = inner.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\')
      else inner = inner.replace(/''/g, "'")
      data[key] = inner
    } else {
      var hashIdx = value.indexOf(' #')
      if (hashIdx >= 0) value = value.slice(0, hashIdx).trim()
      data[key] = value
    }
    i++
  }
  return data
}

function parseFrontmatter(raw) {
  var firstLineEnd = raw.indexOf('\n')
  if (firstLineEnd < 0) return void 0
  if (raw.slice(0, firstLineEnd).replace(/\r$/, '') !== '---') return void 0
  var start = firstLineEnd + 1
  var closing = findClosingFrontmatter(raw, start)
  if (closing === void 0) return void 0
  var data = parseSimpleYaml(raw.slice(start, closing.start))
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return void 0
  return { data: data, body: raw.slice(closing.bodyStart) }
}

function findClosingFrontmatter(raw, start) {
  var lineStart = start
  while (lineStart <= raw.length) {
    var nextNewline = raw.indexOf('\n', lineStart)
    var lineEnd = nextNewline < 0 ? raw.length : nextNewline
    if (raw.slice(lineStart, lineEnd).replace(/\r$/, '') === '---') {
      return { start: lineStart, bodyStart: nextNewline < 0 ? raw.length : nextNewline + 1 }
    }
    if (nextNewline < 0) return void 0
    lineStart = nextNewline + 1
  }
  return void 0
}

function stringField(data, key) {
  var value = data[key]
  return typeof value === 'string' && value.length > 0 ? value : void 0
}
function optionalString(data, key) {
  var value = data[key]
  return typeof value === 'string' && value.length > 0 ? value : void 0
}
function parseInvocationPolicy(data) {
  var disableModelInvocation = frontmatterBoolean(data, 'disable-model-invocation')
  var userInvocable = frontmatterBoolean(data, 'user-invocable')
  return {
    modelInvocable: disableModelInvocation !== true,
    userInvocable: userInvocable !== false,
  }
}
function frontmatterBoolean(data, key) {
  if (!Object.prototype.hasOwnProperty.call(data, key)) return void 0
  var value = data[key]
  if (typeof value === 'boolean') return value
  if (value === 1 || value === '1') return true
  if (value === 0 || value === '0') return false
  if (typeof value === 'string') {
    switch (value.toLowerCase()) {
      case 'true':
      case 'yes':
      case 'on':
        return true
      case 'false':
      case 'no':
      case 'off':
        return false
    }
  }
  throw new TypeError('frontmatter field "' + key + '" must be a boolean')
}
function optionalMetadata(data) {
  var value = data.metadata
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) return value
  return void 0
}

var SKILL_NS = 'dsh-polish:skill-loader'

async function publishSkillCatalog(ctx) {
  if (!ctx || !ctx.skills || typeof ctx.skills.list !== 'function' || !ctx.settings || typeof ctx.settings.update !== 'function') return
  try {
    var skills = await ctx.skills.list({})
    var catalog = []
    for (var i = 0; i < skills.length; i++) {
      var skill = skills[i]
      if (!skill || !skill.invocation || skill.invocation.userInvocable !== true) continue
      catalog.push({
        name: skill.name,
        description: skill.description || '',
        source: skill.source || 'custom',
        path: skill.path || (skill.resourceBase && skill.resourceBase.path) || '',
      })
    }
    catalog.sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0 })
    var existing = null
    var rows = ctx.settings.describe ? ctx.settings.describe() : []
    for (var n = 0; n < rows.length; n++) if (rows[n] && rows[n].ns === SKILL_NS) existing = rows[n]
    var current = existing && existing.value && Array.isArray(existing.value.catalog) ? existing.value.catalog : []
    if (JSON.stringify(current) !== JSON.stringify(catalog)) await ctx.settings.update(SKILL_NS, { catalog: catalog })
  } catch (error) {
    warn(ctx, '[dshp skill-loader] 技能目录刷新失败：' + (error && error.message ? error.message : error))
  }
}

export function apply(ctx, config) {
  // 设置页只编辑 customRoots；catalog 与 request 仍是 volatile Client 通道。
  try {
    if (ctx.settings && typeof ctx.settings.configure === 'function') {
      if (typeof ctx.effect === 'function') ctx.effect(function () { return ctx.settings.configure({ auto: false }, ctx.fiber) }, 'dsh-polish: skill settings policy')
      else ctx.settings.configure({ auto: false }, ctx.fiber)
    }
  } catch (error) {}

  var enabled = !config || config.enabled !== false
  if (!enabled) return

  // 解析缓存与自定义根读取器跨 list() 共享；apply 重跑（重装、HMR）时重新创建。
  var shared = {
    parsed: new Map(),
    liveCustomRoots: function () {
      var row = readLiveRow(ctx)
      return row ? row.customRoots : null
    },
  }

  var register = function () {
    return ctx.skills.registerProvider(function (control) {
      return new SkillProvider(ctx, control, config, shared)
    })
  }

  function installProvider() {
    var unregister = register()
    var stopped = false
    var running = false
    var pending = false
    var lastRunAt = 0
    var lastSignature = null
    // 重扫并刷新 catalog。扫描进行中收到的请求只记一次 pending，结束后补跑一次。
    var run = function () {
      if (stopped) return
      if (running) {
        pending = true
        return
      }
      running = true
      lastRunAt = Date.now()
      var done = function () {
        running = false
        if (pending && !stopped) {
          pending = false
          run()
        }
      }
      Promise.resolve(publishSkillCatalog(ctx)).then(done, done)
    }
    // 轮询读的是 settings 内存值，不碰磁盘。只有「自定义根 + 请求 nonce」变化时才重扫，
    // 且两次重扫至少间隔 RESCAN_MIN_GAP_MS。
    var poll = function () {
      if (stopped) return
      var live = readLiveRow(ctx)
      var signature = live ? JSON.stringify([live.customRoots, live.nonce]) : ''
      if (signature === lastSignature) return
      if (lastSignature !== null && Date.now() - lastRunAt < RESCAN_MIN_GAP_MS) return
      lastSignature = signature
      run()
    }
    poll()
    var stopInterval = typeof ctx.interval === 'function' ? ctx.interval(poll, POLL_MS) : null
    return function () {
      stopped = true
      try { if (typeof stopInterval === 'function') stopInterval(); else if (stopInterval && typeof stopInterval.dispose === 'function') stopInterval.dispose() } catch (error) {}
      try { if (typeof unregister === 'function') unregister() } catch (error) {}
    }
  }

  try {
    if (typeof ctx.effect === 'function') ctx.effect(installProvider, 'dsh-polish: skill provider and catalog')
    else installProvider()
  } catch (error) {
    warn(ctx, '[dshp skill-loader] 注册 provider 失败：' + (error && error.message ? error.message : error))
  }
}
