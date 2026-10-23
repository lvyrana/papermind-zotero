// Live synthetic preview test of the actual Connector upload method.
// This exercises HTTP transport in Node, not Zotero's native fetch or UI.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createHash } from 'node:crypto'

const base = process.env.PAPERMIND_TEST_URL, paper = Number(process.env.PAPERMIND_TEST_PAPER)
assert.match(base, /^https:\/\/litfinch-migration-preview-[a-z0-9]+-lvyranas-projects\.vercel\.app$/)
assert.ok(paper > 0 && process.env.VERCEL_OIDC_TOKEN && process.env.PAPERMIND_TEST_SESSION)
const bytes = fs.readFileSync(0)
assert.ok(bytes.length > 4.5 * 1024 * 1024 && bytes.length < 50 * 1024 * 1024)
assert.equal(bytes.subarray(0, 5).toString(), '%PDF-')
const digest = createHash('sha256').update(bytes).digest('hex')
const connection = { base, uid: process.env.PAPERMIND_TEST_UID, token: process.env.PAPERMIND_TEST_SESSION }
const context = vm.createContext({ URL, Zotero: { Prefs: { get() {} } } })
vm.runInContext(fs.readFileSync(new URL('../bootstrap.js', import.meta.url), 'utf8'), context)
const pm = context.PaperMind
pm.connectionSnapshot = () => connection
const calls = []
const win = { URL, Blob, FormData, fetch: async (url, options) => {
  const parsed = new URL(url), own = parsed.origin === base
  if (!own) {
    assert.equal(parsed.origin + parsed.pathname, 'https://vercel.com/api/blob/')
    assert.deepEqual(Object.keys(options.headers), ['Content-Type'])
    assert.equal(options.credentials, 'omit')
  }
  const response = await fetch(url, { ...options,
    headers: { ...options.headers, ...(own ? { 'x-vercel-trusted-oidc-idp-token': process.env.VERCEL_OIDC_TOKEN } : {}) },
    signal: AbortSignal.timeout(120000),
  })
  calls.push({ path: parsed.pathname, status: response.status })
  console.log(JSON.stringify({ stage: 'connector_request', path: parsed.pathname, status: response.status }))
  return response
} }
try {
  const completed = await pm.uploadPdf(win, paper, bytes, connection)
  assert.equal((await completed.json()).sha256, digest)
  const response = await fetch(`${base}/api/library/${paper}/pdf`, {
    headers: { Authorization: 'Bearer ' + connection.token, 'x-vercel-trusted-oidc-idp-token': process.env.VERCEL_OIDC_TOKEN },
    redirect: 'error', signal: AbortSignal.timeout(90000),
  })
  assert.equal(response.status, 200)
  const downloaded = Buffer.from(await response.arrayBuffer())
  assert.equal(createHash('sha256').update(downloaded).digest('hex'), digest)
  console.log(JSON.stringify({ ok: true, paper_id: paper, bytes: bytes.length, sha256: digest,
    native_zotero_verified: false, checks: ['actual_connector_method_direct_upload', 'completion_hash', 'fresh_cloud_read_hash'] }))
} catch (error) {
  // Never print transport errors: they can include signed URLs or headers.
  console.log(JSON.stringify({ ok: false, error_type: error.name, calls }))
  process.exitCode = 1
}
