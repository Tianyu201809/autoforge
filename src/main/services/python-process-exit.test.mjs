import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isPythonCancellationExitCode } from './python-process-exit.ts'

describe('isPythonCancellationExitCode', () => {
  it('recognizes the runtime cancellation exit code', () => {
    assert.equal(isPythonCancellationExitCode(130), true)
  })

  it('rejects other and missing exit codes', () => {
    assert.equal(isPythonCancellationExitCode(0), false)
    assert.equal(isPythonCancellationExitCode(1), false)
    assert.equal(isPythonCancellationExitCode(null), false)
  })
})
