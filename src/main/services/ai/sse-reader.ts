import { LlmProviderError } from './provider-contract'

export interface ReadSseOptions {
  signal?: AbortSignal
  idleTimeoutMs: number
}

async function readWithTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  options: ReadSseOptions
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (options.signal?.aborted) {
    throw new LlmProviderError('请求已取消', 'cancelled', false)
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  let onAbort: (() => void) | undefined
  const read = reader.read()
  void read.catch(() => undefined)
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new LlmProviderError('模型响应等待超时', 'timeout', true))
    }, options.idleTimeoutMs)
  })
  const aborted = new Promise<never>((_resolve, reject) => {
    if (!options.signal) return
    onAbort = () => reject(new LlmProviderError('请求已取消', 'cancelled', false))
    options.signal.addEventListener('abort', onAbort, { once: true })
  })

  try {
    return await Promise.race([read, timeout, aborted])
  } finally {
    if (timer) clearTimeout(timer)
    if (onAbort) options.signal?.removeEventListener('abort', onAbort)
  }
}

export async function* readSseData(
  response: Response,
  options: ReadSseOptions
): AsyncGenerator<string> {
  const body = response.body
  if (!body) throw new LlmProviderError('响应 stream body 缺失', 'invalid_response', false)

  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let dataLines: string[] = []
  let ended = false

  const consumeLine = (line: string): string | null => {
    if (!line) {
      if (dataLines.length === 0) return null
      const payload = dataLines.join('\n')
      dataLines = []
      return payload.length > 0 ? payload : null
    }
    if (line.startsWith(':')) return null
    if (!line.startsWith('data:')) return null
    let value = line.slice('data:'.length)
    if (value.startsWith(' ')) value = value.slice(1)
    dataLines.push(value)
    return null
  }

  try {
    while (true) {
      const result = await readWithTimeout(reader, options)
      if (result.done) {
        ended = true
        buffer += decoder.decode()
        if (buffer) {
          const payload = consumeLine(buffer.endsWith('\r') ? buffer.slice(0, -1) : buffer)
          if (payload !== null) yield payload
        }
        if (dataLines.length > 0) yield dataLines.join('\n')
        return
      }

      buffer += decoder.decode(result.value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const rawLine of lines) {
        const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
        const payload = consumeLine(line)
        if (payload !== null) yield payload
      }
    }
  } finally {
    if (!ended) {
      try {
        await reader.cancel()
      } catch {
        // The stream may already be closed by its producer.
      }
    }
    reader.releaseLock()
  }
}
