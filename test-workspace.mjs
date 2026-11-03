import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { webcrypto } from 'node:crypto'
import { browserOptions } from './scripts/browser-fixture.mjs'

function fixture(files = new Map()) {
  const prefs = new Map([['extensions.papermind.uid', '123e4567-e89b-42d3-a456-426614174000'], ['extensions.papermind.configVersion', 3]])
  const paper = { id: 1, key: 'PAPER123', libraryID: 1, isRegularItem: () => true, getCreators: () => [],
    getField: key => ({ title: 'Test PDF', abstractNote: 'Synthetic abstract' }[key] || '') }
  const attachment = { id: 2, key: 'PDF12345', libraryID: 1, parentItemID: 1, isAttachment: () => true }
  const texts = ['Introduction baseline lung function.', 'Current methods and population.', 'Results no association.', 'Limitations confounding.']
  const requests = [], notes = [], writes = []
  let reads = 0
  const pdf = { numPages: texts.length, getPage: async n => { reads++; return { getTextContent: async () => ({ items: [{ str: texts[n - 1], hasEOL: true }] }) } } }
  const app = { pdfDocument: pdf, pdfViewer: { currentPageNumber: 2 } }
  const reader = { itemID: 2, _internalReader: { _primaryView: { _iframeWindow: { PDFViewerApplication: app } } } }
  const win = { crypto: webcrypto, TextEncoder, AbortController, setTimeout, clearTimeout,
    Zotero_Tabs: { selectedID: 'pdf-tab' },
    fetch: async (url, options) => { requests.push({ url, payload: JSON.parse(options.body) }); return { ok: true, json: async () => ({ ok: true, reply: 'Synthetic answer with PDF page 2.' }) } } }
  const Zotero = { Profile: { dir: '/mock-profile' }, Prefs: { get: key => prefs.get(key), set: (key, value) => prefs.set(key, value) },
    Items: { get: id => id === 1 ? paper : attachment }, Libraries: { get: () => ({ editable: true, libraryType: 'user' }) },
    getMainWindow: () => win, getMainWindows: () => [], debug() {},
    Reader: { getByTabID: () => reader }, Item: class { setNote(html) { this.html = html } async saveTx() { notes.push(this); return notes.length } } }
  const io = { makeDirectory: async () => {}, exists: async path => files.has(path), readJSON: async path => JSON.parse(files.get(path)),
    writeJSON: async (path, data, options) => { writes.push({ path, options }); files.set(path, JSON.stringify(data)) } }
  const ctx = vm.createContext({ Zotero, Services: { prompt: {} }, Components: {}, URL, IOUtils: io, PathUtils: { join: (...args) => args.join('/') }, Uint8Array })
  for (const file of ['bootstrap.js', 'sidebar.js', 'reader-context.js', 'workspace.js']) vm.runInContext(fs.readFileSync(new URL(file, import.meta.url), 'utf8'), ctx)
  ctx.PaperMind.ai = { ensure: async () => true, request: async (win, endpoint, payload, signal) => {
    const response = await win.fetch('https://synthetic-ai.test' + endpoint, { body: JSON.stringify(payload), signal })
    return response.json()
  } }
  const sidebar = ctx.PaperMindSidebar, workspace = ctx.PaperMindWorkspace, context = ctx.PaperMindReaderContext
  workspace.install(sidebar); sidebar.workspace = workspace
  const session = sidebar.sessionFor(paper)
  return { ctx, sidebar, workspace, context, session, win, paper, attachment, reader, app, pdf, texts, requests, notes, prefs, files, writes, io, reads: () => reads }
}

const latest = f => f.session.messages.filter(x => x.role === 'assistant' && x.kind === 'read').at(-1)

test('portable reading export excludes credentials and restore keeps the previous revision', async () => {
  const f = fixture(); await f.workspace.load(f.session)
  f.workspace.state(f.session).cards = [{ content: 'Keep this', id: 'card-1', noteID: 999 }]
  f.session.draft = 'Unfinished question'
  await f.workspace.persist(f.session)
  const packet = JSON.parse(JSON.stringify(f.workspace.backup(f.session)))
  assert.equal(packet.record.draft, 'Unfinished question')
  assert.doesNotMatch(JSON.stringify(packet), /apiKey|token|data_uid|123e4567/)
  f.io.copy = async (from, to) => f.files.set(to, f.files.get(from))
  f.workspace.state(f.session).cards[0].content = 'Newer state'
  await f.workspace.persist(f.session)
  await f.workspace.restore(f.session, packet)
  assert.equal(f.workspace.state(f.session).cards[0].content, 'Keep this')
  assert.equal(f.workspace.state(f.session).cards[0].noteID, undefined)
  const previous = [...f.files].find(([name]) => name.includes('before-restore'))
  assert.match(previous[1], /Newer state/)
  packet.paper.key = '../other'
  await assert.rejects(f.workspace.restore(f.session, packet), /不匹配/)
  packet.paper.key = f.paper.key; packet.record.cards = [{ content: 123 }]
  await assert.rejects(f.workspace.restore(f.session, packet), /无效/)
})

test('start hint waits for local records and recommends the abstract without network or writes', async () => {
  const f = fixture(), active = f.context.active(f.win, f.paper)
  assert.equal(f.workspace.startHint(f.session, active), null)
  await f.workspace.load(f.session)
  const hint = f.workspace.startHint(f.session, active)
  assert.equal(hint.action, 'abstract')
  assert.match(hint.text, /先点「读摘要」/)
  assert.equal(f.workspace.startHint(f.session, null).action, 'abstract')
  assert.equal(f.requests.length, 0)
  assert.equal(f.writes.length, 0)
  assert.equal(f.reads(), 0)
  f.session.busy = true
  assert.equal(f.workspace.startHint(f.session, active), null)
})

test('start hint falls back to the local PDF, or explains how to supply missing content', async () => {
  const f = fixture(); await f.workspace.load(f.session)
  f.paper.getField = key => key === 'title' ? 'No abstract' : '  '
  const hint = f.workspace.startHint(f.session, f.context.active(f.win, f.paper))
  assert.equal(hint.action, 'map')
  assert.match(hint.text, /条目没有摘要.*「阅读路线」/)
  assert.equal(f.workspace.startHint(f.session, null).action, null)
  assert.match(f.workspace.startHint(f.session, null).text, /打开这篇的 PDF/)
  assert.equal(f.requests.length, 0)
})

test('existing reading work, a selection or a draft takes priority over the start hint', async () => {
  for (const prepare of [
    (w, s) => { s.messages.push({ role: 'assistant', content: 'Existing reading', kind: 'read' }) },
    (w) => { w.cards.push({ content: 'Existing card' }) },
    (w) => { w.board.push({ content: 'Existing board entry' }) },
    (w) => { w.quiz.push({ content: 'Existing quiz' }) },
    (w, s) => { s.messages.push({ content: 'Existing chat' }) },
    (w, s) => { s.source = { text: 'Selected passage' } },
    (w, s) => { s.draft = 'An unfinished question' },
  ]) {
    const f = fixture(); await f.workspace.load(f.session)
    prepare(f.workspace.state(f.session), f.session)
    assert.equal(f.workspace.startHint(f.session, f.context.active(f.win, f.paper)), null)
  }
})

test('reopening a paper with a saved card does not show the start hint again', async () => {
  const f = fixture()
  await f.workspace.capture(f.session, { content: 'Keep this reading note', origin: '个人笔记' })
  const fresh = fixture(f.files)
  await fresh.workspace.load(fresh.session)
  assert.equal(fresh.workspace.startHint(fresh.session, fresh.context.active(fresh.win, fresh.paper)), null)
  assert.equal(fresh.workspace.state(fresh.session).cards[0].content, 'Keep this reading note')
  assert.equal(fresh.writes.length, 0)
})

test('abstract cards never borrow the current selection and remain source-free after reload', async () => {
  const f = fixture()
  f.session.source = { text: 'Unrelated selected methods', page: 2, attachmentKey: f.attachment.key, libraryID: 1 }
  await f.workspace.run(f.session, 'abstract', f.win)
  const result = latest(f)
  assert.equal(result.source, null)
  await f.workspace.capture(f.session, result)
  assert.equal(f.workspace.state(f.session).cards[0].source, null)
  f.session.source = { ...f.session.source, text: 'Another selected result', page: 3 }
  await f.workspace.capture(f.session, result)
  const cards = f.workspace.state(f.session).cards
  assert.equal(cards.length, 1)
  assert.equal(cards[0].source, null)
  assert.equal(cards[0].content, result.content)
  await f.workspace.toBoard(f.session, cards[0], '背景')
  const fresh = fixture(f.files)
  await fresh.workspace.load(fresh.session)
  const restored = fresh.workspace.state(fresh.session)
  assert.equal(restored.cards[0].source, null)
  assert.equal(restored.board[0].source, null)
})

test('capturing results keeps their own source, rejects empty content and normalizes absent sources', async () => {
  const f = fixture()
  const original = { text: 'Original evidence', page: 1, attachmentKey: f.attachment.key, libraryID: 1 }
  f.session.source = { ...original, text: 'New selection', page: 3 }
  await f.workspace.capture(f.session, { content: 'Reading result', source: original })
  assert.equal(f.workspace.state(f.session).cards[0].source.page, 1)
  await f.workspace.capture(f.session, { content: '', source: null })
  assert.equal(f.workspace.state(f.session).cards.length, 1)
  assert.match(f.session.error, /先划选原文/)
  const note = { content: 'Source-free personal note', origin: '个人笔记' }
  await f.workspace.capture(f.session, note)
  await f.workspace.capture(f.session, note)
  const cards = f.workspace.state(f.session).cards
  assert.equal(cards.length, 2)
  assert.equal(cards[1].source, null)
  await f.workspace.capture(f.session)
  assert.equal(cards.length, 3)
  assert.equal(cards[2].content, 'New selection')
  assert.equal(cards[2].source.page, 3)
  assert.equal(cards[2].origin, '原文')
})

test('inline editing saves multi-paragraph text, rejects empty drafts and creates new cards', async () => {
  const f = fixture(); await f.workspace.load(f.session)
  const w = f.workspace.state(f.session)
  await f.workspace.capture(f.session, { content: 'Original card', origin: 'AI 解读' })
  const card = w.cards[0]; card.noteID = 7
  w.editing = card; w.editDraft = '   '
  await f.workspace.saveEdit(f.session)
  assert.equal(card.content, 'Original card'); assert.equal(w.editing, card)
  assert.match(f.session.error, /内容为空/)
  w.editDraft = 'First paragraph\n\nSecond paragraph  '
  await f.workspace.saveEdit(f.session)
  assert.deepEqual([card.content, card.origin, card.noteID, w.editing, f.session.error], ['First paragraph\n\nSecond paragraph', '个人编辑', null, null, ''])
  w.editing = 'new'; w.editDraft = 'Personal judgement'
  await f.workspace.saveEdit(f.session)
  assert.deepEqual([w.cards.length, w.cards[1].content, w.cards[1].origin, w.editing], [2, 'Personal judgement', '个人笔记', null])
})

test('reading tasks ask for concrete content, not a word count or page citations', async () => {
  for (const [action, pattern] of [['page', /PDF 第 2 页.*具体信息/], ['guide', /具体含义/], ['map', /具体问题/]]) {
    const f = fixture()
    if (action === 'guide') f.session.source = { text: 'Selected body paragraph', page: 2, attachmentKey: f.attachment.key, libraryID: 1 }
    await f.workspace.run(f.session, action, f.win)
    assert.equal(f.session.error, '')
    assert.match(f.requests.at(-1).payload.message, pattern)
    assert.doesNotMatch(f.requests.at(-1).payload.message, /\d+字|最多\d+|页码/)
  }
})

test('a journal-length PDF is sent whole and uncut, labelled page by page', async () => {
  const f = fixture()
  f.texts[1] = 'Methods detail. '.repeat(500) + 'Scale sentinel at the end of page two.'
  const data = await f.context.collect(f.context.active(f.win, f.paper))
  assert.equal(data.coverage, '全文 4 页')
  for (const n of [1, 2, 3, 4]) assert.match(data.pages, new RegExp(`\\[PDF 第 ${n} 页\\]`))
  assert.match(data.pages, /Scale sentinel at the end of page two\./)
  assert.doesNotMatch(data.pages, /节选/)
  f.session.draft = 'Which scale?'
  await f.workspace.run(f.session, 'chat', f.win)
  assert.match(f.requests.at(-1).payload.paper_pages, /Scale sentinel/)
})

test('excerpt cards carry a translation that survives reload and backup; edits clear it and failures offer a retry', async () => {
  const f = fixture(); await f.workspace.load(f.session)
  const w = f.workspace.state(f.session)
  f.ctx.PaperMind.ai.config = () => ({ mode: 'api' })
  let answer = { ok: true, translated: '观察到的效应不确定。' }
  f.win.fetch = async (url, options) => { f.requests.push({ url, payload: JSON.parse(options.body) }); return { ok: true, json: async () => answer } }
  const settle = async () => { while (w.translating.size) await new Promise(resolve => setTimeout(resolve, 0)) }
  f.session.source = { text: 'The observed effect was uncertain.', page: 2, attachmentKey: f.attachment.key, libraryID: 1 }
  await f.workspace.capture(f.session); await settle()
  assert.equal(f.requests.at(-1).url, 'https://synthetic-ai.test/api/translate')
  assert.equal(w.cards[0].translation, '观察到的效应不确定。')
  const fresh = fixture(f.files); await fresh.workspace.load(fresh.session)
  assert.equal(fresh.workspace.state(fresh.session).cards[0].translation, '观察到的效应不确定。')
  const packet = JSON.parse(JSON.stringify(f.workspace.backup(f.session)))
  assert.equal(f.workspace.validateBackup(packet, f.session).cards[0].translation, '观察到的效应不确定。')
  await f.workspace.toBoard(f.session, w.cards[0], '发现')
  assert.equal(w.board[0].translation, '观察到的效应不确定。')
  w.editing = w.cards[0]; w.editDraft = 'The effect was uncertain.'
  await f.workspace.saveEdit(f.session)
  assert.equal(w.cards[0].translation, undefined)
  answer = { ok: false, error: '服务不可用' }
  await f.workspace.translateCard(f.session, w.cards[0], true)
  assert.match(f.session.error, /服务不可用.*补译文/)
  const count = f.requests.length
  await f.workspace.capture(f.session, { content: '中文个人笔记，不需要翻译。', origin: '个人笔记' }); await settle()
  f.prefs.set('extensions.papermind.cardTranslate', false)
  f.session.source = { ...f.session.source, text: 'Another English excerpt.' }
  await f.workspace.capture(f.session); await settle()
  assert.equal(f.requests.length, count)
})

test('restored abstract cards and board entries stay deduplicated with omitted sources', async () => {
  const f = fixture()
  await f.workspace.run(f.session, 'abstract', f.win)
  const result = latest(f)
  await f.workspace.capture(f.session, result)
  await f.workspace.toBoard(f.session, result, '背景')
  const packet = JSON.parse(JSON.stringify(f.workspace.backup(f.session)))
  f.io.copy = async (from, to) => f.files.set(to, f.files.get(from))
  await f.workspace.restore(f.session, packet)
  for (const current of [f, fixture(f.files)]) {
    await current.workspace.load(current.session)
    const w = current.workspace.state(current.session)
    await current.workspace.capture(current.session, latest(current))
    await current.workspace.toBoard(current.session, result, '背景')
    await current.workspace.toBoard(current.session, latest(current), '背景')
    await current.workspace.toBoard(current.session, w.cards[0], '背景')
    assert.deepEqual([w.cards.length, w.board.length], [1, 1])
  }
})

test('selected cards survive restore without duplicates while distinct sources stay separate', async () => {
  const f = fixture()
  const source = f.sidebar.captureSource(f.attachment, {
    text: 'Synthetic selected passage', pageLabel: 'ii', position: { pageIndex: 1 },
  })
  f.session.source = source
  await f.workspace.capture(f.session)
  const result = { content: source.text, source }
  await f.workspace.toBoard(f.session, result, '背景')
  const packet = JSON.parse(JSON.stringify(f.workspace.backup(f.session)))
  f.io.copy = async (from, to) => f.files.set(to, f.files.get(from))
  await f.workspace.restore(f.session, packet)
  const fresh = fixture(f.files)
  await fresh.workspace.load(fresh.session)
  fresh.session.source = { libraryID: source.libraryID, attachmentKey: source.attachmentKey,
    page: source.page, text: source.text, pageLabel: '2' }
  await fresh.workspace.capture(fresh.session)
  await fresh.workspace.toBoard(fresh.session, result, '背景')
  const w = fresh.workspace.state(fresh.session)
  assert.deepEqual([w.cards.length, w.board.length], [1, 1])
  for (const change of [{ page: 3 }, { attachmentKey: 'OTHERPDF' }, { libraryID: 2 }, { text: 'Different passage' }]) {
    const other = { ...result, source: { ...source, ...change } }
    await fresh.workspace.capture(fresh.session, other)
    await fresh.workspace.toBoard(fresh.session, other, '背景')
  }
  assert.deepEqual([w.cards.length, w.board.length], [5, 5])
  await fresh.workspace.toBoard(fresh.session, result, '方法')
  assert.equal(w.board.length, 6)
})

test('workspace browser fixture retains Chromium sandbox and uses unique portable screenshots', () => {
  const script = fs.readFileSync(new URL('scripts/check-workspace-browser.mjs', import.meta.url), 'utf8')
  assert.equal(browserOptions.chromiumSandbox, true)
  assert.match(script, /chromium\.launch\(browserOptions\)/)
  assert.match(script, /mkdtemp\(join\(tmpdir\(\)/)
  assert.doesNotMatch(script, /\/private\/tmp|--no-sandbox/)
})

test('reads the active local PDF with physical page labels; cache avoids repeated extraction', async () => {
  const f = fixture(), active = f.context.active(f.win, f.paper)
  const data = await f.context.collect(active, 'association')
  assert.equal(data.page, 2)
  assert.match(data.currentText, /methods/)
  assert.match(data.pages, /PDF 第 4 页/)
  await f.context.collect(active, 'confounding')
  assert.equal(f.reads(), 4)
  assert.equal(f.context.active(f.win, { id: 99 }), null)
})

test('uses the active split view, and handles missing/scanned text without invented content', async () => {
  const f = fixture()
  f.reader._internalReader._lastViewPrimary = false
  f.reader._internalReader._secondaryView = { _iframeWindow: { PDFViewerApplication: { pdfDocument: f.pdf, pdfViewer: { currentPageNumber: 4 } } } }
  assert.equal(f.context.active(f.win, f.paper).page, 4)
  f.reader._internalReader._secondaryView = null
  assert.equal((await f.context.collect(f.context.active(f.win, f.paper))).page, null)
})

test('Zotero 9 processed characters use zero-based pages, spacing and normalized ligatures', async () => {
  const f = fixture(), seen = []
  f.pdf.getPageData = async ({ pageIndex }) => {
    seen.push(pageIndex)
    return { chars: [{ c: 'ﬁ', u: 'fi', spaceAfter: true }, { c: 'text', lineBreakAfter: true },
      { c: 'hidden', ignorable: true }, { c: 'next', paragraphBreakAfter: true }, { c: 'end' }] }
  }
  f.pdf.getPage = () => { throw Error('Stock PDF.js API must not be used') }
  const data = await f.context.collect(f.context.active(f.win, f.paper))
  assert.equal(data.currentText, 'fi text\nnext\n\nend')
  assert.deepEqual(seen, [1, 0, 2, 3])
  assert.equal(data.firstError, null)
})

test('failed extraction remains diagnosable and retries instead of caching failure', async () => {
  const f = fixture()
  f.pdf.getPageData = async () => { throw Error('Reader unavailable') }
  const failed = await f.context.collect(f.context.active(f.win, f.paper))
  assert.equal(failed.firstError, 'Reader unavailable')
  assert.match(failed.coverage, /4 页读取失败/)
  f.pdf.getPageData = async () => ({ chars: [{ c: 'Recovered' }] })
  assert.equal((await f.context.collect(f.context.active(f.win, f.paper))).currentText, 'Recovered')
})

test('native worker parameters are cloned into the active PDF window compartment', async () => {
  const f = fixture(), cloned = new WeakSet(), realm = f.reader._internalReader._primaryView._iframeWindow
  f.ctx.Components.utils = { cloneInto: (params, target) => {
    assert.equal(target, realm)
    const result = { ...params }; cloned.add(result); return result
  } }
  f.pdf.getPageData = async params => {
    assert.ok(cloned.has(params), 'uncloned options would fail Firefox worker structured cloning')
    return { chars: [{ c: `Page ${params.pageIndex + 1}` }] }
  }
  assert.equal((await f.context.collect(f.context.active(f.win, f.paper))).currentText, 'Page 2')
})

test('caps evidence packet with an honest partial coverage label', async () => {
  const f = fixture()
  f.pdf.numPages = 250
  f.pdf.getPage = async n => ({ getTextContent: async () => ({ items: [{ str: `Page ${n} ` + 'x'.repeat(6000) }] }) })
  const data = await f.context.collect(f.context.active(f.win, f.paper))
  assert.ok(data.pages.length <= 62000)
  assert.match(data.coverage, /不代表全部内容/)
  assert.match(data.pages, /PDF 第 2 页\]/)
})

test('cards and board survive a fresh session, use atomic writes and hashed identity filenames', async () => {
  const f = fixture()
  f.session.source = { text: 'A quote', page: 2, attachmentKey: f.attachment.key, libraryID: 1 }
  await f.workspace.capture(f.session)
  await f.workspace.capture(f.session)
  const w = f.workspace.state(f.session)
  assert.equal(w.cards.length, 1)
  await f.workspace.toBoard(f.session, w.cards[0], '方法')
  await f.workspace.toBoard(f.session, w.cards[0], '方法')
  const fresh = fixture(f.files)
  await fresh.workspace.load(fresh.session)
  assert.equal(fresh.workspace.state(fresh.session).cards[0].source.page, 2)
  assert.equal(fresh.workspace.state(fresh.session).board.length, 1)
  assert.match(f.writes[0].path, /\/[a-f0-9]{64}\.json$/)
  assert.equal(f.writes[0].options.tmpPath, f.writes[0].path + '.tmp')
  f.prefs.set('extensions.papermind.uid', '123e4567-e89b-42d3-a456-426614174001')
  const other = f.sidebar.sessionFor(f.paper)
  await f.workspace.load(other)
  assert.equal(f.workspace.state(other).cards.length, 0)
})

test('malformed storage is not overwritten; write failure preserves current content and can retry', async () => {
  const f = fixture(), path = await f.workspace.path(f.session)
  f.files.set(path, '{broken')
  await f.workspace.load(f.session)
  assert.equal(f.workspace.state(f.session).loaded, false)
  assert.equal(f.workspace.startHint(f.session, f.context.active(f.win, f.paper)), null)
  await assert.rejects(f.workspace.persist(f.session), /尚未载入/)
  assert.equal(f.files.get(path), '{broken')
  const g = fixture(); await g.workspace.load(g.session)
  const write = g.io.writeJSON
  g.io.writeJSON = async () => { throw Error('disk unavailable') }
  g.session.source = { text: 'Keep me', page: 2 }
  await g.workspace.capture(g.session)
  assert.match(g.workspace.state(g.session).storageError, /disk unavailable/)
  assert.equal(g.workspace.state(g.session).cards.length, 1)
  g.io.writeJSON = write
  await g.workspace.persist(g.session)
  assert.equal(g.workspace.state(g.session).storageError, '')
})

test('chat sends page text plus bounded whole-document background, never uploads a PDF or creates a server paper', async () => {
  const f = fixture(); f.session.draft = 'Explain results'
  await f.workspace.run(f.session, 'chat', f.win)
  assert.equal(f.requests.length, 1)
  const { url, payload } = f.requests[0]
  assert.ok(url.endsWith('/api/chat')); assert.equal(payload.paper_rowid, 0)
  assert.equal(payload.current_page, 2)
  assert.match(payload.paper_pages, /Results no association/)
  assert.equal(f.session.messages.length, 2)
  assert.equal(f.session.messages[1].source.page, 2)
  assert.equal(f.session.draft, '')
})

test('abstract reading sends only entry metadata and works without extracting PDF pages', async () => {
  const f = fixture(); await f.workspace.load(f.session)
  f.context.collect = async () => { throw new Error('PDF extraction must not run for an abstract') }
  f.session.draft = 'Unsent draft about another detail'
  f.session.messages = [{ role: 'user', content: 'Private previous discussion' }]
  f.session.source = { text: 'Selected body paragraph', page: 3, attachmentKey: f.attachment.key }
  await f.workspace.run(f.session, 'abstract', f.win)
  assert.equal(f.session.error, '')
  assert.equal(f.reads(), 0)
  assert.equal(f.requests.length, 1)
  assert.deepEqual(f.requests[0].payload, { paper_title: 'Test PDF', paper_abstract: 'Synthetic abstract', mode: 'abstract' })
  assert.equal(latest(f).coverage, '依据条目摘要')
  assert.equal(latest(f).source, null)
  assert.equal(f.session.draft, 'Unsent draft about another detail')
  assert.equal(f.session.messages.length, 3)
})

test('missing abstract fails before PDF extraction or a provider request', async () => {
  const f = fixture()
  f.paper.getField = key => key === 'title' ? 'No abstract' : '  '
  f.context.collect = async () => { throw new Error('Unexpected extraction') }
  await f.workspace.run(f.session, 'abstract', f.win)
  assert.match(f.session.error, /条目没有摘要/)
  assert.equal(f.requests.length, 0)
  assert.equal(f.reads(), 0)
})

test('reading routes and current-page reading retain PDF context', async () => {
  for (const action of ['map', 'page']) {
    const f = fixture()
    await f.workspace.run(f.session, action, f.win)
    assert.equal(f.session.error, '')
    assert.ok(f.reads() > 0)
    assert.equal(f.requests[0].payload.current_page, 2)
    assert.match(f.requests[0].payload.current_page_text, /Current methods/)
    assert.match(f.requests[0].payload.paper_pages, /Results no association/)
    assert.notEqual(latest(f).coverage, '依据条目摘要')
  }
})

test('reading modes and quiz run in the plugin and quiz answers retain the question', async () => {
  const f = fixture()
  for (const action of ['map', 'abstract', 'page']) {
    await f.workspace.run(f.session, action, f.win)
    assert.ok(latest(f).content)
    assert.equal(f.requests.at(-1).payload.history?.length || 0, 0)
  }
  assert.deepEqual([...f.session.messages].map(x => x.kind), Array(6).fill('read'))
  await f.workspace.run(f.session, 'quiz', f.win)
  const w = f.workspace.state(f.session)
  assert.equal(w.quiz.length, 2)
  w.quizDraft = 'My answer is based on the methods.'
  await f.workspace.run(f.session, 'quizAnswer', f.win)
  assert.equal(f.requests.at(-1).payload.history.length, 2)
  assert.match(f.requests.at(-1).payload.message, /My answer/)
  assert.equal(w.quiz.length, 4)
})

test('reading results and questions share one timeline; follow-ups see the reading as history', async () => {
  const f = fixture()
  await f.workspace.run(f.session, 'page', f.win)
  await f.workspace.run(f.session, 'abstract', f.win)
  f.session.draft = '这里的结果说明什么'
  await f.workspace.run(f.session, 'chat', f.win)
  assert.deepEqual([...f.session.messages].map(x => [x.role, x.kind || 'chat']), [['user', 'read'], ['assistant', 'read'],
    ['user', 'read'], ['assistant', 'read'], ['user', 'chat'], ['assistant', 'chat']])
  assert.equal(f.session.messages[0].content, '第 2 页带读')
  const history = f.requests.at(-1).payload.history
  assert.deepEqual(history.map(x => x.content.slice(0, 7)), ['第 2 页带读', 'Synthet', '摘要带读', 'Synthet'])
  assert.equal(f.workspace.state(f.session).mode, 'read')
  const packet = JSON.parse(JSON.stringify(f.workspace.backup(f.session)))
  assert.equal(f.workspace.validateBackup(packet, f.session).messages[1].kind, 'read')
})

test('a reading result saved by 0.9 joins the end of the timeline on load and restore', async () => {
  const f = fixture(), path = await f.workspace.path(f.session)
  const guide = { role: 'assistant', content: 'Saved page reading', question: '第 2 页带读', source: null }
  f.files.set(path, JSON.stringify({ version: 1, cards: [], board: [], quiz: [], draft: '', guide,
    messages: [{ role: 'user', content: 'Earlier question' }, { role: 'assistant', content: 'Earlier answer' }] }))
  await f.workspace.load(f.session)
  assert.deepEqual([...f.session.messages].map(x => x.content), ['Earlier question', 'Earlier answer', '第 2 页带读', 'Saved page reading'])
  assert.equal(latest(f).question, '第 2 页带读')
  await f.workspace.persist(f.session)
  assert.equal(JSON.parse(f.files.get(path)).guide, null)
  const packet = { format: 'litfinch-reading', version: 1, paper: { key: f.paper.key },
    record: { version: 1, cards: [], board: [], quiz: [], messages: [], draft: '', guide } }
  f.io.copy = async (from, to) => f.files.set(to, f.files.get(from))
  await f.workspace.restore(f.session, packet)
  assert.deepEqual([...f.session.messages].map(x => x.kind), ['read', 'read'])
})

test('legacy follow-up and already-folded backups retain one copy of the reading answer', async () => {
  const f = fixture(), path = await f.workspace.path(f.session)
  const guide = { role: 'assistant', content: 'Already in history', question: '第 2 页带读' }
  const record = { version: 1, cards: [], board: [], quiz: [], draft: '', guide,
    messages: [{ role: 'user', content: guide.question }, { ...guide }] }
  f.files.set(path, JSON.stringify(record))
  const copies = session => session.messages.filter(x => x.role === 'assistant' && x.content === guide.content).length
  await f.workspace.load(f.session)
  assert.equal(copies(f.session), 1)
  await f.workspace.persist(f.session)
  const fresh = fixture(f.files)
  await fresh.workspace.load(fresh.session)
  assert.equal(copies(fresh.session), 1)
  const packet = JSON.parse(JSON.stringify(f.workspace.backup(f.session)))
  packet.record.guide = guide
  packet.record.messages.forEach(x => { x.kind = 'read' })
  f.io.copy = async (from, to) => f.files.set(to, f.files.get(from))
  await f.workspace.restore(f.session, packet)
  assert.equal(copies(f.session), 1)
  await f.workspace.persist(f.session)
  const restored = fixture(f.files)
  await restored.workspace.load(restored.session)
  assert.equal(copies(restored.session), 1)
})

test('a model too small for the whole paper gets selected pages once, and keeps getting them for this paper', async () => {
  const f = fixture(), sent = []
  f.ctx.PaperMind.ai.request = async (win, endpoint, payload) => {
    sent.push(payload.paper_pages)
    if (payload.paper_pages.includes('[读取范围：全文')) throw Object.assign(new Error('论文全文超出所选模型的上下文长度。'), { code: 'CONTEXT_TOO_LONG' })
    return { ok: true, reply: 'Answer from selected pages.' }
  }
  f.session.draft = 'Explain the methods'
  await f.workspace.run(f.session, 'chat', f.win)
  assert.equal(f.session.error, '')
  assert.equal(sent.length, 2)
  assert.match(sent[1], /本次提供 \d+ 页/)
  assert.equal(f.session.messages.at(-1).content, 'Answer from selected pages.')
  f.session.draft = 'And the results?'
  await f.workspace.run(f.session, 'chat', f.win)
  assert.equal(sent.length, 3)
  assert.doesNotMatch(sent[2], /\[读取范围：全文/)
  // Other failures are not retried.
  const g = fixture(); let calls = 0
  g.ctx.PaperMind.ai.request = async () => { calls++; throw new Error('个人 AI 服务返回 HTTP 401') }
  g.session.draft = 'x'
  await g.workspace.run(g.session, 'chat', g.win)
  assert.deepEqual([calls, /401/.test(g.session.error)], [1, true])
})

test('failed selected-page retries do not change the next whole-paper request', async () => {
  for (const invalidReply of [false, true]) {
    const f = fixture(), sent = []
    f.ctx.PaperMind.ai.request = async (win, endpoint, payload) => {
      sent.push(payload.paper_pages)
      if (sent.length === 1) throw Object.assign(new Error('Too long'), { code: 'CONTEXT_TOO_LONG' })
      if (sent.length === 2) {
        if (invalidReply) return { ok: false, error: 'No answer' }
        throw new Error('Service unavailable')
      }
      return { ok: true, reply: 'Whole paper answer' }
    }
    f.session.draft = 'Explain'
    await f.workspace.run(f.session, 'chat', f.win)
    assert.ok(f.session.error)
    assert.equal(Boolean(f.workspace.state(f.session).partialContext), false)
    await f.workspace.run(f.session, 'chat', f.win)
    assert.equal(sent.length, 3)
    assert.match(sent[2], /\[读取范围：全文/)
  }
})

test('HTTP input-length errors retry with selected pages while token rate limits do not', async () => {
  for (const status of [400, 429]) {
    const f = fixture()
    vm.runInContext(fs.readFileSync(new URL('ai.js', import.meta.url), 'utf8'), f.ctx)
    const ai = f.ctx.PaperMindAI
    f.ctx.PaperMind.ai = ai
    ai.config = () => ({ mode: 'api', base: 'http://localhost/v1', model: 'reader' })
    ai.key = () => ''; ai.ensure = async () => true
    let calls = 0
    f.win.fetch = async (url, options) => {
      calls++
      if (JSON.parse(options.body).messages[1].content.includes('[读取范围：全文')) {
        return { ok: false, status, text: async () => status === 400 ? 'Input length must be less than 32768' : 'Token limit per minute exceeded' }
      }
      return { ok: true, json: async () => ({ choices: [{ message: { content: 'Selected-page answer' } }] }) }
    }
    f.session.draft = 'Explain'
    await f.workspace.run(f.session, 'chat', f.win)
    assert.equal(calls, status === 400 ? 3 : 1) // 400 also exercises the existing non-stream fallback.
    assert.equal(Boolean(f.workspace.state(f.session).partialContext), status === 400)
  }
})

test('cancel and identity changes discard late responses', async () => {
  for (const changeIdentity of [false, true]) {
    const f = fixture(); await f.workspace.load(f.session)
    let reply, started
    const ready = new Promise(resolve => { started = resolve })
    f.win.fetch = async () => { started(); return new Promise(resolve => { reply = resolve }) }
    f.session.draft = 'Explain'
    const pending = f.workspace.run(f.session, 'chat', f.win)
    await ready
    if (changeIdentity) f.prefs.set('extensions.papermind.uid', '123e4567-e89b-42d3-a456-426614174001')
    else f.sidebar.cancel(f.session)
    reply({ ok: true, json: async () => ({ ok: true, reply: 'late' }) })
    await pending
    assert.equal(f.session.messages.length, 0)
    assert.equal(f.session.busy, false)
  }
})

test('page and selection are captured before asynchronous extraction', async () => {
  const f = fixture(); await f.workspace.load(f.session)
  f.session.source = { text: 'Old selected passage', page: 2, attachmentKey: f.attachment.key, libraryID: 1 }
  const collect = f.context.collect.bind(f.context)
  f.context.collect = async (...args) => {
    f.app.pdfViewer.currentPageNumber = 4
    f.session.source = { text: 'New passage', page: 4, attachmentKey: f.attachment.key, libraryID: 1 }
    return collect(...args)
  }
  await f.workspace.run(f.session, 'guide', f.win)
  assert.equal(f.requests[0].payload.current_page, 2)
  assert.equal(f.requests[0].payload.quote.text, 'Old selected passage')
  assert.equal(latest(f).source.page, 2)
})

test('board note export is escaped, read-only guarded and duplicate-safe', async () => {
  const f = fixture(); await f.workspace.load(f.session)
  await f.workspace.toBoard(f.session, { content: '<script>bad</script>', source: { text: 'Source', page: 2, attachmentKey: 'PDF12345', libraryID: 1 } }, '发现')
  await f.workspace.exportBoard(f.session, false)
  assert.equal(f.notes.length, 0)
  await f.workspace.exportBoard(f.session, true)
  await f.workspace.exportBoard(f.session, true)
  assert.equal(f.notes.length, 1)
  assert.match(f.notes[0].html, /&lt;script&gt;/)
  assert.match(f.notes[0].html, /page=2/)
})
