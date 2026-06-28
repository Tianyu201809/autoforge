import { execSync } from 'child_process'
import { readFileSync, writeFileSync } from 'fs'

const path = 'src/renderer/src/components/DetailPanel.vue'

let c = execSync('git cat-file blob HEAD:src/renderer/src/components/DetailPanel.vue').toString('utf8')

if (!c.includes('详情')) {
  console.error('HEAD blob missing UTF-8 Chinese — cannot restore')
  process.exit(1)
}

const classReps = [
  ["return { text: '空闲', class: 'text-zinc-400' }", "return { text: '空闲', class: 'sb-text-muted' }"],
  ['border-l border-zinc-800/80 bg-[#0c0c0d]', 'border-l sb-border sb-bg-panel'],
  ['border-b border-zinc-800/60', 'border-b sb-border-subtle'],
  ['bg-[#080809]', 'sb-bg-log'],
  ['bg-zinc-900/60 border border-zinc-800/80', 'sb-bg-input border sb-border'],
  ['bg-zinc-100 text-zinc-900', 'sb-btn-accent'],
  ['border-b-2 border-zinc-100', 'border-b-2 border-[var(--sb-text-primary)]'],
  ['text-zinc-200', 'sb-text-primary'],
  ['text-zinc-300', 'sb-text-secondary'],
  ['text-zinc-400', 'sb-text-muted'],
  ['text-zinc-500', 'sb-text-muted'],
  ['text-zinc-600', 'sb-text-faint'],
  ['bg-zinc-900/20', 'sb-bg-surface'],
  ['bg-zinc-800/60', 'sb-bg-inset'],
  ['bg-zinc-800/50', 'sb-bg-inset'],
  ['border border-zinc-800/60', 'border sb-border-subtle'],
  ['border border-zinc-800/80', 'border sb-border'],
  ['border-b border-zinc-800/40', 'border-b sb-border-subtle'],
  ['border-zinc-700/40', 'sb-border-subtle'],
  ['bg-zinc-800 text-zinc-200', 'sb-bg-inset sb-text-primary'],
  ['focus:border-zinc-600', 'focus:sb-input'],
  [
    'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/60',
    'sb-text-muted hover:sb-text-secondary sb-bg-hover'
  ],
  ['hover:text-zinc-300', 'hover:sb-text-secondary'],
  ['hover:text-zinc-200', 'hover:sb-text-primary'],
  ['hover:border-zinc-700', 'hover:border-[var(--sb-border)]'],
  ['hover:bg-zinc-800 transition-colors', 'sb-bg-hover transition-colors'],
  ['border-zinc-800/60', 'sb-border-subtle'],
  ['bg-zinc-800', 'sb-bg-inset'],
  ['hover:bg-white', 'hover:opacity-90']
]

for (const [from, to] of classReps) {
  c = c.split(from).join(to)
}

c = c.replaceAll('window.scriptBox', 'window.autoforge')
c = c.replaceAll('scriptbox.json', 'autoforge.json')

writeFileSync(path, c, 'utf8')

const v = readFileSync(path, 'utf8')
console.log('详情 OK:', v.includes('详情'))
console.log('配置 OK:', v.includes('配置'))
console.log('autoforge OK:', v.includes('autoforge'))
console.log('scriptBox gone:', !v.includes('scriptBox'))
console.log('garbled tab labels:', (v.match(/label: '\?\?'/g) || []).length)
