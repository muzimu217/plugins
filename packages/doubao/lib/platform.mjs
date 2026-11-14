// Where the Doubao desktop client lives, how to start it, how to stop it, and
// what to tell the user — per platform, in one place.
//
// The plugin used to hardcode /Applications/Doubao.app in four files. That is
// correct on macOS and wrong everywhere else, so a Windows user got
// "not installed" no matter what they had. Everything platform-specific now
// answers from here.
//
// Doubao ships a desktop client for macOS and Windows only; there is no Linux
// build. On Linux this module says so plainly instead of pretending a path
// might exist, and the plugin falls back to the cookie sign-in.

import { homedir } from "node:os"
import { join } from "node:path"
import { existsSync } from "node:fs"
import { execSync } from "node:child_process"

export const PLATFORM = process.platform
export const IS_MAC = PLATFORM === "darwin"
export const IS_WIN = PLATFORM === "win32"
export const IS_LINUX = PLATFORM === "linux"

export const PLATFORM_NAME = IS_MAC ? "macOS" : IS_WIN ? "Windows" : IS_LINUX ? "Linux" : PLATFORM

/** Whether Doubao publishes a desktop client for this platform. */
export function clientSupported() {
  return IS_MAC || IS_WIN
}

/** Where the app bundle/directory may be, most likely first. */
export function appCandidates() {
  if (IS_MAC) {
    return [
      "/Applications/Doubao.app",
      join(homedir(), "Applications/Doubao.app"),
    ]
  }
  if (IS_WIN) {
    const local = process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local")
    return [
      join(local, "Doubao", "Application", "app"),
      join(local, "Programs", "Doubao", "Application", "app"),
    ]
  }
  return []
}

/** The app path that exists, else the first candidate (so messages can name it). */
export function appPath() {
  const candidates = appCandidates()
  return candidates.find((p) => existsSync(p)) ?? candidates[0] ?? ""
}

/** The executable to spawn, or "" when nothing is installed. */
export function binaryPath() {
  if (IS_MAC) {
    for (const app of appCandidates()) {
      const bin = join(app, "Contents", "MacOS", "Doubao")
      if (existsSync(bin)) return bin
    }
    return ""
  }
  if (IS_WIN) {
    for (const dir of appCandidates()) {
      for (const exe of ["Doubao.exe", "DoubaoWork.exe"]) {
        const bin = join(dir, exe)
        if (existsSync(bin)) return bin
      }
    }
    return ""
  }
  return ""
}

/** The client's own profile directory (its cookies live there). */
export function userDataDir() {
  if (IS_MAC) return join(homedir(), "Library", "Application Support", "Doubao")
  if (IS_WIN) {
    const local = process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local")
    return join(local, "Doubao")
  }
  return ""
}

/** The process name the OS lists for the client. */
export function processName() {
  return IS_WIN ? "Doubao.exe" : "Doubao"
}

/** Launch flags, identical across platforms (Chromium on both). */
export function launchArgs({ port, udd } = {}) {
  return [
    `--remote-debugging-port=${port}`,
    ...(udd ? [`--user-data-dir=${udd}`] : []),
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--no-proxy-server",
  ]
}

/** The command a user can paste themselves, in their own shell. */
export function relaunchCommand(port) {
  if (IS_MAC) return `open -a Doubao --args --remote-debugging-port=${port}`
  if (IS_WIN) {
    const bin = binaryPath() || "%LOCALAPPDATA%\\Doubao\\Application\\app\\Doubao.exe"
    return `"${bin}" --remote-debugging-port=${port}`
  }
  return ""
}

/**
 * Whether the client process is up. `pgrep` on macOS/Linux, `tasklist` on
 * Windows. Both are stdlib commands, no dependency.
 */
export function isClientRunning() {
  try {
    if (IS_WIN) {
      const out = execSync(`tasklist /FI "IMAGENAME eq ${processName()}" /NH`, {
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 5000,
      })
      const text = out.toString()
      return /Doubao(Work)?\.exe/i.test(text) && !/no tasks|没有运行/i.test(text)
    }
    const pattern = IS_MAC ? "Doubao.app/Contents/MacOS/Doubao" : "Doubao"
    const out = execSync(`pgrep -f '${pattern}'`, { stdio: ["ignore", "pipe", "ignore"], timeout: 5000 })
    return out.toString().trim().length > 0
  } catch {
    return false
  }
}

/** Ask the client to quit, the way a user would. */
export function quitClient() {
  try {
    if (IS_MAC) {
      execSync(`osascript -e 'quit app "Doubao"'`, { stdio: "ignore", timeout: 6000 })
      return true
    }
    if (IS_WIN) {
      execSync(`taskkill /IM ${processName()} /T`, { stdio: "ignore", timeout: 8000 })
      return true
    }
  } catch {}
  return false
}

/** Force it down when a polite quit did not take. */
export function killClient() {
  try {
    if (IS_MAC) {
      execSync(`pkill -9 -f 'Doubao.app/Contents/MacOS/Doubao'`, { stdio: "ignore", timeout: 4000 })
      return true
    }
    if (IS_WIN) {
      execSync(`taskkill /F /IM ${processName()} /T`, { stdio: "ignore", timeout: 8000 })
      return true
    }
  } catch {}
  return false
}

/** Only macOS can install from the .dmg it already downloaded. */
export function supportsAutoInstall() {
  return IS_MAC
}

/** What to tell a user who has no client yet. */
export function installHint() {
  if (IS_MAC) return "请从 https://www.doubao.com/download/desktop 下载 macOS 版并安装"
  if (IS_WIN) return "请从 https://www.doubao.com/download/desktop 下载 Windows 版并安装"
  return "豆包没有 Linux 桌面客户端；请改用网页登录的 Cookie 方式添加账号"
}
