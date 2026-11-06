import { HubInstallError } from './hub-script-installer'

export function hubOrigin(hubUrl: string): string {
  const url = new URL(hubUrl.trim())
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new HubInstallError('invalid_request', '安装请求无效')
  }
  return url.origin
}

export function buildHubDownloadUrl(hubUrl: string, hubScriptId: string, installToken: string): string {
  const url = new URL(`/api/scripts/${encodeURIComponent(hubScriptId)}/download`, hubOrigin(hubUrl))
  url.searchParams.set('installToken', installToken)
  return url.toString()
}

export function parseBridgeInstallBody(body: unknown): { hubScriptId: string; installToken: string } {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new HubInstallError('invalid_request', '安装请求无效')
  }
  const record = body as Record<string, unknown>
  if ('zipUrl' in record || 'sha256' in record) {
    throw new HubInstallError('invalid_request', '安装请求无效')
  }
  if (typeof record.hubScriptId !== 'string' || !record.hubScriptId.trim()) {
    throw new HubInstallError('invalid_request', '安装请求无效')
  }
  if (typeof record.installToken !== 'string' || !record.installToken.trim()) {
    throw new HubInstallError('invalid_request', '安装请求无效')
  }
  return { hubScriptId: record.hubScriptId.trim(), installToken: record.installToken.trim() }
}

export function originAllowed(originHeader: string | undefined, hubUrl: string): boolean {
  if (!originHeader || originHeader === 'null') return false
  try {
    return originHeader === hubOrigin(hubUrl)
  } catch {
    return false
  }
}
