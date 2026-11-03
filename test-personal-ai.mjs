import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

function fixture() {
  const prefs = new Map(), logins = [], requests = []
  const ctx = vm.createContext({ URL, PaperMind: {},
    Zotero: { Prefs: { get: key => prefs.get(key), set: (key, value) => prefs.set(key, value) } },
    Services: { logins: {
      findLogins: (base, _, realm) => logins.filter(x => x.hostname === base && x.httpRealm === realm),
      addLoginAsync: async value => logins.push(value), modifyLogin: (old, value) => logins.splice(logins.indexOf(old), 1, value),
      removeLogin: value => logins.splice(logins.indexOf(value), 1),
    } },
    Components: { interfaces: {}, Constructor: function () { return function (hostname, _, httpRealm, username, password) { Object.assign(this, { hostname, httpRealm, username, password }) } } },
  })
  vm.runInContext(fs.readFileSync(new URL('ai.js', import.meta.url), 'utf8'), ctx)
  const ai = ctx.PaperMindAI
  const win = { URL, AbortController, setTimeout, clearTimeout, fetch: async (url, options) => {
    requests.push({ url, ...options }); return { ok: true, json: async () => ({ choices: [{ message: { content: 'Synthetic answer' } }] }) }
  } }
  return { ai, ctx, prefs, logins, requests, win }
}

test('unconfigured AI fails closed with no maintainer fallback or network', async () => {
  const f = fixture()
  await assert.rejects(f.ai.request(f.win, '/api/chat', { message: 'Explain' }), /公共 AI 已关闭/)
  assert.equal(f.requests.length, 0)
})

test('personal API uses only the selected endpoint and its own key; preferences have no key', async () => {
  const f = fixture()
  await f.ai.save({ mode: 'api', base: 'https://provider.example/v1/', model: 'my-model' }, 'synthetic-personal-key')
  assert.doesNotMatch([...f.prefs.values()].join(), /synthetic-personal-key/)
  const result = await f.ai.request(f.win, '/api/chat', { message: 'Explain', paper_title: 'Synthetic paper' })
  assert.equal(result.reply, 'Synthetic answer')
  assert.equal(f.requests.length, 1)
  assert.equal(f.requests[0].url, 'https://provider.example/v1/chat/completions')
  assert.deepEqual(Object.keys(f.requests[0].headers).sort(), ['Authorization', 'Content-Type'])
  assert.equal(f.requests[0].headers.Authorization, 'Bearer synthetic-personal-key')
  assert.equal(f.requests[0].redirect, 'error'); assert.equal(f.requests[0].credentials, 'omit')
  await assert.rejects(f.ai.save({ mode: 'api', base: 'https://another.example/v1', model: 'other' }), /密钥/)
  assert.equal(f.ai.config().base, 'https://provider.example/v1')
  await f.ai.forgetKey()
  await assert.rejects(f.ai.request(f.win, '/api/chat', {}), /密钥/)
  assert.equal(f.requests.length, 1)
})

test('API settings reject remote plaintext, embedded credentials, query and fragment', () => {
  const { ai } = fixture()
  for (const url of ['http://provider.example/v1', 'https://user:password@example.com', 'https://example.com?key=abc', 'https://example.com/#x']) assert.throws(() => ai.base(url))
  assert.equal(ai.base('http://127.0.0.1:1234/v1'), 'http://127.0.0.1:1234/v1')
})

test('both abstract entry points isolate title and abstract at the provider boundary', async () => {
  const f = fixture()
  await f.ai.save({ mode: 'api', base: 'http://localhost/v1', model: 'reader' })
  const payload = { mode: 'abstract', paper_title: 'Abstract title', paper_abstract: 'A descriptive study reported an association.',
    current_page: 7, current_page_text: 'Body page sentinel', paper_pages: 'Whole paper sentinel',
    quote: { text: 'Selected paragraph sentinel' }, history: [{ role: 'user', content: 'Prior conversation sentinel' }],
    message: 'Expand the whole article into a long critique' }
  for (const endpoint of ['/api/chat', '/api/deep-read/guide']) await f.ai.request(f.win, endpoint, payload)
  const packets = f.requests.map(request => JSON.parse(request.body).messages)
  assert.deepEqual(packets[0], packets[1])
  for (const messages of packets) {
    assert.equal(messages.length, 3)
    assert.deepEqual(JSON.parse(messages[1].content.split('\n').slice(1).join('\n')),
      { title: payload.paper_title, abstract: payload.paper_abstract })
    assert.doesNotMatch(JSON.stringify(messages), /sentinel|long critique/)
    assert.match(messages.at(-1).content, /主要发现的具体数字/)
    assert.doesNotMatch(messages.at(-1).content, /\d+字/)
    assert.match(messages[0].content, /不得操作文件、调用工具/)
    assert.match(messages[0].content, /回答中不标注页码/)
    assert.match(messages[0].content, /每次回答最长约 1000 字/)
  }
})

test('chat sends the paper as readable text first, then history, then where the reader is, then the question', () => {
  const { ai } = fixture()
  const messages = ai.messages('/api/chat', { paper_title: 'T', paper_abstract: 'A', current_page: 4, current_page_text: 'Page four',
    paper_pages: '[读取范围：全文 2 页]\n[PDF 第 1 页]\nOne\n\n[PDF 第 4 页]\nFour', quote: { text: 'Chosen words', page: 4 },
    history: [{ role: 'user', content: 'Earlier' }, { role: 'assistant', content: '我只能看到第 5 页' }], message: '这个量表是什么？' })
  assert.deepEqual([...messages].map(x => x.role), ['system', 'user', 'user', 'assistant', 'user', 'user'])
  assert.match(messages[1].content, /^论文材料\n\n题名：T\n\n摘要：A\n\n\[读取范围：全文 2 页\]/)
  assert.doesNotMatch(messages[1].content, /Page four|"page"/)
  assert.equal(messages[4].content, '读者此刻停在 PDF 第 4 页。\n读者选中的原文（PDF 第 4 页）：\n「Chosen words」')
  assert.equal(messages[5].content, '这个量表是什么？')
  assert.match(messages[0].content, /对话历史里如果说过「看不到某页」/)
})

test('a context-length refusal is recognised; other provider errors keep the generic message', async () => {
  const f = fixture()
  await f.ai.save({ mode: 'api', base: 'http://localhost/v1', model: 'small' })
  for (const [status, body, code] of [
    [400, '{"error":{"code":"context_length_exceeded","message":"This model\'s maximum context length is 32768 tokens"}}', 'CONTEXT_TOO_LONG'],
    [413, '', 'CONTEXT_TOO_LONG'],
    [400, 'Input length must be less than 32768', 'CONTEXT_TOO_LONG'],
    [422, 'Prompt is too long', 'CONTEXT_TOO_LONG'],
    [429, 'Token limit per minute exceeded', undefined],
    [429, 'maximum context length exceeded', undefined],
    [400, 'Too many tokens per minute', undefined],
    [422, 'Too many input tokens: TPM rate limit', undefined],
    [401, '{"error":{"message":"Incorrect API key"}}', undefined],
  ]) {
    f.win.fetch = async () => ({ ok: false, status, text: async () => body })
    const error = await f.ai.request(f.win, '/api/chat', { message: 'x', paper_pages: 'p' }).catch(e => e)
    assert.equal(error.code, code, String(status))
    if (!code) assert.ok(error.message.includes(`HTTP ${status}`))
  }
})

test('page 201 reaches the provider beside the question without changing the stable paper material', async () => {
  const f = fixture()
  vm.runInContext(fs.readFileSync(new URL('reader-context.js', import.meta.url), 'utf8'), f.ctx)
  const pdf = { numPages: 201, getPage: async n => ({ getTextContent: async () => ({ items: [{ str: n === 201 ? 'CURRENT_PAGE_201_ONLY' : `Page ${n}` }] }) }) }
  const context = await f.ctx.PaperMindReaderContext.collect({ pdf, page: 201 })
  await f.ai.save({ mode: 'api', base: 'http://localhost/v1', model: 'reader' })
  await f.ai.request(f.win, '/api/chat', { paper_pages: context.pages, current_page: context.page,
    current_page_text: context.currentText, message: 'Explain this page' })
  const messages = JSON.parse(f.requests.at(-1).body).messages
  assert.doesNotMatch(messages[1].content, /CURRENT_PAGE_201_ONLY/)
  assert.match(messages.at(-2).content, /\[读者当前页 · PDF 第 201 页\]\nCURRENT_PAGE_201_ONLY/)
  assert.equal(messages.at(-1).content, 'Explain this page')
  const full = f.ai.messages('/api/chat', { paper_pages: '[PDF 第 201 页]\nCURRENT_PAGE_201_ONLY',
    current_page: 201, current_page_text: 'CURRENT_PAGE_201_ONLY', message: 'Explain' })
  assert.equal(JSON.stringify(full).split('CURRENT_PAGE_201_ONLY').length - 1, 1)
})

test('API routes translation independently while reading operations keep the reading model', async () => {
  const f = fixture()
  await f.ai.save({ mode: 'api', base: 'https://provider.example/v1', model: 'reader', translationModel: 'translator' }, 'synthetic-key')
  for (const endpoint of ['/api/translate', '/api/chat', '/api/deep-read/guide']) {
    const result = await f.ai.request(f.win, endpoint, { text: 'Original', message: 'Explain' })
    assert.equal(result[endpoint === '/api/translate' ? 'translated' : endpoint === '/api/chat' ? 'reply' : 'guide'], 'Synthetic answer')
  }
  assert.deepEqual(f.requests.map(x => JSON.parse(x.body).model), ['translator', 'reader', 'reader'])
  assert.ok(f.requests.every(x => x.url === 'https://provider.example/v1/chat/completions'))
  assert.equal(JSON.parse(f.requests[0].body).messages[1].content, 'Original')
  assert.equal(f.ai.config().model, 'reader')
})

test('legacy saved configuration and blank translation model retain the reading model', async () => {
  const f = fixture()
  f.prefs.set(f.ai.pref, JSON.stringify({ mode: 'api', base: 'http://localhost:1234/v1', model: 'legacy-model' }))
  await f.ai.request(f.win, '/api/translate', { text: 'Original' })
  assert.equal(JSON.parse(f.requests[0].body).model, 'legacy-model')
  await f.ai.save({ ...f.ai.config(), translationModel: '  ' })
  await f.ai.request(f.win, '/api/translate', { text: 'Original' })
  assert.equal(JSON.parse(f.requests[1].body).model, 'legacy-model')
})

test('streaming reads split server-sent chunks and falls back when a service rejects streaming', async () => {
  const f = fixture(), encoder = new TextEncoder()
  await f.ai.save({ mode: 'api', base: 'http://localhost/v1', model: 'reader' })
  f.win.TextDecoder = TextDecoder
  const chunks = ['data: {"choices":[{"delta":{"content":"第一"}}]}\n\nda', 'ta: {"choices":[{"delta":{"content":"段。"}}]}\n\n: keep-alive\n', 'data: [DONE]\n\n']
  f.win.fetch = async (url, options) => {
    f.requests.push({ url, ...options }); let index = 0
    return { ok: true, headers: { get: () => 'text/event-stream; charset=utf-8' },
      body: { getReader: () => ({ read: async () => index < chunks.length ? { value: encoder.encode(chunks[index++]), done: false } : { done: true } }) } }
  }
  const seen = []
  assert.equal((await f.ai.request(f.win, '/api/chat', { message: 'Explain' }, undefined, text => seen.push(text))).reply, '第一段。')
  assert.deepEqual(seen, ['第一', '第一段。'])
  assert.equal(JSON.parse(f.requests[0].body).stream, true)
  f.requests.length = 0
  f.win.fetch = async (url, options) => {
    f.requests.push({ url, ...options })
    return JSON.parse(options.body).stream ? { ok: false, status: 400 } : { ok: true, json: async () => ({ choices: [{ message: { content: 'Whole answer' } }] }) }
  }
  assert.equal((await f.ai.request(f.win, '/api/chat', { message: 'Explain' }, undefined, () => {})).reply, 'Whole answer')
  assert.deepEqual(f.requests.map(request => JSON.parse(request.body).stream), [true, false])
  f.requests.length = 0
  assert.equal((await f.ai.request(f.win, '/api/translate', { text: 'Original' })).translated, 'Whole answer')
  assert.deepEqual(f.requests.map(request => JSON.parse(request.body).stream), [false])
})

test('Codex receives independent models and keeps account defaults when both are blank', async () => {
  const f = fixture(), configs = []
  f.ctx.PaperMind.codex = { stop: async () => {}, generate: async (_win, _messages, config) => { configs.push(config); return 'Codex answer' } }
  await f.ai.save({ mode: 'codex', model: 'codex-reader', translationModel: 'codex-translator' })
  await f.ai.request(f.win, '/api/translate', { text: 'Original' })
  await f.ai.request(f.win, '/api/chat', { message: 'Explain' })
  assert.deepEqual(configs.map(x => x.model), ['codex-translator', 'codex-reader'])
  await f.ai.save({ mode: 'codex' })
  await f.ai.request(f.win, '/api/translate', { text: 'Original' })
  assert.equal(configs[2].model, '')
  assert.equal(f.requests.length, 0)
})

test('connection check identifies missing models without sending paper text', async () => {
  const f = fixture()
  await f.ai.save({ mode: 'api', base: 'https://provider.example/v1', model: 'reader', translationModel: 'translator' }, 'synthetic-key')
  let ids = ['reader']
  f.win.fetch = async (url, options) => { f.requests.push({ url, ...options }); return { ok: true, json: async () => ({ data: ids.map(id => ({ id })) }) } }
  assert.match(await f.ai.test(f.win), /未找到翻译模型/)
  ids = ['translator']
  assert.match(await f.ai.test(f.win), /未找到精读模型/)
  ids = ['reader', 'translator']
  assert.match(await f.ai.test(f.win), /包含精读和翻译模型；尚未测试生成/)
  assert.ok(f.requests.every(x => x.url.endsWith('/models') && !x.body))
})

test('Codex settings check both chosen models and label translation failure', async () => {
  const f = fixture(), models = []
  f.ctx.PaperMind.codex = { stop: async () => {}, check: async (_win, config) => { models.push(config.model); if (config.model === 'missing') throw new Error('模型不可用。') } }
  await f.ai.save({ mode: 'codex', model: 'reader', translationModel: 'translator' })
  assert.match(await f.ai.test(f.win), /精读和翻译模型检查通过/)
  assert.deepEqual(models, ['reader', 'translator'])
  await f.ai.save({ mode: 'codex', model: 'reader', translationModel: 'missing' })
  await assert.rejects(f.ai.test(f.win), /翻译连接：模型不可用/)
})

test('invalid pasted keys never overwrite existing credentials or preferences', async () => {
  const f = fixture(), config = { mode: 'api', base: 'https://provider.example/v1', model: 'reader' }
  await f.ai.save(config, 'original-valid-key')
  const saved = f.prefs.get(f.ai.pref), revision = f.ai.revision
  for (const invalid of ['普通中文', '   ', 'key with-space', 'key\twith-tab', 'key\n', 'key\r\n', 'key\u0000']) {
    await assert.rejects(f.ai.save({ ...config, model: 'other' }, invalid), error => /密钥格式无效/.test(error.message) && !error.message.includes(invalid))
    assert.equal(f.ai.key(config.base), 'original-valid-key')
    assert.equal(f.prefs.get(f.ai.pref), saved)
    assert.equal(f.ai.revision, revision)
  }
  await f.ai.save({ ...config, translationModel: 'translator' }, '')
  assert.equal(f.ai.key(config.base), 'original-valid-key')
  await f.ai.save(config, '  generic-provider-token_123==  ')
  assert.equal(f.ai.key(config.base), 'generic-provider-token_123==')
  assert.doesNotMatch([...f.prefs.values()].join(), /original-valid-key|generic-provider-token/)
  assert.equal(f.requests.length, 0)
})

test('provider refusal is bounded, does not echo credentials and never switches provider', async () => {
  const f = fixture(); await f.ai.save({ mode: 'api', base: 'https://provider.example/v1', model: 'test' }, 'secret')
  f.win.fetch = async () => { f.requests.push(1); return { ok: false, status: 429, text: async () => 'secret' } }
  await assert.rejects(f.ai.request(f.win, '/api/chat', {}), error => /429/.test(error.message) && !/secret/.test(error.message))
  assert.equal(f.requests.length, 1)
})

test('provider configuration changes discard in-flight output', async () => {
  const f = fixture(); await f.ai.save({ mode: 'api', base: 'https://provider.example/v1', model: 'test' }, 'secret')
  let finish
  f.win.fetch = () => new Promise(resolve => { finish = resolve })
  const pending = f.ai.request(f.win, '/api/chat', {})
  await f.ai.save({ mode: 'none' })
  finish({ ok: true, json: async () => ({ choices: [{ message: { content: 'stale' } }] }) })
  await assert.rejects(pending, /连接已改变/)
})

test('Codex protocol rejects server tool and approval requests', async () => {
  const ctx = vm.createContext({ PaperMind: { ai: {} }, Zotero: {}, Services: {} })
  vm.runInContext(fs.readFileSync(new URL('codex.js', import.meta.url), 'utf8'), ctx)
  const bridge = ctx.PaperMindCodex, sent = []
  bridge.send = async value => sent.push(value)
  await bridge.receive({ id: 1, method: 'item/commandExecution/requestApproval', params: {} })
  assert.equal(sent[0].error.code, -32601)
  assert.match(bridge.configuration(), /forced_login_method = "chatgpt"/)
  assert.match(bridge.configuration(), /":root" = "deny"/)
  assert.match(bridge.configuration(), /shell_tool = false/)
  assert.match(bridge.configuration(), /history]\npersistence = "none"/)
})


test('model discovery works before choosing a model and has no credential or preference writes', async () => {
  const f = fixture(), config = { mode: 'api', base: 'https://provider.example/v1' }
  f.win.fetch = async (url, options) => { f.requests.push({ url, ...options }); return { ok: true, json: async () => ({ data: [{ id: 'reader' }, { id: 'translator' }, { id: 'reader' }] }) } }
  assert.deepEqual(Array.from(await f.ai.models(f.win, config, 'new-synthetic-key')), ['reader', 'translator'])
  assert.equal(f.prefs.size, 0); assert.equal(f.logins.length, 0); assert.equal(f.ai.revision, 0)
  assert.equal(f.requests[0].headers.Authorization, 'Bearer new-synthetic-key')
  assert.equal(f.requests[0].url, config.base + '/models')
  assert.equal(f.requests[0].redirect, 'error'); assert.equal(f.requests[0].credentials, 'omit'); assert.equal(f.requests[0].body, undefined)
  await f.ai.save({ ...config, model: 'reader' }, 'stored-synthetic-key')
  await f.ai.models(f.win, config)
  assert.equal(f.requests[1].headers.Authorization, 'Bearer stored-synthetic-key')
  await assert.rejects(f.ai.models(f.win, { ...config, base: 'https://other.example/v1' }), /当前服务的 API 密钥/)
  await assert.rejects(f.ai.models(f.win, config, '误复制文字'), /密钥格式无效/)
  assert.equal(f.requests.length, 2)
  await f.ai.models(f.win, { mode: 'api', base: 'http://localhost:1234/v1' })
  assert.equal(f.requests[2].headers.Authorization, undefined)
})

test('discovery bounds untrusted model rows and keeps arbitrary custom models available', async () => {
  const f = fixture()
  const rows = [{ id: null }, {}, { id: '   ' }, { id: 'bad\nname' }, { id: 'x'.repeat(201) }, { id: '<custom-model>' }, { id: ' trimmed ' }]
  f.win.fetch = async () => ({ ok: true, json: async () => ({ data: rows }) })
  assert.deepEqual(Array.from(await f.ai.models(f.win, { mode: 'api', base: 'http://localhost/v1' })), ['<custom-model>', 'trimmed'])
  rows.push(...Array.from({ length: 3000 }, (_, i) => ({ id: 'model-' + i })))
  assert.equal((await f.ai.models(f.win, { mode: 'api', base: 'http://localhost/v1' })).length, 1000)
  f.win.fetch = async () => ({ ok: false, status: 404, text: async () => 'private upstream body' })
  await assert.rejects(f.ai.models(f.win, { mode: 'api', base: 'http://localhost/v1' }), e => /404/.test(e.message) && !e.message.includes('private'))
})

test('Codex discovery does not require a chosen model and checks the account before listing', async () => {
  const f = fixture()
  vm.runInContext(fs.readFileSync(new URL('codex.js', import.meta.url), 'utf8'), f.ctx)
  const bridge = f.ctx.PaperMindCodex, methods = []
  bridge.start = async (_win, config) => { bridge.launchPath = config.codexPath || '' }
  bridge.rpc = async method => { methods.push(method); return method === 'account/read' ? { account: { type: 'chatgpt' } } : { data: [{ id: 'entry-id', model: 'provider-model' }] } }
  f.ctx.PaperMind.codex = bridge
  assert.deepEqual(Array.from(await f.ai.models(f.win, { mode: 'codex' })), ['provider-model'])
  assert.deepEqual(methods, ['account/read', 'model/list'])
  assert.equal(f.prefs.size, 0)
  bridge.process = {}; bridge.launchPath = '/old/codex'
  await assert.rejects(bridge.models(f.win, { codexPath: '/new/codex' }), /先保存连接/)
  assert.equal(methods.length, 2)
})


test('Codex model discovery rejects a new path while the previous path is still launching', async () => {
  const f = fixture()
  vm.runInContext(fs.readFileSync(new URL('codex.js', import.meta.url), 'utf8'), f.ctx)
  const bridge = f.ctx.PaperMindCodex, launches = [], methods = []
  let finishLaunch
  // Keep the real start() promise-sharing behavior; replace only the process boundary.
  bridge.launch = async (_win, config) => {
    launches.push(config.codexPath)
    await new Promise(resolve => { finishLaunch = resolve })
    bridge.process = {}; bridge.launchPath = config.codexPath || ''
  }
  bridge.rpc = async method => {
    methods.push(method)
    return method === 'account/read' ? { account: { type: 'chatgpt' } } : { data: [{ model: 'old-path-model' }] }
  }
  const original = bridge.models(f.win, { codexPath: '/old/codex' })
  const changed = bridge.models(f.win, { codexPath: '/new/codex' })
  const rejected = assert.rejects(changed, /路径已更改，请先保存连接/)
  assert.deepEqual(launches, ['/old/codex'])
  assert.equal(bridge.process, null)
  finishLaunch()
  assert.equal((await original)[0].model, 'old-path-model')
  await rejected
  assert.deepEqual(methods, ['account/read', 'model/list'])
  assert.equal((await bridge.models(f.win, { codexPath: '/old/codex' }))[0].model, 'old-path-model')
  assert.deepEqual(launches, ['/old/codex'])
})
