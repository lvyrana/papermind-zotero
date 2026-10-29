// Synthetic transport at the provider boundary; exercise the real ai.js adapter.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export function requireBrowserPreflight() {
  const script = fileURLToPath(new URL('./browser_preflight.py', import.meta.url))
  const result = spawnSync('python3', [script], { encoding: 'utf8' })
  if (result.error || result.status !== 0) {
    throw new Error(`Browser tests unavailable: preflight failed. ${result.stderr || result.error || 'No result'}\nRerun in an ordinary terminal: cd papermind-zotero && npm run test:browser`)
  }
}

export const browserOptions = {
  headless: true,
  chromiumSandbox: true,
  ...(process.env.PAPERMIND_CHROMIUM_EXECUTABLE
    ? { executablePath: process.env.PAPERMIND_CHROMIUM_EXECUTABLE }
    : process.env.LITFINCH_BROWSER_CHANNEL ? { channel: process.env.LITFINCH_BROWSER_CHANNEL } : {}),
}

export async function installPersonalAI(page) {
  await page.route('**/*', route => route.abort())
  await page.evaluate(() => {
    const originalGet = Zotero.Prefs.get
    Zotero.Prefs.get = key => key === 'extensions.papermind.ai'
      ? JSON.stringify({ mode: 'api', base: 'https://synthetic-ai.example/v1', model: 'synthetic-model' })
      : originalGet(key)
    Services.logins = { findLogins: () => [{ password: 'synthetic-test-key' }] }
    window.__requests = []
    window.fetch = async (url, options) => {
      if (url !== 'https://synthetic-ai.example/v1/chat/completions') throw new Error('Unexpected test destination')
      const body = JSON.parse(options.body)
      window.__requests.push({ url, body, credentials: options.credentials, redirect: options.redirect })
      if (window.__failNextRequest) {
        window.__failNextRequest = false
        return { ok: false, status: 503 }
      }
      const content = window.__aiRespond(body.messages)
      return { ok: true, json: async () => ({ choices: [{ message: { content } }] }) }
    }
  })
  await page.addScriptTag({ path: fileURLToPath(new URL('../ai.js', import.meta.url)) })
  await page.evaluate(() => { PaperMind.ai = PaperMindAI })
}

export async function assertPersonalTransport(page) {
  const requests = await page.evaluate(() => window.__requests)
  assert.ok(requests.length > 0)
  for (const request of requests) {
    assert.equal(request.url, 'https://synthetic-ai.example/v1/chat/completions')
    assert.equal(request.body.model, 'synthetic-model')
    assert.equal(request.credentials, 'omit')
    assert.equal(request.redirect, 'error')
    assert.equal(request.body.messages[0].role, 'system')
  }
}
