import assert from 'node:assert/strict'
import { test } from 'node:test'

const sseModule = import('./sse-reader').catch(() => null)
const encoder = new TextEncoder()

async function readData(response: Response, signal?: AbortSignal): Promise<string[]> {
  const module = await sseModule
  assert.ok(module, 'SSE reader module should be available')
  const payloads: string[] = []
  for await (const payload of module.readSseData(response, { signal, idleTimeoutMs: 100 })) {
    payloads.push(payload)
  }
  return payloads
}

test('reads SSE frames split across chunks and handles CRLF', async () => {
  const response = new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode('data: {"text":'))
      controller.enqueue(encoder.encode('"hello"}\r\n\r\ndata: [DONE]\r\n\r\n'))
      controller.close()
    }
  }))

  assert.deepEqual(await readData(response), ['{"text":"hello"}', '[DONE]'])
})

test('ignores comments and empty data frames', async () => {
  const response = new Response(' : keep-alive\n\ndata:\n\ndata: {"ok":true}\n\n')

  assert.deepEqual(await readData(response), ['{"ok":true}'])
})

test('rejects a response without a body', async () => {
  const module = await sseModule
  assert.ok(module, 'SSE reader module should be available')

  await assert.rejects(
    async () => {
      for await (const _payload of module.readSseData(new Response(null), { idleTimeoutMs: 100 })) {
        void _payload
      }
    },
    /stream body/
  )
})

test('cancels a pending reader when the request is aborted', async () => {
  let cancelled = false
  const response = new Response(new ReadableStream<Uint8Array>({
    cancel() {
      cancelled = true
    }
  }))
  const controller = new AbortController()
  const module = await sseModule
  assert.ok(module, 'SSE reader module should be available')
  const iterator = module.readSseData(response, { signal: controller.signal, idleTimeoutMs: 1000 })[Symbol.asyncIterator]()
  const pending = iterator.next()
  controller.abort()

  await assert.rejects(pending, (error: { code?: string }) => error.code === 'cancelled')
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(cancelled, true)
})
