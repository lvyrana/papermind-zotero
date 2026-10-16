// Copyright (C) 2026 lvyrana
// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'

const source = file => readFileSync(new URL(file, import.meta.url), 'utf8')

test('LitFinch display name keeps the existing installation and update identity', () => {
  const manifest = JSON.parse(source('./manifest.json'))
  assert.equal(manifest.name, '研雀 · LitFinch')
  assert.equal(manifest.homepage_url, 'https://papermindapp.com')
  assert.equal(manifest.applications.zotero.id, 'papermind-connector@papermind.local')
  assert.equal(manifest.applications.zotero.update_url, 'https://papermindapp.com/api/zotero-plugin/update.json')
})

test('existing device settings and Login Manager realm survive the display rename', () => {
  const uid = '11111111-1111-4111-8111-111111111111'
  const prefs = new Map([['extensions.papermind.uid', uid], ['extensions.papermind.configVersion', 3]])
  const context = vm.createContext({ URL, Zotero: { Prefs: { get: key => prefs.get(key) } } })
  for (const file of ['./bootstrap.js', './account.js']) vm.runInContext(source(file), context)
  assert.equal(context.PaperMind.getUid(), uid)
  assert.equal(context.PaperMind.isConfigured(), true)
  assert.equal(context.PaperMind.PREF_BASE, 'extensions.papermind.baseURL')
  assert.equal(context.PaperMind.PREF_UID, 'extensions.papermind.uid')
  assert.equal(context.PaperMindAccount.realm, 'PaperMind account session')
  assert.match(source('./workspace.js'), /PathUtils\.join\(Zotero\.Profile\.dir, 'papermind-reading'\)/)
})

test('reader, translation, menus and account surfaces share the accepted brand', () => {
  const sidebar = source('./sidebar.js'), workspace = source('./workspace.js')
  assert.match(sidebar, /launch\.textContent = '研雀'/)
  assert.match(sidebar, /'研雀原文下方翻译'/)
  assert.match(sidebar, /<h2>研雀 · /)
  assert.match(workspace, /'研雀 · 阅读台'/)
  assert.match(workspace, /'研雀账号'/)
  assert.match(source('./bootstrap.js'), /'用研雀精读'/)
  assert.match(source('./account.js'), /'研雀连接恢复'/)
  assert.match(source('./locale/zh-CN/papermind.ftl'), /\.label = 研雀精读/)
  assert.match(source('./locale/en-US/papermind.ftl'), /\.label = LitFinch/)
  for (const text of [sidebar, workspace, source('./bootstrap.js')]) {
    assert.doesNotMatch(text, /['"]PaperMind(?:['" ·]| 连接| 侧栏| 阅读| 精读)/)
  }
})
