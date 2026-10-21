import z from '@deepseek-ai/schemastery'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'

/**
 * 会话瘦身（组件 M）：把冗长会话「压缩续命」——对会话的当前上下文窗口（打开
 * 会话所见的最新窗口，与几百条历史无关）跑一次与内置 /compact 同形的压缩，
 * 得一段 checkpoint，旧会话改名归档
 * （`原名@K`，K = 同基名所有会话中尾部 `@N` 的最大值 + 1，永不撞名），
 * 再创建一个同名（原名）新会话（seed 注入 checkpoint：空闲会话，只存上下文、不强制模型回复），继承
 * 旧会话的模型/effort 选择。归档 = `workspaceRegistry.archiveSession`
 * （主会话 + 其全部子代理逐个归档——该 API 不级联；不删除、不
 * stopActivity；用户可在工作区归档列表里找回）。
 *
 * —— 与内置 /compact 的关系 ——
 *   内置 compaction（dsh-compaction-basic）是**会话内**事件流压缩：把
 *   shadowed 区段替换成 compaction 事件，会话 id 不变。本组件是**会话级**
 *   瘦身：旧会话原封不动（只是改名 + 归档），新会话只带 checkpoint 开始，
 *   上下文从此干净。两者的 LLM 总结指令是同一份（下方 COMPACTION_INSTRUCTION
 *   逐字取自 dsh-compaction-basic 的 COMPACTION_INSTRUCTION 常量，
 *   CHECKPOINT_PREAMBLE 逐字取自其 CHECKPOINT_PREAMBLE），所以新会话读到的
 *   背景与内置压缩产物同构。
 *
 * —— 数据面：fetch 路由（而不是 volatile 设置推送）——
 *   行数据是「每会话一行」的表格（标题/事件数/文件大小/上下文/状态），
 *   走 volatile 设置会重复 0.4.45 之前的失效风暴（每次重写整行配置 →
 *   全局 settings 失效 → 所有设置页重渲染）。因此宿主用
 *   `connection.fetch.register` 挂三条只读/控制路由，客户端页面 2.5s 轮询：
 *     GET  /api/dshp/session-slim/state   → { rows, memory, queue, done, now }
 *     POST /api/dshp/session-slim/slim    → body { ids: [...] } 入队
 *     POST /api/dshp/session-slim/refresh → 强制重统计（清 10s 缓存）
 *     POST /api/dshp/session-slim/stop    → 停止排队（进行中的任务跑完当前阶段）
 *   这是 core 插件的标准手法（dsh-api-session-controller 的 /api/file、
 *   dsh-session-log-export 的下载路由同范式：`ctx.effect(() =>
 *   ctx.connection.fetch.register({ path, methods, requestBody, fetch }), 标签)`）。
 *
 * —— 行指标从哪来（不拆 zstd，全部走现成物化面）——
 *   · 冷会话：`~/.dsh/storages/session_projcache/sessions/<id>.json`
 *     （sessionProjections 的持久化投影缓存，v7）：rows.title.val = 最新标题；
 *     所有 row 共享同一 seq（0 基日志前缀）→ 事件数 = max(seq) + 1；
 *     rows.contextPressure.val = { contextWindow?, pressureTokens?,
 *     surfaceTokens }（token-meter 投影：surfaceTokens = 当前上下文 token 数，
 *     contextWindow = 模型窗口）；rows.modelSelection.val.lastUsed =
 *     { provider, model, reasoningEffort? }；record.identity.cwd = 项目。
 *   · 热会话：ctx.sessions.list()（全量在内存会话，无 LRU 逐出）+
 *     ctx.sessionProjections.stateOf(session, key)（与投影缓存同键）。
 *   · zstd 原始文件大小：`~/.dsh/sessions/<cwd-slug>/<id>/session.v4.jsonl.zstd`
 *     的 fs.stat（不解压）。cwd-slug 是 8.3 短名编码（中文 → ~XXXX~），
 *     不反推编码——直接遍历 sessions 下的工作区目录建 id→size 映射。
 *   · 进行中：ctx.agents.list() 里 agent.status === 'running'（core 自己的
 *     活动判定，dsh-workspace 的 turn-archive 门同式）。进行中的会话跳过
 *     （用户拍板：谨慎优先）。
 *   · 0.4.74 父子折叠（取代 0.4.73 的「整类排除」）：每个顶层会话一行，
 *     事件数 / 文件大小 = 主会话 + 全部后代子代理合计（用户拍板「我计算
 *     的时候应当是这些的综合」）；running / live 树上任一为真即真；
 *     subIds = 全部后代 id（归档级联用）。谱系用
 *     ctx.sessionQuery.listSessions()（与侧栏同源的完整逻辑语料；子代理
 *     子会话 header 的 parentSession = 父会话 id，dsh-subagent 创建时写入）。
 *     父会话不在语料（孤儿子代理）→ 按顶层行独立展示；语料读取失败 →
 *     回退 0.4.73 行为（subagent 整类跳过：热会话 header.origin ===
 *     'subagent'；冷会话投影行 rows.subagent.val，仅 subagent/descriptor
 *     事件写入）。
 *   · 0.4.73 筛选：事件数是**唯一**筛选条件（用户拍板「以事件数为准」），
 *     默认 5000；原文件大小阈值字段已移除。
 *
 * —— 当前上下文窗口（0.4.80：slim 读什么）——
 *   sessionQuery.readSurface(id)（dsh-session-query）：「读取一个会话的完整
 *   当前模型 surface（live-preferred，冷会话同样可读，无需使其 live）」，
 *   返回 { session: header 克隆, inheritedEventCount, capturedThroughSeq,
 *   events: 当前 surface 事件快照 }。surface = 最新的上下文窗口：被 DSH
 *   自身压缩 shadowed 的旧区段在 surface 里已替换为 checkpoint，所以窗口
 *   受模型窗口约束，而不是几百条的完整日志。用户 0.4.80 拍板：slim ≡
 *   「打开这个会话 /compact 一次，把结果复制进新会话」——只有这个窗口参与
 *   压缩，历史日志不读、不总结。
 *   事件 → 模型消息用本地 deriveMessage()（dsh-session 导出函数
 *   deriveEventMessage 的逐行移植；dsh-session 不在本包声明依赖里，
 *   pnpm 严格模式不可静态导入，故移植而非导入）。
 *
 * —— 压缩调用（与内置 /compact 同形，0.4.80 单次窗口压缩）——
 *   ctx.llm.stream({ provider, model, messages, maxTokens,
 *   sessionId, purpose: 'compaction', tools?, reasoningEffort? }) +
 *   BlockAssembler 收块（dsh-llm 导出；chunk 协议：block-start/text-delta/
 *   block-end/usage/finish）。messages = 窗口全部消息 + 指令（末条 user
 *   消息）——正是 dsh-compaction-basic compactNow（retainTokens=0，即
 *   /compact）的调用形状。窗口预算（启发式）：window = resolveModelInfo
 *   的 contextWindow（失败保守按 32768）；输出预算 = min(65536,
 *   max(8192, window/2))；输入预算 = max(8000, window − 输出预算 − 16384)。
 *   窗口 token 数 ≤ 输入预算 → 单次调用（一般情形，成本 = 一次 /compact）；
 *   仅当窗口本身超预算（从未压缩过的巨型会话）→ 回退 0.4.79 的分块
 *   map-reduce（~min(24000, 输入预算) token/块、树形合并），分片对象仍是
 *   这个窗口。单条消息 > 60000 token 的（巨型工具结果）先截断再入块。
 *   token 计数用本地启发式（CJK ≈ 1 字符/token，其余 ≈ 3.5 字符/token，
 *   宁高勿低）。compact 模型：页面配置（compactProvider/compactModel/
 *   compactEffort）优先；留空 = 继承该会话 modelSelection.lastUsed。调用
 *   前用 ctx.llm.resolveCallConfig 验证路由有效。（DSH 压缩另传 toolHistory
 *   做适配器工具投影——KV 缓存优化，非语义输入，slim 不复刻。）
 *
 * —— 改名/归档/新建/注入（全部 host 服务，wire 不经过客户端）——
 *   sessionController.rename({ sessionId, title }) → { title, seq }
 *     （内部 resolveAgent：冷会话会被恢复进内存——归档后留在内存至进程
 *     退出，插件层没有可达的 unload API；页面文案已如实说明）。
 *   workspaceRegistry.archiveSession(id, {})（不带 stopActivity）→ 再对
 *   row.subIds 里每个后代子代理逐个 archiveSession（该 API 不级联，
 *   子代理同占资源，用户拍板连带封存）。
 *   workspaceRegistry.list() 按 path 匹配 cwd 找到工作区 →
 *   sessionController.create({ workspaceId })（create 内部 attachSession，
 *   新会话挂回原工作区组；找不到工作区才退回 create({ cwd })）。
 *   sessionController.rename(newId, 原名) →
 *   resolveAgent(newId).followup(createUserMessage({ content, source })) →
 *   sessions.flush(agent.session)（timer 组件注入消息的同一真路径）→
 *   modelSelection.lastUsed 存在时 selectModel(newId, lastUsed)。
 */

// ---- 纯函数（harness 直接测） ------------------------------------------------

/**
 * 旧会话的归档名：`基名@K`。基名 = 当前标题去掉尾部 `@N`（没有则原样）；
 * K = 当前标题的 N（若有）与 allTitles（同项目全部会话标题，热+冷）中
 * 匹配 `^基名@(\d+)$` 的最大 N + 1。用户规则：Foo@3 已存在 → 下一个是
 * Foo@4（不是 Foo@3@1）。allTitles 为空且标题无后缀 → Foo@1。
 * 标题为空返回 null（调用方按错误处理）。
 */
export function nextArchiveTitle(currentTitle, allTitles) {
  var title = typeof currentTitle === 'string' ? currentTitle.trim() : ''
  if (title === '') return null
  var base = title.replace(/@\d+$/, '')
  var self = /@(\d+)$/.exec(title)
  var maxK = self ? parseInt(self[1], 10) : 0
  var titles = Array.isArray(allTitles) ? allTitles : []
  var pattern = new RegExp('^' + base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '@(\\d+)$')
  for (var i = 0; i < titles.length; i++) {
    var t = typeof titles[i] === 'string' ? titles[i].trim() : ''
    var m = pattern.exec(t)
    if (m) {
      var k = parseInt(m[1], 10)
      if (k > maxK) maxK = k
    }
  }
  return base + '@' + (maxK + 1)
}

/**
 * 原始事件 → 模型消息。dsh-session deriveEventMessage 的逐行移植（无投影
 * 重写层：slim 读的是日志快照，不需要插件消息重写）。
 */
export function deriveMessage(event) {
  if (!event || typeof event.type !== 'string' || !event.data) return null
  switch (event.type) {
    case 'user/message':
      return event.data
    case 'system/message':
    case 'developer/message':
    case 'assistant/message': {
      var message = event.data.message
      if (!message || !Array.isArray(message.content) || message.content.length === 0) return null
      return message
    }
    case 'tool/result':
      return event.data.message || null
    default:
      return null
  }
}

/** 文本 token 启发式（宁高勿低）：CJK/全角 ≈ 1 字符 1 token，其余 ≈ 3.5 字符/token。 */
export function estimateTextTokens(text) {
  if (typeof text !== 'string' || text.length === 0) return 0
  var cjk = 0
  var other = 0
  for (var i = 0; i < text.length; i++) {
    var code = text.charCodeAt(i)
    var wide =
      (code >= 0x2e80 && code <= 0x9fff) || // CJK 统一表意（含扩展 A 前段）
      (code >= 0x3000 && code <= 0x303f) || // CJK 标点
      (code >= 0x3400 && code <= 0x4dbf) || // 扩展 A
      (code >= 0xac00 && code <= 0xd7af) || // 谚文
      (code >= 0xf900 && code <= 0xfaff) || // 兼容表意
      (code >= 0xff00 && code <= 0xffef) // 全角形
    if (wide) cjk += 1
    else other += 1
  }
  return cjk + Math.ceil(other / 3.5)
}

/** 单条消息的 token 估算（role 框定 4 + 各 content 块）。 */
export function estimateMessageTokens(message) {
  var total = 4
  if (!message || !message.content) return total
  var items
  if (Array.isArray(message.content)) items = message.content
  else if (typeof message.content === 'string') items = [{ type: 'text', text: message.content }]
  else return total
  for (var i = 0; i < items.length; i++) {
    var block = items[i]
    if (!block || typeof block !== 'object') continue
    if (typeof block.text === 'string') total += estimateTextTokens(block.text)
    else if (typeof block.input === 'string') total += estimateTextTokens(block.input)
    else if (block.input && typeof block.input === 'object') total += estimateTextTokens(JSON.stringify(block.input))
    else if (block.type === 'tool_result' && block.content) total += estimateMessageTokens({ content: block.content })
    else if (Array.isArray(block.content)) total += estimateMessageTokens({ content: block.content })
  }
  return total
}

/**
 * 贪心分块：每块 ≤ budget token；超大单条消息（> OVERSIZED_TOKENS）先截断
 * 文本块再入块。返回 [{ messages, tokens }]（顺序保持）。
 */
export function chunkMessages(messages, budget) {
  var list = Array.isArray(messages) ? messages : []
  var cap = typeof budget === 'number' && budget > 0 ? budget : 24000
  var chunks = []
  var current = []
  var currentTokens = 0
  for (var i = 0; i < list.length; i++) {
    var message = list[i]
    if (!message) continue
    var tokens = estimateMessageTokens(message)
    if (tokens > OVERSIZED_TOKENS) {
      message = truncateMessage(message, OVERSIZED_TOKENS)
      tokens = estimateMessageTokens(message)
    }
    if (currentTokens + tokens > cap && current.length > 0) {
      chunks.push({ messages: current, tokens: currentTokens })
      current = []
      currentTokens = 0
    }
    current.push(message)
    currentTokens += tokens
  }
  if (current.length > 0) chunks.push({ messages: current, tokens: currentTokens })
  return chunks
}

function truncateMessage(message, maxTokens) {
  var content = message && Array.isArray(message.content) ? message.content : null
  if (!content) return message
  var out = []
  for (var i = 0; i < content.length; i++) {
    var block = content[i]
    if (block && typeof block.text === 'string' && estimateTextTokens(block.text) > maxTokens) {
      // 按「该文本自己的字符/token 比」反推截断长度（CJK ≈ 1、latin ≈ 3.5），
      // 留 5% 余量，保证截断后估算 ≤ maxTokens。
      var ratio = block.text.length / Math.max(1, estimateTextTokens(block.text))
      var cut = block.text.slice(0, Math.max(2000, Math.floor(ratio * maxTokens * 0.95)))
      out.push({ type: block.type, text: cut + '\n[…slim-trimmed…]' })
    } else {
      out.push(block)
    }
  }
  return { role: message.role, content: out }
}

/**
 * 0.4.80：surface 事件（readSurface 的 events）→ 压缩输入。messages = 逐事件
 * deriveMessage（非消息事件为 null，跳过）保持顺序；tools = 窗口内最后一个
 * request/header 的 tools 数组（压缩调用同形传 DSH）；sourceTokens = 窗口
 * 消息 token 估算和（决定单次调用还是分块回退）。纯函数，harness 直测。
 */
export function surfaceFromEvents(events) {
  var list = Array.isArray(events) ? events : []
  var messages = []
  var tools = null
  var sourceTokens = 0
  for (var i = 0; i < list.length; i++) {
    var event = list[i]
    if (!event || typeof event !== 'object') continue
    if (event.type === 'request/header' && event.data && event.data.header && Array.isArray(event.data.header.tools)) {
      tools = event.data.header.tools
    }
    var message = deriveMessage(event)
    if (message) {
      messages.push(message)
      sourceTokens += estimateMessageTokens(message)
    }
  }
  return { messages: messages, tools: tools, sourceTokens: sourceTokens }
}

// 分块参数：24000 token/块（32k 窗口模型的 75%；指令 + 输出还有余量），
// 单条消息 60000 token 上限（截断保留 60% 正文）。
var OVERSIZED_TOKENS = 60000
var CHUNK_BUDGET_TOKENS = 24000
var SUMMARY_MAX_TOKENS = 8000
var ROWS_TTL_MS = 10000
var BATCH_GAP_MS = 3000
var LLM_IDLE_TIMEOUT_MS = 120000   // 0.4.78：模型流 2 分钟无数据视为挂死
var LLM_CALL_HARD_MS = 30 * 60000  // 0.4.78：单次模型调用总时长上限
// 0.4.79：看门狗从 20 分钟提到 4 小时——超大会话（如 409 分片）的合法
// 总结在并行下也要数小时，旧值会把正常任务在 map 中途强杀（看门狗的
// 用途是清理挂死，不是限制工作量；单次调用仍受 LLM_CALL_HARD_MS 约束）。
var SLIM_JOB_HARD_MS = 4 * 60 * 60000
var SUMMARIZE_CONCURRENCY = 4 // 0.4.79：分片 map 阶段的并行度
var MERGE_GROUP_SIZE = 4      // 0.4.79：树形 reduce 每轮合并的分片数（4→1）
// 0.4.80：单次压缩调用的输出预算上下限（65536 = DSH headroomTokens 默认；
// 8192 下限——更小的 checkpoint 带不动上下文）。
var COMPACTION_MAX_OUTPUT = 65536
var COMPACTION_OUTPUT_FLOOR = 8192

// ---- 与内置压缩同构的指令文本（逐字取自 dsh-compaction-basic）--------------

var COMPACTION_INSTRUCTION = [
  'You are now acting as a compaction engine for this AI coding assistant. Condense the conversation ABOVE into a structured checkpoint that lets another model resume the work with no loss of essential context.',
  '',
  'Output EXACTLY the Markdown structure below: keep every section, in order. Use terse bullets, not prose paragraphs. Write "(none)" for an empty section — never drop a section.',
  '',
  '## Primary Request and Intent',
  '- [the user\'s original and evolving goals; quote verbatim where the exact wording matters]',
  '',
  '## Key Technical Concepts',
  '- [technologies, frameworks, patterns, and conventions in play]',
  '',
  '## Files and Code',
  '- [exact path: why it matters, key changes or snippets]',
  '',
  '## Errors and Fixes',
  '- [error: how it was resolved, plus any related user feedback]',
  '',
  '## Pending Jobs',
  '- [explicitly requested work not yet completed]',
  '',
  '## Current Work',
  '- [precisely what was in progress at this checkpoint]',
  '',
  '## Next Step',
  '- [the single next action, directly in line with the most recent request, or "(none)"]',
  '',
  '## Critical Context',
  '- [decisions and their rationale, constraints, user preferences, open questions, data needed to continue]',
  '',
  'Rules:',
  '- Write concise English engineering prose. Preserve exact file paths, commands, error strings, identifiers, numeric values, function signatures, and syntax fragments.',
  '- Capture user feedback and explicit instructions faithfully, especially corrections.',
  '- Do NOT mention this summarization request or that the context was compacted.',
  '- Output only the checkpoint text: do not call any tool or take any other action.',
  '- If the conversation already contains a <compacted-summary> block, it is a PRIOR checkpoint. Do not copy it forward verbatim: preserve still-true facts, drop stale ones, and merge newer information into a single consolidated summary under the same structure.',
].join('\n')

var CHECKPOINT_PREAMBLE =
  'This is an automatically generated checkpoint condensing an earlier span of the conversation to free up context. Treat the captured context as established background and build on it without restating it. Continue the task directly from the messages that follow, without acknowledging this checkpoint.'

// 0.4.80：checkpoint 定界标签（逐字取自 dsh-compaction-basic）——注入新会话的
// checkpoint 与内置 /compact 产物完全同形（含标签），新会话后续被内置压缩
// 命中时按 PRIOR checkpoint 规则合并而非逐字搬运。
var SUMMARY_OPEN_TAG = '<compacted-summary>'
var SUMMARY_CLOSE_TAG = '</compacted-summary>'

// 多分片合并：把 N 个分片 checkpoint 合成一份（map-reduce 的 reduce 步）。
var COMBINE_PREAMBLE =
  'The messages above are partial checkpoints of ONE long conversation, in chronological order (PART 1 = oldest). Merge them into a single consolidated checkpoint: keep every fact that is still true in the latest part, drop stale or contradicted facts, merge duplicates, and let the latest parts win for Current Work and Next Step.\n\n'

// ---- 配置 -------------------------------------------------------------------

export const Config = z.object({
  /** 实时总开关（行开关之外的第二道闸；关闭时页面仍在但操作被拒）。 */
  enabled: z.boolean().default(true).volatile(),
  /** 事件数筛选（唯一筛选条件，0.4.73 用户拍板「以事件数为准」）：
   *  ≥ 该值才进入「批量瘦身筛选列表」。默认 5000。 */
  minEvents: z.number().default(5000).volatile(),
  /** compact 模型 provider；留空 = 继承会话自身的 modelSelection。 */
  compactProvider: z.string().default('').volatile(),
  /** compact 模型名；留空 = 继承会话自身。 */
  compactModel: z.string().default('').volatile(),
  /** compact reasoningEffort；留空 = 继承会话自身记录（无则模型默认）。 */
  compactEffort: z.string().default('').volatile(),
  /** 批量大小：一次连续处理的会话数（批间停 3s，队列自动续批）。 */
  batchSize: z.number().default(3).volatile(),
})

// settings（读行配置）、connection（fetch 路由）、llm（总结调用 + 路由验证）、
// sessions（热会话 + flush）、agents（运行判定）、workspaceRegistry（归档 +
// 工作区匹配）、sessionProjections（热会话投影状态）、sessionController
// （create/rename/selectModel/resolveAgent/followup 载体）、sessionQuery
// （冷会话完整日志读取）。
export const inject = [
  'settings',
  'timer', // 0.4.78：队列看门狗 ctx.interval
  'connection',
  'llm',
  'sessions',
  'agents',
  'workspaceRegistry',
  'sessionProjections',
  'sessionController',
  'sessionQuery',
]

// DSH home 解析：优先官方 dsh-home-paths（$DSH_HOME 优先，否则 ~/.dsh，
// profile node_modules 里现成可解析）；动态 import 失败（其他部署没有它）
// 退回同优先级的本地实现——同 prompts 的 renderPrompt 教训：可解析才用，
// 不可解析不炸行。
var homePathsMod = null
try {
  import('@deepseek-ai/dsh-home-paths').then(
    function (mod) {
      if (mod && typeof mod.dshHomePath === 'function') homePathsMod = mod
    },
    function () {},
  )
} catch (error) {}

function homePath() {
  var segments = Array.prototype.slice.call(arguments)
  if (homePathsMod) return homePathsMod.dshHomePath.apply(null, segments)
  var env = process.env.DSH_HOME
  var base = typeof env === 'string' && env.trim() !== '' ? env : path.join(os.homedir(), '.dsh')
  return path.join.apply(path, [base].concat(segments))
}

export function apply(ctx, config) {
  var enabled = !config || config.enabled !== false
  var NS = 'dsh-polish:session-slim'

  // 隐藏自动生成的设置表单页（真实界面在「设置 → 会话瘦身」）。
  ctx.effect(function () {
    ctx.settings.configure({ auto: false }, ctx.fiber)
  })

  if (!enabled) return

  // ---- 行缓存（10s TTL；refresh 路由强制重建）----
  var rowsCache = { at: 0, rows: [] }
  // ---- 谱系缓存（corpus 全量扫盘贵一个量级：独立 60s TTL，force 清掉）----
  var CORPUS_TTL_MS = 60000
  var corpusCache = { at: 0, byId: null, children: null }

  function readConfig() {
    var value = null
    try {
      var list = ctx.settings.describe()
      for (var i = 0; i < list.length; i++) {
        if (list[i] && list[i].ns === NS) {
          value = list[i].value
          break
        }
      }
    } catch (error) {}
    return value || {}
  }

  // ---- zstd 文件大小映射（遍历 sessions/<workspace-slug>/<id>/，不反推
  //      8.3 短名编码）。路径每次调用时解析（动态 import 落地后自动切换
  //      官方实现；两种实现结果同构：$DSH_HOME 优先，否则 ~/.dsh）。----
  function buildFileSizes() {
    var map = {}
    var SESSIONS_ROOT = homePath('sessions')
    var wsDirs = []
    try {
      wsDirs = fs.readdirSync(SESSIONS_ROOT)
    } catch (error) {
      return map
    }
    for (var i = 0; i < wsDirs.length; i++) {
      var wsDir = path.join(SESSIONS_ROOT, wsDirs[i])
      var entries = []
      try {
        entries = fs.readdirSync(wsDir)
      } catch (error) {
        continue
      }
      for (var j = 0; j < entries.length; j++) {
        var stat
        try {
          stat = fs.statSync(path.join(wsDir, entries[j], 'session.v4.jsonl.zstd'))
        } catch (error) {
          continue
        }
        map[entries[j]] = stat.size
      }
    }
    return map
  }

  // ---- 投影状态读取（stateOf 返回原始 state 或其 {val} 包装，都容忍）----
  function stateOf(session, key) {
    try {
      var s = ctx.sessionProjections ? ctx.sessionProjections.stateOf(session, key) : undefined
      if (s === undefined) return undefined
      if (s && typeof s === 'object' && 'val' in s) return s.val
      return s
    } catch (error) {
      return undefined
    }
  }

  // ---- 行构建（0.4.74：父子折叠）----
  // 谱系来源：ctx.sessionQuery.listSessions() —— 侧栏用的同一份「完整
  // 逻辑语料」（live + persisted，带完整 header：origin / parentSession）。
  // 子代理会话创建时 dsh-subagent 在子会话 header 写入 parentSession =
  // 父会话 id（热冷会话都有），据此 BFS 出全部后代。
  // 行语义：每个顶层会话一行；事件数 / 文件大小 = 主会话 + 全部后代
  //   子代理合计（用户拍板：「我计算的时候应当是这些的综合」）；
  //   running / live 树上任一为真即真；subIds = 全部后代 id（归档级联用）。
  //   孤儿子代理（parentSession 不在语料里）→ 按顶层行独立展示（不藏）。
  //   语料读取失败 → 退回 0.4.73 行为（整类跳过 subagent，不折叠）。
  // 指标来源不变：热 = stateOf / 内存 log；冷 = projcache。
  function descendantsOf(rootId, children) {
    var out = []
    var seenD = {}
    seenD[rootId] = true // 根不是自己的后代（环防护）
    var stack = (children[rootId] || []).slice()
    while (stack.length > 0) {
      var c = stack.pop()
      if (seenD[c]) continue
      seenD[c] = true
      out.push(c)
      var cs = children[c] || []
      for (var x = 0; x < cs.length; x++) stack.push(cs[x])
    }
    return out
  }

  // 把子行折进顶层行（纯函数：harness 直接行为测试）。
  // allRows = 全部行（含 subagent 行，各带 .parent）；children = 谱系
  // parentId -> [childId...]（corpus 构建）。返回顶层行数组（孤儿子代理
  // 父不在表里也按顶层保留，不藏数据）；每个顶层行就地变更：
  // events/fileBytes = 整树合计，running/live = 整树 OR，
  // subIds = 全部后代 id，subCount = 后代数。
  function foldRows(allRows, children) {
    var rowByIdMap = {}
    for (var i = 0; i < allRows.length; i++) rowByIdMap[allRows[i].id] = allRows[i]
    var out = []
    for (var fi = 0; fi < allRows.length; fi++) {
      var r = allRows[fi]
      if (r.parent && rowByIdMap[r.parent]) continue // 非顶层：指标并入父行
      var desc = descendantsOf(r.id, children)
      for (var dx = 0; dx < desc.length; dx++) {
        var dr = rowByIdMap[desc[dx]]
        if (!dr) continue
        r.events = (r.events || 0) + (dr.events || 0)
        if (typeof dr.fileBytes === 'number') {
          r.fileBytes = (typeof r.fileBytes === 'number' ? r.fileBytes : 0) + dr.fileBytes
        }
        r.running = r.running || dr.running
        r.live = r.live || dr.live
      }
      r.subIds = desc
      r.subCount = desc.length
      out.push(r)
    }
    return out
  }

  async function buildRows(force) {
    var fileSizes = buildFileSizes()
    var live = []
    var liveById = {}
    try {
      live = ctx.sessions.list()
      for (var li = 0; li < live.length; li++) liveById[live[li].id] = live[li]
    } catch (error) {}
    var running = {}
    try {
      var agents = ctx.agents.list()
      for (var ai = 0; ai < agents.length; ai++) {
        var agent = agents[ai]
        if (agent && agent.status === 'running' && agent.session && agent.session.id) running[agent.session.id] = true
      }
    } catch (error) {}
    var archived = []
    try {
      archived = ctx.workspaceRegistry.archivedSessionIds || []
    } catch (error) {}

    // sessionQuery 是完整持久化语料，可能包含没有 cwd/工作区归属的孤儿记录。
    // 瘦身列表必须与侧栏使用同一份可见性判定；否则创建失败/回滚残留会以
    // 「幽灵 session」形式出现在本组件，但用户在正常会话列表找不到它。
    var visibleById = {}
    try {
      if (!ctx.sessionController || typeof ctx.sessionController.list !== 'function') throw new Error('sessionController.list 不可用')
      var visibleResult = await ctx.sessionController.list()
      var visibleSessions = Array.isArray(visibleResult) ? visibleResult : visibleResult && Array.isArray(visibleResult.items) ? visibleResult.items : null
      if (!visibleSessions) throw new Error('sessionController.list 返回值无效')
      for (var vi = 0; vi < visibleSessions.length; vi++) {
        var visibleId = visibleSessions[vi] && (visibleSessions[vi].sessionId || visibleSessions[vi].id)
        if (visibleId) visibleById[visibleId] = true
      }
    } catch (error) {
      // 可见性无法确认时宁可暂时不展示、不允许提交，也不能把持久化孤儿
      // 当成可瘦身会话；下一次轮询会重试。
      return []
    }

    // 父子谱系（corpus = 与侧栏同源的全会话清单）。全量扫盘（1000+ 个
    // zstd 头读取，DSH 自身并发上限 3）比指标重建贵一个量级 → 独立 60s
    // TTL（指标仍是 10s）；force 重建（刷新按钮）清掉。单次扫描失败
    // 保留陈旧缓存（瞬时失败不丢整树折叠），无陈旧才回退 0.4.73。
    if (force && corpusCache.byId) corpusCache = { at: 0, byId: null, children: null }
    var corpusById = corpusCache.byId || {}
    var children = corpusCache.children || {}
    var corpusFresh = corpusCache.byId !== null && Date.now() - corpusCache.at <= CORPUS_TTL_MS
    var corpusLookupFailed = false
    if (!corpusFresh) {
      try {
        var corpus = await ctx.sessionQuery.listSessions(null)
        var nextById = {}
        var nextChildren = {}
        for (var ci = 0; ci < corpus.length; ci++) {
          var ch = corpus[ci] && corpus[ci].header
          if (!ch || !ch.id) continue
          nextById[ch.id] = ch
          // DSH 自己的子代理判据（dsh-subagent）：origin + parentSession 同看。
          if (ch.origin === 'subagent' && ch.parentSession && visibleById[ch.id] && visibleById[ch.parentSession]) {
            if (!nextChildren[ch.parentSession]) nextChildren[ch.parentSession] = []
            nextChildren[ch.parentSession].push(ch.id)
          }
        }
        corpusCache = { at: Date.now(), byId: nextById, children: nextChildren }
        corpusById = nextById
        children = nextChildren
      } catch (error) {
        corpusLookupFailed = true
        corpusById = corpusCache.byId || {}
        children = corpusCache.children || {}
      }
    }
    var haveCorpus = Object.keys(corpusById).length > 0

    var rows = []
    var seen = {}

    function pushRow(r) {
      rows.push(r)
      seen[r.id] = true
    }

    // 热会话先行（数据更新鲜；同 id 时热行优先于冷行）。
    for (var k = 0; k < live.length; k++) {
      var s = live[k]
      if (!s || !visibleById[s.id]) continue
      // 语料不可用时的 0.4.73 回退：subagent 整类跳过。
      if (!haveCorpus && s.header && s.header.origin === 'subagent') continue
      var liveTitle = stateOf(s, 'title')
      var livePressure = stateOf(s, 'contextPressure') || null
      var liveSelection = stateOf(s, 'modelSelection') || null
      var liveAgentPreset = s.header && typeof s.header.agentPreset === 'string' ? s.header.agentPreset : stateOf(s, 'agentPreset') || null
      var cwd = s.header && s.header.cwd ? s.header.cwd : null
      var headerSeq = -1
      try {
        for (var h = 0; h < s.log.length; h++) {
          if (typeof s.log[h].seq === 'number' && s.log[h].seq > headerSeq) headerSeq = s.log[h].seq
        }
      } catch (error) {}
      pushRow({
        id: s.id,
        project: projectOf(cwd),
        cwd: cwd,
         agentPreset: typeof liveAgentPreset === 'string' ? liveAgentPreset : null,
        title: typeof liveTitle === 'string' ? liveTitle : null,
        events: headerSeq + 1,
        fileBytes: typeof fileSizes[s.id] === 'number' ? fileSizes[s.id] : null,
        ctxTokens: livePressure && typeof livePressure.surfaceTokens === 'number' ? livePressure.surfaceTokens : null,
        ctxWindow: livePressure && typeof livePressure.contextWindow === 'number' ? livePressure.contextWindow : null,
        provider: liveSelection && liveSelection.lastUsed ? liveSelection.lastUsed.provider : null,
        model: liveSelection && liveSelection.lastUsed ? liveSelection.lastUsed.model : null,
        effort: liveSelection && liveSelection.lastUsed && liveSelection.lastUsed.reasoningEffort ? liveSelection.lastUsed.reasoningEffort : null,
        live: true,
        running: !!running[s.id],
        archived: archived.indexOf(s.id) >= 0,
        parent: s.header && s.header.origin === 'subagent' && s.header.parentSession ? s.header.parentSession : null,
         lineageComplete: !corpusLookupFailed && haveCorpus,
      })
    }

    // 冷/归档会话：projcache（sessionProjections 的持久缓存，v7）。
    var PROJCACHE_DIR = homePath('storages', 'session_projcache', 'sessions')
    var files = []
    try {
      files = fs.readdirSync(PROJCACHE_DIR)
    } catch (error) {}
    for (var i = 0; i < files.length; i++) {
      var file = files[i]
      if (file.slice(-5) !== '.json') continue
      var id = file.slice(0, -5)
      if (!visibleById[id]) continue
      if (seen[id]) continue
      var record = null
      try {
        record = JSON.parse(fs.readFileSync(path.join(PROJCACHE_DIR, file), 'utf8'))
      } catch (error) {
        continue
      }
      var identity = record && record.record ? record.record.identity : null
      var rowsMap = record && record.record ? record.record.rows : null
      if (!identity) continue
      // 语料不可用时的 0.4.73 回退（投影行 rows.subagent 仅子代理自身有值）。
      if (!haveCorpus && rowsMap && rowsMap.subagent && rowsMap.subagent.val) continue
      var title = rowsMap && rowsMap.title ? rowsMap.title.val : null
      var maxSeq = -1
      if (rowsMap) {
        for (var key in rowsMap) {
          var row = rowsMap[key]
          if (row && typeof row.seq === 'number' && row.seq > maxSeq) maxSeq = row.seq
        }
      }
      var pressure = (rowsMap && rowsMap.contextPressure ? rowsMap.contextPressure.val : null) || null
      var selection = (rowsMap && rowsMap.modelSelection ? rowsMap.modelSelection.val : null) || null
      var coldHeader = corpusById[id]
      pushRow({
        id: id,
        project: projectOf(identity.cwd),
        cwd: identity.cwd || null,
         agentPreset: coldHeader && typeof coldHeader.agentPreset === 'string' ? coldHeader.agentPreset : rowsMap && rowsMap.agentPreset && typeof rowsMap.agentPreset.val === 'string' ? rowsMap.agentPreset.val : null,
        title: typeof title === 'string' ? title : null,
        events: maxSeq + 1,
        fileBytes: typeof fileSizes[id] === 'number' ? fileSizes[id] : null,
        ctxTokens: pressure && typeof pressure.surfaceTokens === 'number' ? pressure.surfaceTokens : null,
        ctxWindow: pressure && typeof pressure.contextWindow === 'number' ? pressure.contextWindow : null,
        provider: selection && selection.lastUsed ? selection.lastUsed.provider : null,
        model: selection && selection.lastUsed ? selection.lastUsed.model : null,
        effort: selection && selection.lastUsed && selection.lastUsed.reasoningEffort ? selection.lastUsed.reasoningEffort : null,
        live: !!liveById[id],
        running: !!running[id],
        archived: archived.indexOf(id) >= 0,
        parent: coldHeader && coldHeader.origin === 'subagent' && coldHeader.parentSession ? coldHeader.parentSession : null,
         lineageComplete: !corpusLookupFailed && haveCorpus,
      })
    }

    // 折叠：每个顶层行的全部后代指标加进去（事件数/文件大小合计；
    // running / live 树上任一为真即真；subIds = 全部后代 id）。
    // foldRows 是纯函数（harness 直接行为测试）。0.4.74 的内联版在
    // `rows = []` 之后迭代 `rows.length`（=0）把所有行全丢了 → 表格恒空。
    if (haveCorpus) {
      rows = foldRows(rows, children)
    } else {
      for (var fi2 = 0; fi2 < rows.length; fi2++) {
        rows[fi2].subIds = []
        rows[fi2].subCount = 0
      }
    }

    // 事件数倒序（用户规格：大头在前）。
    rows.sort(function (a, b) {
      return (b.events || 0) - (a.events || 0)
    })
    return rows
  }


  function projectOf(cwd) {
    if (typeof cwd !== 'string' || cwd === '') return '(未知)'
    var parts = cwd.replace(/\\/g, '/').split('/').filter(function (p) {
      return p !== ''
    })
    return parts.length > 0 ? parts[parts.length - 1] : '(未知)'
  }

  var rowsBuilding = null

  async function rowsNow(force) {
    var now = Date.now()
    if (!force && now - rowsCache.at <= ROWS_TTL_MS && rowsCache.rows.length > 0) return rowsCache.rows
    if (rowsBuilding === null) {
      rowsBuilding = (async function () {
        try {
          rowsCache = { at: Date.now(), rows: await buildRows(force) }
        } finally {
          rowsBuilding = null
        }
      })()
    }
    return rowsBuilding.then(function () {
      return rowsCache.rows
    })
  }

  async function rowById(id) {
    var rows = await rowsNow(false)
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].id === id) return rows[i]
    }
    return null
  }

  // 只读已缓存行（enqueue 取标题用；不触发重建）。
  function cachedRowById(id) {
    var rows = rowsCache.rows
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].id === id) return rows[i]
    }
    return null
  }

  // ---- 内存三色条数据 ----
  function memoryInfo() {
    var usage = process.memoryUsage()
    var total = os.totalmem()
    var used = os.totalmem() - os.freemem()
    return {
      total: total,
      used: used,
      free: os.freemem(),
      rss: usage.rss,
      heapUsed: usage.heapUsed,
      pid: process.pid,
    }
  }

  // ---- 处理队列（串行 worker；批间停 BATCH_GAP_MS；stop 只拦新任务与
  //      阶段边界，进行中的 LLM 调用跑完）----
  var queue = []
  var done = [] // 新→旧，上限 50
  var workerBusy = false
  var cancelRequested = false
  var batchTimer = null
  var currentJob = null // 0.4.78：在途任务（/state 暴露；此前 shift 后对用户不可见）
  var lastActivityAt = Date.now() // 0.4.78：看门狗活动水位

  function pushDone(job) {
    done.unshift(job)
    if (done.length > 50) done.length = 50
  }

  function enqueue(ids) {
    var list = Array.isArray(ids) ? ids : []
    var added = 0
    for (var i = 0; i < list.length; i++) {
      var id = typeof list[i] === 'string' ? list[i] : String(list[i] || '')
      if (id === '') continue
      var pending = false
      for (var j = 0; j < queue.length; j++) {
        if (queue[j].sessionId === id) {
          pending = true
          break
        }
      }
      if (!pending && currentJob && currentJob.sessionId === id) pending = true
       if (pending) continue
      var row = cachedRowById(id)
      queue.push({
        key: id + ':' + Date.now(),
        sessionId: id,
        title: row && row.title ? row.title : id,
        phase: 'queued',
        detail: null,
        error: null,
        at: Date.now(),
        startedAt: null,
        finishedAt: null,
      })
      added += 1
    }
    if (added > 0) pump()
    return added
  }

  function stopQueue() {
    cancelRequested = true
    if (batchTimer !== null) {
      clearTimeout(batchTimer)
      batchTimer = null
    }
    for (var i = 0; i < queue.length; i++) {
      queue[i].phase = 'cancelled'
      queue[i].error = '用户停止'
      queue[i].finishedAt = Date.now()
      pushDone(queue[i])
    }
    queue.length = 0
    return true
  }

  function pump() {
    if (workerBusy) return
    workerBusy = true
    lastActivityAt = Date.now() // 0.4.78
    try {
    var cfg = readConfig()
    var batchSize = Math.max(1, Math.min(10, Math.floor(Number(cfg.batchSize) || 3)))
    var processBurst = function (remaining) {
      if (cancelRequested) {
        workerBusy = false
        cancelRequested = false
        return
      }
      if (remaining <= 0) {
        if (queue.length > 0) batchTimer = setTimeout(function () { lastActivityAt = Date.now(); processBurst(batchSize) }, BATCH_GAP_MS) // 0.4.78 水位
        else workerBusy = false
        return
      }
      var job = queue.shift()
      if (!job) {
        workerBusy = false
        return
      }
      job.phase = 'running'
      job.startedAt = Date.now()
      currentJob = job // 0.4.78：在途任务可见
      lastActivityAt = Date.now()
      slimOne(job).then(
        function (result) {
          if (job.stale) return // 0.4.78：已被看门狗强制结算，迟到回执不再记账
          job.phase = 'done'
          job.detail = result
          job.finishedAt = Date.now()
          pushDone(job)
          if (currentJob === job) currentJob = null
          lastActivityAt = Date.now()
          processBurst(remaining - 1)
        },
        function (error) {
          if (job.stale) return
          var failedPhase = job.phase || '未知'
          job.phase = 'failed'
          job.errorCode = error && error.code ? String(error.code) : 'SLIM_FAILED'
          if (error && error.newSessionId) job.newSessionId = String(error.newSessionId)
          job.error = '阶段「' + failedPhase + '」失败：' + String((error && error.message) || error) + ((error && error.newSessionId) || job.newSessionId ? '（新会话：' + ((error && error.newSessionId) || job.newSessionId) + '，状态 ' + (job.newSessionState || 'unknown') + '）' : '')
          // 0.4.81：宿主控制台同步一份（[dshp slim] 前缀可检索）。
          try {
            ctx.logger.warn('[dshp slim] ' + job.sessionId + ' 失败：' + (error && error.code ? error.code + ' ' : '') + job.error)
          } catch (logErr) {}
          job.finishedAt = Date.now()
          pushDone(job)
          if (currentJob === job) currentJob = null
          lastActivityAt = Date.now()
          processBurst(remaining - 1)
        },
      )
    }
    processBurst(batchSize)
    } catch (error) {
      // 0.4.78：任何同步异常（配置读取/闭包构造）都不能让 worker 永久
      // busy——否则队列从此冻结（症状：任务一直「排队中」、无进行中）。
      // 复位 busy；任务仍在队列里，下次 enqueue/pump 重试。
      workerBusy = false
      currentJob = null
      lastActivityAt = Date.now()
    }
  }

  function checkCancel(job) {
    if (cancelRequested) {
      var error = new Error('用户停止')
      error.code = 'SLIM_CANCELLED'
      throw error
    }
  }

  // ---- 转录（热 = 内存日志；冷 = sessionQuery.readSession 完整回放日志）----
  // ---- LLM 总结（文本块装配；chunk 协议见头注）----
  // 0.4.78：promise 级超时——挂起的 iter.next() 也能被计时器拒绝。
  function withTimeout(promise, ms, message) {
    var timerError = new Error(message)
    timerError.code = 'SLIM_LLM_TIMEOUT'
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () {
        reject(timerError)
      }, ms)
      Promise.resolve(promise).then(
        function (v) {
          clearTimeout(timer)
          resolve(v)
        },
        function (e) {
          clearTimeout(timer)
          reject(e)
        },
      )
    })
  }

  async function callSlimLlm(target, messages, tools, sessionId, maxTokens) {
    var options = {
      provider: target.provider,
      model: target.model,
      messages: messages,
      maxTokens: typeof maxTokens === 'number' && maxTokens > 0 ? maxTokens : SUMMARY_MAX_TOKENS,
      sessionId: sessionId,
      purpose: 'compaction',
    }
    if (Array.isArray(tools) && tools.length > 0) options.tools = tools
    if (target.reasoningEffort) options.reasoningEffort = target.reasoningEffort
    var assembler = new BlockAssembler()
    // 0.4.78：ctx.llm.stream 无超时、无 signal——提供方挂起（连接建立但
    // 不出数据/流不结束）时旧 for-await 会永久悬挂：slimOne 永不结算 →
    // 串行 worker 永久 busy → 之后所有任务卡死在「排队」。现在：相邻数据
    // 间隔超 LLM_IDLE_TIMEOUT_MS 即中断迭代器并失败本任务；单次调用总时长
    // 超 LLM_CALL_HARD_MS 同样失败。失败只结束本任务，worker 继续队列。
    var startAt = Date.now()
    var stream = ctx.llm.stream(options)
    var iter = stream && typeof stream[Symbol.asyncIterator] === 'function' ? stream[Symbol.asyncIterator]() : null
    if (!iter) {
      var badStream = new Error('ctx.llm.stream 返回了非异步可迭代值')
      badStream.code = 'SLIM_LLM_BAD_STREAM'
      throw badStream
    }
    try {
      while (true) {
        var step
        try {
          step = await withTimeout(iter.next(), LLM_IDLE_TIMEOUT_MS, '模型流 ' + (LLM_IDLE_TIMEOUT_MS / 1000) + ' 秒无数据，视为挂死')
        } catch (timeoutErr) {
          try { iter.return() } catch (abortErr) {}
          throw timeoutErr
        }
        if (step.done) break
        if (Date.now() - startAt > LLM_CALL_HARD_MS) {
          var hardErr = new Error('单次模型调用超过 ' + (LLM_CALL_HARD_MS / 60000) + ' 分钟，强制停止')
          hardErr.code = 'SLIM_LLM_TIMEOUT'
          try { iter.return() } catch (abortErr2) {}
          throw hardErr
        }
        assembler.push(step.value)
      }
    } catch (streamErr) {
      if (!(streamErr && streamErr.code === 'SLIM_LLM_TIMEOUT')) {
        try { iter.return() } catch (abortErr3) {}
      }
      throw streamErr
    }
    // 0.4.81：流的 finish 终态（DSH 自己的 summarizeWithLlm 同款检查）。
    // 修复前 provider 侧错误（未知模型/鉴权/限流…）被吞成「空文本 + usage 全 0」，
    // 用户无从得知真实原因（DSH desktop 无落盘日志，页面错误行是唯一出口）。
    var finish = assembler.finish
    if (finish && finish.kind === 'error') {
      // 0.4.91：错误里带上**实际用的路线**——用户看到「余额不足」时必须知道
      // 是哪条 provider/model 出的问题（本机实测：同一条 deepseek-official 路线
      // 对所有模型都返回 402 Insufficient Balance）。
      var route = target && target.provider ? target.provider + '/' + target.model : ''
      var fe = new Error('模型调用失败' + (route ? '（' + route + '）' : '') + '：' + ((finish.failure && finish.failure.message) || '未知错误') + (finish.failure && finish.failure.code ? ' [' + finish.failure.code + ']' : ''))
      fe.code = 'SLIM_LLM_FINISH_ERROR'
      throw fe
    }
    if (finish && finish.kind === 'aborted') {
      var fa = new Error('模型调用被中断' + (finish.failure && finish.failure.message ? '：' + finish.failure.message : ''))
      fa.code = 'SLIM_LLM_ABORTED'
      throw fa
    }
    if (finish && finish.kind === 'max-tokens') {
      var fm = new Error('摘要在 token 上限处被截断（输出预算可能偏小，或输入窗口过大）')
      fm.code = 'SLIM_LLM_MAX_TOKENS'
      throw fm
    }
    var text = ''
    var blocks = assembler.blocks()
    for (var i = 0; i < blocks.length; i++) {
      if (blocks[i] && blocks[i].type === 'text') text += blocks[i].text
    }
    return { text: text.trim(), usage: assembler.usage }
  }

  // 0.4.79：有界并行池（结果按输入序；首错即拒，未决调用任其自然结算——
  // 每个都受 LLM_CALL_HARD_MS 上限约束，不会永久悬挂 worker）。
  function mapPool(items, limit, fn) {
    return new Promise(function (resolve, reject) {
      var results = new Array(items.length)
      var next = 0
      var active = 0
      var settled = 0
      var failed = false
      function tick() {
        while (!failed && active < limit && next < items.length) {
          var idx = next++
          active++
          Promise.resolve()
            .then(function () { return fn(items[idx], idx) })
            .then(
              function (v) {
                results[idx] = v
                active--
                settled++
                if (settled === items.length) resolve(results)
                else tick()
              },
              function (e) {
                active--
                settled++
                if (!failed) { failed = true; reject(e) }
              },
            )
        }
      }
      tick()
    })
  }

  // 0.4.79：去掉 reasoningEffort 的目标副本（空文本重试用）。
  function targetWithoutEffort(target) {
    return { provider: target.provider, model: target.model }
  }

  // 0.4.91：provider 侧（余额/鉴权/限流/模型不存在）失败——这类失败换一条
  // 能跑通的路线就能继续，不是「这个会话有问题」。
  function isProviderRouteFailure(error) {
    if (!error) return false
    var code = String(error.code || '')
    var msg = String(error.message || '')
    if (code === 'SLIM_MODEL_INVALID') return true
    if (code !== 'SLIM_LLM_FINISH_ERROR') return false
    return (
      /\[(QUOTA|ACCOUNT_QUOTA_EXCEEDED|INVALID_CREDENTIAL|MISSING_CREDENTIAL|RATE_LIMIT|NO_ADAPTER|INVALID_MODEL)\]/i.test(msg) ||
      /Insufficient Balance|余额不足|鉴权|unauthorized|invalid api key/i.test(msg) ||
      /\b(401|402|403)\b/.test(msg)
    )
  }

  // 0.4.91：回退路线 = 该会话自己最后用过的 provider/model（那是这个会话确实
  // 跑通过的路线）。没有可回退路线时返回 null。
  function fallbackRoute(lastUsed, failedTarget) {
    if (!lastUsed || !lastUsed.provider || !lastUsed.model) return null
    if (failedTarget && lastUsed.provider === failedTarget.provider && lastUsed.model === failedTarget.model) return null
    return {
      provider: lastUsed.provider,
      model: lastUsed.model,
      reasoningEffort: lastUsed.reasoningEffort || undefined,
    }
  }

  function usageText(usage) {
    if (!usage) return "无"
    try {
      var s = JSON.stringify(usage)
      return s.length > 160 ? s.slice(0, 160) + "…" : s
    } catch (error) {
      return "无"
    }
  }

  async function summarizeChunk(target, chunkMessages, tools, sessionId, label, maxTokens) {
    var messages = []
    for (var i = 0; i < chunkMessages.length; i++) messages.push(chunkMessages[i])
    messages.push({ role: "user", content: [{ type: "text", text: COMPACTION_INSTRUCTION }] })
    var result = await callSlimLlm(target, messages, tools, sessionId, maxTokens)
    // 0.4.79：空文本重试——带 effort 的调用可能把整个 maxTokens 预算耗在
    // reasoning 上（内容全空）。先去掉 effort 重试一次；仍空则把 usage
    // 附进错误，用户可核对 token 到底花在哪。
    if (result.text === "") {
      if (target.reasoningEffort) {
        var retry = await callSlimLlm(targetWithoutEffort(target), messages, tools, sessionId, maxTokens)
        if (retry.text !== "") return { text: retry.text, usage: retry.usage, retriedWithoutEffort: true }
        var error = new Error(label + "：模型返回空文本，去 effort 重试仍空（usage: " + usageText(retry.usage) + "）——该模型在该分片上不出正文，换低 effort 或换模型")
        error.code = "SLIM_EMPTY_SUMMARY"
        throw error
      }
      var error2 = new Error(label + "：模型返回空文本（usage: " + usageText(result.usage) + "）——输出预算可能全被 reasoning 消耗，换低 effort 或换模型")
      error2.code = "SLIM_EMPTY_SUMMARY"
      throw error2
    }
    return result
  }

  // 0.4.79 树形 reduce 的单次合并调用（同款空文本重试）。
  async function mergeCall(target, body, sessionId, round) {
    var messages = [{ role: "user", content: [{ type: "text", text: body }] }]
    var result = await callSlimLlm(target, messages, null, sessionId)
    if (result.text === "") {
      if (target.reasoningEffort) {
        var retry = await callSlimLlm(targetWithoutEffort(target), messages, null, sessionId)
        if (retry.text !== "") return { text: retry.text, usage: retry.usage, retriedWithoutEffort: true }
      }
      var error = new Error("合并分片（第 " + round + " 轮）：模型返回空文本（usage: " + usageText(result.usage) + "）")
      error.code = "SLIM_EMPTY_SUMMARY"
      throw error
    }
    return result
  }

  // 0.4.79：并行 map（SUMMARIZE_CONCURRENCY 路，结果按分片序）+ 树形 reduce
  // （每轮 MERGE_GROUP_SIZE 个 → 1 个，直到剩一份）。旧实现的两个规模缺陷：
  // 顺序 map 对 409 分片要数小时；扁平单次 reduce 把 409 份 part 文本塞进
  // 一次调用的上下文——远超任何窗口，必然失败/截断。job（可选）承载进度
  // 细节（currentJob.detail → /state current → 页面在途行「分片 p/total」）。
  async function summarizeTranscript(target, transcript, tools, sessionId, job, chunkBudget) {
    function progress(detail) {
      if (job) job.detail = detail
    }
    var chunks = chunkMessages(transcript, chunkBudget)
    if (chunks.length === 0) {
      var error = new Error("无可总结的消息")
      error.code = "SLIM_EMPTY_TRANSCRIPT"
      throw error
    }
    var sourceTokens = 0
    for (var i = 0; i < chunks.length; i++) sourceTokens += chunks[i].tokens
    var lastUsage = null
    if (chunks.length === 1) {
      progress("分片 1/1")
      var single = await summarizeChunk(target, chunks[0].messages, tools, sessionId, "总结")
      return { summary: single.text, chunks: 1, sourceTokens: sourceTokens, usage: single.usage, rounds: 0 }
    }
    // map：每分片一份 checkpoint（并行，完成序不定，结果按输入序落位）
    var done = 0
    progress("分片 0/" + chunks.length + "（并行 " + SUMMARIZE_CONCURRENCY + " 路）")
    var partResults = await mapPool(chunks, SUMMARIZE_CONCURRENCY, function (chunk, idx) {
      checkCancelBySession(sessionId)
      return summarizeChunk(target, chunk.messages, tools, sessionId, "分片 " + (idx + 1) + "/" + chunks.length).then(function (r) {
        done++
        progress("分片 " + done + "/" + chunks.length)
        return r
      })
    })
    var parts = []
    for (var p = 0; p < partResults.length; p++) {
      if (partResults[p] === undefined) continue
      parts.push(partResults[p].text)
      lastUsage = partResults[p].usage
    }
    // reduce：树形合并，直到剩一份
    var level = parts
    var round = 0
    while (level.length > 1) {
      round++
      checkCancelBySession(sessionId)
      var groups = []
      for (var g = 0; g < level.length; g += MERGE_GROUP_SIZE) groups.push(level.slice(g, g + MERGE_GROUP_SIZE))
      progress("合并第 " + round + " 轮（" + level.length + " → " + groups.length + "）")
      var mergedLevel = await mapPool(groups, SUMMARIZE_CONCURRENCY, function (group, gidx) {
        var body = COMBINE_PREAMBLE
        for (var q = 0; q < group.length; q++) body += "=== PART " + (q + 1) + " ===\n" + group[q] + "\n\n"
        body += "\n" + COMPACTION_INSTRUCTION
        return mergeCall(target, body, sessionId, round + ":" + (gidx + 1))
      })
      level = []
      for (var m = 0; m < mergedLevel.length; m++) {
        if (mergedLevel[m] === undefined) continue
        level.push(mergedLevel[m].text)
        lastUsage = mergedLevel[m].usage
      }
    }
    if (level.length !== 1 || level[0] === "") {
      var error3 = new Error("合并分片：模型返回空文本")
      error3.code = "SLIM_EMPTY_SUMMARY"
      throw error3
    }
    return { summary: level[0], chunks: chunks.length, sourceTokens: sourceTokens, usage: lastUsage, rounds: round }
  }
  // 阶段边界的取消检查（slimOne 各步之间调用）。
  function checkCancelBySession(sessionId) {
    checkCancel(null)
  }

  // ---- 瘦身主流程（每步失败即抛错，job 记录 phase + error）----
  async function slimOne(job) {
    var id = job.sessionId
    var cfg = readConfig()

    // 0) 取行（标题/cwd/模型）。缓存里没有（如刚归档后刷新）→ 强制重建一次。
    var row = await rowById(id)
    if (!row) {
      await rowsNow(true)
      row = await rowById(id)
    }
    if (!row || !row.title) {
      var e0 = new Error('会话无标题（新建即改的会话），无法改名归档')
      e0.code = 'SLIM_NO_TITLE'
      throw e0
    }
    if (row.archived) {
      var eArchived = new Error('会话已经归档，拒绝重复瘦身；请先恢复它再重试')
      eArchived.code = 'SLIM_ALREADY_ARCHIVED'
      throw eArchived
    }
    if (row.lineageComplete === false) {
      var eLineage = new Error('无法确认主会话的完整子代理谱系，已停止以避免漏归档；请刷新后重试')
      eLineage.code = 'SLIM_LINEAGE_UNAVAILABLE'
      throw eLineage
    }
    checkCancel(job)

    // 1) 进行中跳过——整棵树（主会话 + 任何后代子代理）。row.running
    //    已是树上 OR 的结果（buildRows 折叠）。
    if (row.running) {
      var e1 = new Error('会话或其子代理正在进行中，已跳过（等它空闲后再试）')
      e1.code = 'SLIM_RUNNING'
      throw e1
    }

    // 1.5) 全树活动预检（DSH 自己的 workspace/session-activity 瀑布——
    //      archiveSession 内部用的同一道门）：任何会话还有活动就在任何
    //      mutation 之前拒绝，避免「改名了没归档成」的半成品。
    var treeIds = [id].concat(row.subIds || [])
    for (var ax = 0; ax < treeIds.length; ax++) {
      var activity = await ctx.waterfall(
        'workspace/session-activity',
        { sessionId: treeIds[ax] },
        function () {
          return Promise.resolve([])
        },
      )
      if (Array.isArray(activity) && activity.length > 0) {
        var ea = new Error('会话或其子代理仍有活动，已跳过（' + treeIds[ax].slice(0, 8) + '…）')
        ea.code = 'SLIM_ACTIVE'
        throw ea
      }
    }
    checkCancel(job)

    // 2) 当前上下文窗口（0.4.80 语义：= 打开会话所见的最新窗口）。
    //    readSurface live-preferred，冷会话同样可读、无需使其 live；shadowed
    //    区段已被 DSH 自身压缩替换为 checkpoint，窗口受模型窗口约束。完整
    //    历史日志不读、不总结。
    job.phase = 'reading'
    var liveSession = null
    try {
      liveSession = ctx.sessions.get ? ctx.sessions.get(id) : undefined
    } catch (error) {}
    var surface = null
    try {
      surface = await ctx.sessionQuery.readSurface(id)
    } catch (error) {
      var e2 = new Error('读不到会话当前上下文窗口（surface）：' + ((error && error.message) || error))
      e2.code = 'SLIM_SURFACE_FAILED'
      throw e2
    }
    var surf = surfaceFromEvents(surface && Array.isArray(surface.events) ? surface.events : [])
    var transcript = surf.messages
    var tools = surf.tools
    if (liveSession) {
      try {
        var header = liveSession.requestHeader ? liveSession.requestHeader() : undefined
        if (header && Array.isArray(header.tools) && header.tools.length > 0) tools = header.tools
      } catch (error) {}
    }
    if (!row.cwd && surface && surface.session && surface.session.cwd) row.cwd = surface.session.cwd
    var hasUser = false
    for (var ti = 0; ti < transcript.length; ti++) {
      if (transcript[ti] && transcript[ti].role === 'user') {
        hasUser = true
        break
      }
    }
    if (transcript.length === 0 || !hasUser) {
      var e3 = new Error('会话当前上下文窗口没有可总结的用户消息（窗口为空或只有系统事件）')
      e3.code = 'SLIM_EMPTY_TRANSCRIPT'
      throw e3
    }
    checkCancel(job)

    // 3) compact 模型：页面配置优先，留空继承会话 modelSelection。
    job.phase = 'summarizing'
    var lastUsed = null
    if (liveSession) {
      var liveSel = stateOf(liveSession, 'modelSelection')
      if (liveSel && liveSel.lastUsed) lastUsed = liveSel.lastUsed
    } else {
      lastUsed = {
        provider: row.provider || null,
        model: row.model || null,
        reasoningEffort: row.effort || undefined,
      }
    }
    var provider = typeof cfg.compactProvider === 'string' && cfg.compactProvider !== '' ? cfg.compactProvider : lastUsed ? lastUsed.provider : ''
    var model = typeof cfg.compactModel === 'string' && cfg.compactModel !== '' ? cfg.compactModel : lastUsed ? lastUsed.model : ''
    var effort =
      typeof cfg.compactEffort === 'string' && cfg.compactEffort !== ''
        ? cfg.compactEffort
        : lastUsed && lastUsed.reasoningEffort
          ? lastUsed.reasoningEffort
          : ''
    if (!provider || !model) {
      var e4 = new Error('未配置 compact 模型，且该会话没有记录过的模型选择')
      e4.code = 'SLIM_NO_MODEL'
      throw e4
    }
    var target = { provider: provider, model: model, reasoningEffort: effort }
    try {
      await ctx.llm.resolveCallConfig({
        provider: provider,
        model: model,
        reasoningEffort: effort || undefined,
      })
    } catch (error) {
      var e5 = new Error('compact 模型不可用（' + provider + '/' + model + '）：' + ((error && error.message) || error))
      e5.code = 'SLIM_MODEL_INVALID'
      throw e5
    }

    // 4) 压缩：窗口放得下 → 一次调用（与 /compact 同形，成本 = 一次模型
    //    调用）；窗口本身超预算（从未压缩过的巨型会话）→ 分块 map-reduce
    //    回退（0.4.79 机制，分片对象仍是窗口）。job.detail 承载进度。
    var window = 32768
    try {
      var modelInfo = await ctx.llm.resolveModelInfo(provider, model)
      if (modelInfo && modelInfo.context && Number.isInteger(modelInfo.context.contextWindow) && modelInfo.context.contextWindow > 0) {
        window = modelInfo.context.contextWindow
      }
    } catch (error) {} // 窗口未知 → 保守按 32k（宁可多分片，不溢出）
    var outputBudget = Math.min(COMPACTION_MAX_OUTPUT, Math.max(COMPACTION_OUTPUT_FLOOR, Math.floor(window / 2)))
    var inputBudget = Math.max(8000, window - outputBudget - 16384)
    var slim
    var runSummary = async function (useTarget) {
      if (surf.sourceTokens <= inputBudget) {
        job.detail = '当前窗口 ' + surf.sourceTokens + ' tokens · 单次压缩'
        var single = await summarizeChunk(useTarget, transcript, tools, id, '总结', outputBudget)
        return { summary: single.text, chunks: 1, sourceTokens: surf.sourceTokens, usage: single.usage, rounds: 0, singlePass: true }
      }
      var res = await summarizeTranscript(useTarget, transcript, tools, id, job, Math.min(CHUNK_BUDGET_TOKENS, inputBudget))
      res.singlePass = false
      return res
    }
    try {
      slim = await runSummary(target)
    } catch (summarizeError) {
      // 0.4.91：配置里那条 compact 路线在**调用期**挂掉（余额不足 / 鉴权失效 /
      // 限流）——这不是「这个会话」的问题，是「设置里那条路线」的问题。本机实测：
      // deepseek-official 的 key 余额为 0，换哪个模型都是 402 Insufficient
      // Balance；而同一会话自己最后用过的路线是能跑通的。此时自动回退到会话自身
      // 路线，并把回退写进 job.detail（页面可见），而不是整单失败。
      if (!isProviderRouteFailure(summarizeError)) throw summarizeError
      var fallback = fallbackRoute(lastUsed, target)
      if (!fallback) throw summarizeError
      var fallbackReady = true
      try {
        await ctx.llm.resolveCallConfig({
          provider: fallback.provider,
          model: fallback.model,
          reasoningEffort: fallback.reasoningEffort || undefined,
        })
      } catch (fallbackResolveError) {
        fallbackReady = false
      }
      if (!fallbackReady) throw summarizeError
      job.detail =
        '路线 ' + target.provider + '/' + target.model + ' 调用失败，回退到会话自身模型 ' + fallback.provider + '/' + fallback.model
      slim = await runSummary(fallback)
      slim.fallbackRoute = target.provider + '/' + target.model + ' → ' + fallback.provider + '/' + fallback.model
    }
    if (slim.summary.length < 200) {
      var e6 = new Error('摘要异常过短（' + slim.summary.length + ' 字符），放弃以保护原会话')
      e6.code = 'SLIM_SUMMARY_TINY'
      throw e6
    }
    checkCancel(job)

    // 5) 归档名：基名@K（K = 同项目最大 @N + 1）。
    var allTitles = []
    var rows = await rowsNow(false)
    for (var ri = 0; ri < rows.length; ri++) {
      if (rows[ri].cwd && row.cwd && normPath(rows[ri].cwd) === normPath(row.cwd)) {
        if (rows[ri].title) allTitles.push(rows[ri].title)
      }
    }
    var archiveTitle = nextArchiveTitle(row.title, allTitles)
    if (!archiveTitle) {
      var e7 = new Error('无法计算归档名')
      e7.code = 'SLIM_NO_TITLE'
      throw e7
    }
    // 6) P0 安全顺序：先创建并确认新会话，再改名/归档旧会话。
    //    旧顺序是先 rename + archive，ctx.agents.create 一旦失败，原会话
    //    已经从正常列表消失，用户只剩归档里找回它；这不是可接受的 compact
    //    失败语义。现在新会话创建、挂回工作区、改回原名和模型继承都完成后，
    //    才会触碰旧会话。
    //
    // 7) 新会话：seed 创建。DSH 自己的 fork 走同一条路：
    //    agents.create({seed, inheritedEventCount, meta.isSeeded})——会话带着
    //    seed 内容以空闲状态出生，**不触发模型回复**（0.4.81 及以前用
    //    followup 注入 = 用户消息唤醒一个强制轮次；用户反馈「正常的 compact
    //    只存上下文，不强制模型继续回复」）。checkpoint 是 user/message
    //    事件——与 /compact 产物完全同形（dsh-compaction-basic 的
    //    commitCompactionBody 就是 session.append('user/message', checkpointMessage)）。
    //    用户第一次发消息时，模型把 checkpoint 当作自己的上下文。
    job.phase = 'resolving-workspace'
    var workspace = null
    if (row.cwd) {
      try {
        if (!ctx.workspaceRegistry || typeof ctx.workspaceRegistry.resolveByPath !== 'function') throw new Error('workspaceRegistry.resolveByPath 不可用')
        workspace = await ctx.workspaceRegistry.resolveByPath(row.cwd)
      } catch (error) {
        var workspaceLookupError = new Error('无法确认会话工作区归属，已停止以保护旧会话：' + ((error && error.message) || error))
        workspaceLookupError.code = 'SLIM_WORKSPACE_LOOKUP_FAILED'
        throw workspaceLookupError
      }
    }
    job.phase = 'creating'
    var newId = 'session-' + randomUUID()
    var checkpointMessage = createUserMessage({
      content: [{ type: 'text', text: CHECKPOINT_PREAMBLE + '\n\n' + SUMMARY_OPEN_TAG + '\n' + slim.summary + '\n' + SUMMARY_CLOSE_TAG }],
      source: { kind: 'dsh-polish-session-slim' },
    })
    var seedNow = Date.now()
    // 0.4.90（P0 真因）：replacement 必须以「已完成的一轮 turn」出生。
    // sessionListMetadata.blank 的定义是「折叠前缀里没有 turn」，而
    // applySessionListMetadata 只在 turn/start 时把 blank 清成 false；
    // 侧栏 isVisible() 规则是「session.blank && id !== current → 隐藏」。
    // 旧 seed 只有 user/message + session/end-seed、没有 turn/start，
    // 于是 replacement 在 sessionController.list() 里可见、在侧栏里却永远
    // 不出现——这正是用户反复报的「瘦身完新会话消失」。
    // 补 turn/start + turn/end（reason completed）后：
    //   · sessionListMetadata.blank = false → 侧栏可见；
    //   · turnBoundary.lastTurn = 1，agent 构造时 phase.lastTurn 读它，
    //     下一轮真实 turn 从 2 开始（不会重复 turn 1）；
    //   · turn/end 把 openTurnStartSeq 清空（不留开放 turn，不会触发续跑）。
    var seedEvents = [
      { type: 'user/message', seq: 0, time: seedNow, data: checkpointMessage, surfaceOp: 'append' },
      { type: 'turn/start', seq: 1, time: seedNow, data: { turn: 1 } },
      { type: 'turn/end', seq: 2, time: seedNow, data: { turn: 1, reason: { kind: 'completed' } } },
      { type: 'session/end-seed', seq: 3, time: seedNow, data: { inherited: true } },
    ]
    // 0.4.90：新会话仍作为**顶层会话**出生（不挂 parentSession）。DSH 自己的
    // fork 会设 parentSession，但它的父会话从不归档；slim 的父会话必然归档，
    // replacement 不挂父更干净（归档级联只处理旧会话自己的 subIds，不依赖
    // replacement 的 parentSession）。注意：这**不是**「新会话不显示」的根因——
    // 根因是 sessionListMetadata.blank（见上面 seed 的注释）。
    var seedMeta = {
      isSeeded: true,
    }
    if (row.cwd) seedMeta.cwd = row.cwd
    if (row.agentPreset) seedMeta.agentPreset = row.agentPreset
    var modelOptions =
      lastUsed && lastUsed.provider && lastUsed.model
        ? { provider: lastUsed.provider, model: lastUsed.model }
        : null
    job.phase = 'seeding'
    job.newSessionState = 'pending'
    var modelInherited = false
    var createArgs = {
      sessionId: newId,
      seed: seedEvents,
      inheritedEventCount: 4,
      meta: seedMeta,
    }
    if (modelOptions) createArgs.agentOptions = modelOptions
    var newHandle = null
    try {
      newHandle = await ctx.agents.create(createArgs)
      job.newSessionId = newId
      job.newSessionState = 'created'
      if (ctx.agents && typeof ctx.agents.get === 'function' && !ctx.agents.get(newId)) {
        var eCreateMissing = new Error('创建 API 已返回，但新会话未出现在 agents 注册表：' + newId)
        eCreateMissing.code = 'SLIM_CREATE_NOT_PUBLISHED'
        eCreateMissing.newSessionId = newId
        throw eCreateMissing
      }
      job.newSessionId = newId
      if (modelOptions) modelInherited = true
    } catch (error) {
      try {
        if (newHandle && typeof newHandle.dispose === 'function') await newHandle.dispose()
      } catch (disposeError) {}
      job.newSessionState = 'unknown'
      // 不再用同一个 newId 盲目 fallback create：create 的 Promise 失败可能是
      // setup/persistence 的未知部分成功，重试会撞持久化身份或制造孤儿会话。
      // compact 模型在此前已通过 resolveCallConfig 校验；失败必须原样可见，
      // 旧会话尚未被改名/归档，用户可以安全重试。
      var e9 = new Error('创建新会话失败' + (modelOptions ? '（模型 ' + modelOptions.provider + '/' + modelOptions.model + '）' : '') + '：' + ((error && error.message) || error))
      e9.code = error && error.code ? String(error.code) : 'SLIM_CREATE_FAILED'
      e9.newSessionId = newId
      e9.newSessionState = 'unknown'
      throw e9
    }
    var sideEffects = { newSessionId: newId, attached: workspace && typeof workspace.attachSession === 'function' ? 'pending' : 'done', modelSelected: modelInherited && lastUsed && lastUsed.provider && lastUsed.model ? 'pending' : 'done', newRenamed: 'pending', newAgentStopped: 'pending', newVisible: 'pending', oldRenamed: 'pending', mainArchived: 'pending', archivedSubIds: [], failedSubIds: [], unknownSubIds: [] }
    job.sideEffects = sideEffects
    var newAgentStopped = false
    async function stopNewAgent() {
      if (newAgentStopped) return
      if (!newHandle || typeof newHandle.dispose !== 'function') {
        sideEffects.newAgentStopped = 'unknown'
        var handleError = new Error('新会话已创建（' + newId + '），但无法取得可关闭的 agent handle；为避免幽灵 session，旧会话未改动')
        handleError.code = 'SLIM_NEW_HANDLE_UNAVAILABLE'
        handleError.newSessionId = newId
        throw handleError
      }
      try {
        await newHandle.dispose()
        newAgentStopped = true
        sideEffects.newAgentStopped = 'done'
      } catch (error) {
        sideEffects.newAgentStopped = 'unknown'
        var stopError = new Error('新会话已创建（' + newId + '），但停止新 agent 失败（结果未知；旧会话未改动）：' + ((error && error.message) || error))
        stopError.code = 'SLIM_NEW_AGENT_STOP_FAILED'
        stopError.newSessionId = newId
        throw stopError
      }
    }
    async function ensureNewVisible() {
      try {
        // 0.4.90：replacement 现在是 live 会话（未 dispose）。最强可见性保证是
        // 它仍在 live agents 注册表里——live 会话必然出现在侧栏。先查 live，
        // 再查 sessionController.list()（侧栏数据源）作为第二道确认。两者都在
        // 才算「与正常侧栏同一可见性来源」，否则旧会话不动、抛错。
        var liveAgent = null
        try {
          liveAgent = ctx.agents && typeof ctx.agents.get === 'function' ? ctx.agents.get(newId) : undefined
        } catch (liveErr) {}
        if (!liveAgent) throw new Error('新会话不在 live agents 注册表（agent 可能已被摘除，侧栏不保证可见）')
        var visibleResultAfterCreate = await ctx.sessionController.list()
        var visibleAfterCreate = Array.isArray(visibleResultAfterCreate) ? visibleResultAfterCreate : visibleResultAfterCreate && Array.isArray(visibleResultAfterCreate.items) ? visibleResultAfterCreate.items : null
        if (!visibleAfterCreate) throw new Error('sessionController.list 返回值无效')
        var found = false
        var foundBlank = null
        for (var vi2 = 0; vi2 < visibleAfterCreate.length; vi2++) {
          var visibleItem = visibleAfterCreate[vi2]
          var visibleAfterId = visibleItem && (visibleItem.sessionId || visibleItem.id)
          if (visibleAfterId === newId) {
            found = true
            foundBlank = visibleItem.blank
            break
          }
        }
        if (!found) throw new Error('sessionController.list 未返回新会话')
        // 0.4.90（P0 真因）：list() 包含 ≠ 侧栏可见。侧栏 isVisible() 规则是
        // 「session.blank && id !== current → 隐藏」——blank 的 replacement
        // 会出现在 list() 里、却永远不进侧栏，而旧会话却已被归档，正是用户
        // 反复报的「瘦身完会话消失」。所以这里必须再要求 item.blank !== true；
        // 否则 fail-safe：旧会话保持不动，抛 SLIM_NEW_NOT_VISIBLE。
        if (foundBlank === true) throw new Error('新会话在 list() 中但 blank=true（没有 turn），侧栏会隐藏它')
        sideEffects.newVisible = 'done'
      } catch (error) {
        sideEffects.newVisible = 'unknown'
        var visibleError = new Error('新会话已创建（' + newId + '），但完成后未出现在可见会话列表；旧会话未改动：' + ((error && error.message) || error))
        visibleError.code = 'SLIM_NEW_NOT_VISIBLE'
        visibleError.newSessionId = newId
        throw visibleError
      }
    }
    job.phase = 'attaching'
    if (workspace && typeof workspace.attachSession === 'function') {
      try {
        await workspace.attachSession(newId)
        sideEffects.attached = 'done'
      } catch (error) {
        sideEffects.attached = 'unknown'
        try { await stopNewAgent() } catch (cleanupError) {}
        var attachError = new Error('新会话已创建（' + newId + '），但挂回工作区失败（结果未知）：' + ((error && error.message) || error))
        attachError.code = 'SLIM_NEW_ATTACH_FAILED'
        attachError.newSessionId = newId
        throw attachError
      }
    }
    if (!workspace || typeof workspace.attachSession !== 'function') sideEffects.attached = 'done'
    try {
      checkCancel(job)
    } catch (cancelError) {
      try { await stopNewAgent() } catch (cleanupError) {}
      throw cancelError
    }

    // 8) 先继承模型/effort；失败时新会话仍保留临时标题，旧会话不动。
    job.phase = 'selecting-model'
    if (modelInherited && lastUsed && lastUsed.provider && lastUsed.model) {
      try {
        await ctx.sessionController.selectModel({
          sessionId: newId,
          provider: lastUsed.provider,
          model: lastUsed.model,
          reasoningEffort: lastUsed.reasoningEffort,
        })
        sideEffects.modelSelected = 'done'
      } catch (error) {
        sideEffects.modelSelected = 'unknown'
        try { await stopNewAgent() } catch (cleanupError) {}
        var effortError = new Error('新会话已创建（' + newId + '），但模型 effort 继承失败（结果未知）：' + ((error && error.message) || error))
        effortError.code = 'SLIM_NEW_EFFORT_FAILED'
        effortError.newSessionId = newId
        throw effortError
      }
    }
    try {
      checkCancel(job)
    } catch (cancelError) {
      try { await stopNewAgent() } catch (cleanupError) {}
      throw cancelError
    }

    // 9) 模型继承完成后，再把新会话改回原名。
    job.phase = 'renaming-new'
    try {
      await ctx.sessionController.rename({ sessionId: newId, title: row.title })
      sideEffects.newRenamed = 'done'
    } catch (error) {
      sideEffects.newRenamed = 'unknown'
      try { await stopNewAgent() } catch (cleanupError) {}
      var renameNewError = new Error('新会话已创建（' + newId + '），但改回原名称失败（结果未知）：' + ((error && error.message) || error))
      renameNewError.code = 'SLIM_NEW_RENAME_FAILED'
      renameNewError.newSessionId = newId
      throw renameNewError
    }
    // 0.4.90（P0 修复）：**不再 dispose 新 agent**。
    // DSH 自己的 fork（侧栏可见性的金标准）创建 replacement 后保留一个 live、
    // idle 的 agent，从不 dispose——fork 的会话因此稳定出现在侧栏。seed 语义保证
    // 这个 agent 空闲出生、不触发模型轮次（用户拍板「正常 compact 只存上下文，
    // 不强制模型继续回复」）。旧实现在这里 dispose，把新会话从 live store 摘成
    // cold，其侧栏可见性转而依赖 sessionQuery 冷读路径（用户实测不可靠），叠加
    // parentSession→已归档父会话，导致 replacement 消失。现在让 replacement 保持
    // live（顶层、已挂工作区、已改名、已继承模型），与 DSH fork 完全同形，必然可见。
    // 失败路径仍调用 stopNewAgent() 清理半配置会话（不留残局）。
    sideEffects.newAgentStopped = 'skipped'
    job.phase = 'verifying-new'
    await ensureNewVisible()

    // 10) 新会话已经可用后，先处理子代理，再改名并归档旧主会话。
    //     这样子代理归档失败时，旧主会话仍保持原名和正常可见性；
    //     rename-old 与 archive-main 之间不再检查 stop，避免半提交被取消。
    var archivedSubs = 0
    var subIds = row.subIds || []
    job.phase = 'archiving'
    try {
      for (var si = 0; si < subIds.length; si++) {
        try {
          await ctx.workspaceRegistry.archiveSession(subIds[si], {})
          sideEffects.archivedSubIds.push(subIds[si])
          archivedSubs += 1
        } catch (subError) {
          sideEffects.unknownSubIds.push(subIds[si])
          sideEffects.failedSubIds.push(subIds[si])
          sideEffects.failedSessionId = subIds[si]
          var childArchiveError = new Error('新会话已创建（' + newId + '），但子代理归档失败（结果未知：' + subIds[si] + '）：' + ((subError && subError.message) || subError))
          childArchiveError.code = 'SLIM_ARCHIVE_FAILED'
          childArchiveError.newSessionId = newId
          throw childArchiveError
        }
      }
    } catch (error) {
      throw error
    }

    job.phase = 'renaming'
    try {
      await ctx.sessionController.rename({ sessionId: id, title: archiveTitle })
      sideEffects.oldRenamed = 'done'
    } catch (error) {
      sideEffects.oldRenamed = 'unknown'
      sideEffects.failedSessionId = id
      var renameOldError = new Error('新会话已创建（' + newId + '），但旧会话改名为归档名失败（结果未知）：' + ((error && error.message) || error))
      renameOldError.code = 'SLIM_ARCHIVE_RENAME_FAILED'
      renameOldError.newSessionId = newId
      throw renameOldError
    }

    job.phase = 'archiving'
    try {
      await ctx.workspaceRegistry.archiveSession(id, {})
      sideEffects.mainArchived = 'done'
    } catch (error) {
      sideEffects.mainArchived = 'unknown'
      sideEffects.failedSessionId = id
      var archiveError = new Error('新会话已创建（' + newId + '），但旧主会话归档失败（结果未知；' + archiveTitle + '，已连带归档 ' + archivedSubs + ' 个子代理）：' + ((error && error.message) || error))
      archiveError.code = 'SLIM_ARCHIVE_FAILED'
      archiveError.newSessionId = newId
      throw archiveError
    }
    return {
      newSessionId: newId,
      archiveTitle: archiveTitle,
      archivedSubagents: archivedSubs,
      chunks: slim.chunks,
      sourceTokens: slim.sourceTokens,
      summaryChars: slim.summary.length,
      singlePass: slim.singlePass === true,
      window: window,
      model: provider + '/' + model,
      modelInherited: modelInherited,
    }
  }

  function normPath(p) {
    return String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  }

  // ---- 响应助手 ----
  function json(value, status) {
    return new Response(JSON.stringify(value), {
      status: status || 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    })
  }

  async function stateResponse() {
    return json({
      rows: await rowsNow(false),
      memory: memoryInfo(),
      queue: queue.map(function (j) {
        return {
          key: j.key,
          sessionId: j.sessionId,
          title: j.title,
          phase: j.phase,
          error: j.error,
          errorCode: j.errorCode || null,
          newSessionId: j.newSessionId || (j.detail && j.detail.newSessionId) || null,
          newSessionState: j.newSessionState || null,
          at: j.at,
          startedAt: j.startedAt,
          finishedAt: j.finishedAt,
          warnings: Array.isArray(j.warnings) ? j.warnings : [],
          sideEffects: j.sideEffects || null,
        }
      }),
      done: done.slice(0, 20).map(function (j) {
        return {
          key: j.key,
          sessionId: j.sessionId,
          title: j.title,
          phase: j.phase,
          detail: j.detail,
          error: j.error,
          errorCode: j.errorCode || null,
          newSessionId: j.newSessionId || (j.detail && j.detail.newSessionId) || null,
          newSessionState: j.newSessionState || null,
          at: j.at,
          startedAt: j.startedAt,
          finishedAt: j.finishedAt,
          warnings: Array.isArray(j.warnings) ? j.warnings : [],
          sideEffects: j.sideEffects || null,
        }
      }),
      // 0.4.78：在途任务（此前 shift 离开 queue 后到完成前对用户完全不可见）
      current: currentJob
        ? {
            key: currentJob.key,
            sessionId: currentJob.sessionId,
            title: currentJob.title,
            phase: currentJob.phase,
            detail: currentJob.detail, // 0.4.79：分片/合并进度
            error: currentJob.error,
            errorCode: currentJob.errorCode || null,
            newSessionId: currentJob.newSessionId || (currentJob.detail && currentJob.detail.newSessionId) || null,
             newSessionState: currentJob.newSessionState || null,
            warnings: Array.isArray(currentJob.warnings) ? currentJob.warnings : [],
             sideEffects: currentJob.sideEffects || null,
            at: currentJob.at,
            startedAt: currentJob.startedAt,
            finishedAt: currentJob.finishedAt,
          }
        : null,
      busy: workerBusy,
      now: Date.now(),
    })
  }

  // ---- 0.4.78 队列看门狗：串行 worker 唯一的「永久死亡」路径是 LLM 流
  //      不结束（ctx.llm.stream 无超时/signal）。调用级超时（callSlimLlm）
  //      是第一道防线；看门狗是最后防线：
  //      1) 单任务超 SLIM_JOB_HARD_MS → stale 强杀、释放 worker、继续队列
  //         （迟到回执由 stale 守护防双记账）；
  //      2) busy 但无在途任务、无待批定时器、队列空且 30s 无活动 → 失步
  //         恢复（复位 workerBusy）。
  function watchdogTick() {
    if (!workerBusy) return
    if (currentJob && currentJob.startedAt && Date.now() - currentJob.startedAt > SLIM_JOB_HARD_MS) {
      currentJob.stale = true
      currentJob.phase = 'failed'
      currentJob.error = '处理超时（看门狗 ' + Math.round(SLIM_JOB_HARD_MS / 60000) + ' 分钟），自动标记失败'
      currentJob.finishedAt = Date.now()
      pushDone(currentJob)
      currentJob = null
      workerBusy = false
      lastActivityAt = Date.now()
      pump()
      return
    }
    if (!currentJob && batchTimer === null && queue.length === 0 && Date.now() - lastActivityAt > 30000) {
      workerBusy = false
      lastActivityAt = Date.now()
    }
  }
  ctx.effect(function () {
    var timer = ctx.interval(watchdogTick, 5000)
    return function () {
      try {
        timer.dispose()
      } catch (error) {}
    }
  }, 'session-slim: queue watchdog')

  // ---- 路由（SessionMediaReferences / session-log-export 同范式）----
  ctx.effect(
    function () {
      // 每条路由都必须声明 requestBody: 'buffered'（core /api/file 的 GET/HEAD
      // 同款）。不声明时 bridge 按流式分支构造 Request——GET 带 body 在
      // WHATWG 语义下非法，连接层把该错误映射为 400（用户实测「状态读取
      // 失败：HTTP 400」）。
      ctx.connection.fetch.register({
        path: '/api/dshp/session-slim/state',
        methods: ['GET'],
        requestBody: 'buffered',
        fetch: async function (request) {
          try {
            return await stateResponse()
          } catch (error) {
            return json({ error: String((error && error.message) || error) }, 500)
          }
        },
      })
      ctx.connection.fetch.register({
        path: '/api/dshp/session-slim/slim',
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async function (request) {
          try {
            var body = {}
            try {
              body = await request.json()
            } catch (error) {}
            var ids = body && Array.isArray(body.ids) ? body.ids : []
            if (ids.length > 200) ids = ids.slice(0, 200)
            var added = enqueue(ids)
            return json({ queued: added })
          } catch (error) {
            return json({ error: String((error && error.message) || error) }, 500)
          }
        },
      })
      ctx.connection.fetch.register({
        path: '/api/dshp/session-slim/refresh',
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async function () {
          try {
            await rowsNow(true)
            var rows = await rowsNow(false)
            return json({ rows: rows.length })
          } catch (error) {
            return json({ error: String((error && error.message) || error) }, 500)
          }
        },
      })
      // 0.4.81：compact 模型「测试调用」——发一个真实最小请求（ping）。
      // validate-model 只裁决路由是否注册；provider 侧故障（未知模型/鉴权/
      // 限流）只有真实调用才暴露。与 slimOne 的调用走同一个 callSlimLlm
      // （含 120s 空闲 / 30min 单次上限与 finish 错误传播）。
      ctx.connection.fetch.register({
        path: '/api/dshp/session-slim/test-call',
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async function (request) {
          try {
            var body = {}
            try {
              body = await request.json()
            } catch (error) {}
            var provider = typeof body.provider === 'string' ? body.provider.trim() : ''
            var model = typeof body.model === 'string' ? body.model.trim() : ''
            var effort = typeof body.effort === 'string' ? body.effort.trim() : ''
            if (!provider || !model) return json({ ok: false, error: '缺少 provider/model' })
            var result = await callSlimLlm(
              { provider: provider, model: model, reasoningEffort: effort },
              [{ role: 'user', content: [{ type: 'text', text: 'ping（slim 连通性测试，请只回复 pong）' }] }],
              null,
              'slim-test-call',
              64,
            )
            if (result.text === '') {
              return json({ ok: false, error: '模型返回空文本（usage: ' + usageText(result.usage) + '）' })
            }
            return json({ ok: true, text: result.text.slice(0, 200), usage: usageText(result.usage) })
          } catch (error) {
            return json({ ok: false, error: String((error && error.message) || error) })
          }
        },
      })
      // 0.4.79：compact 模型可用性校验（页面下拉的兜底验证——列出可选项
      // 后仍有陈旧保存值/目录刷新间隙，保存前这里给出确切裁决）。
      ctx.connection.fetch.register({
        path: '/api/dshp/session-slim/validate-model',
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async function (request) {
          try {
            var body = {}
            try {
              body = await request.json()
            } catch (error) {}
            var provider = typeof body.provider === 'string' ? body.provider.trim() : ''
            var model = typeof body.model === 'string' ? body.model.trim() : ''
            var effort = typeof body.effort === 'string' ? body.effort.trim() : ''
            if (!provider || !model) return json({ ok: true, skipped: true })
            try {
              await ctx.llm.resolveCallConfig({
                provider: provider,
                model: model,
                reasoningEffort: effort || undefined,
              })
              return json({ ok: true })
            } catch (error) {
              return json({ ok: false, error: String((error && error.message) || error) })
            }
          } catch (error) {
            return json({ ok: false, error: String((error && error.message) || error) }, 500)
          }
        },
      })
      ctx.connection.fetch.register({
        path: '/api/dshp/session-slim/stop',
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: function () {
          try {
            stopQueue()
            return json({ stopped: true })
          } catch (error) {
            return json({ error: String((error && error.message) || error) }, 500)
          }
        },
      })
    },
    'session-slim: fetch routes',
  )
}
