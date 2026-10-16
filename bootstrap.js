/**
 * PaperMind Connector — Zotero 插件
 * Copyright (C) 2026 lvyrana
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * 在文献右键菜单加一项「用 PaperMind 精读」：
 *   1. 读取选中条目的元数据 + 最佳 PDF 附件
 *   2. POST 到 PaperMind（/api/library/save + /api/library/{id}/pdf）
 *   3. 用默认浏览器打开 PaperMind 阅读页（带 ?uid= 自动认领设备身份）
 *
 * 首次使用会弹窗要求粘贴 PaperMind 设置页复制的专属链接。
 * Tools 菜单里有「PaperMind 连接设置…」可随时修改。
 *
 * 兼容 Zotero 7 – 9（bootstrap 插件架构，参考官方 make-it-red 示例）。
 */

/* global Zotero, Services, Components */

var PaperMind = {
  MENU_ID: 'papermind-open-menuitem',
  TOOLS_ID: 'papermind-settings-menuitem',
  PREF_BASE: 'extensions.papermind.baseURL',
  PREF_UID: 'extensions.papermind.uid',
  LEGACY_PREF_USERNAME: 'extensions.papermind.username',
  LEGACY_PREF_PASSWORD: 'extensions.papermind.password',
  PREF_CONFIG_VERSION: 'extensions.papermind.configVersion',
  PREF_LOCAL_ONLY: 'extensions.papermind.localOnly',
  CONFIG_VERSION: 3,
  DEFAULT_BASE: 'https://papermindapp.com',

  log(msg) {
    Zotero.debug('[papermind] ' + msg)
  },

  getBaseURL() {
    let v = ''
    try { v = Zotero.Prefs.get(this.PREF_BASE, true) } catch (e) { /* unset */ }
    return (v || this.DEFAULT_BASE).replace(/\/+$/, '')
  },

  validateServiceBase(base, URLConstructor = URL) {
    let url
    try { url = new URLConstructor(base) } catch { throw new Error('服务地址无效，请重新设置连接。') }
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && local))
      || url.username || url.password || (url.pathname && url.pathname !== '/') || url.search || url.hash) {
      throw new Error('远程服务必须使用 HTTPS；HTTP 仅用于 localhost、127.0.0.1 或 [::1] 本机调试。')
    }
    return url.origin
  },

  getUid() {
    const account = this.account?.record()?.account
    if (account) return account.data_uid
    let v = ''
    try { v = Zotero.Prefs.get(this.PREF_UID, true) } catch (e) { /* unset */ }
    return v || ''
  },

  getConfigVersion() {
    let v = 0
    try { v = Number(Zotero.Prefs.get(this.PREF_CONFIG_VERSION, true)) } catch (e) { /* unset */ }
    return v || 0
  },

  isValidUid(uid) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uid || '')
  },

  isLocalBase(base) {
    return /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(base || '')
  },

  isConfigured() {
    if (this.account?.record()) return true
    if (Zotero.Prefs.get(this.PREF_LOCAL_ONLY, true)) return false
    return this.getConfigVersion() >= this.CONFIG_VERSION
      && this.isValidUid(this.getUid())
  },

  async ensureConnection(win) {
    if (this.isConfigured()) return true
    if (this.account) {
      const session = this.sidebar?.sessionFor(this.sidebar.activeItem(win))
      if (session && this.sidebar.workspace) this.sidebar.workspace.state(session).mode = 'settings'
      await this.account.start(win)
      return false
    }
    return this.promptSettings(win)
  },

  migrateLegacyConfig() {
    const uid = this.getUid()
    if (!this.isValidUid(uid) || this.getConfigVersion() >= this.CONFIG_VERSION || Zotero.Prefs.get(this.PREF_LOCAL_ONLY, true)) return false

    // v0.2.x stored the shared preview credentials in Zotero prefs. The site no
    // longer uses Basic Auth, so clear the stale secret without asking users to reconnect.
    Zotero.Prefs.set(this.LEGACY_PREF_USERNAME, '', true)
    Zotero.Prefs.set(this.LEGACY_PREF_PASSWORD, '', true)
    Zotero.Prefs.set(this.PREF_CONFIG_VERSION, this.CONFIG_VERSION, true)
    return true
  },

  connectionSnapshot() {
    const base = this.getBaseURL()
    this.validateServiceBase(base)
    return Object.freeze({ base, uid: this.getUid(), token: this.account?.record(base)?.token || '' })
  },

  requireCurrentConnection(connection) {
    let current
    try { current = this.connectionSnapshot() } catch { /* Invalid new settings also cancel the old import. */ }
    if (!current || current.base !== connection.base || current.uid !== connection.uid || current.token !== connection.token) {
      const error = new Error('连接或账号已改变，本次导入已停止。请在当前连接重新导入。')
      error.code = 'CONNECTION_CHANGED'
      throw error
    }
  },

  requestHeaders(extra = {}, connection = this.connectionSnapshot()) {
    this.validateServiceBase(connection.base)
    return {
      'X-User-ID': connection.uid,
      ...extra,
      ...(connection.token ? { Authorization: 'Bearer ' + connection.token } : {}),
    }
  },

  buildReadingUrl(base, paperId, uid) {
    this.validateServiceBase(base)
    if (this.account?.record(base)) return `${base}/paper/${encodeURIComponent(paperId)}?library=1`
    return `${base}/paper/${encodeURIComponent(paperId)}?library=1&uid=${encodeURIComponent(uid)}`
  },

  async readError(resp) {
    try {
      const text = (await resp.text()).slice(0, 500)
      if (!text) return ''
      try {
        const data = JSON.parse(text)
        return data.detail || data.error || ''
      } catch (e) {
        return text.slice(0, 160)
      }
    } catch (e) { return '' }
  },

  async requireOk(resp, action) {
    if (resp.ok) return resp

    const detail = await this.readError(resp)
    const err = new Error(`${action}失败（HTTP ${resp.status}${detail ? '：' + detail : ''}）`)
    err.status = resp.status
    throw err
  },

  connectionMessage(error, base) {
    if (error && error.status === 401) {
      return this.account ? '请打开阅读台「账号」，使用 Zotero 账号登录或重新登录。未关联账号的旧服务可在设置中粘贴专属链接。'
        : '连接未通过设备身份校验。请打开 Zotero「工具 → 研雀连接设置…」，重新粘贴专属链接。'
    }
    if (error && error.status === 403) {
      return '当前设备没有这项操作权限。请重新粘贴研雀设置页里的“我的专属链接”。'
    }
    if (this.isLocalBase(base)) {
      return '插件仍在连接本机开发地址。请打开 Zotero「工具 → 研雀连接设置…」，改为线上专属链接。'
    }
    return `无法连接 ${base}。请检查网络后再试，或在 Zotero「工具 → 研雀连接设置…」重新连接。`
  },

  parsePersonalLink(win, rawLink) {
    let url
    try {
      url = new win.URL(rawLink.trim())
    } catch (e) {
      throw new Error('链接格式不正确。请直接粘贴研雀设置页复制的完整专属链接。')
    }
    this.validateServiceBase(url.origin, win.URL)
    if (url.username || url.password) throw new Error('专属链接不得包含用户名或密码。')
    const uid = (url.searchParams.get('uid') || '').trim().toLowerCase()
    if (!this.isValidUid(uid)) {
      throw new Error('链接里没有有效的设备 ID。请在研雀「设置」页点击“复制我的专属链接”后再粘贴。')
    }
    return { base: url.origin, uid }
  },

  async promptSettings(win) {
    const ps = Services.prompt
    if (this.account?.record() || this.account?.pending || this.account?.starting) {
      ps.alert(win, '研雀', '请先在阅读台账号设置中退出或取消登录，再更改旧版连接。')
      return false
    }

    const currentUid = this.getUid()
    const currentBase = this.getBaseURL()
    const link = {
      value: this.isValidUid(currentUid)
        ? `${currentBase}/?uid=${currentUid}`
        : this.DEFAULT_BASE,
    }
    if (!ps.prompt(win, '研雀连接设置',
      '打开研雀 → 设置 → 点击“复制我的专属链接”，然后粘贴到这里：', link, null, {})) {
      return false
    }

    let parsed
    try {
      parsed = this.parsePersonalLink(win, link.value)
    } catch (e) {
      ps.alert(win, '研雀', e.message)
      return false
    }

    Zotero.Prefs.set(this.PREF_BASE, parsed.base, true)
    Zotero.Prefs.set(this.PREF_UID, parsed.uid, true)
    Zotero.Prefs.set(this.LEGACY_PREF_USERNAME, '', true)
    Zotero.Prefs.set(this.LEGACY_PREF_PASSWORD, '', true)
    Zotero.Prefs.set(this.PREF_CONFIG_VERSION, this.CONFIG_VERSION, true)

    try {
      const resp = await win.fetch(parsed.base + '/api/settings', {
        headers: this.requestHeaders(),
        redirect: 'error', credentials: 'omit',
      })
      await this.requireOk(resp, '连接测试')
      Zotero.Prefs.set(this.PREF_LOCAL_ONLY, false, true)
      ps.alert(win, '研雀', '连接成功。现在可以右键文献 →「用研雀精读」。')
    } catch (e) {
      this.log('connection test failed: ' + e)
      ps.alert(win, '研雀',
        this.connectionMessage(e, parsed.base) + '\n\n技术信息：' + e.message)
      return false
    }
    return true
  },

  /** 从 extra 字段提取 PMID */
  extractPmid(extra) {
    const m = /PMID:\s*(\d+)/i.exec(extra || '')
    return m ? m[1] : ''
  },

  buildPaper(item) {
    const authors = item.getCreators()
      .map(c => [c.firstName, c.lastName].filter(Boolean).join(' '))
      .filter(Boolean)
      .join(', ')
    const doi = item.getField('DOI') || ''
    return {
      title: item.getField('title') || '(untitled)',
      abstract: item.getField('abstractNote') || '',
      authors,
      journal: item.getField('publicationTitle') || item.getField('conferenceName') || '',
      pub_date: item.getField('date') || '',
      doi,
      pmid: this.extractPmid(item.getField('extra')),
      link: item.getField('url') || (doi ? 'https://doi.org/' + doi : ''),
      source: 'zotero',
    }
  },

  async openSelected(win) {
    const pane = Zotero.getActiveZoteroPane()
    let item = pane.getSelectedItems()[0]
    if (!item) {
      Services.prompt.alert(win, '研雀', '请先选中一条文献。')
      return
    }
    if (item.isAttachment() && item.parentItemID) {
      item = Zotero.Items.get(item.parentItemID)
    }
    if (!item.isRegularItem()) {
      Services.prompt.alert(win, '研雀', '请选中一条文献条目（而不是笔记或独立附件）。')
      return
    }

    if (!await this.ensureConnection(win)) return
    const base = this.getBaseURL()

    try {
      const connection = this.connectionSnapshot()
      // 1. 保存元数据到 PaperMind 收藏库
      const saveResp = await win.fetch(base + '/api/library/save', {
        method: 'POST',
        headers: this.requestHeaders({ 'Content-Type': 'application/json' }, connection),
        redirect: 'error', credentials: 'omit',
        body: JSON.stringify({ paper: this.buildPaper(item), chats: [] }),
      })
      await this.requireOk(saveResp, '保存文献')
      const saved = await saveResp.json()
      this.requireCurrentConnection(connection)
      if (!saved.id) throw new Error('save 未返回 id')
      this.log('saved rowid=' + saved.id)

      // 2. 上传最佳 PDF 附件（没有就跳过，PaperMind 侧还能自动找 OA 全文）
      try {
        const att = await item.getBestAttachment()
        if (att && att.attachmentContentType === 'application/pdf') {
          const path = await att.getFilePathAsync()
          if (path) {
            const bytes = await win.IOUtils.read(path)
            const fd = new win.FormData()
            fd.append('file', new win.Blob([bytes], { type: 'application/pdf' }), 'paper.pdf')
            this.requireCurrentConnection(connection)
            const upResp = await win.fetch(`${base}/api/library/${saved.id}/pdf`, {
              method: 'POST',
              headers: this.requestHeaders({}, connection),
              redirect: 'error', credentials: 'omit',
              body: fd,
            })
            await this.requireOk(upResp, '上传 PDF')
            this.log('pdf upload HTTP ' + upResp.status)
          }
        }
      } catch (e) {
        if (e.code === 'CONNECTION_CHANGED') throw e
        this.log('pdf upload skipped: ' + e)
      }

      // 3. 打开浏览器进入阅读页（?uid= 让新浏览器自动继承设备身份）
      this.requireCurrentConnection(connection)
      Zotero.launchURL(this.buildReadingUrl(base, saved.id, connection.uid))
    } catch (e) {
      this.log('openSelected failed: ' + e)
      Services.prompt.alert(win, '研雀',
        '发送失败：' + e.message + '\n\n' + this.connectionMessage(e, base))
    }
  },

  addToWindow(win) {
    this.sidebar?.addToWindow(win)
    const doc = win.document
    if (doc.getElementById(this.MENU_ID)) return

    // 文献右键菜单
    const itemMenu = doc.getElementById('zotero-itemmenu')
    if (itemMenu) {
      const mi = doc.createXULElement('menuitem')
      mi.id = this.MENU_ID
      mi.setAttribute('label', '用研雀精读')
      mi.addEventListener('command', () => this.openSelected(win))
      itemMenu.appendChild(mi)
    }

    // Tools 菜单：连接设置
    const toolsMenu = doc.getElementById('menu_ToolsPopup')
    if (toolsMenu && !doc.getElementById(this.TOOLS_ID)) {
      const mi = doc.createXULElement('menuitem')
      mi.id = this.TOOLS_ID
      mi.setAttribute('label', '研雀连接设置…')
      mi.addEventListener('command', () => { void this.promptSettings(win) })
      toolsMenu.appendChild(mi)
    }
  },

  removeFromWindow(win) {
    this.sidebar?.removeFromWindow(win)
    const doc = win.document
    for (const id of [this.MENU_ID, this.TOOLS_ID]) {
      const el = doc.getElementById(id)
      if (el) el.remove()
    }
  },
}

// ── bootstrap entry points ──────────────────────────────────

function install() {}

async function startup({ rootURI }) {
  await Zotero.initializationPromise
  PaperMind.migrateLegacyConfig()
  try {
    const scope = { Zotero, Services, PaperMind, Components }
    // Privileged Firefox globals are used only for local reading records.
    if (typeof IOUtils === 'undefined') Components.utils.importGlobalProperties(['IOUtils', 'PathUtils'])
    scope.IOUtils = IOUtils
    scope.PathUtils = PathUtils
    Services.scriptloader.loadSubScript(rootURI + 'account.js', scope)
    PaperMind.account = scope.PaperMindAccount
    if (!PaperMind.isValidUid(Zotero.Prefs.get(PaperMind.PREF_UID, true))) {
      Zotero.Prefs.set(PaperMind.PREF_UID, Zotero.getMainWindow().crypto.randomUUID(), true)
      // New local-only identity must not be mistaken for an old configured service on restart.
      Zotero.Prefs.set(PaperMind.PREF_CONFIG_VERSION, PaperMind.CONFIG_VERSION, true)
      Zotero.Prefs.set(PaperMind.PREF_LOCAL_ONLY, true, true)
    }
    Services.scriptloader.loadSubScript(rootURI + 'sidebar.js', scope)
    Services.scriptloader.loadSubScript(rootURI + 'reader-context.js', scope)
    Services.scriptloader.loadSubScript(rootURI + 'workspace.js', scope)
    PaperMind.sidebar = scope.PaperMindSidebar
    scope.PaperMindWorkspace.install(PaperMind.sidebar)
    PaperMind.sidebar.workspace = scope.PaperMindWorkspace
    PaperMind.sidebar.init(rootURI)
  } catch (error) {
    // A sidebar registration failure must not remove the existing web entry.
    PaperMind.log('sidebar initialization failed: ' + error)
  }
  for (const win of Zotero.getMainWindows()) {
    PaperMind.addToWindow(win)
  }
}

function onMainWindowLoad({ window }) {
  PaperMind.addToWindow(window)
}

function onMainWindowUnload({ window }) {
  PaperMind.removeFromWindow(window)
}

function shutdown() {
  PaperMind.account?.dispose()
  PaperMind.sidebar?.destroy()
  if (typeof Zotero !== 'undefined') {
    for (const win of Zotero.getMainWindows()) {
      PaperMind.removeFromWindow(win)
    }
  }
}

function uninstall() {}
