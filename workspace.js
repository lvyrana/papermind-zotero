/* Copyright (C) 2026 lvyrana · SPDX-License-Identifier: AGPL-3.0-only */
/* global Zotero, PaperMind, PaperMindReaderContext, IOUtils, PathUtils */
var PaperMindWorkspace = {
  boardSections: ['背景', '方法', '发现', '局限与启发'],

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
      cards: [], board: [], mode: 'read', guide: null, quiz: [], quizDraft: '', marker: '', storageError: '', writeQueue: Promise.resolve() }
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

  async capture(session, message) {
    await this.load(session)
    const w = this.state(session)
    if (!w.loaded) return
    const source = message?.source || session.source
    const text = message?.content || source?.text
    if (!text) { session.error = '先划选原文，或生成一条带读结果。'; this.sidebar.refresh(session); return }
    if (!w.cards.some(card => card.content === text && JSON.stringify(card.source) === JSON.stringify(source))) {
      w.cards.push({ id: Zotero.getMainWindow().crypto.randomUUID(), content: text,
        title: message?.question || '原文摘录', source: source ? { ...source } : null,
        origin: message ? (message.origin || 'AI 解读') : '原文', created: new Date().toISOString() })
      await this.persist(session)
    }
    w.mode = 'read'; session.status = '已存为本篇卡片。'; this.sidebar.refresh(session)
  },

  async toBoard(session, item, section) {
    await this.load(session)
    const w = this.state(session)
    if (!w.loaded || !this.boardSections.includes(section)) return
    if (!w.board.some(x => x.section === section && x.content === item.content && JSON.stringify(x.source) === JSON.stringify(item.source))) {
      w.board.push({ id: Zotero.getMainWindow().crypto.randomUUID(), section, content: item.content,
        source: item.source ? { ...item.source } : null, origin: item.origin || 'AI 解读' })
      await this.persist(session)
    }
    w.mode = 'board'; this.sidebar.refresh(session)
  },

  async exportBoard(session, editable) {
    const w = this.state(session)
    if (!w.board.length) return
    const content = this.boardSections.map(section => section + '\n' + w.board.filter(x => x.section === section)
      .map(x => x.content + (x.source ? `\n原文：${this.sidebar.sourceURL(x.source)}` : '')).join('\n\n')).join('\n\n')
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
    const active = PaperMindReaderContext.active(win, session.paper)
    const activeSnapshot = active ? { ...active } : null
    const controller = new win.AbortController()
    const request = ++session.request
    session.busy = true; session.controller = controller; session.error = ''; session.status = '正在读取本地论文…'
    this.sidebar.refresh(session)
    const current = () => request === session.request && this.sidebar.sessionFor(session.paper) === session && !controller.signal.aborted
    let timer
    try {
      await this.load(session)
      if (!w.loaded) throw new Error(w.storageError)
      if (!current()) return
      if (!await PaperMind.ensureConnection(win)) return
      if (!current()) return
      if (action === 'chat' && !prompt) throw new Error('先写下想问的问题。')
      if (action === 'quizAnswer' && (!prompt || !w.quiz.length)) throw new Error('先回答当前自测问题。')
      if (action === 'guide' && !source?.text) throw new Error('请先在 PDF 中划选文字。')
      if ((source?.text.length || 0) > 6000) throw new Error('选段超过 6000 字，请缩小选区。')
      if (source && activeSnapshot && source.attachmentKey !== activeSnapshot.attachment.key) throw new Error('选段属于另一附件，请重新划选。')
      timer = win.setTimeout(() => controller.abort(), 90000)
      const context = await PaperMindReaderContext.collect(activeSnapshot, prompt + ' ' + (source?.text || ''), controller.signal)
      if (!current()) return
      const paper = PaperMind.buildPaper(session.paper)
      if (action === 'page' && !context.currentText.trim()) throw new Error('当前页没有可读取的文字层。仍可划选可用文字，或读摘要。')
      if (action === 'abstract' && !paper.abstract) throw new Error('条目没有摘要，可使用阅读路线或读当前页。')
      if (!paper.abstract && !context.currentText && !context.pages.replace(/^\[读取范围[^\n]*\]\n?/, '').trim() && !source?.text) throw new Error('尚未读到论文文字，请等待 PDF 加载后重试。')
      const instructions = {
        map: '为这篇论文制定具体阅读路线：先明确文献类型和研究问题，再指出应该核对的证据和局限。依据给出的页码内容，不预设文章一定是临床试验。',
        abstract: '带读这篇论文的摘要，解释研究问题、文献类型、主要结论及证据边界。',
        page: '带读当前页，解释本页关键概念、论证和数字。标明原文页码，不把本页没有的信息当成已知。',
        guide: '精读选中的这段原文：拆解语义，解释关键术语，再联系本文前后文；区分作者陈述与推断，保留原文限定词。',
        quiz: '基于给出的本文原文与阅读卡片，提出一个需要理解而非背诵的问题。一次只问一题，先不要给答案。附可回看的 PDF 页码。',
        quizAnswer: '核对我对上一题的回答，指出哪些有原文支持、哪些需要修正，并给出原文页码。不要根据原文没有的信息评分。我的回答：' + prompt,
      }
      const history = action === 'quizAnswer' ? w.quiz : action === 'chat' ? session.messages : []
      const userMessage = (instructions[action] || prompt).slice(0, 2000)
      const cards = action.startsWith('quiz') ? w.cards.slice(-6).map(x => x.content).join('\n').slice(0, 2500) : ''
      const payload = { paper_title: paper.title.slice(0, 500), paper_abstract: paper.abstract.slice(0, 5000),
        paper_rowid: 0, message: userMessage,
        history: history.slice(-8).map(({ role, content }) => ({ role, content: content.slice(0, 8000) })),
        current_page: context.page, current_page_text: context.currentText,
        paper_pages: (context.pages + (cards ? '\n[个人阅读卡片，可能含推断，需回原文核对]\n' + cards : '')).slice(0, 24000),
        quote: source ? { text: source.text.slice(0, 4000), page: source.page } : null }
      session.status = '正在生成…'; w.coverage = context.coverage; this.sidebar.refresh(session)
      const response = await win.fetch(PaperMind.getBaseURL() + '/api/chat', {
        method: 'POST', headers: PaperMind.requestHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload), signal: controller.signal, redirect: 'error', credentials: 'omit' })
      await PaperMind.requireOk(response, '生成')
      const data = await response.json()
      if (!current()) return
      if (!data.ok || !data.reply) throw new Error(data.error || data.reply || '没有收到内容，请重试。')
      const pageSource = activeSnapshot && context.page ? { text: context.currentText, page: context.page,
        attachmentKey: activeSnapshot.attachment.key, libraryID: activeSnapshot.attachment.libraryID } : null
      const question = ({ map: '阅读路线', abstract: '摘要带读', page: `第 ${context.page} 页带读`, guide: '精读这段', quiz: '考考自己', quizAnswer: '核对回答' })[action] || prompt
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
      if (request === session.request) { session.busy = false; session.controller = null; this.sidebar.refresh(session) }
    }
  },

  render(body, item, editable) {
    const sidebar = this.sidebar, session = sidebar.sessionFor(item), doc = body.ownerDocument, win = doc.defaultView
    const prior = body.querySelector('.pmw-scroll'), scrollTop = prior?.scrollTop || 0
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
    if (PaperMind.account) button(tools, PaperMind.account.record() ? '账号' : '登录', () => {
      this.state(session).mode = 'settings'; sidebar.refresh(session)
    }, !session)
    button(tools, '设置', () => { const w = this.state(session); w.mode = w.mode === 'settings' ? 'read' : 'settings'; sidebar.refresh(session) }, !session)
    button(tools, '关闭', () => sidebar.toggleWindow(win, false))
    if (!session) { el('p', '在 Zotero 中打开一篇 PDF，即可开始带读。', root); return }
    const w = this.state(session), active = PaperMindReaderContext.active(win, session.paper)
    el('div', session.paper.getField('title'), head, 'pmw-title')
    el('div', active?.page ? `本地 PDF · 第 ${active.page} / ${active.pdf?.numPages || '?'} 页` : '条目摘要 · 等待打开本地 PDF', head, 'pmw-muted')
    if (!w.loaded && !w.loading && !w.storageError) void this.load(session)
    const content = el('main', null, root, 'pmw-scroll')
    const busy = session.busy || !w.loaded
    const mode = name => { w.mode = name; sidebar.refresh(session) }
    const actions = (parent, result, isCard = false) => {
      const row = el('div', null, parent, 'pmw-actions')
      if (!isCard) button(row, '存为卡片', () => this.capture(session, result), !w.loaded)
      if (result.source) button(row, `原文 · 第 ${result.source.page || '?'} 页`, () => sidebar.openSource(result.source, session))
      const details = el('details', null, row)
      el('summary', '送到汇报', details)
      for (const section of this.boardSections) button(details, section, () => this.toBoard(session, result, section), !w.loaded)
    }
    if (w.mode !== 'read') button(content, '← 返回阅读台', () => mode('read'))
    if (w.mode === 'settings') {
      if (PaperMind.account) {
        const account = PaperMind.account.record()?.account
        el('h3', '研雀账号', content)
        el('p', account ? `已登录：${account.username}` : '使用 Zotero 账号连接网站与插件，本地卡片无需登录。', content)
        el('p', PaperMind.account.status, content, 'pmw-muted')
        if (PaperMind.account.pending || PaperMind.account.starting) button(content, '取消登录', () => PaperMind.account.cancel())
        else button(content, account ? '重新登录' : '使用 Zotero 账号继续', () => PaperMind.account.start(win))
        if (account) button(content, '退出账号', () => PaperMind.account.logout(win))
      }
      el('h3', '连接与数据', content)
      el('p', 'PDF 在本地读取。点击 AI 操作时发送题名、摘要、当前页、选段和有页码的相关文字节选；不上传 PDF 文件。', content)
      el('p', '卡片、对话、自测和汇报保存在本机 Zotero 配置目录，按论文和连接身份隔离；不会自动同步到网页版。', content)
      el('p', w.coverage || '尚未发起 AI 操作。', content, 'pmw-muted')
      button(content, '旧版专属链接设置', async () => { await PaperMind.promptSettings(win); sidebar.syncWindow(win) }, session.busy || Boolean(PaperMind.account?.record()) || Boolean(PaperMind.account?.pending))
    } else if (w.mode === 'board') {
      el('h3', '单篇汇报', content)
      for (const section of this.boardSections) {
        el('h4', section, content)
        const rows = w.board.filter(x => x.section === section)
        if (!rows.length) el('p', '从带读结果或卡片送入材料。', content, 'pmw-muted')
        for (const entry of rows) {
          const card = el('article', null, content, 'pmw-card')
          el('div', entry.content, card, 'pmw-text')
          if (entry.source) button(card, `原文 · 第 ${entry.source.page || '?'} 页`, () => sidebar.openSource(entry.source, session))
          button(card, '编辑', () => this.editText(session, entry, win))
        }
      }
      button(content, '保存汇报到 Zotero 笔记', () => this.exportBoard(session, editable), !editable || !w.board.length)
    } else if (w.mode === 'quiz') {
      el('h3', '考考自己', content)
      if (!w.quiz.length) el('p', '结合本篇原文与卡片，一次讨论一个问题。', content)
      for (const message of w.quiz) {
        if (message.role === 'user') continue
        const box = el('article', null, content, 'pmw-card')
        sidebar.renderAnswer(el('div', null, box, 'pmw-text'), message.content)
        actions(box, message)
      }
      button(content, w.quiz.length ? '换一道题' : '出一道题', () => this.run(session, 'quiz', win), busy)
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
        const box = el('article', null, content, 'pmw-card')
        el('div', message.role === 'user' ? '提问' : '研雀', box, 'pmw-muted')
        sidebar.renderAnswer(el('div', null, box, 'pmw-text'), message.display || message.content)
        if (message.role === 'assistant') actions(box, message)
      }
    } else {
      const hint = this.startHint(session, active)
      if (hint) el('p', hint.text, content, 'pmw-start').setAttribute('aria-label', '阅读起步提示')
      const controls = el('div', null, content, 'pmw-actions')
      for (const [label, action] of [['阅读路线', 'map'], ['读摘要', 'abstract'], ['读当前页', 'page']]) {
        const control = button(controls, label, () => this.run(session, action, win), busy)
        if (hint?.action === action) control.className = 'pmw-start-action'
      }
      if (w.guide) {
        const guide = el('article', null, content, 'pmw-card')
        el('h3', w.guide.question, guide)
        sidebar.renderAnswer(el('div', null, guide, 'pmw-text'), w.guide.content)
        actions(guide, w.guide)
        button(guide, '继续追问', () => { session.draft = `关于${w.guide.question}：`; session.messages.push({ role: 'user', content: w.guide.question }, { ...w.guide }); mode('chat') })
        button(guide, '收起', () => { w.guide = null; void this.persist(session) })
      } else el('p', hint ? '阅读路线：先读哪些部分、核对哪些证据。读当前页：解释当前页文字。'
        : '先抓整篇思路，或跟着当前页读。划选原文可直接精读、翻译或存卡片。', content, 'pmw-muted')
      const cardHead = el('div', null, content, 'pmw-row')
      el('h3', `阅读卡片 · ${w.cards.length}`, cardHead)
      button(cardHead, '写卡片', async () => {
        const value = { value: '' }
        if (Services.prompt.prompt(win, '新建阅读卡片', '笔记正文', value, null, {}) && value.value.trim()) {
          await this.capture(session, { content: value.value.trim(), question: '阅读笔记', origin: '个人笔记', source: session.source })
        }
      }, !w.loaded)
      if (!w.cards.length) el('p', '留下关键证据、问题和自己的判断。每张卡片保留原文出处。', content, 'pmw-muted')
      for (const card of w.cards) {
        const node = el('article', null, content, 'pmw-card')
        el('div', card.origin, node, 'pmw-muted')
        el('div', card.content, node, 'pmw-text')
        actions(node, card, true)
        button(node, '编辑', () => this.editText(session, card, win))
        button(node, card.noteID ? '已存为 Zotero 笔记' : '存为 Zotero 笔记', async () => {
          card.question = card.title || '阅读卡片'
          await sidebar.saveNote(session, card, editable)
          await this.persist(session)
        }, !editable || Boolean(card.noteID || card.saving))
      }
    }
    const footer = el('footer', null, root)
    const nav = el('div', null, footer, 'pmw-row')
    button(nav, '考考自己', () => mode('quiz'))
    button(nav, `汇报板 · ${w.board.length}`, () => mode('board'))
    button(nav, '对话', () => mode('chat'))
    if (session.source) {
      const selected = el('details', null, footer, 'pmw-source')
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
    button(send, session.busy ? '生成中…' : '发送', () => this.run(session, 'chat', win), busy)
    if (session.busy) button(send, '停止', () => sidebar.cancel(session))
    const error = session.error || w.storageError
    if (error || session.status) {
      const status = el('div', error || session.status, footer, error ? 'pmw-error' : 'pmw-muted')
      status.setAttribute('role', error ? 'alert' : 'status')
      if (w.storageError) button(status, '重试本地记录', () => w.loaded ? this.persist(session) : this.load(session))
    }
    content.scrollTop = scrollTop
    if (focusName) { const target = root.querySelector(`[data-input="${focusName}"]`); if (target) { target.focus(); target.setSelectionRange(...selection) } }
  },

  async editText(session, item, win) {
    const value = { value: item.content }
    if (Services.prompt.prompt(win, '编辑阅读材料', '正文', value, null, {})) {
      if (!value.value.trim()) return
      item.content = value.value.trim(); item.origin = '个人编辑'; item.noteID = null
      await this.persist(session)
    }
  },

  styles: `
  .pmw{color-scheme:light dark;background:light-dark(#fffefa,#242a26);color:light-dark(#273d30,#e5eee7);font:13px/1.65 system-ui;display:flex;flex:1;flex-direction:column;box-sizing:border-box;width:100%;max-width:100%;min-width:0;height:100%;min-height:0;overflow:hidden}
  .pmw *{box-sizing:border-box}.pmw header,.pmw footer{flex:none;padding:12px 15px;border-bottom:1px solid #89988844}.pmw footer{border-top:1px solid #89988844;border-bottom:0;max-height:45%;overflow:auto}
  .pmw button,.pmw summary{font:inherit;font-size:12px;cursor:pointer}.pmw button{border:1px solid #89988855;background:transparent;color:inherit;border-radius:7px;padding:5px 8px;margin:2px}.pmw button:disabled{opacity:.5;cursor:default}
  .pmw h3{font-size:14px;margin:12px 0 8px}.pmw h4{font-size:13px;margin:15px 0 5px}.pmw p{margin:10px 0}.pmw-row{display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap}
  .pmw-title{font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:7px}.pmw-muted{font-size:11px;opacity:.72}.pmw-scroll{flex:1;min-height:0;overflow:auto;padding:12px 15px}.pmw-actions{display:flex;flex-wrap:wrap;gap:4px}
  .pmw .pmw-start{border-left:3px solid #6b8b73;padding-left:10px;margin:0 0 12px}.pmw .pmw-start-action{background:light-dark(#e9f1e9,#354b3d);border-color:#6b8b73}
  .pmw-card{border:1px solid #89988844;border-radius:9px;padding:12px;margin:12px 0}.pmw-text{white-space:pre-wrap;overflow-wrap:anywhere}.pmw textarea{font:inherit;width:100%;height:66px;resize:vertical;padding:8px;background:transparent;color:inherit;border:1px solid #89988877;border-radius:8px;margin-top:8px}
  .pmw-source{margin-top:8px;font-size:12px}.pmw-source summary{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.pmw blockquote{max-height:100px;overflow:auto;margin:6px;white-space:pre-wrap}.pmw-error{color:light-dark(#a4362e,#ffa79e);font-size:12px;white-space:pre-wrap}.pmw details button{font-size:11px}
  `,
}
