// One client, many accounts.
//
// magpie keys accounts as `doubao` / `doubao#xxxxxx`, and this plugin's usage
// and chat are per-account because each carries its own cookie. Claiming is
// different: it drives the *desktop client*, and that client is signed in to
// exactly one account at a time. Clicking "立即领取" while the client is on
// account B, for a check-in asked on behalf of account A, credits B — the
// wrong person, silently.
//
// So a claim is only attempted when the client's uid matches the account's. An
// unknown uid on either side is not a mismatch: the caller has no evidence to
// act on, and the sweep reports "client unreachable" on its own.

/**
 * @param {string} clientUid  the uid read from the running client, "" if unknown
 * @param {string} accountUid the uid of the account asking to check in
 * @returns {{ok:true}|{ok:false, code:"client-account-mismatch", message:string}}
 */
export function checkClientAccount(clientUid, accountUid) {
  const c = String(clientUid ?? "").trim()
  const a = String(accountUid ?? "").trim()
  if (!c || !a) return { ok: true }
  if (c === a) return { ok: true }
  return {
    ok: false,
    code: "client-account-mismatch",
    message:
      `豆包客户端当前登录的是另一个账号（uid ${c}），不是这个账号（uid ${a}）。` +
      `签到必须由客户端里已登录的那个账号发起，所以请先在客户端切换登录，再让插件签到这个账号。` +
      `（读余额、对话不受影响：每个账号用的是自己的 Cookie。）`,
  }
}
