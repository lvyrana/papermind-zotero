import { requireBrowserPreflight, browserOptions } from './browser-fixture.mjs'
const { chromium } = await import(process.env.PAPERMIND_PLAYWRIGHT_MODULE || 'playwright')
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
const artifacts = await mkdtemp(join(tmpdir(), 'litfinch-personal-ai-ui-'))
requireBrowserPreflight()
const browser = await chromium.launch(browserOptions)
try {
  const page = await browser.newPage({ viewport: { width: 500, height: 900 } })
  page.setDefaultTimeout(5000)
  await page.route('**/*', route => route.abort())
  await page.goto('about:blank')
  await page.setContent('<main id="settings" style="font:15px system-ui;line-height:1.6;padding:20px"></main>')
  await page.evaluate(() => {
    const prefs = window.__prefs = new Map(), logins = window.__logins = [], requests = window.__requests = []
    window.PaperMind = { codex: { stop: async () => {}, models: async () => [{ model: 'synthetic-codex' }] } }
    window.Zotero = { Prefs: { get: key => prefs.get(key), set: (key, value) => prefs.set(key, value) } }
    window.Services = { logins: { findLogins: base => logins.filter(x => x.hostname === base), addLoginAsync: async entry => logins.push(entry), modifyLogin: (old, entry) => logins.splice(logins.indexOf(old), 1, entry), removeLogin: entry => logins.splice(logins.indexOf(entry), 1) } }
    window.Components = { interfaces: {}, Constructor: function () { return function (hostname, _, realm, username, password) { Object.assign(this, { hostname, password }) } } }
    window.__modelMode = 'ok'
    window.fetch = async (url, options) => {
      requests.push({ url, options })
      if (!url.endsWith('/models')) return { ok: true, json: async () => ({ choices: [{ message: { content: 'Synthetic answer' } }] }) }
      if (__modelMode === 'error') return { ok: false, status: 503 }
      if (__modelMode === 'pending') return new Promise(resolve => { window.__finishModels = resolve })
      return { ok: true, json: async () => ({ data: __modelMode === 'empty' ? [] : [{ id: 'synthetic-reader' }, { id: 'synthetic-translator' }] }) }
    }
    window.__render = () => {
      const root = document.querySelector('main'); root.replaceChildren()
      const el = (tag, text, parent) => { const node = document.createElement(tag); if (text) node.textContent = text; parent.append(node); return node }
      const button = (parent, text, fn) => { const node = el('button', text, parent); node.style.margin = '8px'; node.onclick = fn }
      PaperMindAI.render(window, root, el, button, __render)
    }
  })
  await page.addScriptTag({ path: fileURLToPath(new URL('../ai.js', import.meta.url)) })
  await page.evaluate(() => __render())
  await page.getByLabel('连接方式').selectOption('api')
  await page.getByLabel('API 基础地址', { exact: false }).fill('https://synthetic-ai.example/v1')
  await page.getByLabel('个人 API 密钥', { exact: false }).fill('synthetic-test-key')
  await page.getByRole('button', { name: '获取可用模型', exact: true }).click()
  await page.getByText('已获取 2 个模型；分别选择后保存连接。', { exact: true }).waitFor()
  assert.equal(await page.evaluate(() => __prefs.size), 0)
  assert.equal(await page.evaluate(() => __logins.length), 0)
  await page.getByLabel('从列表选择精读模型', { exact: true }).selectOption('synthetic-reader')
  await page.getByLabel('从列表选择翻译模型', { exact: true }).selectOption('synthetic-translator')
  await page.screenshot({ path: join(artifacts, 'model-picker-selected.png'), fullPage: true })
  await page.getByRole('button', { name: '检查连接', exact: true }).click()
  await page.getByText('连接成功，模型列表包含精读和翻译模型；尚未测试生成。', { exact: true }).waitFor()
  assert.equal(await page.evaluate(() => __requests.length), 2)
  assert.equal(await page.evaluate(() => [...__prefs.values()].join().includes('synthetic-test-key')), false)
  assert.equal(await page.getByLabel('个人 API 密钥', { exact: false }).inputValue(), '')
  assert.equal(await page.getByLabel('精读模型', { exact: true }).inputValue(), 'synthetic-reader')
  assert.equal(await page.getByLabel('翻译模型（留空使用精读模型）', { exact: true }).inputValue(), 'synthetic-translator')
  await page.screenshot({ path: join(artifacts, 'personal-api-settings.png') })
  await page.evaluate(async () => {
    await PaperMindAI.request(window, '/api/translate', { text: 'Original sentence' })
    await PaperMindAI.request(window, '/api/chat', { message: 'Explain the sentence' })
  })
  assert.deepEqual(await page.evaluate(() => __requests.filter(x => x.options.body).map(x => JSON.parse(x.options.body).model)), ['synthetic-translator', 'synthetic-reader'])
  // Discovery failure and stale requests must not erase drafts or import a previous service's choices.
  await page.getByLabel('精读模型', { exact: true }).fill('manual-reader')
  await page.evaluate(() => { __modelMode = 'error' })
  await page.getByRole('button', { name: '获取可用模型', exact: true }).click()
  await page.getByText('获取模型失败，已保留当前输入。', { exact: false }).waitFor()
  assert.equal(await page.getByLabel('精读模型', { exact: true }).inputValue(), 'manual-reader')
  assert.equal(await page.getByLabel('翻译模型（留空使用精读模型）', { exact: true }).inputValue(), 'synthetic-translator')
  await page.evaluate(() => { __modelMode = 'empty' })
  await page.getByRole('button', { name: '获取可用模型', exact: true }).click()
  await page.getByText('服务返回的模型列表为空，已保留当前输入，可手动填写。', { exact: true }).waitFor()
  assert.equal(await page.getByLabel('精读模型', { exact: true }).inputValue(), 'manual-reader')
  await page.evaluate(() => { __modelMode = 'pending' })
  await page.getByRole('button', { name: '获取可用模型', exact: true }).click()
  await page.waitForFunction(() => typeof __finishModels === 'function')
  await page.getByLabel('API 基础地址', { exact: false }).fill('https://changed-service.example/v1')
  await page.evaluate(() => __finishModels({ ok: true, json: async () => ({ data: [{ id: 'stale-service-model' }] }) }))
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  assert.equal(await page.getByLabel('从列表选择精读模型', { exact: true }).isDisabled(), true)
  assert.equal(await page.getByLabel('从列表选择精读模型', { exact: true }).locator('option').count(), 1)
  assert.equal(await page.getByLabel('精读模型', { exact: true }).inputValue(), 'manual-reader')
  await page.getByLabel('API 基础地址', { exact: false }).fill('https://synthetic-ai.example/v1')
  await page.evaluate(() => { __modelMode = 'ok' })
  await page.getByLabel('个人 API 密钥', { exact: false }).fill('误复制的普通文字')
  await page.getByRole('button', { name: '保存连接', exact: true }).click()
  await page.getByText('密钥格式无效：请复制完整密钥，避免中文、内部空白或换行。当前已存密钥未修改。', { exact: true }).waitFor()
  assert.equal(await page.evaluate(() => __logins[0].password), 'synthetic-test-key')
  assert.equal(await page.getByLabel('个人 API 密钥', { exact: false }).inputValue(), '')
  await page.getByLabel('连接方式').selectOption('codex')
  assert.equal(await page.getByLabel('精读模型', { exact: true }).inputValue(), '')
  assert.equal(await page.getByLabel('翻译模型（留空使用精读模型）', { exact: true }).inputValue(), '')
  await page.getByText('连接方式已更改，请保存并检查连接。', { exact: true }).waitFor()
  await page.getByRole('button', { name: '使用 ChatGPT 登录', exact: true }).waitFor()
  await page.screenshot({ path: join(artifacts, 'codex-settings.png') })
  const beforeCodex = await page.evaluate(() => __requests.length)
  await page.getByRole('button', { name: '获取可用模型', exact: true }).click()
  await page.getByText('已获取 1 个模型；分别选择后保存连接。', { exact: true }).waitFor()
  await page.getByLabel('从列表选择精读模型', { exact: true }).selectOption('synthetic-codex')
  assert.equal(await page.getByLabel('精读模型', { exact: true }).inputValue(), 'synthetic-codex')
  assert.equal(await page.evaluate(() => __requests.length), beforeCodex)
  console.log('Personal AI settings browser checks passed. Synthetic data; no provider call. Screenshots: ' + artifacts)
} finally { await browser.close() }
