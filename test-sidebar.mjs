// Copyright (C) 2026 lvyrana
// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'

const fixture = () => {
  const prefs = new Map([
    ['extensions.papermind.uid', '123e4567-e89b-42d3-a456-426614174000'],
    ['extensions.papermind.configVersion', 3],
  ])
  const paper = { id: 12, key: 'PAPER123', libraryID: 1, isRegularItem: () => true,
    getField: field => ({ title: 'Synthetic paper', abstractNote: 'A randomized study.' }[field] || ''),
    getCreators: () => [] }
  const attachment = { id: 13, key: 'PDF12345', libraryID: 1, parentItemID: 12,
    isAttachment: () => true }
  const calls = [], notes = []
  const Zotero = {
    Prefs: { get: key => prefs.get(key), set: (key, value) => prefs.set(key, value) },
    Items: { get: id => id === 12 ? paper : attachment },
    Libraries: { get: () => ({ libraryType: 'user', editable: true }) },
    Groups: { getGroupIDFromLibraryID: () => 987 },
    debug() {}, getMainWindows: () => [],
    ItemPaneManager: { registerSection: section => { calls.push(section); return 'test-pane' }, unregisterSection() {} },
    Reader: { registerEventListener() {}, unregisterEventListener() {} },
    Item: class {
      setNote(value) { this.html = value }
      async saveTx() { notes.push(this); return 51 }
    },
  }
  const context = vm.createContext({ Zotero, Services: { prompt: {} }, Components: {}, URL })
  for (const file of ['bootstrap.js', 'sidebar.js']) vm.runInContext(fs.readFileSync(new URL(file, import.meta.url), 'utf8'), context)
  const win = { AbortController, setTimeout, clearTimeout,
    fetch: async (url, options) => {
      calls.push({ url, ...options, payload: JSON.parse(options.body) })
      return { ok: true, json: async () => ({ ok: true, guide: 'A sourced explanation.', reply: 'Follow-up answer.', translated: '翻译结果。' }) }
    } }
  const sidebar = context.PaperMindSidebar
  const session = sidebar.sessionFor(paper)
  session.source = sidebar.captureSource(attachment, { text: 'The observed effect was uncertain.', position: { pageIndex: 2 }, pageLabel: 'iii' })
  return { sidebar, session, paper, attachment, win, calls, notes, prefs, Zotero, context }
}

test('Fluent labels only set attributes, never replace the native section body', () => {
  for (const locale of ['en-US', 'zh-CN']) {
    const source = fs.readFileSync(new URL(`locale/${locale}/papermind.ftl`, import.meta.url), 'utf8')
    assert.match(source, /^papermind-reading-header =\s*\n\s+\.label =/m)
    assert.match(source, /^papermind-reading-nav =\s*\n\s+\.tooltiptext =/m)
  }
})

test('registers a native section and removes it on shutdown', () => {
  const f = fixture()
  f.sidebar.SHOW_LEGACY_SECTION = true
  f.sidebar.init('file:///test/')
  assert.equal(f.calls[0].pluginID, 'papermind-connector@papermind.local')
  f.sidebar.destroy()
  assert.equal(f.sidebar.sessions.size, 0)
})

test('shutdown preserves other plugins with Zotero 9.0.6 inverted unregister filter', () => {
  for (const hasPluginCleanup of [true, false]) {
    const f = fixture()
    const other = { type: 'renderToolbar', pluginID: 'other@example', handler() {} }
    const reader = f.Zotero.Reader
    reader._registeredListeners = [other]
    reader.registerEventListener = (type, handler, pluginID) => reader._registeredListeners.push({ type, handler, pluginID })
    reader.unregisterEventListener = () => assert.fail('must not call the broken public cleanup')
    if (hasPluginCleanup) reader._unregisterEventListenerByPluginID = id => {
      reader._registeredListeners = reader._registeredListeners.filter(x => x.pluginID !== id)
    }
    f.sidebar.init('file:///test/')
    assert.equal(reader._registeredListeners.length, 2)
    f.sidebar.destroy()
    assert.equal(reader._registeredListeners.length, 1)
    assert.equal(reader._registeredListeners[0], other)
    f.sidebar.init('file:///test/')
    assert.equal(reader._registeredListeners.length, 2)
    f.sidebar.destroy()
    assert.equal(reader._registeredListeners[0], other)
  }
})

test('native render failures stay inside the custom section and remain diagnosable', () => {
  const f = fixture()
  f.sidebar.SHOW_LEGACY_SECTION = true
  f.sidebar.init('file:///test/')
  f.sidebar.render = () => { throw new TypeError('synthetic rendering error') }
  const body = { textContent: '' }
  assert.doesNotThrow(() => f.calls[0].onRender({ body, item: f.paper, editable: true }))
  assert.match(body.textContent, /侧栏加载失败/)
  assert.match(f.sidebar.renderError, /synthetic rendering error/)
})

test('selection opens the host controller and only scrolls the active reader pane', () => {
  const f = fixture()
  f.sidebar.SHOW_LEGACY_SECTION = true
  f.sidebar.paneID = 'test-pane'
  const calls = []
  const host = {
    context: { mode: 'notes' },
    set collapsed(value) { calls.push(['collapsed', value, this.context.mode]) },
    sidenav: { container: {
      getEnabledPane: id => id === 'test-pane',
      scrollToPane: id => { calls.push(['scroll', id]) },
    } },
  }
  f.sidebar.focusPane({ ZoteroContextPane: host })
  assert.deepEqual(calls, [['collapsed', false, 'item'], ['scroll', 'test-pane']])
  assert.doesNotThrow(() => f.sidebar.focusPane({}))
})

test('independent sidebar is the default and tab observer is removed on shutdown', () => {
  const f = fixture()
  let observer, removed
  f.Zotero.Notifier = {
    registerObserver(value, types) { observer = value; assert.equal(types.join(','), 'tab,item'); return 7 },
    unregisterObserver(id) { removed = id },
  }
  f.sidebar.init('file:///test/')
  assert.equal(f.calls.length, 0)
  assert.equal(typeof observer.notify, 'function')
  f.sidebar.destroy()
  assert.equal(removed, 7)
})

test('reader tabs cannot fall back to the previous library selection', () => {
  const f = fixture()
  const win = { Zotero_Tabs: { selectedID: 'reader-1' }, ZoteroPane: { getSelectedItems: () => [f.paper] } }
  f.Zotero.Reader.getByTabID = () => null
  assert.equal(f.sidebar.activeItem(win), null)
  f.Zotero.Reader.getByTabID = () => ({ itemID: 13 })
  assert.equal(f.sidebar.activeItem(win), f.attachment)
  win.Zotero_Tabs.selectedID = 'zotero-pane'
  assert.equal(f.sidebar.activeItem(win), f.paper)
})

test('inline translation stays below the source, requesting scroll room at the bottom', () => {
  const { sidebar } = fixture()
  for (const rect of [[30, 60, 240, 100], [450, 530, 590, 570], [0, 10, 620, 450]]) {
    const placed = sidebar.translationPlacement(rect, { width: 640, height: 600 }, 180)
    assert.ok(placed.top > rect[3])
    assert.ok(placed.left >= 12)
    assert.ok(placed.left + placed.width <= 628)
    assert.ok(placed.top - placed.scrollBy + 180 <= 588)
  }
})

test('attachment and parent resolve to the same paper session, identities stay separate', () => {
  const f = fixture()
  assert.equal(f.sidebar.sessionFor(f.attachment), f.session)
  f.prefs.set('extensions.papermind.uid', '223e4567-e89b-42d3-a456-426614174000')
  assert.notEqual(f.sidebar.sessionFor(f.paper), f.session)
})

test('captures the physical page and creates user/group PDF anchors', () => {
  const f = fixture()
  assert.equal(f.session.source.page, 3)
  assert.equal(f.session.source.pageLabel, 'iii')
  assert.equal(f.sidebar.sourceURL(f.session.source), 'zotero://open-pdf/library/items/PDF12345?page=3')
  f.Zotero.Libraries.get = () => ({ libraryType: 'group' })
  assert.equal(f.sidebar.sourceURL(f.session.source), 'zotero://open-pdf/groups/987/items/PDF12345?page=3')
  assert.equal(f.sidebar.captureSource(f.attachment, { position: 'not-json' }).page, null)
})

test('source navigation uses the native reader without an external protocol prompt', async () => {
  const f = fixture()
  f.Zotero.Items.getByLibraryAndKey = (libraryID, key) => {
    assert.equal(libraryID, 1)
    assert.equal(key, 'PDF12345')
    return f.attachment
  }
  f.Zotero.Reader.open = async (id, location) => {
    assert.equal(id, 13)
    assert.equal(location.pageIndex, 2)
  }
  await f.sidebar.openSource(f.session.source, f.session)
  assert.equal(f.session.error, '')
  f.Zotero.Items.getByLibraryAndKey = () => null
  await f.sidebar.openSource(f.session.source, f.session)
  assert.match(f.session.error, /原文附件已移除/)
})

test('selection explanation uses the existing API without uploading a PDF or saving a server item', async () => {
  const f = fixture()
  await f.sidebar.run(f.session, 'guide', f.win)
  assert.equal(f.calls.length, 1)
  assert.match(f.calls[0].url, /\/api\/deep-read\/guide$/)
  assert.equal(f.calls[0].payload.mode, 'selection')
  assert.equal(f.calls[0].payload.page, 3)
  assert.equal(f.calls[0].headers['X-User-ID'], f.prefs.get('extensions.papermind.uid'))
  assert.equal(f.calls[0].redirect, 'error')
  assert.equal(f.session.messages[1].content, 'A sourced explanation.')
  assert.equal(f.session.busy, false)
})

test('follow-up carries preceding context and leaves a newer draft intact', async () => {
  const f = fixture()
  await f.sidebar.run(f.session, 'guide', f.win)
  f.session.draft = 'Why uncertain?'
  const fetch = f.win.fetch
  f.win.fetch = (...args) => { f.session.draft = 'A newer question'; return fetch(...args) }
  await f.sidebar.run(f.session, 'chat', f.win)
  assert.equal(f.calls[1].payload.history.length, 2)
  assert.equal(f.calls[1].payload.message, 'Why uncertain?')
  assert.equal(f.calls[1].payload.paper_rowid, 0)
  assert.equal(f.session.draft, 'A newer question')
})

test('empty prompts, missing abstracts and oversized selections fail before a network request', async () => {
  const f = fixture()
  await f.sidebar.run(f.session, 'chat', f.win)
  assert.match(f.session.error, /问题/)
  f.session.source.text = 'x'.repeat(3001)
  await f.sidebar.run(f.session, 'translate', f.win)
  assert.match(f.session.error, /3000/)
  f.paper.getField = () => ''
  await f.sidebar.run(f.session, 'abstract', f.win)
  assert.match(f.session.error, /没有摘要/)
  assert.equal(f.calls.length, 0)
})

test('server refusal is visible and retry remains available', async () => {
  const f = fixture()
  f.win.fetch = async () => ({ ok: true, json: async () => ({ ok: false, error: '今日额度已用完' }) })
  await f.sidebar.run(f.session, 'guide', f.win)
  assert.match(f.session.error, /额度/)
  assert.equal(f.session.busy, false)
  assert.equal(f.session.messages.length, 0)
})

test('HTTP failure and timeout do not leave the sidebar stuck', async () => {
  const f = fixture()
  f.win.fetch = async () => ({ ok: false, status: 401, text: async () => '{"detail":"身份失效"}' })
  await f.sidebar.run(f.session, 'guide', f.win)
  assert.match(f.session.error, /401/)
  f.win.fetch = async () => { throw new DOMException('timeout', 'AbortError') }
  await f.sidebar.run(f.session, 'guide', f.win)
  assert.match(f.session.error, /超时/)
  assert.equal(f.session.busy, false)
})

test('changing selection during generation keeps the answer anchored to its original source', async () => {
  const f = fixture()
  f.win.fetch = async () => {
    f.session.source = { ...f.session.source, page: 9, text: 'A different passage' }
    return { ok: true, json: async () => ({ ok: true, guide: 'Original answer' }) }
  }
  await f.sidebar.run(f.session, 'guide', f.win)
  assert.equal(f.session.messages[1].source.page, 3)
  assert.match(f.sidebar.noteHTML(f.session, f.session.messages[1]), /page=3/)
})

test('cancelled late responses cannot overwrite the next request', async () => {
  const f = fixture()
  let release
  f.win.fetch = () => new Promise(resolve => { release = resolve })
  const pending = f.sidebar.run(f.session, 'guide', f.win)
  await f.sidebar.run(f.session, 'guide', f.win) // duplicate is ignored
  f.sidebar.cancel(f.session)
  release({ ok: true, json: async () => ({ ok: true, guide: 'Late response' }) })
  await pending
  assert.equal(f.session.messages.length, 0)
  assert.equal(f.session.busy, false)
})

test('identity change mid-request discards the previous identity answer', async () => {
  const f = fixture()
  f.win.fetch = async () => {
    f.prefs.set('extensions.papermind.uid', '223e4567-e89b-42d3-a456-426614174000')
    return { ok: true, json: async () => ({ ok: true, guide: 'Old identity answer' }) }
  }
  await f.sidebar.run(f.session, 'guide', f.win)
  assert.equal(f.session.messages.length, 0)
})

test('saving escapes model/source HTML, preserves provenance, and prevents duplicate notes', async () => {
  const f = fixture()
  const message = { role: 'assistant', question: 'Why?', content: '<img src=x onerror=evil()>', source: { ...f.session.source, text: '<script>bad()</script>' } }
  await Promise.all([f.sidebar.saveNote(f.session, message, true), f.sidebar.saveNote(f.session, message, true)])
  assert.equal(f.notes.length, 1)
  assert.equal(f.notes[0].parentID, f.paper.id)
  assert.equal(f.notes[0].libraryID, 1)
  assert.match(f.notes[0].html, /&lt;img/)
  assert.match(f.notes[0].html, /&lt;script/)
  assert.doesNotMatch(f.notes[0].html, /<script|<img/)
  assert.match(f.notes[0].html, /page=3/)
  assert.equal(message.noteID, 51)
})

test('read-only libraries never create notes', async () => {
  const f = fixture()
  f.Zotero.Libraries.get = () => ({ editable: false })
  await f.sidebar.saveNote(f.session, {}, true)
  assert.equal(f.notes.length, 0)
  assert.match(f.session.error, /只读/)
})
