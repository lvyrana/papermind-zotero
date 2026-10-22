// Copyright (C) 2026 lvyrana · SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const members = Object.freeze([
  'manifest.json', 'bootstrap.js', 'sidebar.js', 'reader-context.js',
  'workspace.js', 'account.js', 'icon.svg', 'LICENSE', 'THIRD_PARTY_NOTICES.md',
  'locale/zh-CN/papermind.ftl', 'locale/en-US/papermind.ftl',
])
const hash = bytes => createHash('sha256').update(bytes).digest('hex')

export function auditPackage(sourceDir, xpi) {
  const actual = execFileSync('unzip', ['-Z1', xpi], { encoding: 'utf8' }).trim().split('\n')
    .filter(name => !name.endsWith('/'))
  if (actual.length !== members.length || new Set(actual).size !== members.length
    || actual.some(name => !members.includes(name))) throw new Error('Unexpected or missing XPI member')
  const sha256 = {}
  for (const name of members) {
    const source = readFileSync(resolve(sourceDir, name))
    const packed = execFileSync('unzip', ['-p', xpi, name], { maxBuffer: 4 * 1024 * 1024 })
    if (!source.length || !source.equals(packed)) throw new Error(`Empty or mismatched member: ${name}`)
    sha256[name] = hash(packed)
  }
  const manifest = JSON.parse(readFileSync(resolve(sourceDir, 'manifest.json')))
  if (manifest.applications?.zotero?.id !== 'papermind-connector@papermind.local') {
    throw new Error('Plugin installation identity changed')
  }
  return { version: manifest.version, xpi_sha256: hash(readFileSync(xpi)),
    files: actual.length, bundled_third_party_runtime_packages: 0,
    runtime_sha256: hash(Buffer.from(members.filter(name => !['LICENSE', 'THIRD_PARTY_NOTICES.md'].includes(name))
      .map(name => `${name}:${sha256[name]}\n`).join(''))), sha256 }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const result = auditPackage(root, resolve(process.argv[2] || resolve(root, 'papermind-connector.xpi')))
  const json = JSON.stringify(result, null, 2) + '\n'
  if (process.argv[3]) writeFileSync(process.argv[3], json, { flag: 'wx', mode: 0o600 })
  console.log(json)
}
