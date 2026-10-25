import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { auditPackage, members } from './scripts/check-package.mjs'

function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'litfinch-package-test-'))
  try {
    for (const name of members) {
      mkdirSync(dirname(join(root, name)), { recursive: true })
      writeFileSync(join(root, name), name === 'manifest.json'
        ? JSON.stringify({ version: '0.7.0', applications: { zotero: { id: 'papermind-connector@papermind.local' } } })
        : `Synthetic test member: ${name}\n`)
    }
    const xpi = join(root, 'test.xpi')
    execFileSync('zip', ['-q', xpi, ...members], { cwd: root })
    run(root, xpi)
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test('release package retains all source bytes and both license documents', () => fixture((root, xpi) => {
  const report = auditPackage(root, xpi)
  assert.equal(report.files, members.length)
  assert.equal(report.version, '0.7.0')
  assert.match(report.runtime_sha256, /^[a-f0-9]{64}$/)
  assert.ok(report.sha256.LICENSE)
  assert.ok(report.sha256['THIRD_PARTY_NOTICES.md'])
}))

test('unexpected archive payload blocks release', () => fixture((root, xpi) => {
  writeFileSync(join(root, '.env'), 'SYNTHETIC=private\n')
  execFileSync('zip', ['-q', xpi, '.env'], { cwd: root })
  assert.throws(() => auditPackage(root, xpi), /Unexpected or missing/)
}))

test('stale packaged source and empty license block release', () => fixture((root, xpi) => {
  writeFileSync(join(root, 'workspace.js'), 'changed source\n')
  assert.throws(() => auditPackage(root, xpi), /mismatched member: workspace.js/)
  execFileSync('zip', ['-q', xpi, 'workspace.js'], { cwd: root })
  writeFileSync(join(root, 'LICENSE'), '')
  execFileSync('zip', ['-q', xpi, 'LICENSE'], { cwd: root })
  assert.throws(() => auditPackage(root, xpi), /Empty or mismatched member: LICENSE/)
}))
