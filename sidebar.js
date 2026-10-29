/**
 * PaperMind native reading sidebar.
 * Copyright (C) 2026 lvyrana
 * SPDX-License-Identifier: AGPL-3.0-only
 * No remote HTML is inserted into Zotero's privileged document.
 */
/* global Zotero, PaperMind */
var PaperMindSidebar = {
  pluginID: 'papermind-connector@papermind.local',
  sessions: new Map(),
  views: new Map(),
  windows: new Map(),
  translations: new Map(),
  SHOW_LEGACY_SECTION: false,

  init(rootURI) {
    this.rootURI = rootURI
    this.selectionHandler = event => this.selectionPopup(event)
    for (const win of Zotero.getMainWindows()) this.addToWindow(win)
    if (this.SHOW_LEGACY_SECTION) this.paneID = Zotero.ItemPaneManager.registerSection({
      paneID: 'papermind-reading', pluginID: this.pluginID,
      header: { l10nID: 'papermind-reading-header', icon: rootURI + 'icon.svg' },
      sidenav: { l10nID: 'papermind-reading-nav', icon: rootURI + 'icon.svg' },
      onItemChange: ({ item, setEnabled }) => {
        setEnabled(Boolean(this.resolvePaper(item)))
        return true
      },
      onRender: ({ body, item, editable }) => {
        try { this.render(body, item, editable) }
        catch (error) {
          this.renderError = String(error) + '\n' + (error.stack || '')
          PaperMind.log('sidebar render failed: ' + error)
          body.textContent = '研雀侧栏加载失败，请通过工具菜单查看侧栏诊断。'
        }
      },
      onDestroy: ({ body }) => this.views.delete(body),
    })
    Zotero.Reader.registerEventListener('renderTextSelectionPopup', this.selectionHandler, this.pluginID)
    this.observerID = Zotero.Notifier?.registerObserver({ notify: (event, type) => {
      if (type === 'tab' || type === 'item') {
        for (const [win, view] of this.windows) {
          if (view.open) win.setTimeout(() => { if (this.windows.has(win)) this.syncWindow(win) }, 0)
        }
      }
    } }, ['tab', 'item'], 'papermind-sidebar')
  },

  addToWindow(win) {
    win.MozXULElement?.insertFTLIfNeeded('papermind.ftl')
    const doc = win.document
    this.mountWindow(win)
    const menu = doc.getElementById('menu_ToolsPopup')
    if (menu && !doc.getElementById('papermind-sidebar-diagnostics')) {
      const entry = doc.createXULElement('menuitem')
      entry.id = 'papermind-sidebar-diagnostics'
      entry.setAttribute('label', '研雀侧栏诊断…')
      entry.addEventListener('command', () => this.showDiagnostics(win))
      menu.appendChild(entry)
      const preview = doc.createXULElement('menuitem')
      preview.id = 'papermind-translation-preview'
      preview.setAttribute('label', '研雀翻译位置预览（不联网）')
      preview.addEventListener('command', () => {
        this.previewNextTranslation = true
        Services.prompt.alert(win, '研雀', '下一次划词后点击「翻译」只展示本地布局示例，不调用 AI。')
      })
      menu.appendChild(preview)
    }
  },

  mountWindow(win) {
    if (this.windows.has(win)) return this.windows.get(win)
    const doc = win.document
    const toolbar = doc.getElementById('zotero-tabs-toolbar')
    const context = doc.getElementById('zotero-context-pane')
    if (!toolbar || !context?.parentElement) return null
    const html = tag => doc.createElementNS('http://www.w3.org/1999/xhtml', tag)
    const launch = html('button')
    launch.id = 'papermind-toggle'
    launch.type = 'button'
    launch.textContent = '研雀'
    launch.title = '打开研雀 · LitFinch 阅读台'
    launch.setAttribute('aria-label', '研雀阅读台')
    launch.setAttribute('aria-controls', 'papermind-panel')
    launch.setAttribute('aria-expanded', 'false')
    launch.style.cssText = 'font:600 12px system-ui;padding:5px 10px;margin:0 6px;border:1px solid #78968166;border-radius:7px;background:transparent;color:inherit;cursor:pointer;'
    toolbar.insertBefore(launch, doc.getElementById('zotero-tb-sync'))
    const panel = html('aside')
    panel.id = 'papermind-panel'
    panel.setAttribute('aria-label', '研雀阅读台侧栏')
    panel.style.cssText = 'display:none;box-sizing:border-box;width:390px;max-width:46vw;min-width:280px;min-height:0;flex:0 1 390px;overflow:hidden;border-left:1px solid #89988844;'
    context.parentElement.appendChild(panel)
    const style = html('style')
    style.id = 'papermind-shell-style'
    style.textContent = '[data-papermind-open] > #zotero-context-pane,[data-papermind-open] > #zotero-context-splitter {display:none!important} [data-papermind-open] > #tabs-deck{min-width:0!important;flex:1 1 0!important} #papermind-toggle[aria-expanded="true"]{background:#365d4b!important;color:white!important}'
    doc.documentElement.appendChild(style)
    const view = { panel, launch, open: false }
    this.windows.set(win, view)
    launch.addEventListener('click', () => this.toggleWindow(win))
    // The library selection event is DOM based; reader selection uses Notifier.
    view.onSelect = () => { if (view.open) this.syncWindow(win) }
    doc.getElementById('zotero-items-tree')?.addEventListener('select', view.onSelect)
    return view
  },

  activeItem(win) {
    const tabID = win.Zotero_Tabs?.selectedID
    if (tabID && tabID !== 'zotero-pane') {
      const reader = Zotero.Reader.getByTabID?.(tabID)
      return reader ? Zotero.Items.get(reader.itemID) : null
    }
    return win.ZoteroPane?.getSelectedItems?.()[0] || null
  },

  syncWindow(win, item = this.activeItem(win)) {
    const view = this.windows.get(win)
    if (!view?.open) return
    const session = this.sessionFor(item)
    if (session && this.views.get(view.panel)?.session === session) return
    try {
      this.render(view.panel, item, session ? Zotero.Libraries.get(session.paper.libraryID).editable : false)
    } catch (error) {
      this.renderError = String(error) + '\n' + (error.stack || '')
      PaperMind.log('sidebar render failed: ' + error)
      view.panel.textContent = '研雀侧栏加载失败，可关闭后重开；详情见工具菜单中的侧栏诊断。'
      this.views.delete(view.panel)
    }
  },

  toggleWindow(win, open) {
    const view = this.mountWindow(win)
    if (!view) return
    view.open = open ?? !view.open
    view.panel.style.display = view.open ? 'flex' : 'none'
    view.panel.parentElement.toggleAttribute('data-papermind-open', view.open)
    view.launch.setAttribute('aria-expanded', String(view.open))
    if (view.open) this.syncWindow(win)
  },

  async showDiagnostics(win) {
    const doc = win.document
    const describe = node => {
      if (!node) return null
      const rect = node.getBoundingClientRect()
      const style = win.getComputedStyle(node)
      return { tag: node.localName, id: node.id, hidden: node.hidden,
        collapsed: node.getAttribute('collapsed'), display: style.display,
        visibility: style.visibility, size: [rect.width, rect.height], position: [rect.x, rect.right],
        children: node.childElementCount }
    }
    const panes = [...doc.querySelectorAll('item-pane-custom-section')]
      .filter(node => node.dataset.pane === this.paneID)
      .map(node => ({ section: describe(node), body: describe(node.querySelector('[data-type="body"]')),
        ancestors: [node.parentElement, node.parentElement?.parentElement,
          node.closest('item-details')].map(describe) }))
    Services.prompt.alert(win, '研雀侧栏诊断', JSON.stringify({
      paneID: this.paneID, views: this.views.size, renderError: this.renderError || null,
      reading: this.workspace ? await this.workspace.diagnostics(win) : null,
      panel: describe(doc.getElementById('papermind-panel')),
      layout: { viewport: win.innerWidth, parent: describe(doc.getElementById('papermind-panel')?.parentElement),
        siblings: [...(doc.getElementById('papermind-panel')?.parentElement?.children || [])].map(describe) },
      context: describe(doc.getElementById('zotero-context-pane')), panes,
    }, null, 2))
  },

  removeFromWindow(win) {
    const view = this.windows.get(win)
    if (view) {
      view.panel.parentElement?.removeAttribute('data-papermind-open')
      view.panel.remove()
      view.launch.remove()
      win.document.getElementById('zotero-items-tree')?.removeEventListener('select', view.onSelect)
      this.windows.delete(win)
    }
    win.document.getElementById('papermind-shell-style')?.remove()
    win.document.getElementById('papermind-sidebar-diagnostics')?.remove()
    win.document.getElementById('papermind-translation-preview')?.remove()
    win.document.querySelector('[href="papermind.ftl"]')?.remove()
    for (const [body] of this.views) {
      if (body.ownerDocument.defaultView === win) this.views.delete(body)
    }
  },

  destroy() {
    for (const state of this.translations.values()) state.close()
    for (const session of this.sessions.values()) this.cancel(session)
    if (this.paneID) Zotero.ItemPaneManager.unregisterSection(this.paneID)
    // Zotero 9.0.6's public unregisterEventListener has an inverted filter:
    // it keeps the target and removes every other plugin's listener. Use the
    // same plugin-scoped cleanup as Zotero's add-on lifecycle instead.
    if (this.selectionHandler) {
      if (typeof Zotero.Reader._unregisterEventListenerByPluginID === 'function') {
        Zotero.Reader._unregisterEventListenerByPluginID(this.pluginID)
      } else if (Array.isArray(Zotero.Reader._registeredListeners)) {
        Zotero.Reader._registeredListeners = Zotero.Reader._registeredListeners.filter(
          listener => listener.pluginID !== this.pluginID,
        )
      }
      this.selectionHandler = null
    }
    if (this.observerID !== undefined) Zotero.Notifier?.unregisterObserver(this.observerID)
    for (const win of this.windows.keys()) this.removeFromWindow(win)
    this.views.clear()
    this.sessions.clear()
  },

  resolvePaper(item) {
    if (!item) return null
    if (item.isAttachment?.() && item.parentItemID) return Zotero.Items.get(item.parentItemID)
    return item.isRegularItem?.() ? item : null
  },

  sessionFor(item) {
    const paper = this.resolvePaper(item)
    if (!paper) return null
    // Device/service changes must not expose an earlier identity's conversation.
    const key = [PaperMind.getBaseURL(), PaperMind.getUid(), paper.libraryID, paper.key].join('|')
    if (!this.sessions.has(key)) this.sessions.set(key, {
      key, paper, source: null, messages: [], draft: '', busy: false,
      status: '', error: '', request: 0, controller: null,
    })
    return this.sessions.get(key)
  },

  captureSource(attachment, annotation = {}) {
    let position = annotation.position || {}
    if (typeof position === 'string') {
      try { position = JSON.parse(position) } catch { position = {} }
    }
    const page = Number.isInteger(position.pageIndex) && position.pageIndex >= 0
      ? position.pageIndex + 1 : null
    return {
      text: String(annotation.text || '').trim(),
      page, pageLabel: String(annotation.pageLabel || page || ''),
      attachmentKey: attachment.key, libraryID: attachment.libraryID,
    }
  },

  sourceURL(source) {
    if (!source?.attachmentKey) return ''
    const library = Zotero.Libraries.get(source.libraryID)
    const path = library.libraryType === 'group'
      ? `groups/${Zotero.Groups.getGroupIDFromLibraryID(source.libraryID)}` : 'library'
    return `zotero://open-pdf/${path}/items/${encodeURIComponent(source.attachmentKey)}`
      + (source.page ? `?page=${source.page}` : '')
  },

  async openSource(source, session) {
    try {
      const attachment = Zotero.Items.getByLibraryAndKey(source.libraryID, source.attachmentKey)
      if (!attachment || !attachment.isAttachment() || attachment.deleted) {
        throw new Error('原文附件已移除或不可用。')
      }
      await Zotero.Reader.open(attachment.id, source.page ? { pageIndex: source.page - 1 } : undefined)
    } catch (error) {
      session.error = '无法返回原文：' + error.message
      this.refresh(session)
    }
  },

  selectionPopup({ reader, doc, params, append }) {
    const attachment = Zotero.Items.get(reader.itemID)
    const session = this.sessionFor(attachment)
    if (!session || !params.annotation?.text) return
    const source = this.captureSource(attachment, params.annotation)
    if (this.SHOW_WORKSPACE) {
      session.source = source
      this.refresh(session)
    }
    const previous = this.translations.get(reader)
    if (previous && previous.sourceKey !== JSON.stringify(source)) previous.close()
    const bar = doc.createElement('div')
    bar.className = 'pm-selection-actions'
    bar.style.cssText = 'display:flex;gap:2px;padding:4px;flex-wrap:wrap;border-top:1px solid color-mix(in srgb,currentColor 14%,transparent)'
    // Match the reader popup's flat buttons instead of default form controls.
    const style = doc.createElement('style')
    style.textContent = '.pm-selection-actions button{font:13px system-ui,sans-serif;color:inherit;background:transparent;border:0;border-radius:5px;padding:4px 8px;cursor:pointer}.pm-selection-actions button:hover{background:color-mix(in srgb,currentColor 10%,transparent)}'
    bar.appendChild(style)
    const actions = [['精读这段', 'guide'], ...(this.showPopupTranslate() ? [['翻译', 'translate']] : []), ['带入追问', null]]
    if (this.SHOW_WORKSPACE) actions.push(['存为卡片', 'card'])
    for (const [label, action] of actions) {
      const button = doc.createElement('button')
      button.textContent = label
      button.addEventListener('click', () => {
        if (action === 'translate') {
          void this.translateInline({ reader, doc, annotation: params.annotation, source, bar })
          return
        }
        session.source = source
        session.error = ''
        this.refresh(session)
        const win = Zotero.getMainWindow()
        this.focusPane(win, attachment)
        if (action === 'card') void this.workspace.capture(session)
        else if (action) void this.run(session, action, win)
        else if (this.SHOW_WORKSPACE) {
          this.workspace.state(session).mode = 'chat'
          this.refresh(session)
        }
      })
      bar.appendChild(button)
    }
    append(bar)
  },

  // Readers who already use another translation add-on can hide this button.
  popupTranslatePref: 'extensions.papermind.popupTranslate',
  showPopupTranslate() { return Zotero.Prefs.get(this.popupTranslatePref, true) !== false },

  translationPlacement(rect, viewport, height, width = 360) {
    const margin = 12, gap = 10
    const cardWidth = Math.min(width, viewport.width - margin * 2)
    return {
      left: Math.max(margin, Math.min(rect[0], viewport.width - cardWidth - margin)),
      top: rect[3] + gap,
      width: cardWidth,
      scrollBy: Math.max(0, rect[3] + gap + height + margin - viewport.height),
    }
  },

  async translateInline({ reader, doc, annotation, source, bar }) {
    this.translations.get(reader)?.close()
    const win = Zotero.getMainWindow()
    const uiWin = doc.defaultView
    const internal = reader._internalReader
    const view = internal?._lastViewPrimary === false ? internal?._secondaryView : internal?._primaryView
    // Native PDF coordinates come from the same view that created the selection.
    const frame = view?._iframeWindow?.frameElement
    const scroller = view?._iframeWindow?.document.getElementById('viewerContainer')
    let position = annotation.position
    if (typeof position === 'string') { try { position = JSON.parse(position) } catch { position = null } }
    const card = doc.createElement('section')
    card.setAttribute('aria-label', '研雀原文下方翻译')
    card.style.cssText = 'position:fixed;z-index:10000;box-sizing:border-box;width:360px;padding:12px 14px;background:light-dark(#fff,#242424);color:light-dark(#26352f,#e2e8e4);color-scheme:light dark;border:1px solid #78968188;border-radius:10px;box-shadow:0 5px 20px #0002;font:14px/1.65 system-ui;'
    const header = doc.createElement('div')
    header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:10px;font-size:12px;color:#64816e;margin-bottom:6px;'
    const title = doc.createElement('span')
    title.textContent = '研雀 · 翻译'
    const close = doc.createElement('button')
    close.textContent = '关闭'
    close.style.cssText = 'font:inherit;color:inherit;background:transparent;border:0;cursor:pointer;padding:2px 6px;'
    header.append(title, close)
    const result = doc.createElement('div')
    result.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere;max-height:180px;overflow:auto;user-select:text;'
    result.textContent = '正在翻译…'
    result.setAttribute('role', 'status')
    card.append(header, result)
    doc.body.appendChild(card)
    const popup = bar.closest('.selection-popup')
    const visibility = popup?.style.visibility || ''
    if (popup) popup.style.visibility = 'hidden'
    const controller = new win.AbortController()
    let closed = false, timer, frameID
    const state = { sourceKey: JSON.stringify(source), close: () => {
      if (closed) return
      closed = true
      controller.abort()
      if (timer) win.clearTimeout(timer)
      if (frameID) uiWin.cancelAnimationFrame(frameID)
      scroller?.removeEventListener('scroll', onMove)
      uiWin.removeEventListener('resize', onMove)
      uiWin.removeEventListener('pagehide', state.close)
      if (popup?.isConnected) popup.style.visibility = visibility
      card.remove()
      if (this.translations.get(reader) === state) this.translations.delete(reader)
    } }
    const place = (allowScroll = false) => {
      if (closed) return
      let rect
      try {
        const local = view?.getClientRectForPopup(position)
        const offset = frame?.getBoundingClientRect()
        if (local && offset) rect = [local[0] + offset.left, local[1] + offset.top, local[2] + offset.left, local[3] + offset.top]
      } catch { /* A reader version without this method falls back to the popup edge. */ }
      if (!rect) {
        const anchor = bar.getBoundingClientRect()
        rect = [anchor.left, anchor.top, anchor.right, anchor.bottom]
      }
      const placement = this.translationPlacement(rect, { width: uiWin.innerWidth, height: uiWin.innerHeight }, card.offsetHeight)
      card.style.left = placement.left + 'px'
      card.style.top = placement.top + 'px'
      card.style.width = placement.width + 'px'
      if (allowScroll && placement.scrollBy && scroller) {
        scroller.scrollTop += placement.scrollBy
        frameID = uiWin.requestAnimationFrame(() => place(false))
      }
    }
    const onMove = () => { if (frameID) uiWin.cancelAnimationFrame(frameID); frameID = uiWin.requestAnimationFrame(() => place(false)) }
    this.translations.set(reader, state)
    close.addEventListener('click', state.close)
    scroller?.addEventListener('scroll', onMove, { passive: true })
    uiWin.addEventListener('resize', onMove)
    uiWin.addEventListener('pagehide', state.close)
    place(true)
    let identity
    try {
      if (this.previewNextTranslation) {
        this.previewNextTranslation = false
        title.textContent = '研雀 · 本地布局预览'
        result.textContent = '这里显示所选英文的中文译文。原文保持可见，翻译留在阅读页面，不打开侧栏。\n\n这是布局示例，未调用 AI。'
        return
      }
      if (!await PaperMind.ai.ensure(win)) { state.close(); return }
      if (closed) return
      identity = [PaperMind.getBaseURL(), PaperMind.getUid()].join('|')
      if (!source.text || source.text.length > 3000) throw new Error('请选择 3000 字以内的原文再翻译。')
      timer = win.setTimeout(() => controller.abort(), 90000)
      const data = await PaperMind.ai.request(win, '/api/translate', { text: source.text }, controller.signal)
      if (closed) return
      if (identity !== [PaperMind.getBaseURL(), PaperMind.getUid()].join('|')) { state.close(); return }
      if (!data.ok || !data.translated) throw new Error(data.error || '没有收到译文，请重试。')
      result.textContent = String(data.translated)
    } catch (error) {
      if (!closed) result.textContent = error.name === 'AbortError' ? '翻译超时，关闭后可重试。' : '翻译失败：' + error.message
    } finally {
      if (timer) win.clearTimeout(timer)
      place(true)
    }
  },

  focusPane(win, item) {
    if (!this.SHOW_LEGACY_SECTION) {
      this.toggleWindow(win, true)
      this.syncWindow(win, item || this.activeItem(win))
      this.windows.get(win)?.panel.querySelector('textarea')?.focus()
      return
    }
    // The host controller synchronizes the outer box, inner pane and splitters.
    // Opening only #zotero-context-pane leaves the inner pane visibility:collapse.
    const host = win.ZoteroContextPane
    if (!host) return
    if (host.context) host.context.mode = 'item'
    host.collapsed = false
    const details = host.sidenav?.container
    if (details?.getEnabledPane?.(this.paneID)) {
      Promise.resolve(details.scrollToPane(this.paneID)).catch(error => {
        PaperMind.log('sidebar focus failed: ' + error)
      })
    }
  },

  refresh(session) {
    for (const [body, view] of this.views) {
      if (view.session === session && body.isConnected) this.render(body, view.item, view.editable)
    }
  },

  render(body, item, editable = true) {
    const session = this.sessionFor(item)
    const previousScroll = body.querySelector('.pm-messages')
    const nearBottom = !previousScroll || previousScroll.scrollHeight - previousScroll.scrollTop - previousScroll.clientHeight < 60
    const scrollTop = previousScroll?.scrollTop || 0
    const oldInput = body.querySelector('textarea')
    const focusInput = oldInput && body.ownerDocument.activeElement === oldInput
    const selectionRange = focusInput ? [oldInput.selectionStart, oldInput.selectionEnd] : null
    body.replaceChildren()
    if (session) this.views.set(body, { session, item, editable })
    else this.views.delete(body)
    const doc = body.ownerDocument
    const element = (tag, text, parent = body) => {
      const node = doc.createElementNS('http://www.w3.org/1999/xhtml', tag)
      if (text !== undefined) node.textContent = text
      parent.appendChild(node)
      return node
    }
    const style = element('style')
    style.textContent = `
      .pm-reading { color-scheme:light dark; background:light-dark(#fff,#242424); color:light-dark(#26352f,#e2e8e4); font:14px/1.7 system-ui,sans-serif; display:flex;flex-direction:column;flex:1;min-width:0;min-height:0;width:100%;height:100%;overflow:hidden; }
      .pm-reading * { box-sizing:border-box; }
      .pm-reading button { padding: 5px 9px; border: 1px solid #89988844; border-radius: 7px; cursor: pointer; font: inherit; font-size:12px; color: inherit; background: transparent; }
      .pm-reading button:disabled { opacity: .5; cursor: default; }
      .pm-reading .pm-primary { background: #365d4b; color: #fff; border-color: #365d4b; }
      .pm-reading .pm-actions { display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 0; }
      .pm-reading .pm-muted { opacity: .7; font-size: 12px; }
      .pm-reading .pm-header {padding:12px 16px;border-bottom:1px solid #89988833;flex:none;}
      .pm-reading .pm-heading {display:flex;align-items:center;justify-content:space-between;gap:8px;}
      .pm-reading .pm-heading strong {font-size:16px;letter-spacing:.2px;}
      .pm-reading .pm-title {font-size:12px;opacity:.7;margin-top:8px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;}
      .pm-reading .pm-messages {flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;padding:18px 16px;}
      .pm-reading .pm-empty {padding:32px 8px;color:inherit;}
      .pm-reading .pm-empty p {font-size:13px;opacity:.65;}
      .pm-reading .pm-message {margin:0 0 22px;}
      .pm-reading .pm-user {margin-left:28px;background:#78968114;padding:10px 12px;border-radius:12px;}
      .pm-reading .pm-answer {white-space:pre-wrap;overflow-wrap:anywhere;}
      .pm-reading .pm-answer strong {font-weight:650;}
      .pm-reading .pm-answer p {margin:0 0 8px;} .pm-reading .pm-answer p:last-child {margin-bottom:0;}
      .pm-reading .pm-answer ul, .pm-reading .pm-answer ol {margin:0 0 8px;padding-left:20px;white-space:normal;}
      .pm-reading .pm-message-label {font-size:11px;opacity:.55;margin-bottom:6px;}
      .pm-reading .pm-composer {flex:none;padding:10px 14px 14px;border-top:1px solid #89988833;background:inherit;}
      .pm-reading .pm-inputbox {border:1px solid #89988866;border-radius:12px;padding:10px;}
      .pm-reading .pm-inputbox:focus-within {border-color:#789681;box-shadow:0 0 0 2px #78968116;}
      .pm-reading textarea {width:100%;height:66px;min-height:0;resize:none;padding:0;border:0;outline:none;font:inherit;font-size:13px;color:inherit;background:transparent;}
      .pm-reading .pm-send-row {display:flex;align-items:center;justify-content:space-between;gap:8px;}
      .pm-reading .pm-source {background:#78968110;border-radius:8px;padding:7px 9px;margin-bottom:9px;font-size:12px;}
      .pm-reading summary {cursor:pointer;list-style-position:inside;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
      .pm-reading blockquote {margin:8px 0;white-space:pre-wrap;overflow:auto;max-height:110px;overflow-wrap:anywhere;}
      .pm-reading .pm-error {color:light-dark(#a4362e,#ffa79e);white-space:pre-wrap;}
      .pm-reading .pm-status:empty {display:none;}
      .pm-reading .pm-status {font-size:12px;margin-top:6px;max-height:60px;overflow:auto;}
      .pm-reading .pm-settings {padding:12px 16px;border-bottom:1px solid #89988833;font-size:12px;max-height:35%;overflow:auto;flex:none;}
      .pm-reading .pm-settings[hidden] {display:none;}
    `
    const root = element('div')
    root.className = 'pm-reading'
    root.setAttribute('aria-label', '研雀精读')
    const button = (parent, label, handler, disabled = false) => {
      const node = element('button', label, parent)
      node.type = 'button'
      node.disabled = disabled
      node.addEventListener('click', handler)
      return node
    }
    const win = doc.defaultView
    const header = element('header', undefined, root)
    header.className = 'pm-header'
    const heading = element('div', undefined, header)
    heading.className = 'pm-heading'
    element('strong', '研雀', heading)
    const tools = element('div', undefined, heading)
    button(tools, '设置', () => { settings.hidden = !settings.hidden })
    button(tools, '关闭', () => this.toggleWindow(win, false))
    const title = element('div', session?.paper.getField('title') || '阅读对话', header)
    title.className = 'pm-title'
    title.title = title.textContent
    const settings = element('section', undefined, root)
    settings.className = 'pm-settings'
    settings.hidden = true
    element('strong', '连接与数据', settings)
    element('p', '点击发送、精读或翻译时，题名、摘要、选段和相关对话会交给已配置的研雀服务及其模型提供方。此侧栏不上传整份 PDF。', settings)
    element('p', '对话保留到 Zotero 退出。需长期保留的回答可保存到文献笔记。', settings)
    button(settings, '连接设置', async () => {
      await PaperMind.promptSettings(win)
      this.render(body, item, editable)
    }, session?.busy)
    const messages = element('div', undefined, root)
    messages.className = 'pm-messages'
    messages.setAttribute('aria-label', '阅读对话记录')
    if (!session || !session.messages.length) {
      const empty = element('div', undefined, messages)
      empty.className = 'pm-empty'
      element('strong', session ? '从这篇论文开始' : '打开一篇论文', empty)
      element('p', session ? '划选文字后，可以精读、翻译，或直接在下方提问。' : '打开 PDF 或在文献库中选择一篇文献。', empty)
      if (session) button(empty, '读摘要', () => void this.run(session, 'abstract', win), session.busy)
    }
    if (!session) return
    for (const message of session.messages) {
      const card = element('div', undefined, messages)
      card.className = 'pm-message' + (message.role === 'user' ? ' pm-user' : '')
      if (message.role === 'assistant') element('div', '研雀', card).className = 'pm-message-label'
      const content = element('div', undefined, card)
      content.className = 'pm-answer'
      this.renderAnswer(content, message.display || message.content)
      if (message.role === 'assistant') {
        const controls = element('div', undefined, card)
        controls.className = 'pm-actions'
        button(controls, message.noteID ? '已保存到 Zotero' : '保存到 Zotero 笔记',
          () => void this.saveNote(session, message, editable), Boolean(message.noteID || message.saving || !editable))
        if (message.source) button(controls, '查看这条回答的原文',
          () => void this.openSource(message.source, session))
      }
    }
    const composer = element('div', undefined, root)
    composer.className = 'pm-composer'
    if (session.source) {
      const sourceBox = element('div', undefined, composer)
      sourceBox.className = 'pm-source'
      const details = element('details', undefined, sourceBox)
      element('summary', `${session.source.page ? `第 ${session.source.page} 页` : '选段'} · ${session.source.text.slice(0, 70)}`, details)
      const quote = element('blockquote', session.source.text, details)
      quote.setAttribute('aria-label', '当前选段')
      const sourceActions = element('div', undefined, sourceBox)
      sourceActions.className = 'pm-actions'
      button(sourceActions, '精读', () => void this.run(session, 'guide', win), session.busy)
      button(sourceActions, '翻译', () => void this.run(session, 'translate', win), session.busy)
      button(sourceActions, '返回原文', () => void this.openSource(session.source, session))
      button(sourceActions, '清除选段', () => { session.source = null; this.refresh(session) })
    }
    const inputBox = element('div', undefined, composer)
    inputBox.className = 'pm-inputbox'
    const input = element('textarea', undefined, inputBox)
    input.setAttribute('aria-label', '继续追问')
    input.placeholder = session.source ? '关于这段，想问什么？' : '询问关于这篇论文的问题…'
    input.maxLength = 2000
    input.value = session.draft
    input.addEventListener('input', () => { session.draft = input.value })
    const sendRow = element('div', undefined, inputBox)
    sendRow.className = 'pm-send-row'
    element('span', '⌘ / Ctrl + Enter', sendRow).className = 'pm-muted'
    const sendActions = element('div', undefined, sendRow)
    button(sendActions, session.busy ? '生成中…' : '发送', () => void this.run(session, 'chat', win), session.busy).className = 'pm-primary'
    if (session.busy) button(sendActions, '停止', () => this.cancel(session))
    input.addEventListener('keydown', event => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault()
        void this.run(session, 'chat', win)
      }
    })
    const status = element('div', session.error || session.status, composer)
    status.className = 'pm-status ' + (session.error ? 'pm-error' : 'pm-muted')
    status.setAttribute('role', session.error ? 'alert' : 'status')
    messages.scrollTop = nearBottom ? messages.scrollHeight : scrollTop
    if (focusInput) {
      input.focus()
      input.setSelectionRange(...selectionRange)
    }
  },

  renderAnswer(node, text) {
    // A deliberately small Markdown subset; model output never becomes HTML.
    const doc = node.ownerDocument
    const make = (tag, parent) => parent.appendChild(doc.createElementNS('http://www.w3.org/1999/xhtml', tag))
    const inline = (parent, value) => {
      for (const part of value.split(/(\*\*[^*\n]+\*\*|`[^`\n]+`)/g)) {
        if ((part.startsWith('**') && part.endsWith('**') && part.length > 4) || (part.startsWith('`') && part.endsWith('`') && part.length > 2)) {
          const bold = part.startsWith('**')
          make(bold ? 'strong' : 'code', parent).textContent = part.slice(bold ? 2 : 1, bold ? -2 : -1)
        } else if (part) parent.appendChild(doc.createTextNode(part))
      }
    }
    // Blank lines end a paragraph; consecutive list lines share one list.
    let list = null, paragraph = null
    for (const line of String(text).split('\n')) {
      const item = line.match(/^\s*(?:([-*•])|(\d{1,2})[.)])\s+(.*)$/)
      const heading = line.match(/^#{1,4}\s+(.*)$/)
      if (!line.trim()) { list = paragraph = null; continue }
      if (item) {
        const tag = item[1] ? 'ul' : 'ol'
        if (list?.localName !== tag) {
          list = make(tag, node); paragraph = null
          if (tag === 'ol' && item[2] !== '1') list.setAttribute('start', item[2])
        }
        inline(make('li', list), item[3])
        continue
      }
      list = null
      if (heading) { paragraph = null; inline(make('strong', make('p', node)), heading[1]); continue }
      if (paragraph) paragraph.appendChild(doc.createTextNode('\n'))
      else paragraph = make('p', node)
      inline(paragraph, line)
    }
  },

  cancel(session) {
    session.request++
    session.controller?.abort()
    session.controller = null
    session.busy = false
    session.status = '已停止等待，可重新发送。'
    this.refresh(session)
  },

  async run(session, action, win) {
    if (session.busy) return
    session.busy = true
    session.error = ''
    const requestID = ++session.request
    let timer
    try {
      if (!await PaperMind.ai.ensure(win)) return
      const current = this.sessionFor(session.paper)
      if (current !== session) {
        session.error = '连接身份已改变，请在当前侧栏重新发起。'
        return
      }
      const source = action === 'abstract' ? null : session.source && { ...session.source }
      const prompt = session.draft.trim()
      const paper = PaperMind.buildPaper(session.paper)
      if (action === 'chat' && !prompt) throw new Error('先写下想问的问题。')
      if (['guide', 'translate'].includes(action) && !source?.text) throw new Error('请先在 PDF 中选择文字。')
      if (action === 'abstract' && !paper.abstract) throw new Error('当前条目没有摘要，可以在 PDF 中划词后精读。')
      const limit = action === 'translate' ? 3000 : 6000
      if ((source?.text.length || 0) > limit) throw new Error(`选段超过 ${limit} 字，请缩小选区后重试。`)
      const context = { paper_title: paper.title.slice(0, 500), paper_abstract: paper.abstract.slice(0, 5000) }
      let endpoint, payload, field
      if (action === 'translate') {
        endpoint = '/api/translate'; payload = { text: source.text }; field = 'translated'
      } else if (action === 'chat') {
        endpoint = '/api/chat'; field = 'reply'
        payload = { ...context, message: prompt, paper_rowid: 0,
          history: session.messages.slice(-8).map(({ role, content }) => ({ role, content })),
          current_page: source?.page || null, current_page_text: source?.text || '',
          quote: source ? { text: source.text.slice(0, 4000), page: source.page } : null }
      } else {
        endpoint = '/api/deep-read/guide'; field = 'guide'
        payload = { ...context, mode: action === 'abstract' ? 'abstract' : 'selection',
          page: source?.page || null, page_text: source?.text || '' }
      }
      const controller = new win.AbortController()
      session.controller = controller
      session.status = '正在生成，可停止等待。'
      this.refresh(session)
      timer = win.setTimeout(() => controller.abort(), 90000)
      const data = await PaperMind.ai.request(win, endpoint, payload, session.controller.signal)
      if (!data.ok || !data[field]) throw new Error(data.error || data.reply || '没有收到内容，可重新发送。')
      if (requestID !== session.request || this.sessionFor(session.paper) !== session) return
      const question = action === 'chat' ? prompt : { guide: '精读这段', translate: '翻译这段', abstract: '精读摘要' }[action]
      // Keep the original quotation in history when the next question uses another selection.
      session.messages.push({ role: 'user', display: question, content: question + (source ? `\n原文${source.page ? `（第 ${source.page} 页）` : ''}：${source.text}` : '') })
      session.messages.push({ role: 'assistant', content: String(data[field]), source, question, noteID: null })
      if (action === 'chat' && session.draft.trim() === prompt) session.draft = ''
      session.status = ''
    } catch (error) {
      if (requestID === session.request) session.error = error.name === 'AbortError'
        ? '等待超时，请重试。' : error.message
    } finally {
      if (timer) win.clearTimeout(timer)
      if (requestID === session.request) {
        session.busy = false
        session.controller = null
        this.refresh(session)
      }
    }
  },

  escapeHTML(text) {
    return String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  },

  noteHTML(session, message) {
    const esc = value => this.escapeHTML(value)
    const paragraphs = value => esc(value).replace(/\n/g, '<br/>')
    const source = message.source
    return `<h2>研雀 · ${esc(message.question)}</h2><p>${esc(session.paper.getField('title'))}</p>`
      + (source ? `<p><a href="${esc(this.sourceURL(source))}">返回原文${source.page ? ` · PDF 第 ${source.page} 页` : ''}</a></p><blockquote>${paragraphs(source.text)}</blockquote>` : '<p>本次未附选段；上下文为条目题名、摘要及此前对话（如有）。</p>')
      + `<p><strong>AI 解读</strong></p><p>${paragraphs(message.content)}</p>`
      + (message.translation ? `<p><strong>译文</strong></p><p>${paragraphs(message.translation)}</p>` : '')
  },

  async saveNote(session, message, editable) {
    if (message.noteID || message.saving) return
    if (!editable || !Zotero.Libraries.get(session.paper.libraryID).editable) {
      session.error = '当前文库为只读，无法创建笔记。'
      this.refresh(session)
      return
    }
    message.saving = true
    this.refresh(session)
    try {
      const note = new Zotero.Item('note')
      note.libraryID = session.paper.libraryID
      note.parentID = session.paper.id
      note.setNote(this.noteHTML(session, message))
      message.noteID = await note.saveTx()
      session.error = ''
      session.status = '已保存为当前文献的子笔记，包含原文及页码链接。'
    } catch (error) {
      session.error = `保存失败：${error.message}`
    } finally {
      message.saving = false
      this.refresh(session)
    }
  },
}
