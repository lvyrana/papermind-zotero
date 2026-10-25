// Validate the installed official CLI with an empty temporary home. No login or model call.
import { spawn } from 'node:child_process'
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import vm from 'node:vm'
import assert from 'node:assert/strict'
const ctx = vm.createContext({})
vm.runInContext(readFileSync(new URL('../codex.js', import.meta.url), 'utf8'), ctx)
const dir = mkdtempSync(join(tmpdir(), 'litfinch-codex-protocol-')), work = join(dir, 'workspace')
mkdirSync(work); writeFileSync(join(dir, 'config.toml'), ctx.PaperMindCodex.configuration().replace('"keyring"', '"file"'), { mode: 0o600 })
const env = Object.fromEntries(['HOME', 'PATH', 'TMPDIR', 'LANG', 'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY'].filter(k => process.env[k]).map(k => [k, process.env[k]]))
const child = spawn(process.env.LITFINCH_CODEX_BIN || 'codex', ['app-server'], { cwd: work, env: { ...env, CODEX_HOME: dir }, stdio: ['pipe', 'pipe', 'pipe'] })
const pending = new Map(); let id = 0, buffer = '', diagnostics = ''
child.stderr.on('data', bytes => { diagnostics += bytes.toString() })
child.stdout.on('data', bytes => {
  buffer += bytes.toString()
  let end
  while ((end = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, end); buffer = buffer.slice(end + 1)
    if (!line.trim()) continue
    const message = JSON.parse(line), item = pending.get(message.id)
    if (item) { pending.delete(message.id); clearTimeout(item.timer); message.error ? item.reject(Error(message.error.message)) : item.resolve(message.result) }
  }
})
const rpc = (method, params) => new Promise((resolve, reject) => {
  const next = ++id, timer = setTimeout(() => reject(Error('Protocol timeout: ' + method)), 15000)
  pending.set(next, { resolve, reject, timer }); child.stdin.write(JSON.stringify({ id: next, method, params }) + '\n')
})
try {
  const initialized = await rpc('initialize', { clientInfo: { name: 'litfinch_protocol_check', version: '0.8.0' } })
  assert.ok(initialized.userAgent)
  child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n')
  const account = await rpc('account/read', { refreshToken: false }); assert.equal(account.account, null)
  const config = await rpc('config/read', { includeLayers: false })
  assert.equal(config.config.default_permissions, 'litfinch')
  assert.equal(config.config.features.shell_tool, false)
  assert.equal(config.config.features.apps, false)
  assert.equal(config.config.forced_login_method, 'chatgpt')
  const started = await rpc('thread/start', { cwd: work, ephemeral: true, approvalPolicy: 'never', baseInstructions: 'Return supplied text only; do not use tools.' })
  assert.ok(started.thread.id)
  await rpc('thread/unsubscribe', { threadId: started.thread.id })
  console.log('Installed Codex protocol passed: initialized, isolated account, personal ChatGPT auth mode, restricted permissions and disabled shell/apps. No login or model request.')
} catch (error) { console.error(error.message); console.error(diagnostics.slice(-1800)); process.exitCode = 1 }
finally {
  for (const item of pending.values()) clearTimeout(item.timer)
  child.kill(); await new Promise(resolve => child.once('close', resolve)); rmSync(dir, { recursive: true, force: true })
}
