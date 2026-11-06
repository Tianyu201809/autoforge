export type HubInstallErrorCode =
  | 'invalid_request'
  | 'download_failed'
  | 'invalid_package'
  | 'import_failed'

export class HubInstallError extends Error {
  constructor(
    public code: HubInstallErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'HubInstallError'
  }
}
