import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import { webcrypto } from 'node:crypto'

const BASE = 'https://papermindapp.com'
const UID = '11111111-1111-4111-8111-111111111111'
const ACCOUNT = '22222222-2222-4222-8222-222222222222'
const LOGIN = { token: 'synthetic-session', expires_in: 100, account: { id: ACCOUNT, data_uid: UID, username: 'Reader' } }

function fixture() {
  const prefs = new Map([['extensions.papermind.uid', UID], ['extensions.papermind.configVersion', 3]])
  const logins = [], requests = [], urls = [], timers = new Map()
  let serial = 0, handler = () => ({ pending: true })
  const win = { URL, AbortController, crypto: webcrypto,
    setTimeout: fn => { timers.set(++serial, fn); return serial }, clearTimeout: id => timers.delete(id),
    fetch: async (url, options) => { requests.push({ url, options }); const data = await handler(url, options)
      return { ok: true, json: async () => data } } }
  const sandbox = { URL, Components: {
    interfaces: { nsILoginInfo: {} },
    Constructor: function () { return function (hostname, _, realm, username, password) {
      Object.assign(this, { hostname, realm, username, password })
    } },
  }, Services: { prompt: {}, logins: {
    findLogins: (base, _, realm) => logins.filter(x => x.hostname === base && x.realm === realm),
    addLoginAsync: async info => logins.push(info),
    modifyLogin: (old, next) => logins.splice(logins.indexOf(old), 1, next),
    removeLogin: login => logins.splice(logins.indexOf(login), 1),
  } }, Zotero: { Prefs: { get: key => prefs.get(key), set: (key, value) => prefs.set(key, value) },
    debug() {}, getMainWindows: () => [], launchURL: url => urls.push(url) } }
  vm.createContext(sandbox)
  for (const file of ['bootstrap.js', 'account.js']) vm.runInContext(fs.readFileSync(new URL(file, import.meta.url), 'utf8'), sandbox)
  const pm = sandbox.PaperMind, account = sandbox.PaperMindAccount
  pm.account = account
  return { pm, account, prefs, logins, requests, urls, timers, win, setHandler: fn => { handler = fn },
    device: () => ({ secret: 's'.repeat(40), user_code: 'ABCDEF123456', expires_in: 600,
      verification_url: BASE + '/settings?device=ABCDEF123456' }) }
}

test('device login stores the session in Login Manager, not prefs or browser URL', async () => {
  const f = fixture()
  f.setHandler(url => url.endsWith('/device/start') ? f.device() : LOGIN)
  await f.account.start(f.win)
  assert.equal(f.urls.length, 1)
  assert.ok(!f.urls[0].includes('s'.repeat(40)))
  await f.account.poll()
  assert.equal(f.logins.length, 1)
  assert.equal(f.account.record().token, LOGIN.token)
  assert.ok(!JSON.stringify([...f.prefs]).includes(LOGIN.token))
  assert.equal(f.pm.requestHeaders({ Authorization: 'forged' }).Authorization, 'Bearer ' + LOGIN.token)
  assert.equal(f.pm.buildReadingUrl(BASE, 7, UID), BASE + '/paper/7?library=1')
  f.account.cached.clear()
  assert.equal(f.account.record().account.id, ACCOUNT)
  assert.ok(f.requests.every(x => x.options.credentials === 'omit'))
})

test('logout revokes session then separates guest space while preserving original UID in account', async () => {
  const f = fixture()
  await f.account.save(BASE, LOGIN)
  await f.account.logout(f.win)
  assert.equal(f.logins.length, 0)
  assert.notEqual(f.pm.getUid(), UID)
  assert.equal(f.pm.isConfigured(), false)
  assert.equal(f.pm.migrateLegacyConfig(), false)
  assert.equal(f.requests.at(-1).options.headers.Authorization, 'Bearer ' + LOGIN.token)
  await f.account.save(BASE, LOGIN)
  assert.equal(f.pm.getUid(), UID)
})

test('failed remote logout keeps usable credentials and local identity', async () => {
  const f = fixture()
  await f.account.save(BASE, LOGIN)
  f.setHandler(() => { throw Error('offline') })
  await assert.rejects(f.account.logout(f.win), /offline/)
  assert.equal(f.pm.getUid(), UID)
  assert.equal(f.logins.length, 1)
})

test('cancel during poll revokes late-issued token without saving it', async () => {
  const f = fixture()
  let finish
  f.setHandler(url => url.endsWith('/device/start') ? f.device()
    : url.endsWith('/device/poll') ? new Promise(resolve => { finish = resolve }) : {})
  await f.account.start(f.win)
  const poll = f.account.poll()
  await f.account.cancel()
  finish(LOGIN); await poll
  assert.equal(f.logins.length, 0)
  assert.ok(f.requests.some(x => x.url.endsWith('/logout')))
})

test('cancel while credential save is yielding cannot resurrect the account', async () => {
  const f = fixture()
  f.setHandler(url => url.endsWith('/device/start') ? f.device() : LOGIN)
  let finish
  const save = f.account.save.bind(f.account)
  f.account.save = async (...args) => { await new Promise(resolve => { finish = resolve }); await save(...args) }
  await f.account.start(f.win)
  const poll = f.account.poll()
  while (!finish) await Promise.resolve()
  await f.account.cancel(); finish(); await poll
  assert.equal(f.logins.length, 0)
  assert.equal(f.account.record(), null)
})

test('invalid verification origin is rejected and repeated starts do not open duplicate flows', async () => {
  const f = fixture()
  f.setHandler(() => ({ ...f.device(), verification_url: 'https://evil.test/settings?device=ABCDEF123456' }))
  await f.account.start(f.win)
  assert.equal(f.urls.length, 0)
  assert.match(f.account.status, /地址无效/)
  let finish
  f.setHandler(() => new Promise(resolve => { finish = resolve }))
  const first = f.account.start(f.win)
  await f.account.start(f.win)
  finish(f.device()); await first
  assert.equal(f.urls.length, 1)
})
