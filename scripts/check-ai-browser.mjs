import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
const artifacts = await mkdtemp(join(tmpdir(), 'litfinch-personal-ai-ui-'))
const browser = await chromium.launch({ headless: true, chromiumSandbox: true, ...(process.env.LITFINCH_BROWSER_CHANNEL ? { channel: process.env.LITFINCH_BROWSER_CHANNEL } : {}) })
try {
  const page = await browser.newPage({ viewport: { width: 500, height: 900 } })
  await page.goto('about:blank')
  await page.setContent('<main id="settings" style="font:15px system-ui;line-height:1.6;padding:20px"></main>')
  await page.evaluate(() => {
    const prefs = window.__prefs = new Map(), logins = window.__logins = [], requests = window.__requests = []
    window.PaperMind = { codex: { stop: async () => {} } }
    window.Zotero = { Prefs: { get: key => prefs.get(key), set: (key, value) => prefs.set(key, value) } }
    window.Services = { logins: { findLogins: base => logins.filter(x => x.hostname === base), addLoginAsync: async entry => logins.push(entry), modifyLogin: (old, entry) => logins.splice(logins.indexOf(old), 1, entry), removeLogin: entry => logins.splice(logins.indexOf(entry), 1) } }
    window.Components = { interfaces: {}, Constructor: function () { return function (hostname, _, realm, username, password) { Object.assign(this, { hostname, password }) } } }
    window.fetch = async (url, options) => { requests.push({ url, options }); return { ok: true, json: async () => ({ data: [{ id: 'synthetic-model' }] }) } }
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
  await page.getByLabel('模型名称', { exact: true }).fill('synthetic-model')
  await page.getByLabel('个人 API 密钥', { exact: false }).fill('synthetic-test-key')
  await page.getByRole('button', { name: '检查连接', exact: true }).click()
  await page.getByText('连接成功，模型列表包含所选模型；尚未发送论文。', { exact: true }).waitFor()
  assert.equal(await page.evaluate(() => __requests.length), 1)
  assert.equal(await page.evaluate(() => [...__prefs.values()].join().includes('synthetic-test-key')), false)
  assert.equal(await page.getByLabel('个人 API 密钥', { exact: false }).inputValue(), '')
  await page.screenshot({ path: join(artifacts, 'personal-api-settings.png') })
  await page.getByLabel('连接方式').selectOption('codex')
  assert.equal(await page.getByLabel('模型名称', { exact: true }).inputValue(), '')
  await page.getByText('连接方式已更改，请保存并检查连接。', { exact: true }).waitFor()
  await page.getByRole('button', { name: '使用 ChatGPT 登录', exact: true }).waitFor()
  await page.screenshot({ path: join(artifacts, 'codex-settings.png') })
  assert.equal(await page.evaluate(() => __requests.length), 1)
  console.log('Personal AI settings browser checks passed. Synthetic data; no provider call. Screenshots: ' + artifacts)
} finally { await browser.close() }
