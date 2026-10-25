// Local-only integration fixture. No real library, model, or profile writes.
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const { chromium } = await import(process.env.PAPERMIND_PLAYWRIGHT_MODULE || 'playwright')
const artifacts = await mkdtemp(join(tmpdir(), 'litfinch-workspace-'))
const browser = await chromium.launch({ headless: true, chromiumSandbox: true, ...(process.env.PAPERMIND_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PAPERMIND_CHROMIUM_EXECUTABLE } : {}) })
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 820 } })
  page.setDefaultTimeout(5000)
  const errors = []; page.on('pageerror', error => errors.push(error.message))
  // Secure context enables native Web Crypto, but all traffic is intercepted.
  await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' }))
  await page.goto('https://local-papermind.test')
  await page.setContent(`<html><body style="margin:0;height:100vh;display:flex;flex-direction:column"><div id="zotero-tabs-toolbar" style="height:40px;display:flex;justify-content:end"><button id="zotero-tb-sync">同步</button></div><main style="display:flex;flex:1;min-height:0"><section id="zotero-items-tree" style="flex:1;padding:25px;background:#eee"><h2>本地 PDF · 模拟宿主</h2><p>The intervention estimate was uncertain.</p><div id="selection"></div></section><div id="zotero-context-splitter"></div><div id="zotero-context-pane">原生详情</div></main></body></html>`)
  await page.evaluate(() => {
    const files = window.__files = new Map(), requests = window.__requests = [], notes = window.__notes = []
    const paper = window.__paper = { id: 1, key: 'PAPER123', libraryID: 1, isRegularItem: () => true, getCreators: () => [], getField: field => ({ title: '示例论文：干预效果与证据边界', abstractNote: 'Uncertain intervention estimates.' }[field] || '') }
    const attachment = window.__attachment = { id: 2, key: 'PDF12345', libraryID: 1, parentItemID: 1, isAttachment: () => true }
    const app = window.__pdfApp = { pdfViewer: { currentPageNumber: 2 }, pdfDocument: { numPages: 3, getPage: async n => ({ getTextContent: async () => ({ items: [{ str: ['Background and study design.', 'Intervention estimates with confidence intervals.', 'Limitations and follow up.'][n - 1] }] }) }) } }
    const reader = window.__reader = { itemID: 2, _internalReader: { _primaryView: { _iframeWindow: { PDFViewerApplication: app } } } }
    const prefs = new Map([['extensions.papermind.uid', '123e4567-e89b-42d3-a456-426614174000'], ['extensions.papermind.configVersion', 3]])
    window.IOUtils = { makeDirectory: async () => {}, exists: async path => files.has(path), readJSON: async path => JSON.parse(files.get(path)), writeJSON: async (path, data) => files.set(path, JSON.stringify(data)) }
    window.PathUtils = { join: (...args) => args.join('/') }
    window.Services = { prompt: { prompt: (win, title, label, value) => { value.value += '\n人工补充'; return true } } }
    window.Components = {}
    window.Zotero_Tabs = { selectedID: 'reader-1' }
    window.Zotero = { Profile: { dir: '/mock-profile' }, Prefs: { get: key => prefs.get(key) }, debug() {},
      getMainWindow: () => window, getMainWindows: () => [window],
      Items: { get: id => id === 1 ? paper : attachment, getByLibraryAndKey: () => attachment },
      Libraries: { get: () => ({ libraryType: 'user', editable: true }) },
      Reader: { getByTabID: () => reader, registerEventListener() {}, _unregisterEventListenerByPluginID() {}, open: async (id, location) => { window.__lastOpen = { id, location } } },
      Item: class { setNote(html) { this.html = html } async saveTx() { notes.push(this.html); return notes.length } } }
    window.fetch = async (url, options) => {
      const payload = JSON.parse(options.body); requests.push(payload)
      if (window.__failNextRequest) {
        window.__failNextRequest = false
        return { ok: true, json: async () => ({ ok: false, error: '模拟服务暂不可用' }) }
      }
      return { ok: true, json: async () => ({ ok: true, reply: payload.message.includes('一次只问一题') ? '如何根据区间估计判断不确定性？请回看第 2 页。' : '应结合区间估计与研究设计判断，原文第 2 页给出了估计范围。' }) }
    }
  })
  for (const file of ['bootstrap.js', 'sidebar.js', 'reader-context.js', 'workspace.js']) await page.addScriptTag({ path: fileURLToPath(new URL('../' + file, import.meta.url)) })
  await page.evaluate(() => {
    PaperMind.ai = { ensure: async () => true, request: async (win, endpoint, payload) => (await win.fetch('https://synthetic-ai.test' + endpoint, { body: JSON.stringify(payload) })).json() }
    PaperMindWorkspace.install(PaperMindSidebar); PaperMindSidebar.workspace = PaperMindWorkspace; PaperMindSidebar.init('file:///mock/')
  })
  await page.getByRole('button', { name: '研雀阅读台', exact: true }).click()
  await page.getByText('本机阅读记录', { exact: true }).waitFor()
  const hint = page.getByLabel('阅读起步提示', { exact: true })
  assert.match(await hint.textContent(), /先点「读摘要」/)
  assert.equal(await page.locator('.pmw-start-action').textContent(), '读摘要')
  assert.deepEqual(await page.evaluate(() => [__requests.length, __files.size, __notes.length]), [0, 0, 0])
  await page.screenshot({ path: join(artifacts, 'start-abstract.png') })
  await page.setViewportSize({ width: 700, height: 600 })
  const narrow = await page.evaluate(() => {
    const content = document.querySelector('.pmw-scroll')
    return { width: content.clientWidth, scrollWidth: content.scrollWidth,
      inputBottom: document.querySelector('[data-input="chat"]').getBoundingClientRect().bottom,
      buttonRight: document.querySelector('.pmw-start-action').getBoundingClientRect().right }
  })
  assert.ok(narrow.scrollWidth <= narrow.width)
  assert.ok(narrow.inputBottom < 600); assert.ok(narrow.buttonRight <= 700)
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.screenshot({ path: join(artifacts, 'start-narrow-dark.png') })
  await page.emulateMedia({ colorScheme: 'light' })
  await page.evaluate(() => {
    window.__originalGetField = __paper.getField
    __paper.getField = field => field === 'abstractNote' ? '' : __originalGetField(field)
    PaperMindSidebar.refresh(PaperMindSidebar.sessionFor(__paper))
  })
  assert.match(await hint.textContent(), /条目没有摘要.*「阅读路线」/)
  assert.equal(await page.locator('.pmw-start-action').textContent(), '阅读路线')
  await page.screenshot({ path: join(artifacts, 'start-without-abstract.png') })
  await page.evaluate(() => {
    window.__originalPDF = __pdfApp.pdfDocument; __pdfApp.pdfDocument = null
    PaperMindSidebar.refresh(PaperMindSidebar.sessionFor(__paper))
  })
  assert.match(await hint.textContent(), /打开这篇的 PDF/)
  assert.equal(await page.locator('.pmw-start-action').count(), 0)
  assert.equal(await page.evaluate(() => __requests.length), 0)
  await page.evaluate(() => {
    __pdfApp.pdfDocument = __originalPDF; __paper.getField = __originalGetField
    window.__failNextRequest = true
    PaperMindSidebar.refresh(PaperMindSidebar.sessionFor(__paper))
  })
  await page.getByRole('button', { name: '读摘要', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: '模拟服务暂不可用' }).waitFor()
  assert.equal(await hint.isVisible(), true)
  assert.equal(await page.getByRole('button', { name: '读摘要', exact: true }).isEnabled(), true)
  await page.getByRole('button', { name: '读摘要', exact: true }).click()
  await page.getByRole('heading', { name: '摘要带读', exact: true }).waitFor()
  assert.equal(await hint.count(), 0)
  assert.equal(await page.evaluate(() => __requests.length), 2)
  assert.match(await page.evaluate(() => __requests.at(-1).message), /带读这篇论文的摘要/)
  await page.setViewportSize({ width: 1100, height: 820 })
  await page.evaluate(() => {
    const getField = __paper.getField
    __paper.getField = field => field === 'title' ? 'LongTitle'.repeat(100) : getField(field)
    PaperMindSidebar.refresh(PaperMindSidebar.sessionFor(__paper))
  })
  const widths = await page.evaluate(() => ({ panel: document.querySelector('#papermind-panel').getBoundingClientRect().width,
    root: document.querySelector('.pmw').getBoundingClientRect().width,
    right: document.querySelector('.pmw').getBoundingClientRect().right, viewport: innerWidth }))
  assert.ok(widths.root <= widths.panel); assert.ok(widths.right <= widths.viewport)
  await page.getByRole('button', { name: '读当前页', exact: true }).click()
  await page.getByText('应结合区间估计与研究设计判断，原文第 2 页给出了估计范围。', { exact: true }).waitFor()
  await page.getByRole('button', { name: '存为卡片', exact: true }).click()
  await page.getByRole('heading', { name: '阅读卡片 · 1', exact: true }).waitFor()
  await page.locator('summary').filter({ hasText: '送到汇报' }).first().click()
  await page.getByRole('button', { name: '发现', exact: true }).first().click()
  await page.getByRole('heading', { name: '单篇汇报' }).waitFor()
  await page.getByRole('button', { name: '保存汇报到 Zotero 笔记', exact: true }).click()
  await page.waitForFunction(() => __notes.length === 1)
  await page.getByRole('button', { name: '保存汇报到 Zotero 笔记', exact: true }).click()
  assert.equal(await page.evaluate(() => __notes.length), 1)
  await page.getByRole('button', { name: '考考自己', exact: true }).click()
  await page.getByRole('button', { name: '出一道题', exact: true }).click()
  await page.getByRole('textbox', { name: '自测回答', exact: true }).fill('区间包含无效值，需要保留不确定性。')
  await page.getByRole('button', { name: '核对回答', exact: true }).click()
  await page.waitForFunction(() => PaperMindWorkspace.state(PaperMindSidebar.sessionFor(__paper)).quiz.length === 4)
  await page.getByRole('button', { name: '← 返回阅读台', exact: true }).click()
  await page.evaluate(() => { __pdfApp.pdfViewer.currentPageNumber = 3 })
  await page.getByText('本地 PDF · 第 3 / 3 页', { exact: true }).waitFor()
  await page.evaluate(() => PaperMindSidebar.selectionPopup({ reader: __reader, doc: document, params: { annotation: { text: 'Selected local text.', position: { pageIndex: 2 } } }, append: node => document.getElementById('selection').appendChild(node) }))
  await page.getByRole('button', { name: '带入追问', exact: true }).click()
  await page.getByRole('textbox', { name: '继续追问', exact: true }).fill('这段和前面的结果有什么联系？')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await page.waitForFunction(() => PaperMindSidebar.sessionFor(__paper).messages.length === 2, { }, { timeout: 5000 }).catch(async error => {
    console.log(await page.evaluate(() => ({ error: PaperMindSidebar.sessionFor(__paper).error,
      draft: PaperMindSidebar.sessionFor(__paper).draft, busy: PaperMindSidebar.sessionFor(__paper).busy,
      requests: __requests, messages: PaperMindSidebar.sessionFor(__paper).messages })))
    throw error
  })
  const payload = await page.evaluate(() => __requests.at(-1))
  assert.equal(payload.current_page, 3); assert.equal(payload.quote.text, 'Selected local text.')
  assert.match(payload.paper_pages, /第 1 页/)
  await page.evaluate(() => {
    const s = PaperMindSidebar.sessionFor(__paper)
    s.messages.push({ role: 'assistant', content: '长回答\n'.repeat(180) + '<img src=x onerror=alert(1)>' })
    PaperMindSidebar.refresh(s)
  })
  const layout = await page.evaluate(() => ({ bottom: document.querySelector('[data-input="chat"]').getBoundingClientRect().bottom,
    height: innerHeight, injected: document.querySelectorAll('.pmw img').length,
    scroll: document.querySelector('.pmw-scroll').scrollHeight > document.querySelector('.pmw-scroll').clientHeight }))
  assert.ok(layout.bottom < layout.height); assert.equal(layout.injected, 0); assert.equal(layout.scroll, true)
  await page.getByRole('button', { name: '← 返回阅读台', exact: true }).click()
  await page.screenshot({ path: join(artifacts, 'reading-with-card.png') })
  // Capture the actual component with a readable synthetic title for the README.
  // Keep the preceding long-title stress test and its evidence unchanged.
  await page.evaluate(() => {
    __paper.getField = __originalGetField
    PaperMindSidebar.refresh(PaperMindSidebar.sessionFor(__paper))
  })
  await page.locator('.pmw').screenshot({ path: join(artifacts, 'readme-reading-card.png') })
  await page.evaluate(async () => {
    const old = PaperMindSidebar.sessionFor(__paper)
    await PaperMindWorkspace.persist(old)
    PaperMindSidebar.sessions.delete(old.key)
    PaperMindSidebar.syncWindow(window)
  })
  await page.getByRole('heading', { name: '阅读卡片 · 1', exact: true }).waitFor()
  assert.equal(await hint.count(), 0)
  await page.getByRole('button', { name: '关闭', exact: true }).click()
  assert.equal(await page.locator('#zotero-context-pane').isVisible(), true)
  await page.evaluate(() => PaperMindSidebar.destroy())
  assert.equal(await page.locator('#papermind-panel').count(), 0)
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ ok: true, nativeZotero: false, artifacts, checks: ['start-hint','missing-abstract','missing-pdf','no-automatic-request','narrow-dark-layout','retry-from-start','local-pdf-context','page-follow','selection','guide','cards','board-note','quiz','chat','storage-reload','fixed-composer','safe-text','cleanup'] }))
} finally { await browser.close() }
