// The menu -> model table conversion, and the cache/fallback ladder. Nothing
// here opens a window: the CDP read is exercised against a port that cannot
// answer, which is also the path a machine without the client takes.

import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  idForMenuRow,
  modelsFromMenuTexts,
  modelsCachePath,
  dynamicModels,
} from "./lib/client-models.mjs"

const STATIC = {
  "doubao-auto": { id: "doubao-auto", name: "豆包 (自动)", reasoning: false },
}

let dir
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "doubao-models-")) })
afterEach(() => { try { rmSync(dir, { recursive: true, force: true }) } catch {} })

describe("idForMenuRow", () => {
  test("the three known rows keep the ids the plugin already shipped", () => {
    expect(idForMenuRow("自动")).toBe("doubao-auto")
    expect(idForMenuRow("豆包 2.1 Lite")).toBe("doubao-2.1-lite")
    expect(idForMenuRow("豆包 2.1 Pro")).toBe("doubao-2.1-pro")
    expect(idForMenuRow("豆包 2.1 Pro 升级")).toBe("doubao-2.1-pro")
  })

  test("a model Doubao adds later gets a readable id", () => {
    expect(idForMenuRow("DeepSeek V4.1 Flash")).toBe("deepseek-v4.1-flash")
    expect(idForMenuRow("GLM 5.3")).toBe("glm-5.3")
  })

  test("豆包 in a new row becomes doubao, not an empty slug", () => {
    expect(idForMenuRow("豆包 3.0 Ultra")).toBe("doubao-3.0-ultra")
  })

  test("a pure-Chinese row still yields a usable id instead of a crash", () => {
    expect(idForMenuRow("超级模型")).toBe("model")
  })

  test("collisions get a numeric suffix", () => {
    const taken = new Set(["model"])
    expect(idForMenuRow("超级模型", taken)).toBe("model-2")
  })
})

describe("modelsFromMenuTexts", () => {
  test("each row becomes a base model plus a deep-think sibling", () => {
    const models = modelsFromMenuTexts(["自动", "豆包 2.1 Lite"])
    const ids = models.map((m) => m.id)
    expect(ids).toContain("doubao-auto")
    expect(ids).toContain("doubao-auto-deep")
    expect(models.find((m) => m.id === "doubao-auto").reasoning).toBe(false)
    expect(models.find((m) => m.id === "doubao-auto-deep").reasoning).toBe(true)
  })

  test("submenus and actions are not models", () => {
    const models = modelsFromMenuTexts(["自动", "推理强度 中", "更多", "新建对话"])
    expect(models.map((m) => m.id)).toEqual(["doubao-auto", "doubao-auto-deep"])
  })

  test("duplicate rows collapse", () => {
    const models = modelsFromMenuTexts(["自动", "自动", " 自动 "])
    expect(models.map((m) => m.id)).toEqual(["doubao-auto", "doubao-auto-deep"])
  })

  test("an empty or garbage-only menu yields no models, not a broken one", () => {
    expect(modelsFromMenuTexts([])).toEqual([])
    expect(modelsFromMenuTexts(["", "   "])).toEqual([])
    expect(modelsFromMenuTexts(["推理强度 低", "更多"])).toEqual([])
  })

  test("the deep sibling has the larger output budget", () => {
    const models = modelsFromMenuTexts(["自动"], { output: 8192, deepOutput: 32768 })
    expect(models.find((m) => m.id === "doubao-auto").limit.output).toBe(8192)
    expect(models.find((m) => m.id === "doubao-auto-deep").limit.output).toBe(32768)
  })
})

describe("modelsCachePath", () => {
  test("sits beside magpie's other state", () => {
    const p = modelsCachePath()
    expect(p).toContain("doubao-models.json")
  })
})

describe("dynamicModels ladder", () => {
  test("no client, no cache -> the static table, never an empty list", async () => {
    const r = await dynamicModels({
      port: 1, // nothing listens here
      fallback: STATIC,
      cachePath: join(dir, "models.json"),
    })
    expect(r.source).toBe("fallback")
    expect(Object.keys(r.models)).toEqual(["doubao-auto"])
  })

  test("a fresh cache is returned without touching the client", async () => {
    const cachePath = join(dir, "models.json")
    writeFileSync(cachePath, JSON.stringify({
      at: Date.now(),
      models: [{ id: "doubao-auto", name: "自动", reasoning: false }],
    }))
    const r = await dynamicModels({ port: 1, fallback: STATIC, cachePath })
    expect(r.source).toBe("cache")
    expect(r.models["doubao-auto"]).toBeDefined()
  })

  test("an unreadable cache is ignored rather than thrown on", async () => {
    const cachePath = join(dir, "models.json")
    writeFileSync(cachePath, "{not json")
    const r = await dynamicModels({ port: 1, fallback: STATIC, cachePath })
    expect(r.source).toBe("fallback")
  })

  test("a stale cache survives a failed re-read", async () => {
    const cachePath = join(dir, "models.json")
    writeFileSync(cachePath, JSON.stringify({
      at: Date.now() - 7 * 3600 * 1000,
      models: [{ id: "doubao-old", name: "旧模型", reasoning: false }],
    }))
    const r = await dynamicModels({ port: 1, fallback: STATIC, cachePath, ttlMs: 1000 })
    expect(r.source).toBe("cache-stale")
    expect(r.models["doubao-old"]).toBeDefined()
  })

  test("the returned shape is an id -> model map, as the host expects", async () => {
    const cachePath = join(dir, "models.json")
    writeFileSync(cachePath, JSON.stringify({
      at: Date.now(),
      models: [{ id: "doubao-auto", name: "自动", reasoning: false }],
    }))
    const r = await dynamicModels({ port: 1, fallback: STATIC, cachePath })
    expect(Array.isArray(r.models)).toBe(false)
    expect(r.models["doubao-auto"].name).toBe("自动")
  })
})
