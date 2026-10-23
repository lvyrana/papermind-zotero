import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const UID = '11111111-1111-4111-8111-111111111111'
const NEXT_UID = '22222222-2222-4222-8222-222222222222'
const BASE = 'https://first.example.test'

function fixture() {
  const prefs = new Map([
    ['extensions.papermind.baseURL', BASE],
    ['extensions.papermind.uid', UID],
    ['extensions.papermind.configVersion', 3],
  ])
  const requests = [], urls = [], alerts = []
  const sandbox = { URL, Components: {}, Services: { prompt: { alert: (...args) => alerts.push(args.at(-1)) } },
    Zotero: { Prefs: { get: key => prefs.get(key), set: (key, value) => prefs.set(key, value) },
      debug() {}, getMainWindows: () => [], launchURL: url => urls.push(url) } }
  vm.createContext(sandbox)
  for (const file of ['bootstrap.js', 'account.js']) {
    vm.runInContext(fs.readFileSync(new URL(file, import.meta.url), 'utf8'), sandbox)
  }
  const item = { isAttachment: () => false, isRegularItem: () => true,
    getCreators: () => [], getField: field => field === 'title' ? 'Synthetic paper' : '',
    getBestAttachment: async () => ({ attachmentContentType: 'application/pdf', getFilePathAsync: async () => '/synthetic.pdf' }) }
  const win = { URL, AbortController, setTimeout, clearTimeout, FormData, Blob, crypto: { randomUUID: () => NEXT_UID },
    ZoteroPane: { getSelectedItems: () => [item] }, IOUtils: { read: async () => new Uint8Array([37, 80, 68, 70, 45]) },
    fetch: async (url, options) => { requests.push({ url, options }); return { ok: true, status: 200, json: async () => url.endsWith('/file-storage') ? { mode: 'server' } : { id: 7 } } } }
  sandbox.Zotero.getActiveZoteroPane = () => win.ZoteroPane
  return { pm: sandbox.PaperMind, account: sandbox.PaperMindAccount, services: sandbox.Services, prefs, requests, urls, alerts, item, win }
}

test('remote HTTP links and deceptive loopback names are rejected', () => {
  const f = fixture()
  for (const base of ['http://example.test', 'http://192.168.1.20', 'http://localhost.example.test',
    'http://127.0.0.1.example.test', 'ftp://localhost', 'https://user:password@example.test']) {
    assert.throws(() => f.pm.parsePersonalLink(f.win, `${base}/?uid=${UID}`))
  }
})

test('HTTPS self-hosting and explicit loopback HTTP remain usable', () => {
  const f = fixture()
  for (const base of ['https://selfhost.example.test', 'http://localhost:8000', 'http://127.0.0.1:8000',
    'http://[::1]:8000', 'http://127.1:8000']) {
    assert.equal(f.pm.parsePersonalLink(f.win, `${base}/?uid=${UID}`).base, new URL(base).origin)
  }
})

test('unsafe stored preferences remain editable but cannot send an import or auth request', async () => {
  const f = fixture()
  f.prefs.set(f.pm.PREF_BASE, 'http://remote.example.test')
  assert.equal(f.pm.getBaseURL(), 'http://remote.example.test')
  await f.pm.openSelected(f.win)
  await assert.rejects(f.account.request(f.win, f.pm.getBaseURL(), 'device/start', {}), /HTTPS/)
  assert.equal(f.requests.length, 0)
  assert.equal(f.urls.length, 0)
  assert.ok(f.alerts.some(message => message.includes('HTTPS')))
  assert.throws(() => f.pm.requestHeaders(), /HTTPS/)
  await f.account.start(f.win)
  assert.equal(f.account.starting, false)
  assert.match(f.account.status, /HTTPS/)
  assert.equal(f.requests.length, 0)
})

for (const phase of ['metadata', 'attachment', 'upload']) {
  for (const change of ['origin', 'uid', 'token']) {
    test(`connection ${change} change during ${phase} stops stale upload and navigation`, async () => {
      const f = fixture()
      let account = change === 'token' ? { token: 'synthetic-before', account: { data_uid: UID } } : null
      f.pm.account = { record: () => account }
      const switchConnection = () => {
        if (change === 'origin') f.prefs.set(f.pm.PREF_BASE, 'https://second.example.test')
        if (change === 'uid') f.prefs.set(f.pm.PREF_UID, NEXT_UID)
        if (change === 'token') account = { token: 'synthetic-after', account: { data_uid: UID } }
      }
      f.win.fetch = async (url, options) => {
        f.requests.push({ url, options })
        if (phase === 'upload' && url.endsWith('/pdf')) switchConnection()
        return { ok: true, status: 200, json: async () => {
          if (phase === 'metadata') switchConnection()
          return url.endsWith('/file-storage') ? { mode: 'server' } : { id: 7 }
        } }
      }
      f.win.IOUtils.read = async () => {
        if (phase === 'attachment') switchConnection()
        return new Uint8Array([37, 80, 68, 70, 45])
      }
      await f.pm.openSelected(f.win)
      assert.equal(f.requests.length, phase === 'upload' ? 3 : 1)
      for (const { options } of f.requests) {
        assert.equal(options.headers['X-User-ID'], UID)
        assert.notEqual(options.headers.Authorization, 'Bearer synthetic-after')
      }
      assert.equal(f.urls.length, 0)
      assert.ok(f.alerts.some(message => message.includes('本次导入已停止')))
    })
  }
}

test('ordinary import and PDF-error fallback keep the same connection credentials', async () => {
  for (const pdfError of [false, true]) {
    const f = fixture()
    if (pdfError) f.win.IOUtils.read = async () => { throw new Error('Synthetic attachment read failure') }
    await f.pm.openSelected(f.win)
    assert.equal(f.requests.length, pdfError ? 1 : 3)
    assert.equal(f.urls.length, 1)
    assert.equal(f.urls[0], `${BASE}/paper/7?library=1&uid=${UID}`)
    for (const { options } of f.requests) {
      assert.equal(options.redirect, 'error')
      assert.equal(options.credentials, 'omit')
      assert.equal(options.headers['X-User-ID'], UID)
    }
    assert.equal(f.alerts.length, pdfError ? 1 : 0)
    if (pdfError) assert.match(f.alerts[0], /文献信息已保存，PDF 未上传/)
  }
})

test('unchanged account import uses its captured token and keeps credentials out of the browser URL', async () => {
  const f = fixture()
  f.pm.account = { record: () => ({ token: 'synthetic-account-session', account: { data_uid: UID } }) }
  await f.pm.openSelected(f.win)
  assert.equal(f.requests.length, 3)
  assert.deepEqual(f.urls, [`${BASE}/paper/7?library=1`])
  for (const { options } of f.requests) assert.equal(options.headers.Authorization, 'Bearer synthetic-account-session')
  assert.deepEqual(f.alerts, [])
})

for (const confirmed of [false, true]) {
  test(`unsafe saved account can ${confirmed ? 'disconnect locally after confirmation' : 'decline local disconnect without losing credentials'}`, async () => {
    const f = fixture(), unsafeBase = 'http://remote.example.test', confirmations = [], removed = []
    const record = { token: 'synthetic-old-http-session', account: { data_uid: UID } }
    f.prefs.set(f.pm.PREF_BASE, unsafeBase)
    f.pm.account = f.account
    f.account.cached.set(unsafeBase, record)
    f.services.logins = { findLogins: () => [record], removeLogin: login => removed.push(login) }
    f.services.prompt.confirm = (...args) => { confirmations.push(args.at(-1)); return confirmed }
    await f.account.logout(f.win)
    assert.equal(f.requests.length, 0)
    assert.equal(confirmations.length, 1)
    assert.match(confirmations[0], /远端会话.*未撤销/)
    assert.equal(removed.length, confirmed ? 1 : 0)
    assert.equal(f.account.record(unsafeBase), confirmed ? null : record)
    assert.equal(f.pm.getUid(), confirmed ? NEXT_UID : UID)
    if (confirmed) {
      let prompts = 0
      f.services.prompt.prompt = () => { prompts++; return false }
      await f.pm.promptSettings(f.win)
      assert.equal(prompts, 1)
      assert.match(f.account.status, /远端会话未撤销/)
    }
  })
}
