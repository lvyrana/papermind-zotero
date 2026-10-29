/* Copyright (C) 2026 lvyrana · SPDX-License-Identifier: AGPL-3.0-only */
/* global Zotero, PaperMind, PaperMindReaderContext, IOUtils, PathUtils */
var PaperMindWorkspace = {
  boardSections: ['背景', '方法', '发现', '局限与启发'],
  cardTranslatePref: 'extensions.papermind.cardTranslate',

  install(sidebar) {
    this.sidebar = sidebar
    sidebar.SHOW_WORKSPACE = true
    const legacyRender = sidebar.render.bind(sidebar)
    sidebar.render = (...args) => sidebar.SHOW_WORKSPACE ? this.render(...args) : legacyRender(...args)
    const legacyRun = sidebar.run.bind(sidebar)
    sidebar.run = (session, action, win) => sidebar.SHOW_WORKSPACE && action !== 'translate'
      ? this.run(session, action, win) : legacyRun(session, action, win)
    const mount = sidebar.mountWindow.bind(sidebar)
    sidebar.mountWindow = win => {
      const view = mount(win)
      if (view && !view.contextTimer) view.contextTimer = win.setInterval(() => {
        if (!view.open) return
        try {
          sidebar.syncWindow(win)
          const session = sidebar.sessionFor(sidebar.activeItem(win))
          if (!session) return
          const active = PaperMindReaderContext.active(win, session.paper)
          const w = this.state(session)
          const marker = active ? `${active.attachment.key}:${active.page}` : ''
          if (w.marker !== marker) {
            w.marker = marker
            if (session.source && (!active || session.source.attachmentKey !== active.attachment.key || session.source.page !== active.page)) session.source = null
            sidebar.refresh(session)
          }
        } catch (error) { PaperMind.log('reader context refresh failed: ' + error.message) }
      }, 750)
      return view
    }
    const remove = sidebar.removeFromWindow.bind(sidebar)
    sidebar.removeFromWindow = win => {
      const view = sidebar.windows.get(win)
      if (view?.contextTimer) win.clearInterval(view.contextTimer)
      remove(win)
    }
  },

  state(session) {
    return session.workspace ||= { loaded: false, loading: null, revision: 0, savedRevision: 0,
      cards: [], board: [], mode: 'read', guide: null, quiz: [], quizDraft: '', marker: '', storageError: '', writeQueue: Promise.resolve(), translating: new Set() }
  },

  autoTranslate() { return Zotero.Prefs.get(this.cardTranslatePref, true) !== false },
  mostlyChinese(text) { return (String(text).match(/[\u4e00-\u9fff]/g) || []).length > String(text).length * 0.3 },

  // Excerpt cards keep the original text and its translation together, so a
  // translation read in the PDF is not lost once the popup closes.
  async translateCard(session, card, manual = false) {
    const w = this.state(session), win = Zotero.getMainWindow(), text = card.content
    w.translating ||= new Set()
    if (w.translating.has(card) || card.translation || this.mostlyChinese(text)) return
    if (!manual && (!this.autoTranslate() || !['api', 'codex'].includes(PaperMind.ai?.config?.().mode))) return
    if (text.length > 3000) {
      if (manual) { session.error = '原文超过 3000 字，请缩短卡片后再生成译文。'; this.sidebar.refresh(session) }
      return
    }
    if (manual && !await PaperMind.ai.ensure(win)) return
    w.translating.add(card); this.sidebar.refresh(session)
    const controller = new win.AbortController(), timer = win.setTimeout(() => controller.abort(), 90000)
    try {
      const data = await PaperMind.ai.request(win, '/api/translate', { text }, controller.signal)
      if (!data.ok || !data.translated) throw new Error(data.error || '没有收到译文。')
      // An edit during the request makes this translation stale.
      if (card.content === text && w.cards.includes(card)) {
        card.translation = String(data.translated).slice(0, 10000)
        await this.persist(session, false)
      }
    } catch (error) {
      session.error = '卡片译文未生成：' + (controller.signal.aborted ? '等待超时' : error.message) + '。可在卡片上点「补译文」重试。'
    } finally { win.clearTimeout(timer); w.translating.delete(card); this.sidebar.refresh(session) }
  },

  startHint(session, active) {
    const w = this.state(session)
    if (!w.loaded || session.busy || w.guide || w.cards.length || w.board.length || w.quiz.length
      || session.messages.length || session.source || session.draft.trim()) return null
    if (String(session.paper.getField('abstractNote') || '').trim()) {
      return { action: 'abstract', text: '先点「读摘要」，了解研究问题和主要结论。' }
    }
    if (active?.pdf) {
      return { action: 'map', text: '条目没有摘要，先点「阅读路线」，从 PDF 正文梳理阅读顺序。' }
    }
    return { action: null, text: '条目没有摘要，先打开这篇的 PDF，等待文字加载后再点「阅读路线」。' }
  },

  async diagnostics(win) {
    try {
      const session = this.sidebar.sessionFor(this.sidebar.activeItem(win))
      if (!session) return { activePaper: false }
      const active = PaperMindReaderContext.active(win, session.paper)
      const context = await PaperMindReaderContext.collect(active)
      const w = this.state(session)
      return { activePaper: true, pdfAvailable: Boolean(active?.pdf), page: context.page,
        totalPages: active?.pdf?.numPages || 0, currentPageCharacters: context.currentText.length,
        contextCharacters: context.pages.length, coverage: context.coverage, extractionError: context.firstError || null,
        recordsLoaded: w.loaded, storageError: w.storageError || null }
    } catch (error) { return { error: error.message } }
  },

  async path(session) {
    const win = Zotero.getMainWindow()
    const digest = await win.crypto.subtle.digest('SHA-256', new win.TextEncoder().encode(session.key))
    const name = Array.from(new Uint8Array(digest), x => x.toString(16).padStart(2, '0')).join('')
    const dir = PathUtils.join(Zotero.Profile.dir, 'papermind-reading')
    await IOUtils.makeDirectory(dir, { ignoreExisting: true, permissions: 0o700 })
    return PathUtils.join(dir, name + '.json')
  },

  async load(session) {
    const w = this.state(session)
    if (w.loaded) return
    if (w.loading) return w.loading
    w.loading = (async () => {
      try {
        const path = await this.path(session)
        if (await IOUtils.exists(path)) {
          const data = await IOUtils.readJSON(path)
          const texts = values => Array.isArray(values) && values.every(x => x && typeof x.content === 'string')
          if (data.version !== 1 || !texts(data.cards) || !texts(data.board) || !texts(data.messages)
            || (data.quiz && !texts(data.quiz)) || (data.guide && typeof data.guide.content !== 'string')) throw new Error('阅读记录格式无法识别，未覆盖原文件。')
          w.cards = data.cards; w.board = data.board
          session.messages = data.messages
          w.guide = data.guide || null
          w.quiz = Array.isArray(data.quiz) ? data.quiz : []
          w.boardExport = data.boardExport || null
          session.draft = String(data.draft || '')
        }
        w.loaded = true
        w.storageError = ''
      } catch (error) { w.storageError = '本地记录未能读取：' + error.message }
      finally { w.loading = null; this.sidebar.refresh(session) }
    })()
    return w.loading
  },

  async persist(session, refresh = true) {
    const w = this.state(session)
    if (!w.loaded) throw new Error('本地记录尚未载入，未覆盖已有数据。')
    const revision = ++w.revision
    const data = JSON.parse(JSON.stringify({ version: 1, cards: w.cards, board: w.board,
      messages: session.messages, guide: w.guide, quiz: w.quiz, draft: session.draft, boardExport: w.boardExport }))
    const task = w.writeQueue.catch(() => {}).then(async () => {
      const path = await this.path(session)
      await IOUtils.writeJSON(path, data, { tmpPath: path + '.tmp', mode: 'overwrite', permissions: 0o600 })
      w.savedRevision = revision; w.storageError = ''
    })
    w.writeQueue = task
    try { await task } catch (error) { w.storageError = '本地保存失败，当前内容仍在窗口中：' + error.message }
    if (refresh || w.storageError) this.sidebar.refresh(session)
  },

  sameSource(left, right) {
    if (!left || !right) return !left && !right
    // Backup restore can reorder fields and omit display-only page labels.
    return ['text', 'page', 'attachmentKey', 'libraryID'].every(key => (left[key] ?? null) === (right[key] ?? null))
  },

  async capture(session, message) {
    await this.load(session)
    const w = this.state(session)
    if (!w.loaded) return
    const source = (message ? message.source : session.source) || null
    const text = message ? message.content : source?.text
    if (!text) { session.error = '先划选原文，或生成一条带读结果。'; this.sidebar.refresh(session); return }
    if (!w.cards.some(card => card.content === text && this.sameSource(card.source, source))) {
      const card = { id: Zotero.getMainWindow().crypto.randomUUID(), content: text,
        title: message?.question || '原文摘录', source: source ? { ...source } : null,
        origin: message ? (message.origin || 'AI 解读') : '原文', created: new Date().toISOString() }
      w.cards.push(card)
      await this.persist(session)
      if (!message) void this.translateCard(session, card)
    }
    w.mode = 'read'; session.status = '已存为本篇卡片。'; this.sidebar.refresh(session)
  },

  backup(session) {
    const w = this.state(session)
    if (!w.loaded || w.storageError) throw new Error('本地记录尚未成功载入或保存，请先处理保存错误。')
    return { format: 'litfinch-reading', version: 1, exportedAt: new Date().toISOString(),
      paper: { key: session.paper.key, title: session.paper.getField('title') },
      record: { version: 1, cards: w.cards, board: w.board, messages: session.messages, guide: w.guide,
        quiz: w.quiz, draft: session.draft } }
  },

  validateBackup(packet, session) {
    if (packet?.format !== 'litfinch-reading' || packet.version !== 1 || packet.paper?.key !== session.paper.key) {
      throw new Error('备份格式或 Zotero 条目编号不匹配。请打开原条目后恢复。')
    }
    const data = packet.record
    if (!data || data.version !== 1 || typeof data.draft !== 'string' || data.draft.length > 100000) throw new Error('阅读备份内容无效。')
    const clean = value => {
      if (!value || typeof value.content !== 'string' || value.content.length > 200000) throw new Error('阅读备份中的文字记录无效。')
      const next = { content: value.content }
      for (const key of ['id', 'question', 'display', 'coverage', 'origin', 'section', 'createdAt', 'translation']) if (typeof value[key] === 'string') next[key] = value[key].slice(0, 10000)
      if (['user', 'assistant'].includes(value.role)) next.role = value.role
      const source = value.source
      if (source && typeof source.text === 'string' && /^[A-Z0-9]{8}$/.test(source.attachmentKey || '')) {
        next.source = { text: source.text.slice(0, 50000), attachmentKey: source.attachmentKey,
          libraryID: session.paper.libraryID, page: Number.isInteger(source.page) && source.page > 0 ? source.page : null }
      }
      return next
    }
    const result = { version: 1, draft: data.draft, guide: data.guide ? clean(data.guide) : null, boardExport: null }
    for (const key of ['cards', 'board', 'messages', 'quiz']) {
      if (!Array.isArray(data[key]) || data[key].length > 10000) throw new Error('阅读备份记录列表无效。')
      result[key] = data[key].map(clean)
    }
    return result
  },

  async restore(session, packet) {
    const data = this.validateBackup(packet, session), w = this.state(session)
    if (!w.loaded || session.busy) throw new Error('请等待当前操作完成后恢复。')
    await w.writeQueue
    const path = await this.path(session)
    // Keep the previous state even when the user restores the wrong revision.
    if (await IOUtils.exists(path)) await IOUtils.copy(path, path + '.before-restore-' + Date.now() + '.json', { noOverwrite: true })
    await IOUtils.writeJSON(path, data, { tmpPath: path + '.tmp', mode: 'overwrite', permissions: 0o600 })
    Object.assign(w, { cards: data.cards, board: data.board, guide: data.guide, quiz: data.quiz, boardExport: null, storageError: '' })
    session.messages = data.messages; session.draft = data.draft
    this.sidebar.refresh(session)
  },

  async transfer(session, win, importing) {
    try {
      await this.load(session)
      const { FilePicker } = ChromeUtils.importESModule('chrome://zotero/content/modules/filePicker.mjs')
      const picker = new FilePicker()
      picker.init(win, importing ? '恢复本篇阅读记录' : '导出本篇阅读记录', importing ? picker.modeOpen : picker.modeSave)
      picker.appendFilter('研雀阅读记录', '*.json'); picker.defaultExtension = 'json'
      picker.defaultString = `litfinch-${session.paper.key}.json`
      if (await picker.show() === picker.returnCancel) return
      if (importing) {
        if ((await IOUtils.stat(picker.file)).size > 15 * 1024 * 1024) throw new Error('备份文件超过 15 MB，未导入。')
        const packet = await IOUtils.readJSON(picker.file)
        this.validateBackup(packet, session)
        if (!Services.prompt.confirm(win, '恢复阅读记录', '用所选备份恢复当前论文的阅读记录？当前记录会另存一份本机备份。')) return
        await this.restore(session, packet)
        session.status = '已恢复本篇阅读记录，恢复前的副本保留在本机。'
      } else {
        await this.state(session).writeQueue
        await IOUtils.writeJSON(picker.file, this.backup(session), { tmpPath: picker.file + '.tmp', mode: 'overwrite', permissions: 0o600 })
        session.status = '已导出本篇阅读记录；文件不含 API 密钥、登录凭据或 PDF。'
      }
    } catch (error) { session.error = error.message }
    this.sidebar.refresh(session)
  },

  async toBoard(session, item, section) {
    await this.load(session)
    const w = this.state(session)
    if (!w.loaded || !this.boardSections.includes(section)) return
    if (!w.board.some(x => x.section === section && x.content === item.content && this.sameSource(x.source, item.source))) {
      w.board.push({ id: Zotero.getMainWindow().crypto.randomUUID(), section, content: item.content,
        source: item.source ? { ...item.source } : null, origin: item.origin || 'AI 解读',
        ...(item.translation ? { translation: item.translation } : {}) })
      await this.persist(session)
    }
    w.mode = 'board'; this.sidebar.refresh(session)
  },

  async exportBoard(session, editable) {
    const w = this.state(session)
    if (!w.board.length) return
    const content = this.boardSections.map(section => section + '\n' + w.board.filter(x => x.section === section)
      .map(x => x.content + (x.translation ? `\n译文：${x.translation}` : '') + (x.source ? `\n原文：${this.sidebar.sourceURL(x.source)}` : '')).join('\n\n')).join('\n\n')
    const message = w.boardExport?.content === content ? w.boardExport : { question: '单篇汇报', content, source: null }
    w.boardExport = message
    await this.sidebar.saveNote(session, message, editable)
    await this.persist(session)
  },

  async run(session, action, win) {
    if (session.busy) return
    const w = this.state(session)
    const prompt = (action === 'quizAnswer' ? w.quizDraft : session.draft).trim()
    const source = !['abstract', 'map', 'page', 'quiz'].includes(action) && session.source ? { ...session.source } : null
    const active = action === 'abstract' ? null : PaperMindReaderContext.active(win, session.paper)
    const activeSnapshot = active ? { ...active } : null
    const controller = new win.AbortController()
    const request = ++session.request
    session.busy = true; session.controller = controller; session.error = ''; session.status = action === 'abstract' ? '正在读取条目摘要…' : '正在读取本地论文…'
    this.sidebar.refresh(session)
    const current = () => request === session.request && this.sidebar.sessionFor(session.paper) === session && !controller.signal.aborted
    let timer
    try {
      await this.load(session)
      if (!w.loaded) throw new Error(w.storageError)
      if (!current()) return
      if (!await PaperMind.ai.ensure(win)) return
      if (!current()) return
      if (action === 'chat' && !prompt) throw new Error('先写下想问的问题。')
      if (action === 'quizAnswer' && (!prompt || !w.quiz.length)) throw new Error('先回答当前自测问题。')
      if (action === 'guide' && !source?.text) throw new Error('请先在 PDF 中划选文字。')
      if ((source?.text.length || 0) > 6000) throw new Error('选段超过 6000 字，请缩小选区。')
      if (source && activeSnapshot && source.attachmentKey !== activeSnapshot.attachment.key) throw new Error('选段属于另一附件，请重新划选。')
      const paper = PaperMind.buildPaper(session.paper)
      if (action === 'abstract' && !paper.abstract.trim()) throw new Error('条目没有摘要，可使用阅读路线或读当前页。')
      timer = win.setTimeout(() => controller.abort(), 90000)
      const context = action === 'abstract' ? { page: null, currentText: '', pages: '', coverage: '依据条目摘要' }
        : await PaperMindReaderContext.collect(activeSnapshot, prompt + ' ' + (source?.text || ''), controller.signal)
      if (!current()) return
      if (action === 'page' && !context.currentText.trim()) throw new Error('当前页没有可读取的文字层。仍可划选可用文字，或读摘要。')
      if (!paper.abstract && !context.currentText && !context.pages.replace(/^\[读取范围[^\n]*\]\n?/, '').trim() && !source?.text) throw new Error('尚未读到论文文字，请等待 PDF 加载后重试。')
      const instructions = {
        // Each reading task states its own length; without it models expand into long reviews.
        map: '为这篇论文制定阅读路线。先用一句话说明文献类型和研究问题，再列最多5步，每步一句：先读哪一部分、核对什么证据或数字，并标页码。依据给出的页码内容，不预设文章一定是临床试验。不写标题和总结。',
        abstract: '带读这篇论文的摘要。',
        page: '带读当前页，用约250—350字（含标点）。第一句用大白话说这页在讲什么；再讲最多3个要点，每点1—2句，标页码。术语第一次出现时顺带用一句话解释；出现数字时说清它代表什么。只讲本页内容，其他页仅用于帮助理解，不把本页没有的信息当成已知。不写标题，不逐句复述原文，不写总结段。',
        guide: '精读选中的这段原文，用约200—300字（含标点）。先用一两句大白话说这段在讲什么，再解释关键术语，最后说明它在全文论证中起什么作用。区分作者陈述与推断，保留原文限定词。不写标题，不逐句复述原文。',
        quiz: '基于给出的本文原文与阅读卡片，提出一个需要理解而非背诵的问题。一次只问一题，先不要给答案。附可回看的 PDF 页码。',
        quizAnswer: '核对我对上一题的回答，指出哪些有原文支持、哪些需要修正，并给出原文页码。不要根据原文没有的信息评分。我的回答：' + prompt,
      }
      const history = action === 'quizAnswer' ? w.quiz : action === 'chat' ? session.messages : []
      const userMessage = (instructions[action] || prompt).slice(0, 2000)
      const cards = action.startsWith('quiz') ? w.cards.slice(-6).map(x => x.content).join('\n').slice(0, 2500) : ''
      const paperFields = { paper_title: paper.title.slice(0, 500), paper_abstract: paper.abstract.slice(0, 5000) }
      const payload = action === 'abstract' ? { ...paperFields, mode: 'abstract' } : { ...paperFields,
        paper_rowid: 0, message: userMessage,
        history: history.slice(-8).map(({ role, content }) => ({ role, content: content.slice(0, 8000) })),
        current_page: context.page, current_page_text: context.currentText,
        paper_pages: (context.pages + (cards ? '\n[个人阅读卡片，可能含推断，需回原文核对]\n' + cards : '')).slice(0, 24000),
        quote: source ? { text: source.text.slice(0, 4000), page: source.page } : null }
      const question = ({ map: '阅读路线', abstract: '摘要带读', page: `第 ${context.page} 页带读`, guide: '精读这段', quiz: '考考自己', quizAnswer: '核对回答' })[action] || prompt
      // Show the answer as it arrives; only the finished answer is saved.
      const target = action.startsWith('quiz') ? 'quiz' : action === 'chat' ? 'chat' : 'read'
      w.mode = target; w.streaming = { request, mode: target, question, prompt: action === 'chat' ? prompt : '', text: '' }
      session.status = '正在生成…'; w.coverage = context.coverage; this.sidebar.refresh(session)
      const onDelta = text => {
        if (!current() || w.streaming?.request !== request) return
        w.streaming.text = text
        // Streaming resets the wait limit; only a stalled service times out.
        win.clearTimeout(timer); timer = win.setTimeout(() => controller.abort(), 90000)
        if (!w.streamTimer) w.streamTimer = win.setTimeout(() => { w.streamTimer = null; this.sidebar.refresh(session) }, 100)
      }
      const data = await PaperMind.ai.request(win, '/api/chat', payload, controller.signal, onDelta)
      if (!current()) return
      if (!data.ok || !data.reply) throw new Error(data.error || data.reply || '没有收到内容，请重试。')
      const pageSource = activeSnapshot && context.page ? { text: context.currentText, page: context.page,
        attachmentKey: activeSnapshot.attachment.key, libraryID: activeSnapshot.attachment.libraryID } : null
      const result = { role: 'assistant', content: String(data.reply), question,
        source: source || (['page', 'chat'].includes(action) ? pageSource : null), coverage: context.coverage }
      if (action.startsWith('quiz')) {
        if (action === 'quiz') w.quiz = []
        w.quiz.push({ role: 'user', content: userMessage }, result); w.mode = 'quiz'
        if (w.quizDraft.trim() === prompt) w.quizDraft = ''
      } else if (action === 'chat') {
        session.messages.push({ role: 'user', content: prompt + (source ? '\n所选原文：' + source.text : ''), display: prompt }, result)
        w.mode = 'chat'
        if (session.draft.trim() === prompt) session.draft = ''
      } else { w.guide = result; w.mode = 'read' }
      session.status = ''; await this.persist(session)
    } catch (error) {
      if (request === session.request) session.error = controller.signal.aborted ? '已停止或等待超时，可重试。' : error.message
    } finally {
      if (timer) win.clearTimeout(timer)
      if (w.streaming?.request === request) w.streaming = null
      if (request === session.request) { session.busy = false; session.controller = null; this.sidebar.refresh(session) }
    }
  },

  renderToggles(parent, el) {
    el('h3', '划词与卡片', parent)
    for (const [label, pref, checked] of [
      ['划词时显示「翻译」按钮（已用其他翻译插件时可关闭）', this.sidebar.popupTranslatePref, this.sidebar.showPopupTranslate()],
      ['划词存卡片时自动附中文译文', this.cardTranslatePref, this.autoTranslate()],
    ]) {
      const row = el('label', null, parent, 'pmw-check')
      const box = el('input', null, row); box.type = 'checkbox'; box.checked = checked
      el('span', label, row)
      box.addEventListener('change', () => Zotero.Prefs.set(pref, box.checked, true))
    }
  },

  // Zotero's own Settings window: the same AI form and switches as the panel.
  renderPreferences(root) {
    const doc = root.ownerDocument, win = Zotero.getMainWindow()
    const el = (tag, text, parent, cls) => {
      const node = doc.createElementNS('http://www.w3.org/1999/xhtml', tag)
      if (text != null) node.textContent = text
      if (cls) node.className = cls
      parent.appendChild(node); return node
    }
    const button = (parent, text, action, disabled = false) => {
      const node = el('button', text, parent); node.type = 'button'; node.disabled = disabled
      node.addEventListener('click', () => Promise.resolve().then(action).catch(error => { PaperMind.ai.status = error.message; draw() }))
      return node
    }
    const draw = () => {
      if (!root.isConnected) return
      root.replaceChildren()
      const box = el('div', null, root, 'pmw pmw-prefs')
      el('style', this.styles, box)
      PaperMind.ai?.render(win, box, el, button, draw)
      this.renderToggles(box, el)
      el('p', '本篇阅读记录的导出与恢复，在阅读台的「设置」中进行。', box, 'pmw-muted')
    }
    draw()
  },

  render(body, item, editable) {
    const sidebar = this.sidebar, session = sidebar.sessionFor(item), doc = body.ownerDocument, win = doc.defaultView
    const prior = body.querySelector('.pmw-scroll'), scrollTop = prior?.scrollTop || 0
    const nearBottom = prior && prior.scrollHeight - prior.scrollTop - prior.clientHeight < 40
    const focused = doc.activeElement
    const focusName = body.contains(focused) ? focused.getAttribute('data-input') : null
    const selection = focusName ? [focused.selectionStart, focused.selectionEnd] : null
    body.replaceChildren()
    if (session) sidebar.views.set(body, { session, item, editable }); else sidebar.views.delete(body)
    const el = (tag, text, parent, cls) => {
      const node = doc.createElementNS('http://www.w3.org/1999/xhtml', tag)
      if (text != null) node.textContent = text
      if (cls) node.className = cls
      parent.appendChild(node); return node
    }
    const button = (parent, text, action, disabled = false) => {
      const node = el('button', text, parent); node.type = 'button'; node.disabled = disabled
      node.addEventListener('click', () => Promise.resolve().then(action).catch(error => {
        if (session) { session.error = error.message; sidebar.refresh(session) }
      })); return node
    }
    const root = el('div', null, body, 'pmw')
    root.setAttribute('aria-label', '研雀阅读台')
    el('style', this.styles, root)
    const head = el('header', null, root)
    const line = el('div', null, head, 'pmw-row')
    el('strong', '研雀 · 阅读台', line)
    const tools = el('div', null, line)
    // One entry for settings; its label says when AI still needs connecting.
    const connected = !PaperMind.ai || ['api', 'codex'].includes(PaperMind.ai.config().mode)
    button(tools, connected ? '设置' : '连接 AI', () => { const w = this.state(session); w.mode = w.mode === 'settings' ? 'read' : 'settings'; sidebar.refresh(session) }, !session)
      .className = connected ? '' : 'pmw-primary'
    button(tools, '关闭', () => sidebar.toggleWindow(win, false))
    if (!session) { el('p', '在 Zotero 中打开一篇 PDF，即可开始带读。', root); return }
    const w = this.state(session), active = PaperMindReaderContext.active(win, session.paper)
    el('div', session.paper.getField('title'), head, 'pmw-title')
    el('div', active?.page ? `本地 PDF · 第 ${active.page} / ${active.pdf?.numPages || '?'} 页` : '条目摘要 · 等待打开本地 PDF', head, 'pmw-muted')
    if (!w.loaded && !w.loading && !w.storageError) void this.load(session)
    const mode = name => { w.mode = name; sidebar.refresh(session) }
    const tabs = el('nav', null, head, 'pmw-tabs')
    tabs.setAttribute('aria-label', '阅读台分区')
    for (const [label, name] of [['阅读', 'read'], ['对话', 'chat'], ['自测', 'quiz'], [`汇报 · ${w.board.length}`, 'board']]) {
      const tab = button(tabs, label, () => mode(name))
      if (w.mode === name) tab.setAttribute('aria-current', 'page')
    }
    const content = el('main', null, root, 'pmw-scroll')
    const busy = session.busy || !w.loaded
    // Page link sits in the card head so the action row stays on one line.
    const sourceLink = (parent, source) => {
      const link = button(parent, `第 ${source.page || '?'} 页 ↗`, () => sidebar.openSource(source, session))
      link.className = 'pmw-link'; link.setAttribute('aria-label', `原文 · 第 ${source.page || '?'} 页`)
    }
    const resultHead = (parent, label, source, heading = false) => {
      const row = el('div', null, parent, 'pmw-card-head')
      el(heading ? 'h3' : 'div', label, row, heading ? null : 'pmw-muted')
      if (source) sourceLink(row, source)
    }
    // The partial answer shows only while its own request is running.
    const live = session.busy && w.streaming?.mode === w.mode ? w.streaming : null
    const streamCard = parent => {
      const card = el('article', null, parent, 'pmw-card')
      card.setAttribute('aria-busy', 'true')
      resultHead(card, live.mode === 'chat' ? '研雀' : live.question, null, live.mode !== 'chat')
      if (live.text) sidebar.renderAnswer(el('div', null, card, 'pmw-text'), live.text)
      el('div', live.text ? '生成中…' : '正在等待回答…', card, 'pmw-muted')
    }
    const translationBlock = (parent, text) => {
      const box = el('div', null, parent, 'pmw-translation')
      el('div', '译文', box, 'pmw-muted')
      el('div', text, box, 'pmw-text')
    }
    const saved = result => w.cards.some(card => card.content === result.content && this.sameSource(card.source, result.source || null))
    // Every refresh rebuilds the DOM, so open menus are remembered by result.
    const toBoardMenu = (row, result) => {
      const menu = el('details', null, row, 'pmw-menu')
      menu.open = w.openMenu === result
      menu.addEventListener('toggle', () => { if (menu.open) w.openMenu = result; else if (w.openMenu === result) w.openMenu = null })
      el('summary', '送到汇报 ▾', menu)
      const list = el('div', null, menu)
      for (const section of this.boardSections) button(list, section, () => { w.openMenu = null; return this.toBoard(session, result, section) }, !w.loaded)
    }
    const startEdit = item => { w.editing = item; w.editDraft = item === 'new' ? '' : item.content; w.focusEdit = true; sidebar.refresh(session) }
    const editor = parent => {
      const box = el('div', null, parent, 'pmw-editor')
      const area = el('textarea', null, box); area.value = w.editDraft; area.maxLength = 20000
      area.rows = Math.min(14, Math.max(4, w.editDraft.split('\n').length + 1))
      area.placeholder = '写下关键证据、问题或自己的判断…'
      area.setAttribute('aria-label', '编辑内容'); area.dataset.input = 'edit'
      area.addEventListener('input', () => { w.editDraft = area.value })
      const cancel = () => { w.editing = null; w.editDraft = ''; sidebar.refresh(session) }
      area.addEventListener('keydown', event => {
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); void this.saveEdit(session) }
        else if (event.key === 'Escape') { event.preventDefault(); cancel() }
      })
      const row = el('div', null, box, 'pmw-actions')
      button(row, '保存', () => this.saveEdit(session), !w.loaded).className = 'pmw-primary'
      button(row, '取消', cancel)
      if (w.focusEdit) { w.focusEdit = false; win.setTimeout(() => area.isConnected && area.focus(), 0) }
    }
    const actions = (parent, result) => {
      const row = el('div', null, parent, 'pmw-actions')
      if (saved(result)) button(row, '✓ 已存卡片', () => {}, true)
      else button(row, '存为卡片', () => this.capture(session, result), !w.loaded)
      toBoardMenu(row, result)
      return row
    }
    if (w.mode === 'settings') {
      PaperMind.ai?.render(win, content, el, button, () => sidebar.refresh(session))
      const SHOW_LEGACY_ACCOUNT = false
      if (SHOW_LEGACY_ACCOUNT && PaperMind.account) {
        const account = PaperMind.account.record()?.account
        el('h3', '研雀账号', content)
        el('p', account ? `已登录：${account.username}` : '使用 Zotero 账号连接网站与插件，本地卡片无需登录。', content)
        el('p', PaperMind.account.status, content, 'pmw-muted')
        if (PaperMind.account.pending || PaperMind.account.starting) button(content, '取消登录', () => PaperMind.account.cancel())
        else button(content, account ? '重新登录' : '使用 Zotero 账号继续', () => PaperMind.account.start(win))
        if (account) button(content, '退出账号', () => PaperMind.account.logout(win))
      }
      this.renderToggles(content, el)
      el('h3', '连接与数据', content)
      el('p', 'PDF 在本地读取。点击 AI 操作时向个人配置的服务发送题名、摘要、当前页、选段和相关文字节选；不上传 PDF 文件。', content)
      el('p', '卡片、对话、自测和汇报保存在本机 Zotero 配置目录。研雀不备份这些记录；导出的文件由使用者自行保存。保存到 Zotero 笔记的内容遵循 Zotero 自身的同步设置。', content)
      button(content, '导出本篇完整阅读记录', () => this.transfer(session, win, false), busy)
      button(content, '恢复本篇阅读记录', () => this.transfer(session, win, true), busy)
      el('p', w.coverage || '尚未发起 AI 操作。', content, 'pmw-muted')
      if (SHOW_LEGACY_ACCOUNT) button(content, '旧版专属链接设置', async () => { await PaperMind.promptSettings(win); sidebar.syncWindow(win) }, session.busy || Boolean(PaperMind.account?.record()) || Boolean(PaperMind.account?.pending))
    } else if (w.mode === 'board') {
      el('h3', '单篇汇报', content)
      for (const section of this.boardSections) {
        el('h4', section, content)
        const rows = w.board.filter(x => x.section === section)
        if (!rows.length) el('p', '从带读结果或卡片送入材料。', content, 'pmw-muted')
        for (const entry of rows) {
          const card = el('article', null, content, 'pmw-card')
          if (w.editing === entry) { editor(card); continue }
          el('div', entry.content, card, 'pmw-text')
          if (entry.translation) translationBlock(card, entry.translation)
          const row = el('div', null, card, 'pmw-actions')
          button(row, '编辑', () => startEdit(entry))
          if (entry.source) sourceLink(row, entry.source)
        }
      }
      button(content, '保存汇报到 Zotero 笔记', () => this.exportBoard(session, editable), !editable || !w.board.length).className = 'pmw-primary'
    } else if (w.mode === 'quiz') {
      el('h3', '考考自己', content)
      if (!w.quiz.length) el('p', '结合本篇原文与卡片，一次讨论一个问题。', content)
      for (const message of w.quiz) {
        if (message.role === 'user') continue
        const box = el('article', null, content, 'pmw-card')
        resultHead(box, '研雀', message.source)
        sidebar.renderAnswer(el('div', null, box, 'pmw-text'), message.content)
        actions(box, message)
      }
      if (live) streamCard(content)
      button(content, w.quiz.length ? '换一道题' : '出一道题', () => this.run(session, 'quiz', win), busy).className = w.quiz.length ? '' : 'pmw-primary'
      if (w.quiz.length) {
        const answer = el('textarea', null, content); answer.value = w.quizDraft
        answer.maxLength = 1800; answer.placeholder = '用自己的话回答，并指出原文依据…'
        answer.setAttribute('aria-label', '自测回答'); answer.dataset.input = 'quiz'
        answer.addEventListener('input', () => { w.quizDraft = answer.value })
        button(content, '核对回答', () => this.run(session, 'quizAnswer', win), busy)
        button(content, '带入对话', () => { session.draft = `关于自测：${w.quiz.filter(x => x.role === 'assistant').at(-1)?.content || ''}\n我的疑问：`.slice(0, 1500); mode('chat') })
      }
    } else if (w.mode === 'chat') {
      el('h3', '关于这篇的对话', content)
      if (!session.messages.length) el('p', '结合当前页、选段与论文背景继续问。', content, 'pmw-muted')
      for (const message of session.messages) {
        const box = el('article', null, content, 'pmw-card' + (message.role === 'user' ? ' pmw-ask' : ''))
        resultHead(box, message.role === 'user' ? '提问' : '研雀', message.role === 'assistant' ? message.source : null)
        sidebar.renderAnswer(el('div', null, box, 'pmw-text'), message.display || message.content)
        if (message.role === 'assistant') actions(box, message)
      }
      if (live) {
        if (live.prompt) {
          const ask = el('article', null, content, 'pmw-card pmw-ask')
          resultHead(ask, '提问', null)
          sidebar.renderAnswer(el('div', null, ask, 'pmw-text'), live.prompt)
        }
        streamCard(content)
      }
    } else {
      const hint = this.startHint(session, active)
      if (hint) el('p', hint.text, content, 'pmw-start').setAttribute('aria-label', '阅读起步提示')
      const controls = el('div', null, content, 'pmw-actions')
      for (const [label, action] of [['阅读路线', 'map'], ['读摘要', 'abstract'], ['读当前页', 'page']]) {
        const control = button(controls, label, () => this.run(session, action, win), busy)
        if (hint?.action === action) control.className = 'pmw-start-action'
      }
      if (live) streamCard(content)
      else if (w.guide) {
        const guide = el('article', null, content, 'pmw-card')
        resultHead(guide, w.guide.question, w.guide.source, true)
        sidebar.renderAnswer(el('div', null, guide, 'pmw-text'), w.guide.content)
        const row = actions(guide, w.guide)
        button(row, '继续追问', () => { session.draft = `关于${w.guide.question}：`; session.messages.push({ role: 'user', content: w.guide.question }, { ...w.guide }); mode('chat') })
        button(row, '收起', () => { w.guide = null; void this.persist(session) }).classList.add('pmw-end')
      } else el('p', hint ? '阅读路线：先读哪些部分、核对哪些证据。读当前页：解释当前页文字。'
        : '先抓整篇思路，或跟着当前页读。划选原文可直接精读、翻译或存卡片。', content, 'pmw-muted')
      const cardHead = el('div', null, content, 'pmw-row')
      el('h3', `阅读卡片 · ${w.cards.length}`, cardHead)
      button(cardHead, '写卡片', () => startEdit('new'), !w.loaded || w.editing === 'new')
      if (w.editing === 'new') editor(el('article', null, content, 'pmw-card'))
      else if (!w.cards.length) el('p', '留下关键证据、问题和自己的判断。每张卡片保留原文出处。', content, 'pmw-muted')
      for (const card of w.cards) {
        const node = el('article', null, content, 'pmw-card')
        resultHead(node, card.origin, card.source)
        if (w.editing === card) { editor(node); continue }
        el('div', card.content, node, 'pmw-text')
        if (card.translation) translationBlock(node, card.translation)
        else if (w.translating?.has(card)) el('div', '正在生成译文…', node, 'pmw-muted pmw-translation')
        const row = el('div', null, node, 'pmw-actions')
        button(row, '编辑', () => startEdit(card))
        if (!card.translation && !w.translating?.has(card) && !this.mostlyChinese(card.content)) button(row, '补译文', () => this.translateCard(session, card, true))
        button(row, card.noteID ? '✓ 已存为 Zotero 笔记' : '存为 Zotero 笔记', async () => {
          card.question = card.title || '阅读卡片'
          await sidebar.saveNote(session, card, editable)
          await this.persist(session)
        }, !editable || Boolean(card.noteID || card.saving))
        toBoardMenu(row, card)
      }
    }
    const footer = el('footer', null, root)
    if (session.source) {
      const selected = el('details', null, footer, 'pmw-source')
      selected.open = Boolean(w.sourceOpen)
      selected.addEventListener('toggle', () => { w.sourceOpen = selected.open })
      el('summary', `选段 · 第 ${session.source.page || '?'} 页 · ${session.source.text.slice(0, 35)}`, selected)
      el('blockquote', session.source.text, selected)
      button(selected, '存为卡片', () => this.capture(session), !w.loaded)
      button(selected, '清除选段', () => { session.source = null; sidebar.refresh(session) })
    }
    const input = el('textarea', null, footer)
    input.value = session.draft; input.maxLength = 1800; input.placeholder = '针对这篇，继续问…'
    input.disabled = !w.loaded
    input.setAttribute('aria-label', '继续追问'); input.dataset.input = 'chat'
    input.addEventListener('input', () => { session.draft = input.value })
    // Blur occurs before the adjacent Send button's click. Persist silently so
    // replacing the DOM here cannot swallow that click.
    input.addEventListener('change', () => { if (w.loaded) void this.persist(session, false) })
    input.addEventListener('keydown', event => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); void this.run(session, 'chat', win) }
    })
    const send = el('div', null, footer, 'pmw-row')
    el('span', w.loaded ? (w.storageError ? '保存异常' : '本机阅读记录') : '正在载入记录…', send, 'pmw-muted')
    const actionsRight = el('div', null, send, 'pmw-actions')
    if (session.busy) button(actionsRight, '停止', () => sidebar.cancel(session))
    button(actionsRight, session.busy ? '生成中…' : '发送', () => this.run(session, 'chat', win), busy).className = 'pmw-primary'
    const error = session.error || w.storageError
    if (error || session.status) {
      const status = el('div', error || session.status, footer, error ? 'pmw-error' : 'pmw-muted')
      status.setAttribute('role', error ? 'alert' : 'status')
      if (w.storageError) button(status, '重试本地记录', () => w.loaded ? this.persist(session) : this.load(session))
    }
    content.scrollTop = live && nearBottom ? content.scrollHeight : scrollTop
    if (focusName) { const target = root.querySelector(`[data-input="${focusName}"]`); if (target) { target.focus(); target.setSelectionRange(...selection) } }
  },

  // Editing happens inside the card; a multi-paragraph card cannot fit a one-line prompt.
  async saveEdit(session) {
    const w = this.state(session), item = w.editing, text = String(w.editDraft || '').trim()
    if (!item) return
    if (!text) { session.error = '内容为空，未保存。'; this.sidebar.refresh(session); return }
    w.editing = null; w.editDraft = ''; session.error = ''
    if (item === 'new') return this.capture(session, { content: text, question: '阅读笔记', origin: '个人笔记', source: session.source })
    if (text !== item.content) { item.content = text; item.origin = '个人编辑'; item.noteID = null; delete item.translation }
    await this.persist(session)
  },

  styles: `
  .pmw{color-scheme:light dark;--pm-bg:light-dark(#fffefa,#242a26);--pm-fg:light-dark(#273d30,#e5eee7);--pm-line:#89988844;--pm-control:#89988855;--pm-field-line:#89988877;--pm-hover:#78968118;--pm-soft:#78968112;--pm-field:light-dark(#fff,#1f2521);--pm-raised:light-dark(#fff,#2c332e);--pm-accent:light-dark(#365d4b,#8fbf9f);--pm-mark:#6b8b73;--pm-start:light-dark(#e3eee4,#3a5443);--pm-link:light-dark(#3f6e55,#9cc7ab);--pm-primary:light-dark(#365d4b,#4a7559);--pm-primary-hover:light-dark(#2b4c3d,#55836a)}
  .pmw{background:var(--pm-bg);color:var(--pm-fg);font:14px/1.65 system-ui;display:flex;flex:1;flex-direction:column;box-sizing:border-box;width:100%;max-width:100%;min-width:0;height:100%;min-height:0;overflow:hidden}
  .pmw *{box-sizing:border-box}.pmw header,.pmw footer{flex:none;padding:12px 15px;border-bottom:1px solid var(--pm-line)}.pmw footer{border-top:1px solid var(--pm-line);border-bottom:0;max-height:45%;overflow:auto}
  .pmw button,.pmw summary{font:inherit;font-size:13px;cursor:pointer}.pmw button{border:1px solid var(--pm-control);background:transparent;color:inherit;border-radius:7px;padding:4px 10px;margin:2px}.pmw button:disabled{opacity:.5;cursor:default}
  .pmw button:not(:disabled):hover,.pmw-menu summary:hover{background:var(--pm-hover)}
  .pmw .pmw-primary{background:var(--pm-primary);border-color:transparent;color:#fff;font-weight:600}.pmw .pmw-primary:not(:disabled):hover{background:var(--pm-primary-hover)}
  .pmw .pmw-link{border-color:transparent;padding:2px 4px;color:var(--pm-link);white-space:nowrap}
  .pmw-tabs{display:flex;gap:2px;margin:10px -6px -12px}.pmw .pmw-tabs button{border:0;border-bottom:2px solid transparent;border-radius:0;margin:0;padding:6px 8px 7px;opacity:.68}.pmw .pmw-tabs button[aria-current=page]{opacity:1;font-weight:600;border-bottom-color:var(--pm-accent)}.pmw .pmw-tabs button:hover{background:transparent;opacity:1}
  .pmw h3{font-size:15px;margin:12px 0 8px}.pmw h4{font-size:14px;margin:16px 0 6px}.pmw p{margin:10px 0}.pmw-row{display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap}
  .pmw-title{font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:7px}.pmw-muted{font-size:12px;opacity:.72}.pmw-scroll{flex:1;min-height:0;overflow:auto;padding:12px 15px}.pmw-actions{display:flex;flex-wrap:wrap;align-items:center;gap:4px}
  .pmw .pmw-start{border-left:3px solid var(--pm-mark);padding-left:10px;margin:0 0 12px}.pmw .pmw-start-action{background:var(--pm-start);border-color:var(--pm-mark);font-weight:600}
  .pmw-card{border:1px solid var(--pm-line);border-radius:9px;padding:12px;margin:10px 0}.pmw-ask{background:var(--pm-soft);border-color:transparent}.pmw-card-head{display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin-bottom:4px}.pmw .pmw-card-head h3{margin:0}.pmw-card .pmw-actions{margin-top:8px}.pmw .pmw-end{margin-left:auto}
  .pmw-text{white-space:pre-wrap;overflow-wrap:anywhere}.pmw .pmw-text p{margin:0 0 8px}.pmw .pmw-text p:last-child{margin-bottom:0}.pmw .pmw-text ul,.pmw .pmw-text ol{margin:0 0 8px;padding-left:20px}
  .pmw .pmw-editor textarea{height:auto;margin-top:4px;resize:vertical}.pmw-editor .pmw-actions{justify-content:flex-end}
  .pmw label{display:block;font-size:12px;margin-top:10px}.pmw input,.pmw select{font:inherit;font-size:13px;color:inherit;background:var(--pm-field);border:1px solid var(--pm-field-line);border-radius:7px;padding:6px 8px}.pmw input:focus,.pmw select:focus,.pmw textarea:focus{outline:none;border-color:var(--pm-mark);box-shadow:0 0 0 2px #6b8b7326}.pmw select:disabled{opacity:.6}.pmw .pmw-check{display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer}.pmw .pmw-check input{margin:0;padding:0;accent-color:var(--pm-primary)}.pmw .pmw-translation{margin-top:8px;padding-top:8px;border-top:1px dashed var(--pm-control)}.pmw textarea{font:inherit;width:100%;height:66px;resize:vertical;padding:8px;background:transparent;color:inherit;border:1px solid var(--pm-field-line);border-radius:8px;margin-top:8px}
  .pmw-menu{position:relative;margin:2px}.pmw-menu summary{list-style:none;border:1px solid var(--pm-control);border-radius:7px;padding:4px 10px}.pmw-menu summary::-webkit-details-marker{display:none}
  .pmw-menu[open]>div{position:absolute;z-index:3;top:calc(100% + 4px);left:0;display:flex;flex-direction:column;min-width:120px;padding:4px;background:var(--pm-raised);border:1px solid var(--pm-control);border-radius:8px;box-shadow:0 6px 18px #0002}.pmw .pmw-menu div button{border-color:transparent;text-align:left;margin:0}
  .pmw.pmw-prefs{display:block;height:auto;overflow:visible;background:transparent;max-width:640px}.pmw-source{margin-top:8px;font-size:13px}.pmw-source summary{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.pmw blockquote{max-height:100px;overflow:auto;margin:6px;white-space:pre-wrap}.pmw-error{color:light-dark(#a4362e,#ffa79e);font-size:13px;white-space:pre-wrap}
  `,
}
