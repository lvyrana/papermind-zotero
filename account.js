/* Copyright (C) 2026 lvyrana · SPDX-License-Identifier: AGPL-3.0-only */
/* global Zotero, Services, Components, PaperMind */
var PaperMindAccount = {
  realm: 'PaperMind account session',
  cached: new Map(), pending: null, starting: false, status: '', generation: 0,

  record(base = PaperMind.getBaseURL()) {
    if (!this.cached.has(base)) {
      const login = Services.logins.findLogins(base, null, this.realm)[0]
      let value = null
      if (login) {
        try { value = JSON.parse(login.password) } catch { throw new Error('登录记录无法读取，请重新登录。') }
      }
      this.cached.set(base, value)
    }
    return this.cached.get(base)
  },

  async save(base, record) {
    const LoginInfo = new Components.Constructor('@mozilla.org/login-manager/loginInfo;1', Components.interfaces.nsILoginInfo, 'init')
    const next = new LoginInfo(base, null, this.realm, record.account.id, JSON.stringify(record), '', '')
    const old = Services.logins.findLogins(base, null, this.realm)[0]
    if (old) Services.logins.modifyLogin(old, next)
    else await Services.logins.addLoginAsync(next)
    this.cached.set(base, record)
  },

  refresh() {
    for (const win of Zotero.getMainWindows()) {
      PaperMind.sidebar?.syncWindow(win)
      const session = PaperMind.sidebar?.sessionFor(PaperMind.sidebar.activeItem(win))
      if (session) PaperMind.sidebar.refresh(session)
    }
  },

  async request(win, base, path, body, token = '') {
    PaperMind.validateServiceBase(base, win.URL)
    const controller = new win.AbortController()
    const timer = win.setTimeout(() => controller.abort(), 20000)
    try {
      const response = await win.fetch(base + '/api/auth/' + path, { method: body === undefined ? 'GET' : 'POST',
        credentials: 'omit', redirect: 'error', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
      await PaperMind.requireOk(response, '账号连接')
      return await response.json()
    } finally { win.clearTimeout(timer) }
  },

  async start(win) {
    if (this.pending || this.starting) return
    this.starting = true
    const base = PaperMind.getBaseURL(), generation = ++this.generation
    this.status = '正在连接登录服务…'; this.refresh()
    try {
      const result = await this.request(win, base, 'device/start', { legacy_uid: PaperMind.getUid() })
      if (generation !== this.generation) {
        if (result.secret) await this.request(win, base, 'device/cancel', { secret: result.secret }).catch(() => {})
        return
      }
      const url = new win.URL(result.verification_url)
      if (url.origin !== base || url.pathname !== '/settings' || url.searchParams.get('device') !== result.user_code
        || !/^[A-F0-9]{12}$/.test(result.user_code) || typeof result.secret !== 'string') throw new Error('登录返回地址无效，未打开网页。')
      this.pending = { base, secret: result.secret, code: result.user_code, generation, win,
        expires: Date.now() + Math.min(result.expires_in || 600, 600) * 1000 }
      this.status = '在浏览器确认连接码：' + result.user_code
      Zotero.launchURL(url.href)
      this.refresh()
      this.pending.timer = win.setTimeout(() => this.poll(), 3000)
    } catch (error) { this.status = error.message; this.refresh() }
    finally { this.starting = false; this.refresh() }
  },

  async poll() {
    const pending = this.pending
    if (!pending || pending.generation !== this.generation) return
    if (Date.now() > pending.expires) { await this.cancel(); this.status = '登录已过期，可重新发起。'; this.refresh(); return }
    try {
      const data = await this.request(pending.win, pending.base, 'device/poll', { secret: pending.secret })
      if (pending !== this.pending || pending.base !== PaperMind.getBaseURL()) {
        if (data.token) await this.request(pending.win, pending.base, 'logout', {}, data.token).catch(() => {})
        return
      }
      if (data.pending) { pending.timer = pending.win.setTimeout(() => this.poll(), 3000); return }
      if (!data.token || !PaperMind.isValidUid(data.account?.data_uid) || !PaperMind.isValidUid(data.account?.id)) throw new Error('账号响应无效，未更改现有身份。')
      try { await this.save(pending.base, { token: data.token, account: data.account, expires: Date.now() + data.expires_in * 1000 }) }
      catch (error) { await this.request(pending.win, pending.base, 'logout', {}, data.token).catch(() => {}); throw error }
      // Saving can yield. A cancelled/replaced attempt must not re-enter the account.
      if (pending !== this.pending || pending.base !== PaperMind.getBaseURL()) {
        await this.request(pending.win, pending.base, 'logout', {}, data.token).catch(() => {})
        for (const login of Services.logins.findLogins(pending.base, null, this.realm)) {
          if (JSON.parse(login.password).token === data.token) Services.logins.removeLogin(login)
        }
        if (this.cached.get(pending.base)?.token === data.token) this.cached.delete(pending.base)
        return
      }
      this.pending = null
      this.status = '已登录：' + data.account.username
      this.refresh()
    } catch (error) {
      if (this.pending === pending) { this.pending = null; this.status = error.message; this.refresh() }
    }
  },

  async cancel() {
    ++this.generation
    const pending = this.pending
    this.pending = null
    if (pending) {
      pending.win.clearTimeout(pending.timer)
      await this.request(pending.win, pending.base, 'device/cancel', { secret: pending.secret }).catch(() => {})
    }
    this.status = '已取消登录，本地记录保留。'; this.refresh()
  },

  async logout(win) {
    await this.cancel()
    const base = PaperMind.getBaseURL(), record = this.record(base)
    let localDisconnect = false
    if (record) {
      try { PaperMind.validateServiceBase(base, win.URL) }
      catch {
        if (!Services.prompt.confirm(win, '研雀连接恢复',
          '当前服务地址不安全，不能发送退出请求。仅移除本机登录记录以便修改地址？远端会话仍未撤销，本地阅读文件保留。')) {
          this.status = '已保留本机登录，可再次退出以修复连接。'; this.refresh()
          return
        }
        localDisconnect = true
      }
    }
    if (record && !localDisconnect) await this.request(win, base, 'logout', {}, record.token)
    if (record?.account.data_uid === Zotero.Prefs.get(PaperMind.PREF_UID, true)) {
      // The old UID now belongs to the account. Keep its files; start a clean guest space.
      Zotero.Prefs.set(PaperMind.PREF_UID, win.crypto.randomUUID(), true)
      Zotero.Prefs.set(PaperMind.PREF_LOCAL_ONLY, true, true)
    }
    for (const login of Services.logins.findLogins(base, null, this.realm)) Services.logins.removeLogin(login)
    this.cached.set(base, null)
    this.status = localDisconnect
      ? '已断开本机登录，本地记录保留；远端会话未撤销，请在安全服务地址或服务管理端处理。'
      : '已退出账号，本地记录保留。'
    this.refresh()
  },

  dispose() {
    ++this.generation
    if (this.pending) this.pending.win.clearTimeout(this.pending.timer)
    this.pending = null
    this.cached.clear()
  },
}
