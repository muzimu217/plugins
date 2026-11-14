// Read the model menu the Doubao desktop client actually shows, so the list
// follows the client instead of a table we wrote once.
//
// Why a cache: magpie asks `provider.models` on every provider listing, and
// opening the client's menu means driving its window. Reading it on every
// listing would flick the user's window around all day, so the menu is read at
// most once per TTL (6 hours, the interval doubao-work settled on) and the
// answer is kept on disk.
//
// Why a fallback: the menu is a Radix popup inside an Electron webview, and it
// does not always mount under CDP (observed: it renders empty unless the app is
// on its task view and the click is a real Input event). A models hook has 20
// seconds before the host gives up, so this never blocks on a popup that will
// not open: it returns the last good list, else the static table.

import { readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { homedir } from "node:os"

import { CdpSession, isCdpUp, listTargets } from "./client-checkin.mjs"

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const DEFAULT_PORT = Number(process.env.DOUBAO_CDP_PORT ?? 9333)

/** Menu rows that are actions or submenus, not models. */
const NOT_A_MODEL = /^(推理强度|思考|深度思考|更多|新建|置顶|今天|昨天|技能|插件|项目|云电脑|测试模型|管理|设置|搜索|全部|最近|小额免费|限时优惠|免费|优惠|续费|升级套餐)/

/** Price/multiplier tags that ride on a row: 0.65x, 1.44x, 0.01x. */
const PRICE_LIKE = /^\d+(\.\d+)?\s*x$/i

/** Reasoning-effort labels of the 推理强度 submenu. */
const EFFORT_LIKE = /^(中|低|高|最高|标准|关闭|开启)$/

/** Rows whose id we know for certain, captured from a live menu. */
const KNOWN = [
  [/^自动$/, "doubao-auto"],
  [/^豆包\s*2\.1\s*Lite$/i, "doubao-2.1-lite"],
  [/^豆包\s*2\.1\s*Pro(\s*升级)?$/i, "doubao-2.1-pro"],
]

/** Where the cached menu lives: beside magpie's other state. */
export function modelsCachePath() {
  if (process.env.MAGPIE_DOUBAO_MODELS) return process.env.MAGPIE_DOUBAO_MODELS
  const dir = process.env.XDG_CONFIG_HOME
    ? join(process.env.XDG_CONFIG_HOME, "magpie")
    : join(homedir(), ".config", "magpie")
  return join(dir, "doubao-models.json")
}

function readCache(path) {
  try {
    const v = JSON.parse(readFileSync(path, "utf8"))
    if (!Array.isArray(v?.models) || !v.models.length) return null
    return { models: v.models, at: Number(v.at) || 0, source: v.source ?? "client" }
  } catch {
    return null
  }
}

function writeCache(path, models) {
  try {
    mkdirSync(dirname(path), { recursive: true })
    const tmp = `${path}.tmp`
    writeFileSync(tmp, JSON.stringify({ at: Date.now(), source: "client", models }, null, 2), { mode: 0o600 })
    renameSync(tmp, path)
  } catch {}
}

/** A stable id for a menu row we have no mapping for. */
export function idForMenuRow(text, taken = new Set()) {
  const known = KNOWN.find(([re]) => re.test(text))
  if (known) return known[1]
  let s = String(text)
    .toLowerCase()
    .replace(/豆包/g, "doubao")
    .replace(/深度求索/g, "deepseek")
    .replace(/高速/g, " fast ")
    .replace(/[^a-z0-9.]+/g, "-")
    .replace(/^-+|-+$/g, "")
  if (!s) s = "model"
  let id = s
  let n = 2
  while (taken.has(id)) id = `${s}-${n++}`
  return id
}

/**
 * Turn menu row texts into model entries. Each row becomes the base model, plus
 * a `-deep` sibling so the 深度思考 toggle stays reachable — the toggle is a
 * property of a request, not a row of the menu.
 */
export function modelsFromMenuTexts(texts, { context = 256000, output = 8192, deepOutput = 32768 } = {}) {
  const rows = [...new Set(
    texts
      .map((t) => String(t ?? "").trim().replace(/\s+/g, " "))
      .filter((t) => t && t.length <= 30
        && !NOT_A_MODEL.test(t)
        && !PRICE_LIKE.test(t)
        && !EFFORT_LIKE.test(t)
        && !/^\d+(\.\d+)?$/.test(t)),
  )]
  if (!rows.length) return []
  const taken = new Set()
  const models = {}
  for (const text of rows) {
    const id = idForMenuRow(text, taken)
    taken.add(id)
    models[id] = {
      id,
      name: text,
      reasoning: false,
      attachment: false,
      modalities: { input: ["text"], output: ["text"] },
      limit: { context, output },
      cost: { input: 0, output: 0, cache_read: 0, cache_write: 0 },
    }
    const deepId = `${id}-deep`
    if (!taken.has(deepId)) {
      taken.add(deepId)
      models[deepId] = {
        ...models[id],
        id: deepId,
        name: `${text} (深度思考)`,
        reasoning: true,
        limit: { context, output: deepOutput },
      }
    }
  }
  return Object.values(models)
}

/**
 * Read the open client's model menu. Returns `{ ok, texts, error }`; never
 * throws, and gives up well inside the host's 20 s listing budget.
 */
export async function readClientMenuTexts({ port = DEFAULT_PORT, budgetMs = 9000 } = {}) {
  const started = Date.now()
  const left = () => budgetMs - (Date.now() - started)
  let session = null
  try {
    if (!(await isCdpUp(port, Math.min(1200, Math.max(300, left()))))) {
      return { ok: false, texts: [], error: `CDP ${port} 未就绪` }
    }
    const targets = await listTargets(port)
    const page = targets.find((t) => /doubao-chat\/chat/.test(t.url || "") && t.type === "page")
      ?? targets.find((t) => /doubao/.test(t.url || "") && t.type === "page")
    if (!page?.webSocketDebuggerUrl) return { ok: false, texts: [], error: "没找到豆包聊天页" }

    session = new CdpSession(page.webSocketDebuggerUrl)
    await session.opened
    await session.send("Runtime.enable", {})

    // The trigger: the model pill above the composer.
    const trig = await session.evaluate(() => {
      const btn = document.querySelector('[data-valid-btn="model-select-action-btn"] button')
      if (!btn) return null
      const r = btn.getBoundingClientRect()
      if (!r.width || !r.height) return null
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
    })
    if (!trig) return { ok: false, texts: [], error: "没找到模型选择按钮" }

    const click = async (pt) => {
      await session.send("Input.dispatchMouseEvent", { type: "mousePressed", x: pt.x, y: pt.y, button: "left", clickCount: 1 })
      await session.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: pt.x, y: pt.y, button: "left", clickCount: 1 })
    }
    await click(trig)
    await sleep(1500)

    // Rows live in the open Radix menu; read every leaf that carries text.
    const texts = await session.evaluate(() => {
      const menus = [...document.querySelectorAll('[role=menu][data-state=open]')]
      const root = menus[menus.length - 1] ?? document.querySelector("[data-radix-popper-content-wrapper]")
      if (!root) return []
      const out = []
      for (const el of root.querySelectorAll("*")) {
        if (el.children.length) continue
        const t = (el.innerText || el.textContent || "").trim().replace(/\s+/g, " ")
        if (t && t.length <= 40) out.push(t)
      }
      return [...new Set(out)]
    })

    // Close the menu the way a user would, so the client is left untouched.
    try { await session.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }) } catch {}

    if (!texts.length) return { ok: false, texts: [], error: "菜单没有渲染出条目" }
    return { ok: true, texts, error: "" }
  } catch (e) {
    return { ok: false, texts: [], error: String(e?.message ?? e) }
  } finally {
    try { await session?.close() } catch {}
  }
}

/**
 * The list a provider should offer: cached menu when fresh, a fresh read when
 * stale, the last good menu when the read fails, and `fallback` (the static
 * table) only when there has never been a successful read.
 */
export async function dynamicModels({ port = DEFAULT_PORT, fallback = {}, ttlMs = 6 * 3600 * 1000, force = false, cachePath = modelsCachePath() } = {}) {
  // The provider contract is OpenCode's shape: an id -> model map.
  const asMap = (arr) => Object.fromEntries(arr.map((m) => [m.id, m]))
  const cached = readCache(cachePath)
  const fresh = cached && Date.now() - cached.at < ttlMs
  if (fresh && !force) return { models: asMap(cached.models), source: "cache", ageMs: Date.now() - cached.at }

  const read = await readClientMenuTexts({ port })
  if (read.ok) {
    const models = modelsFromMenuTexts(read.texts)
    if (models.length) {
      writeCache(cachePath, models)
      return { models: asMap(models), source: "client", ageMs: 0, rows: read.texts }
    }
  }
  if (cached) return { models: asMap(cached.models), source: "cache-stale", ageMs: Date.now() - cached.at, error: read.error }
  return { models: fallback, source: "fallback", ageMs: 0, error: read.error }
}
