// Optional DOM regression; uses synthetic metadata and mocked responses only.
// PAPERMIND_PLAYWRIGHT_MODULE may point to an existing Playwright installation.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
const { chromium } = await import(process.env.PAPERMIND_PLAYWRIGHT_MODULE || 'playwright')
const browser = await chromium.launch({ headless: true,
  ...(process.env.PAPERMIND_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PAPERMIND_CHROMIUM_EXECUTABLE } : {}) })
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } })
  await page.setContent(`<!doctype html><html lang="zh-CN"><body style="margin:0;height:100vh;display:flex;flex-direction:column;background:#f7f7f5">
    <div id="zotero-tabs-toolbar" style="height:42px;display:flex;align-items:center;justify-content:flex-end;border-bottom:1px solid #ddd"><button id="zotero-tb-sync">同步</button></div>
    <main style="display:flex;flex:1;min-height:0"><div id="zotero-items-tree" style="flex:1;min-width:0;padding:28px"><h2>示例论文 · PDF 阅读区</h2><p>The observed effect was uncertain.</p><div id="selection"></div></div><div id="zotero-context-splitter"></div><div id="zotero-context-pane">原生文献信息</div></main></body></html>`)
  await page.evaluate(() => {
    window.__notes = []
    window.__requests = []
    const paper = window.__paper = { id: 1, key: 'PAPER123', libraryID: 1,
      isRegularItem: () => true, getCreators: () => [],
      getField: field => ({ title: '示例论文：运动干预与活动能力', abstractNote: 'An example study with uncertain estimates.' }[field] || '') }
    const attachment = window.__attachment = { id: 2, key: 'PDF12345', libraryID: 1,
      isAttachment: () => true, parentItemID: 1 }
    const prefs = new Map([
      ['extensions.papermind.uid', '123e4567-e89b-42d3-a456-426614174000'],
      ['extensions.papermind.configVersion', 3],
    ])
    window.Services = { prompt: {} }
    window.Components = {}
    window.Zotero = {
      Prefs: { get: key => prefs.get(key) }, debug() {},
      Items: { get: id => id === 1 ? paper : attachment,
        getByLibraryAndKey: () => attachment },
      Libraries: { get: () => ({ libraryType: 'user', editable: true }) },
      getMainWindow: () => window, getMainWindows: () => [window],
      Reader: { getByTabID: () => ({ itemID: 2 }), open: async (id, location) => { window.__lastReaderOpen = { id, location } } },
      Item: class {
        setNote(html) { this.html = html }
        async saveTx() { window.__notes.push({ html: this.html, parentID: this.parentID }); return 3 }
      },
    }
    window.Zotero_Tabs = { selectedID: 'reader-1' }
    window.fetch = async (url, options) => {
      window.__requests.push({ url, body: JSON.parse(options.body) })
      return { ok: true, json: async () => ({ ok: true,
        guide: '原句在说什么\n效应估计存在不确定性。需要把区间估计与样本量一起读。\n\n为什么重要\n不能仅凭点估计判断干预有效。',
        reply: '这里的区间包含无效值，因此不能排除无效。', translated: '观察到的效应存在不确定性。' }) }
    }
  })
  for (const file of ['bootstrap.js', 'sidebar.js']) await page.addScriptTag({ path: fileURLToPath(new URL('../' + file, import.meta.url)) })
  await page.evaluate(() => {
    PaperMindSidebar.addToWindow(window)
    PaperMindSidebar.selectionPopup({ reader: { itemID: 2 }, doc: document,
      params: { annotation: { text: 'The observed effect was uncertain.', position: { pageIndex: 2 } } },
      append: node => document.getElementById('selection').appendChild(node) })
  })
  await page.getByRole('button', { name: '研雀阅读台', exact: true }).click()
  await page.getByText('从这篇论文开始', { exact: true }).waitFor()
  assert.equal(await page.locator('#zotero-context-pane').isVisible(), false)
  assert.equal(await page.getByRole('button', { name: '精读这段', exact: true }).count(), 1)
  await page.getByRole('button', { name: '精读这段', exact: true }).click()
  await page.getByText('原句在说什么', { exact: false }).waitFor()
  await page.getByRole('button', { name: '保存到 Zotero 笔记', exact: true }).click()
  await page.getByRole('button', { name: '已保存到 Zotero', exact: true }).waitFor()
  const notes = await page.evaluate(() => window.__notes)
  assert.equal(notes.length, 1)
  assert.equal(notes[0].parentID, 1)
  assert.match(notes[0].html, /page=3/)
  await page.getByRole('button', { name: '查看这条回答的原文' }).click()
  assert.deepEqual(await page.evaluate(() => window.__lastReaderOpen), { id: 2, location: { pageIndex: 2 } })
  await page.getByRole('textbox', { name: '继续追问' }).fill('这里为什么不能排除无效？')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await page.getByText('这里的区间包含无效值，因此不能排除无效。', { exact: true }).waitFor()
  assert.equal(await page.getByRole('textbox', { name: '继续追问' }).inputValue(), '')
  assert.equal(await page.evaluate(() => window.__requests.length), 2)
  // Translation belongs next to the original, never to the conversation sidebar.
  await page.getByRole('button', { name: '关闭', exact: true }).click()
  await page.getByRole('button', { name: '翻译', exact: true }).click()
  await page.getByText('观察到的效应存在不确定性。', { exact: true }).waitFor()
  assert.equal(await page.locator('#papermind-panel').isVisible(), false)
  assert.equal(await page.evaluate(() => PaperMindSidebar.sessionFor(window.__paper).messages.length), 4)
  const inlineBounds = await page.evaluate(() => ({
    bottom: document.querySelector('#selection').getBoundingClientRect().bottom,
    top: document.querySelector('[aria-label="研雀原文下方翻译"]').getBoundingClientRect().top,
  }))
  assert.ok(inlineBounds.top >= inlineBounds.bottom)
  await page.getByRole('button', { name: '关闭', exact: true }).click()
  assert.equal(await page.locator('[aria-label="研雀原文下方翻译"]').count(), 0)
  await page.getByRole('button', { name: '研雀阅读台', exact: true }).click()
  assert.equal(await page.locator('.pm-user').first().textContent(), '精读这段')
  assert.equal(await page.locator('.pm-source details').getAttribute('open'), null)
  assert.equal(await page.getByText('点击发送、精读或翻译时', { exact: false }).isVisible(), false)
  await page.getByRole('button', { name: '设置', exact: true }).click()
  assert.equal(await page.getByText('点击发送、精读或翻译时', { exact: false }).isVisible(), true)
  await page.getByRole('button', { name: '设置', exact: true }).click()
  if (process.env.PAPERMIND_SIDEBAR_SCREENSHOT) await page.screenshot({ path: process.env.PAPERMIND_SIDEBAR_SCREENSHOT, fullPage: true })
  // Long answers must scroll independently without moving the composer off-screen.
  await page.evaluate(() => {
    const session = PaperMindSidebar.sessionFor(window.__paper)
    session.messages.push({ role: 'assistant', content: '**长回答**\n' + '需要结合效应估计、区间和研究设计阅读。\n'.repeat(90) + '<img src=x onerror=alert(1)>' })
    PaperMindSidebar.refresh(session)
  })
  const layout = await page.evaluate(() => {
    const scroll = document.querySelector('.pm-messages'), input = document.querySelector('textarea')
    return { scrollable: scroll.scrollHeight > scroll.clientHeight,
      inputBottom: input.getBoundingClientRect().bottom, height: innerHeight,
      injectedImages: document.querySelectorAll('.pm-answer img').length }
  })
  assert.equal(layout.scrollable, true)
  assert.ok(layout.inputBottom < layout.height)
  assert.equal(layout.injectedImages, 0)
  await page.setViewportSize({ width: 850, height: 600 })
  assert.ok(await page.evaluate(() => document.querySelector('textarea').getBoundingClientRect().bottom < innerHeight))
  await page.setViewportSize({ width: 1100, height: 800 })
  // Switching documents preserves drafts and never shows the prior paper's chat.
  await page.getByRole('textbox', { name: '继续追问' }).fill('尚未发送的追问')
  await page.evaluate(() => PaperMindSidebar.refresh(PaperMindSidebar.sessionFor(window.__paper)))
  assert.equal(await page.getByRole('textbox', { name: '继续追问' }).evaluate(node => node === document.activeElement), true)
  await page.evaluate(() => {
    const other = { ...window.__paper, id: 9, key: 'OTHER123', getField: () => '另一篇论文' }
    PaperMindSidebar.syncWindow(window, other)
  })
  assert.equal(await page.locator('.pm-message').count(), 0)
  await page.evaluate(() => PaperMindSidebar.syncWindow(window, window.__paper))
  assert.equal(await page.getByRole('textbox', { name: '继续追问' }).inputValue(), '尚未发送的追问')
  // Native pane visibility is restored without mutating its collapsed state.
  await page.getByRole('button', { name: '关闭', exact: true }).click()
  assert.equal(await page.locator('#zotero-context-pane').isVisible(), true)
  await page.getByRole('button', { name: '研雀阅读台', exact: true }).click()
  await page.getByRole('button', { name: '清除选段' }).click()
  assert.equal(await page.getByRole('blockquote', { name: '当前选段' }).count(), 0)
  await page.evaluate(() => PaperMindSidebar.removeFromWindow(window))
  assert.equal(await page.locator('#papermind-panel').count(), 0)
  assert.equal(await page.locator('#papermind-toggle').count(), 0)
  console.log(JSON.stringify({ ok: true, mode: 'browser DOM with mocked Zotero and API',
    checked: ['toolbar-toggle', 'selection-popup', 'explain', 'follow-up', 'save-note', 'page-link', 'clear-selection', 'long-chat-fixed-composer', 'paper-switch-draft', 'collapsed-source', 'settings-only-disclosure', 'safe-markdown', 'cleanup'],
    nativeZotero: false }))
} finally {
  await browser.close()
}
