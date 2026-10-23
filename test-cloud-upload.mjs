import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const BASE = 'https://preview.example.test', ID = 'a'.repeat(32)
const bytes = new Uint8Array([37, 80, 68, 70, 45])
const reply = (body, status = 200) => new Response(JSON.stringify(body), { status })
const grant = (url = 'https://vercel.com/api/blob/?signature=synthetic') => reply({ upload_id: ID, upload_url: url })
function fixture(replies) {
  const context = vm.createContext({ URL, Zotero: { Prefs: { get() {} } } })
  vm.runInContext(fs.readFileSync(new URL('./bootstrap.js', import.meta.url), 'utf8'), context)
  const pm = context.PaperMind, calls = []
  let current = { base: BASE, uid: 'synthetic', token: 'synthetic-session' }
  const connection = current
  pm.connectionSnapshot = () => current
  const win = { URL, Blob, FormData, fetch: async (url, options) => {
    calls.push({ url, options })
    const result = replies.shift()
    return typeof result === 'function' ? result() : result
  } }
  return { pm, win, calls, connection, change: () => { current = { ...current, token: 'changed' } } }
}

test('cloud upload uses account only at the app and completes only after direct PUT', async () => {
  const f = fixture([reply({ mode: 'direct' }), grant(), reply({}), reply({ ok: true })])
  assert.equal((await f.pm.uploadPdf(f.win, 7, bytes, f.connection)).status, 200)
  assert.equal(f.calls.length, 4)
  const direct = f.calls[2]
  assert.equal(direct.options.method, 'PUT')
  assert.deepEqual(Object.keys(direct.options.headers), ['Content-Type'])
  assert.equal(direct.options.credentials, 'omit')
  assert.equal(direct.options.redirect, 'error')
  assert.equal(direct.options.referrerPolicy, 'no-referrer')
  assert.equal(f.calls[3].url, `${BASE}/api/library/7/pdf-upload/${ID}`)
  for (const index of [0, 1, 3]) assert.equal(f.calls[index].options.headers.Authorization, 'Bearer synthetic-session')
})

test('old server without capability route keeps multipart', async () => {
  const f = fixture([reply({}, 404), reply({ ok: true })])
  await f.pm.uploadPdf(f.win, 7, bytes, f.connection)
  assert.equal(f.calls[1].url, `${BASE}/api/library/7/pdf`)
  assert.ok(f.calls[1].options.body instanceof FormData)
})

for (const url of ['https://evil.example/api/blob/', 'https://vercel.com/other', 'https://user:secret@vercel.com/api/blob/']) {
  test(`reject unexpected signed endpoint ${new URL(url).hostname}`, async () => {
    const f = fixture([reply({ mode: 'direct' }), grant(url)])
    await assert.rejects(f.pm.uploadPdf(f.win, 7, bytes, f.connection), /许可无效/)
    assert.equal(f.calls.length, 2)
  })
}

test('cloud errors do not fall back to multipart or declare a saved PDF', async () => {
  for (const replies of [[reply({}, 503)], [reply({ mode: 'direct' }), grant(), reply({}, 403)]]) {
    const expected = replies.length, f = fixture(replies)
    await assert.rejects(f.pm.uploadPdf(f.win, 7, bytes, f.connection), /失败/)
    assert.equal(f.calls.length, expected)
    assert.ok(f.calls.every(call => !call.url.endsWith('/pdf')))
  }
})

test('direct transport exceptions cannot leak signed URLs to logs', async () => {
  const f = fixture([reply({ mode: 'direct' }), grant(), () => { throw Error('https://vercel.com/api/blob/?signature=SECRET') }])
  await assert.rejects(f.pm.uploadPdf(f.win, 7, bytes, f.connection), error => /直传连接失败/.test(error.message) && !error.message.includes('SECRET'))
})

test('cloud uploads require an account and reject oversized files before network', async () => {
  const f = fixture([reply({ mode: 'direct' })])
  f.connection.token = ''
  await assert.rejects(f.pm.uploadPdf(f.win, 7, bytes, f.connection), /登录研雀账号/)
  assert.equal(f.calls.length, 1)
  const oversized = fixture([])
  await assert.rejects(oversized.pm.uploadPdf(oversized.win, 7, new Uint8Array(50 * 1024 * 1024 + 1), oversized.connection), /50MB/)
  assert.equal(oversized.calls.length, 0)
})

for (const phase of ['config', 'grant', 'put']) {
  test(`connection changes during ${phase} stop later requests`, async () => {
    const replies = [reply({ mode: 'direct' }), grant(), reply({}), reply({ ok: true })]
    const f = fixture(replies), index = ['config', 'grant', 'put'].indexOf(phase)
    const original = replies[index]
    replies[index] = () => { f.change(); return original }
    await assert.rejects(f.pm.uploadPdf(f.win, 7, bytes, f.connection), /本次导入已停止/)
    assert.equal(f.calls.length, index + 1)
  })
}
