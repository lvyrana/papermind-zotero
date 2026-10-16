/* Copyright (C) 2026 lvyrana · SPDX-License-Identifier: AGPL-3.0-only */
/* global Zotero */
var PaperMindReaderContext = {
  cache: new WeakMap(),
  realms: new WeakMap(),

  active(win, paper) {
    const reader = Zotero.Reader.getByTabID?.(win.Zotero_Tabs?.selectedID)
    if (!reader) return null
    const attachment = Zotero.Items.get(reader.itemID)
    if (!attachment?.isAttachment?.() || attachment.parentItemID !== paper.id) return null
    const internal = reader._internalReader
    const view = internal?._lastViewPrimary === false ? internal._secondaryView : internal?._primaryView
    const app = view?._iframeWindow?.PDFViewerApplication
    const page = app?.pdfViewer?.currentPageNumber
    if (app?.pdfDocument) this.realms.set(app.pdfDocument, view._iframeWindow)
    return { reader, attachment, pdf: app?.pdfDocument,
      page: Number.isInteger(page) && page > 0 ? page : null }
  },

  async pageText(pdf, page) {
    if (!pdf || !Number.isInteger(page) || page < 1 || page > pdf.numPages) return ''
    let entry = this.cache.get(pdf)
    if (!entry) { entry = new Map(); this.cache.set(pdf, entry) }
    if (!entry.has(page)) {
      const pending = (async () => {
        // Zotero 9 exposes processed characters, not stock PDF.js text items.
        if (typeof pdf.getPageData === 'function') {
          const realm = this.realms.get(pdf)
          const params = { pageIndex: page - 1 }
          // Firefox cross-compartment wrappers cannot be posted to PDF's worker.
          const data = await pdf.getPageData(realm && Components.utils?.cloneInto
            ? Components.utils.cloneInto(params, realm) : params)
          if (!Array.isArray(data?.chars)) throw new Error('PDF 页面文字格式不受支持')
          return data.chars.filter(char => !char.ignorable).map(char =>
            (char.u ?? char.c ?? '') + (char.paragraphBreakAfter ? '\n\n' : char.lineBreakAfter ? '\n' : char.spaceAfter ? ' ' : '')
          ).join('').trim().slice(0, 60000)
        }
        const content = await (await pdf.getPage(page)).getTextContent()
        return content.items.map(item => (item.str || '') + (item.hasEOL ? '\n' : ' ')).join('').trim().slice(0, 60000)
      })()
      entry.set(page, pending)
      pending.catch(() => entry.delete(page))
    }
    return entry.get(page)
  },

  // Extract locally. A request receives a page-labelled, explicitly bounded
  // evidence packet, not an unlabelled claim to have sent the whole document.
  async collect(active, query = '', signal) {
    if (!active?.pdf) return { pages: '', currentText: '', coverage: '未读取 PDF；仅有条目摘要', page: null }
    const { pdf, page } = active
    const currentText = await this.pageText(pdf, page).catch(() => '')
    const texts = []
    let chars = 0, scanned = 0, failed = 0, firstError = null
    const terms = [...new Set(String(query).toLowerCase().match(/[a-z0-9]{3,}|[\u4e00-\u9fff]{2,6}/g) || [])].slice(0, 24)
    for (let n = 1; n <= Math.min(pdf.numPages, 200); n++) {
      if (signal?.aborted) throw new Error('已停止读取 PDF。')
      const text = await this.pageText(pdf, n).catch(error => { failed++; firstError ||= String(error.message || error).slice(0, 200); return '' })
      texts.push({ n, text, score: terms.reduce((sum, term) => sum + (text.toLowerCase().includes(term) ? 1 : 0), 0) })
      scanned++
      chars += text.length
      if (chars >= 800000) break
    }
    // Current page + beginning/end + lexical matches, then document order.
    const priority = [...texts].sort((a, b) => {
      const score = x => (x.n === page ? 1000 : 0) + (x.n <= 2 || x.n === scanned ? 100 : 0) + x.score * 10
      return score(b) - score(a) || a.n - b.n
    })
    const selected = [], budget = 22500
    let used = 0
    for (const entry of priority) {
      if (!entry.text || used >= budget) continue
      const text = entry.text.slice(0, Math.min(5000, budget - used))
      selected.push({ ...entry, text, truncated: text.length < entry.text.length })
      used += text.length + 40
    }
    const pages = selected.sort((a, b) => a.n - b.n)
      .map(x => `[PDF 第 ${x.n} 页${x.truncated ? ' · 节选' : ''}]\n${x.text}`).join('\n\n')
    const coverage = `本地检查 ${scanned}/${pdf.numPages} 页${failed ? `，${failed} 页读取失败` : ''}；本次提供 ${selected.length} 页文字或节选，不代表全部内容`
    return { pages: `[读取范围：${coverage}]\n${pages}`.slice(0, 24000), currentText: currentText.slice(0, 5000), coverage, page, firstError }
  },
}
