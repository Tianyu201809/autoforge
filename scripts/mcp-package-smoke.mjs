import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'

const child = spawn(process.execPath, ['--import', 'tsx', 'src/mcp/stdio-server.ts', '--app-env', 'production'], {
  cwd: process.cwd(),
  stdio: ['pipe', 'pipe', 'pipe']
})

let stdout = ''
let stderr = ''
child.stdout.setEncoding('utf8')
child.stderr.setEncoding('utf8')
child.stdout.on('data', (chunk) => { stdout += chunk })
child.stderr.on('data', (chunk) => { stderr += chunk })

child.stdin.write(`${JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'autoforge-smoke', version: '1' }
  }
})}\n`)

await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`MCP smoke timeout\n${stderr}`)), 10_000)
  const check = () => {
    if (!stdout.includes('"jsonrpc"')) return
    clearTimeout(timer)
    resolve()
  }
  child.stdout.on('data', check)
  child.once('error', reject)
})

assert.match(stdout, /"protocolVersion"/)
assert.doesNotMatch(stdout, /mcp-endpoint|token|pipe\\|\.sock/i)
child.kill()
console.log('MCP package smoke passed')
