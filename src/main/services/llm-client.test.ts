import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createLlmClient,
  LlmClientError,
  parseExtraHeaders,
  resolveChatCompletionsUrl
} from './llm-client'
import type { LlmProfile } from '../../shared/llm-types'

const PROFILE: LlmProfile = {
  id: 'p1',
  name: '测试配置',
  kind: 'openai-compatible',
  baseUrl: 'https://api.example.com/v1',
  model: 'demo-model',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

test('resolveChatCompletionsUrl 归一化接口地址', () => {
  assert.equal(
    resolveChatCompletionsUrl('https://api.deepseek.com/v1'),
    'https://api.deepseek.com/v1/chat/completions'
  )
  assert.equal(
    resolveChatCompletionsUrl('https://api.deepseek.com/v1/'),
    'https://api.deepseek.com/v1/chat/completions'
  )
  assert.equal(
    resolveChatCompletionsUrl('https://gw.example.com/v1/chat/completions'),
    'https://gw.example.com/v1/chat/completions'
  )
  assert.throws(() => resolveChatCompletionsUrl('  '), LlmClientError)
})

test('parseExtraHeaders 只接受字符串值', () => {
  assert.deepEqual(parseExtraHeaders('{"X-A":"1","X-B":2}'), { 'X-A': '1' })
  assert.deepEqual(parseExtraHeaders('not json'), {})
  assert.deepEqual(parseExtraHeaders(''), {})
  assert.deepEqual(parseExtraHeaders('[1,2]'), {})
})

test('chat 成功时返回模型内容', async () => {
  const client = createLlmClient({
    request: async () =>
      jsonResponse({
        model: 'demo-model',
        choices: [{ message: { content: '{"ok":true}' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 }
      })
  })
  const result = await client.chat({
    baseUrl: PROFILE.baseUrl,
    model: PROFILE.model,
    apiKey: 'key',
    messages: [{ role: 'user', content: 'hi' }]
  })
  assert.equal(result.content, '{"ok":true}')
  assert.equal(result.model, 'demo-model')
  assert.equal(result.completionTokens, 5)
})

test('chat 在 401 时给出认证失败提示', async () => {
  const client = createLlmClient({
    request: async () => jsonResponse({ error: { message: 'invalid api key' } }, 401)
  })
  await assert.rejects(
    () =>
      client.chat({
        baseUrl: PROFILE.baseUrl,
        model: PROFILE.model,
        apiKey: 'bad',
        messages: [{ role: 'user', content: 'hi' }]
      }),
    (error: unknown) => {
      assert.ok(error instanceof LlmClientError)
      assert.equal(error.code, 'auth')
      assert.match(error.message, /认证失败/)
      return true
    }
  )
})

test('chat 在 404 时提示检查接口地址', async () => {
  const client = createLlmClient({ request: async () => jsonResponse({}, 404) })
  await assert.rejects(
    () =>
      client.chat({
        baseUrl: PROFILE.baseUrl,
        model: PROFILE.model,
        apiKey: 'key',
        messages: [{ role: 'user', content: 'hi' }]
      }),
    (error: unknown) => {
      assert.ok(error instanceof LlmClientError)
      assert.equal(error.code, 'not_found')
      assert.match(error.message, /\/v1/)
      return true
    }
  )
})

test('chat 在返回非 JSON 时给出明确错误', async () => {
  const client = createLlmClient({
    request: async () => new Response('<html>gateway error</html>', { status: 200 })
  })
  await assert.rejects(
    () =>
      client.chat({
        baseUrl: PROFILE.baseUrl,
        model: PROFILE.model,
        apiKey: 'key',
        messages: [{ role: 'user', content: 'hi' }]
      }),
    (error: unknown) => {
      assert.ok(error instanceof LlmClientError)
      assert.equal(error.code, 'invalid_response')
      return true
    }
  )
})

test('chat 在网关不支持 response_format 时自动重试', async () => {
  let calls = 0
  const client = createLlmClient({
    request: async (_url, init) => {
      calls += 1
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      if (calls === 1) {
        assert.ok(body.response_format)
        return jsonResponse({ error: { message: 'unsupported response_format' } }, 400)
      }
      assert.equal(body.response_format, undefined)
      return jsonResponse({ choices: [{ message: { content: '{"ok":true}' } }] })
    }
  })

  const result = await client.chat({
    baseUrl: PROFILE.baseUrl,
    model: PROFILE.model,
    apiKey: 'key',
    messages: [{ role: 'user', content: 'hi' }],
    json: true
  })
  assert.equal(calls, 2)
  assert.equal(result.content, '{"ok":true}')
})

test('testConnection 在成功时返回耗时与回显', async () => {
  const client = createLlmClient({
    request: async () => jsonResponse({ choices: [{ message: { content: 'OK' } }] })
  })
  const result = await client.testConnection(PROFILE, 'key')
  assert.equal(result.ok, true)
  assert.match(result.message, /OK/)
  assert.ok(typeof result.latencyMs === 'number')
})

test('testConnection 在失败时返回错误信息而不抛出', async () => {
  const client = createLlmClient({ request: async () => jsonResponse({}, 429) })
  const result = await client.testConnection(PROFILE, 'key')
  assert.equal(result.ok, false)
  assert.match(result.message, /限流|额度/)
})

// ---------- 流式 ----------

function sseResponse(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    }
  })
  return new Response(stream, { status, headers: { 'Content-Type': 'text/event-stream' } })
}

function sseChunk(content: string, finishReason: string | null = null): string {
  return `data: ${JSON.stringify({
    model: 'demo-model',
    choices: [{ delta: { content }, finish_reason: finishReason }]
  })}\n\n`
}

test('chatStream 累积增量并回调 onDelta', async () => {
  const client = createLlmClient({
    request: async () =>
      sseResponse([sseChunk('{"ok"'), sseChunk(':true}'), sseChunk('', 'stop'), 'data: [DONE]\n\n'])
  })

  const deltas: string[] = []
  const result = await client.chatStream({
    baseUrl: PROFILE.baseUrl,
    model: PROFILE.model,
    apiKey: 'key',
    messages: [{ role: 'user', content: 'hi' }],
    onDelta: (delta, totalChars) => {
      deltas.push(`${delta}|${totalChars}`)
    }
  })

  assert.equal(result.content, '{"ok":true}')
  assert.equal(result.finishReason, 'stop')
  assert.equal(result.model, 'demo-model')
  assert.equal(result.streamed, true)
  assert.deepEqual(deltas, ['{"ok"|5', ':true}|11'])
})

test('chatStream 忽略注释行与非 data 行', async () => {
  const client = createLlmClient({
    request: async () =>
      sseResponse([': keep-alive\n\n', 'event: message\n', sseChunk('hello'), '\n', 'data: [DONE]\n\n'])
  })
  const result = await client.chatStream({
    baseUrl: PROFILE.baseUrl,
    model: PROFILE.model,
    apiKey: 'key',
    messages: [{ role: 'user', content: 'hi' }]
  })
  assert.equal(result.content, 'hello')
})

test('chatStream 处理跨块切断的 SSE 行', async () => {
  const full = sseChunk('partial-line')
  const split = Math.floor(full.length / 2)
  const client = createLlmClient({
    request: async () => sseResponse([full.slice(0, split), full.slice(split), 'data: [DONE]\n\n'])
  })
  const result = await client.chatStream({
    baseUrl: PROFILE.baseUrl,
    model: PROFILE.model,
    apiKey: 'key',
    messages: [{ role: 'user', content: 'hi' }]
  })
  assert.equal(result.content, 'partial-line')
})

test('chatStream 在流为空时回退到非流式请求', async () => {
  let calls = 0
  const client = createLlmClient({
    request: async (_url, init) => {
      calls += 1
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      if (body.stream === true) return sseResponse(['data: [DONE]\n\n'])
      return jsonResponse({ choices: [{ message: { content: 'fallback' } }] })
    }
  })

  const result = await client.chatStream({
    baseUrl: PROFILE.baseUrl,
    model: PROFILE.model,
    apiKey: 'key',
    messages: [{ role: 'user', content: 'hi' }]
  })

  assert.equal(calls, 2)
  assert.equal(result.content, 'fallback')
  assert.equal(result.streamed, false)
})

test('chatStream 在 HTTP 错误时给出可读提示', async () => {
  const client = createLlmClient({
    request: async () => new Response('{"error":"bad key"}', { status: 401 })
  })
  await assert.rejects(
    () =>
      client.chatStream({
        baseUrl: PROFILE.baseUrl,
        model: PROFILE.model,
        apiKey: 'bad',
        messages: [{ role: 'user', content: 'hi' }]
      }),
    (error: unknown) => {
      assert.ok(error instanceof LlmClientError)
      assert.equal(error.code, 'auth')
      return true
    }
  )
})

test('chatStream 在空闲超时后中止并提示', async () => {
  const encoder = new TextEncoder()
  const client = createLlmClient({
    request: async () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(sseChunk('start')))
          // 之后不再发送任何数据，触发空闲超时
        }
      })
      return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
    }
  })

  await assert.rejects(
    () =>
      client.chatStream({
        baseUrl: PROFILE.baseUrl,
        model: PROFILE.model,
        apiKey: 'key',
        messages: [{ role: 'user', content: 'hi' }],
        idleTimeoutSeconds: 1
      }),
    (error: unknown) => {
      assert.ok(error instanceof LlmClientError)
      assert.equal(error.code, 'timeout')
      assert.match(error.message, /没有收到新内容|没有响应/)
      return true
    }
  )
})

test('chatStream 支持外部取消', async () => {
  const controller = new AbortController()
  const encoder = new TextEncoder()
  const client = createLlmClient({
    request: async () => {
      const stream = new ReadableStream<Uint8Array>({
        start(ctrl) {
          ctrl.enqueue(encoder.encode(sseChunk('start')))
        }
      })
      return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
    }
  })

  const pending = client.chatStream({
    baseUrl: PROFILE.baseUrl,
    model: PROFILE.model,
    apiKey: 'key',
    messages: [{ role: 'user', content: 'hi' }],
    signal: controller.signal,
    idleTimeoutSeconds: 30
  })
  setTimeout(() => controller.abort(), 50)

  await assert.rejects(pending, (error: unknown) => {
    assert.ok(error instanceof LlmClientError)
    assert.equal(error.code, 'cancelled')
    return true
  })
})
