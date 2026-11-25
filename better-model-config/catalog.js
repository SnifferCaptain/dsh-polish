const FIELD_ALIASES = {
  model: ['model', 'modelid', 'id', 'name'],
  aliases: ['aliases', 'alias', 'modelaliases'],
  family: ['family', 'vendor', 'maker'],
  contextWindow: ['contextwindow', 'context_window', 'context', 'contextlength', 'context_length', 'ctx'],
  maxTokens: ['maxoutput', 'max_output', 'maxoutputtokens', 'max_output_tokens', 'maxtokens', 'max_tokens', 'maxcompletiontokens'],
  inputModalities: ['inputmodalities', 'input_modalities', 'modalities', 'input'],
  vision: ['vision', 'image', 'supportsimage', 'supports_image', 'imageinput'],
  audioInput: ['audioinput', 'audio_input', 'supportsaudioinput', 'supports_audio_input', 'audioin'],
  audioOutput: ['audiooutput', 'audio_output', 'supportsaudiooutput', 'supports_audio_output', 'audioout'],
  thinkingEnabled: ['thinkingenabled', 'thinking_enabled', 'reasoning', 'supportsreasoning', 'supports_reasoning'],
  forceAdaptiveThinking: ['forceadaptivethinking', 'force_adaptive_thinking', 'adaptive_thinking'],
  thinkingMode: ['thinkingmode', 'thinking_mode', 'reasoningmode', 'reasoning_mode'],
  thinkingLevels: ['thinkinglevels', 'thinking_levels', 'reasoninglevels', 'reasoning_levels', 'efforts'],
  thinkingMin: ['thinkingmin', 'thinking_min', 'budgetmin', 'budget_min'],
  thinkingMax: ['thinkingmax', 'thinking_max', 'budgetmax', 'budget_max'],
  thinkingDefault: ['thinkingdefault', 'thinking_default', 'defaultthinking', 'default_effort', 'defaultthinkingeffort'],
  priceInput: ['priceinputcnypermillion', 'price_input_cny_per_million', 'inputcostpermillion', 'input_cost_per_million', 'inputprice'],
  priceOutput: ['priceoutputcnypermillion', 'price_output_cny_per_million', 'outputcostpermillion', 'output_cost_per_million', 'outputprice'],
  priceCacheRead: ['pricecachereadcnypermillion', 'price_cache_read_cny_per_million', 'cachereadcostpermillion', 'cache_read_cost_per_million', 'cachereadprice'],
  priceCacheWrite: ['pricecachewritecnypermillion', 'price_cache_write_cny_per_million', 'cachecreationcostpermillion', 'cache_creation_cost_per_million', 'cachewriteprice'],
  priceCurrency: ['pricecurrency', 'price_currency', 'currency'],
  priceExchangeRate: ['priceexchangerate', 'price_exchange_rate', 'usdexchangerate', 'usd_exchange_rate'],
  priceContextTiers: ['pricecontexttiersjson', 'price_context_tiers_json', 'contexttiers', 'context_tiers'],
  priceTimeRules: ['pricetimerulesjson', 'price_time_rules_json', 'timerules', 'time_rules'],
};

const KNOWN_HEADERS = new Set(Object.values(FIELD_ALIASES).flat().map(normalizeHeader));
const THINKING_KEYS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

export function normalizeModelName(value) {
  return String(value ?? '').normalize('NFKC').toLowerCase().replace(/[.\-\s]/g, '');
}

export function normalizeHeader(value) {
  return String(value ?? '').replace(/^\uFEFF/u, '').toLowerCase().replace(/[.\-_\s]/g, '');
}

function csvRows(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const source = String(text ?? '').replace(/^\uFEFF/u, '');
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"' && field.length === 0) quoted = true;
    else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
    } else {
      field += char;
    }
  }
  if (quoted) throw new Error('CSV catalog contains an unterminated quoted field');
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some((cell) => cell.length > 0)) rows.push(row);
  }
  return rows;
}

function parseNumber(value) {
  if (value === undefined || String(value).trim() === '') return undefined;
  const parsed = Number(String(value).trim().replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseNonNegativeNumber(value) {
  const parsed = parseNumber(value);
  return parsed !== undefined && parsed >= 0 ? parsed : undefined;
}

function parsePositiveNumber(value) {
  const parsed = parseNumber(value);
  return parsed !== undefined && parsed > 0 ? parsed : undefined;
}

function parseBoolean(value) {
  if (value === undefined || String(value).trim() === '') return undefined;
  const text = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'enabled', 'on'].includes(text)) return true;
  if (['0', 'false', 'no', 'n', 'disabled', 'off'].includes(text)) return false;
  return undefined;
}

function parseList(value) {
  const text = String(value ?? '').trim();
  if (!text) return [];
  if (text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed.map(String).map((item) => item.trim()).filter(Boolean);
    } catch {}
  }
  return text.split(/[|;,]/u).map((item) => item.trim()).filter(Boolean);
}

function parseThinkingLevels(value) {
  const text = String(value ?? '').trim();
  if (!text) return undefined;
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return Object.fromEntries(parsed.map((level) => [String(level), String(level)]));
    if (parsed && typeof parsed === 'object') return parsed;
  } catch {}
  const entries = text.split(/[|;,]/u).map((item) => item.trim()).filter(Boolean);
  const result = {};
  for (const entry of entries) {
    const equals = entry.indexOf('=');
    if (equals < 0) result[entry] = entry;
    else result[entry.slice(0, equals).trim()] = entry.slice(equals + 1).trim() || null;
  }
  return Object.keys(result).length ? result : undefined;
}

function firstColumn(record, aliases) {
  for (const alias of aliases) {
    const key = normalizeHeader(alias);
    if (Object.hasOwn(record, key) && record[key] !== '') return record[key];
  }
  return undefined;
}

function parsePricingJson(value) {
  if (value === undefined) return undefined;
  const text = String(value).trim();
  if (!text) return undefined;
  try { return JSON.parse(text); } catch { return text; }
}

function canonicalEntry(header, values) {
  const raw = Object.fromEntries(header.map((key, index) => [normalizeHeader(key), values[index] ?? '']));
  const get = (field) => firstColumn(raw, FIELD_ALIASES[field]);
  const model = String(get('model') ?? '').trim();
  if (!model) return undefined;
  const aliases = parseList(get('aliases'));
  const modalities = parseList(get('inputModalities')).map((item) => item.toLowerCase());
  const vision = parseBoolean(get('vision'));
  const thinkingLevels = parseThinkingLevels(get('thinkingLevels'));
  const extras = {};
  for (const [key, value] of Object.entries(raw)) if (!KNOWN_HEADERS.has(key) && value !== '') extras[key] = value;
  const contextTiers = parsePricingJson(get('priceContextTiers'));
  const timeRules = parsePricingJson(get('priceTimeRules'));
  if (contextTiers !== undefined) extras.price_context_tiers_json = typeof contextTiers === 'string' ? contextTiers : JSON.stringify(contextTiers);
  if (timeRules !== undefined) extras.price_time_rules_json = typeof timeRules === 'string' ? timeRules : JSON.stringify(timeRules);
  const rawThinkingMode = String(get('thinkingMode') ?? '').trim().toLowerCase();
  const thinkingMode = ['budget', 'range', 'continuous', 'continuous-0-100', '0-100'].includes(rawThinkingMode) ? 'budget' : (rawThinkingMode ? 'effort' : undefined);
  return {
    model,
    aliases,
    family: String(get('family') ?? '').trim() || undefined,
    contextWindow: parseNumber(get('contextWindow')),
    maxTokens: parseNumber(get('maxTokens')),
    inputModalities: modalities.length ? [...new Set(['text', ...modalities.filter((m) => ['text', 'image'].includes(m))])] : (vision === true ? ['text', 'image'] : undefined),
    audioInput: parseBoolean(get('audioInput')),
    audioOutput: parseBoolean(get('audioOutput')),
    thinkingEnabled: parseBoolean(get('thinkingEnabled')),
    forceAdaptiveThinking: parseBoolean(get('forceAdaptiveThinking')),
    thinkingMode,
    thinkingLevels,
    thinkingMin: parseNumber(get('thinkingMin')),
    thinkingMax: parseNumber(get('thinkingMax')),
    thinkingDefault: String(get('thinkingDefault') ?? '').trim() || undefined,
    pricing: {
      input: parseNonNegativeNumber(get('priceInput')),
      output: parseNonNegativeNumber(get('priceOutput')),
      cacheRead: parseNonNegativeNumber(get('priceCacheRead')),
      cacheWrite: parseNonNegativeNumber(get('priceCacheWrite')),
      currency: String(get('priceCurrency') ?? '').trim() || undefined,
      exchangeRate: parsePositiveNumber(get('priceExchangeRate')),
      contextTiers,
      timeRules,
    },
    extras,
  };
}

export function parseModelCatalog(text) {
  const rows = csvRows(text);
  if (rows.length === 0) return { rows: [], lookup: {}, ambiguous: [], priceTableVersion: undefined, rowCount: 0 };
  const [header, ...body] = rows;
  const entries = body.map((values) => canonicalEntry(header, values)).filter(Boolean);
  const lookup = Object.create(null);
  const ambiguous = new Set();
  for (const entry of entries) {
    for (const key of [entry.model, ...entry.aliases].map(normalizeModelName).filter(Boolean)) {
      if (ambiguous.has(key)) continue;
      if (lookup[key] && lookup[key].model !== entry.model) {
        delete lookup[key];
        ambiguous.add(key);
      } else lookup[key] = entry;
    }
  }
  const version = entries.map((entry) => Number(entry.extras.pricetableversion)).find(Number.isFinite);
  return { rows: entries, lookup, ambiguous: [...ambiguous], priceTableVersion: version, rowCount: entries.length };
}

function consensus(values) {
  const comparable = values.map((value) => JSON.stringify(value));
  return comparable.every((value) => value === comparable[0]) ? values[0] : undefined;
}

export function enrichCatalogWithBuiltins(catalog, models = []) {
  const groups = new Map();
  for (const model of models) {
    if (!model || typeof model.id !== 'string') continue;
    const keys = [model.id, model.name].filter(Boolean).map(normalizeModelName).filter(Boolean);
    const supported = model.reasoning ? THINKING_KEYS.filter((level) => model.thinkingLevelMap?.[level] !== null && (level !== 'xhigh' && level !== 'max' || model.thinkingLevelMap?.[level] !== undefined)) : [];
    const meta = {
      contextWindow: Number.isFinite(model.contextWindow) ? model.contextWindow : undefined,
      maxTokens: Number.isFinite(model.maxTokens) ? model.maxTokens : undefined,
      inputModalities: Array.isArray(model.input) ? [...new Set(['text', ...model.input.filter((item) => ['text', 'image'].includes(item))])] : undefined,
      thinkingEnabled: typeof model.reasoning === 'boolean' ? model.reasoning : undefined,
      forceAdaptiveThinking: typeof model.compat?.forceAdaptiveThinking === 'boolean' ? model.compat.forceAdaptiveThinking : undefined,
      thinkingLevels: supported.length ? Object.fromEntries(supported.filter((level) => level !== 'off').map((level) => [level, model.thinkingLevelMap?.[level] ?? level])) : undefined,
    };
    for (const key of keys) {
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(meta);
    }
  }
  const builtinLookup = Object.create(null);
  for (const [key, values] of groups) {
    const fields = {};
    for (const field of ['contextWindow', 'maxTokens', 'inputModalities', 'thinkingEnabled', 'forceAdaptiveThinking', 'thinkingLevels']) {
      const present = values.map((value) => value[field]).filter((value) => value !== undefined);
      if (present.length) fields[field] = consensus(present);
    }
    builtinLookup[key] = fields;
  }
  const lookup = Object.create(null);
  for (const [key, entry] of Object.entries(catalog.lookup)) lookup[key] = mergeBuiltin(entry, builtinLookup[key]);
  return { ...catalog, lookup, builtinLookup };
}

function mergeBuiltin(entry, fallback) {
  if (!fallback) return entry;
  return {
    ...entry,
    contextWindow: entry.contextWindow ?? fallback.contextWindow,
    maxTokens: entry.maxTokens ?? fallback.maxTokens,
    inputModalities: entry.inputModalities ?? fallback.inputModalities,
    thinkingEnabled: entry.thinkingEnabled ?? fallback.thinkingEnabled,
    forceAdaptiveThinking: entry.forceAdaptiveThinking ?? fallback.forceAdaptiveThinking,
    thinkingLevels: entry.thinkingLevels ?? fallback.thinkingLevels,
  };
}

export function lookupModelDefaults(catalog, modelName) {
  const key = normalizeModelName(modelName);
  if (!key || catalog.ambiguous?.includes(key)) return undefined;
  return catalog.lookup?.[key] ?? catalog.builtinLookup?.[key];
}
