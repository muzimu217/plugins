// The one-client-many-accounts rule: a claim may only run when the desktop
// client is signed in to the account asking for it.

import { describe, expect, test } from "bun:test"
import { checkClientAccount } from "./lib/account-guard.mjs"

describe("checkClientAccount", () => {
  test("the same uid may claim", () => {
    expect(checkClientAccount("2310548330121795", "2310548330121795").ok).toBe(true)
  })

  test("a different uid is refused, and names both accounts", () => {
    const v = checkClientAccount("111", "222")
    expect(v.ok).toBe(false)
    expect(v.code).toBe("client-account-mismatch")
    expect(v.message).toContain("111")
    expect(v.message).toContain("222")
  })

  test("an unknown uid on either side is not a mismatch", () => {
    // No evidence means no verdict: the sweep still reports an unreachable
    // client by itself, and blocking here would break single-account setups
    // whose client has not been read yet.
    expect(checkClientAccount("", "222").ok).toBe(true)
    expect(checkClientAccount("111", "").ok).toBe(true)
    expect(checkClientAccount(undefined, undefined).ok).toBe(true)
    expect(checkClientAccount(null, null).ok).toBe(true)
  })

  test("numeric and string uids compare by value", () => {
    expect(checkClientAccount(2310548330121795, "2310548330121795").ok).toBe(true)
  })

  test("whitespace around a uid does not create a false mismatch", () => {
    expect(checkClientAccount("  222  ", "222").ok).toBe(true)
  })

  test("the refusal says what to do and what still works", () => {
    const v = checkClientAccount("a", "b")
    expect(v.message).toContain("切换登录")
    expect(v.message).toContain("Cookie")
  })
})
