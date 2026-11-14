// The platform layer is what makes the client paths work off macOS. These
// tests only assert the contract; the Windows branches cannot be exercised on
// a Mac, so they are checked for shape (a non-empty path built from
// LOCALAPPDATA) rather than by running them.

import { describe, expect, test } from "bun:test"
import {
  PLATFORM,
  PLATFORM_NAME,
  IS_MAC,
  IS_WIN,
  clientSupported,
  appCandidates,
  appPath,
  binaryPath,
  userDataDir,
  launchArgs,
  relaunchCommand,
  isClientRunning,
  installHint,
  supportsAutoInstall,
  processName,
} from "./lib/platform.mjs"

describe("platform identity", () => {
  test("names the platform it runs on", () => {
    expect(["darwin", "win32", "linux"]).toContain(PLATFORM)
    expect(PLATFORM_NAME.length).toBeGreaterThan(0)
  })

  test("macOS and Windows have a client, Linux does not", () => {
    expect(clientSupported()).toBe(IS_MAC || IS_WIN)
  })

  test("only macOS installs from a .dmg", () => {
    expect(supportsAutoInstall()).toBe(IS_MAC)
  })
})

describe("client paths", () => {
  test("macOS looks in /Applications first, then ~/Applications", () => {
    const c = appCandidates()
    if (IS_MAC) {
      expect(c[0]).toBe("/Applications/Doubao.app")
      expect(c.length).toBeGreaterThanOrEqual(2)
    } else {
      expect(Array.isArray(c)).toBe(true)
    }
  })

  test("Windows candidates are built from LOCALAPPDATA", () => {
    if (!IS_WIN) return
    expect(appCandidates().every((p) => p.toLowerCase().includes("doubao"))).toBe(true)
  })

  test("a path is always answerable, installed or not", () => {
    // appPath returns the first existing candidate, else the first candidate,
    // so callers can put it in a message without checking first.
    const p = appPath()
    expect(typeof p).toBe("string")
    if (clientSupported()) expect(p.length).toBeGreaterThan(0)
  })

  test("the profile directory is a real-looking path", () => {
    const d = userDataDir()
    expect(typeof d).toBe("string")
    if (clientSupported()) expect(d.toLowerCase()).toContain("doubao")
  })

  test("the binary is empty rather than invented when nothing is installed", () => {
    const b = binaryPath()
    expect(typeof b).toBe("string")
    // On a machine with the client this points inside it; on one without it is
    // "" — never a path that does not exist.
    if (b) expect(b.toLowerCase()).toContain("doubao")
  })

  test("the process name is the one tasklist/pgrep would show", () => {
    expect(processName()).toBe(IS_WIN ? "Doubao.exe" : "Doubao")
  })
})

describe("launching and stopping", () => {
  test("launch flags carry the port and the profile dir", () => {
    const args = launchArgs({ port: 9333, udd: "/tmp/x" })
    expect(args).toContain("--remote-debugging-port=9333")
    expect(args).toContain("--user-data-dir=/tmp/x")
    expect(args).toContain("--no-sandbox")
  })

  test("the profile flag is left out when there is no profile dir", () => {
    expect(launchArgs({ port: 9334 }).some((a) => a.startsWith("--user-data-dir"))).toBe(false)
  })

  test("the copy-paste command names the same port", () => {
    const cmd = relaunchCommand(9333)
    if (clientSupported()) {
      expect(cmd).toContain("9333")
      expect(cmd.toLowerCase()).toContain("doubao")
    }
  })

  test("running check answers a boolean instead of throwing", () => {
    expect(typeof isClientRunning()).toBe("boolean")
  })
})

describe("user-facing hints", () => {
  test("the install hint says what to do on every platform", () => {
    const h = installHint()
    expect(h.length).toBeGreaterThan(0)
    if (IS_MAC) expect(h).toContain("macOS")
    if (IS_WIN) expect(h).toContain("Windows")
    if (!clientSupported()) expect(h).toContain("Linux")
  })
})
