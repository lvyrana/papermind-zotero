import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

function fixture() {
  const prefs = new Map(), logins = [], requests = []
  const ctx = vm.createContext({ URL, PaperMind: {},
    Zotero: { Prefs: { get: key => prefs.get(key), set: (key, value) => prefs.set(key, value) } },
    Services: { logins: {
      findLogins: (base, _, realm) => logins.filter(x => x.hostname === base && x.httpRealm === realm),
      addLoginAsync: async value => logins.push(value), modifyLogin: (old, value) => logins.splice(logins.indexOf(old), 1, value),
      removeLogin: value => logins.splice(logins.indexOf(value), 1),
    } },
    Components: { interfaces: {}, Constructor: function () { return function (hostname, _, httpRealm, username, password) { Object.assign(this, { hostname, httpRealm, username, password }) } } },
  })
  vm.runInContext(fs.readFileSync(new URL('ai.js', import.meta.url), 'utf8'), ctx)
  const ai = ctx.PaperMindAI
  const win = { URL, AbortController, setTimeout, clearTimeout, fetch: async (url, options) => {
    requests.push({ url, ...options }); return { ok: true, json: async () => ({ choices: [{ message: { content: 'Synthetic answer' } }] }) }
  } }
  return { ai, ctx, prefs, logins, requests, win }
}

test('unconfigured AI fails closed with no maintainer fallback or network', async () => {
  const f = fixture()
  await assert.rejects(f.ai.request(f.win, '/api/chat', { message: 'Explain' }), /公共 AI 已关闭/)
  assert.equal(f.requests.length, 0)
})

test('personal API uses only the selected endpoint and its own key; preferences have no key', async () => {
  const f = fixture()
  await f.ai.save({ mode: 'api', base: 'https://provider.example/v1/', model: 'my-model' }, 'synthetic-personal-key')
  assert.doesNotMatch([...f.prefs.values()].join(), /synthetic-personal-key/)
  const result = await f.ai.request(f.win, '/api/chat', { message: 'Explain', paper_title: 'Synthetic paper' })
  assert.equal(result.reply, 'Synthetic answer')
  assert.equal(f.requests.length, 1)
  assert.equal(f.requests[0].url, 'https://provider.example/v1/chat/completions')
  assert.deepEqual(Object.keys(f.requests[0].headers).sort(), ['Authorization', 'Content-Type'])
  assert.equal(f.requests[0].headers.Authorization, 'Bearer synthetic-personal-key')
  assert.equal(f.requests[0].redirect, 'error'); assert.equal(f.requests[0].credentials, 'omit')
  await assert.rejects(f.ai.save({ mode: 'api', base: 'https://another.example/v1', model: 'other' }), /密钥/)
  assert.equal(f.ai.config().base, 'https://provider.example/v1')
  await f.ai.forgetKey()
  await assert.rejects(f.ai.request(f.win, '/api/chat', {}), /密钥/)
  assert.equal(f.requests.length, 1)
})

test('API settings reject remote plaintext, embedded credentials, query and fragment', () => {
  const { ai } = fixture()
  for (const url of ['http://provider.example/v1', 'https://user:password@example.com', 'https://example.com?key=abc', 'https://example.com/#x']) assert.throws(() => ai.base(url))
  assert.equal(ai.base('http://127.0.0.1:1234/v1'), 'http://127.0.0.1:1234/v1')
})

test('provider refusal is bounded, does not echo credentials and never switches provider', async () => {
  const f = fixture(); await f.ai.save({ mode: 'api', base: 'https://provider.example/v1', model: 'test' }, 'secret')
  f.win.fetch = async () => { f.requests.push(1); return { ok: false, status: 429, text: async () => 'secret' } }
  await assert.rejects(f.ai.request(f.win, '/api/chat', {}), error => /429/.test(error.message) && !/secret/.test(error.message))
  assert.equal(f.requests.length, 1)
})

test('provider configuration changes discard in-flight output', async () => {
  const f = fixture(); await f.ai.save({ mode: 'api', base: 'https://provider.example/v1', model: 'test' }, 'secret')
  let finish
  f.win.fetch = () => new Promise(resolve => { finish = resolve })
  const pending = f.ai.request(f.win, '/api/chat', {})
  await f.ai.save({ mode: 'none' })
  finish({ ok: true, json: async () => ({ choices: [{ message: { content: 'stale' } }] }) })
  await assert.rejects(pending, /连接已改变/)
})

test('Codex protocol rejects server tool and approval requests', async () => {
  const ctx = vm.createContext({ PaperMind: { ai: {} }, Zotero: {}, Services: {} })
  vm.runInContext(fs.readFileSync(new URL('codex.js', import.meta.url), 'utf8'), ctx)
  const bridge = ctx.PaperMindCodex, sent = []
  bridge.send = async value => sent.push(value)
  await bridge.receive({ id: 1, method: 'item/commandExecution/requestApproval', params: {} })
  assert.equal(sent[0].error.code, -32601)
  assert.match(bridge.configuration(), /forced_login_method = "chatgpt"/)
  assert.match(bridge.configuration(), /":root" = "deny"/)
  assert.match(bridge.configuration(), /shell_tool = false/)
  assert.match(bridge.configuration(), /history]\npersistence = "none"/)
})
