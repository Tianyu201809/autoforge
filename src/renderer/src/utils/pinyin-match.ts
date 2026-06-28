import { pinyin } from 'pinyin-pro'

/** 提取中文文本的拼音首字母串（小写，无空格） */
export function getPinyinInitials(text: string): string {
  if (!text) return ''
  return pinyin(text, { pattern: 'first', toneType: 'none', type: 'array' })
    .join('')
    .toLowerCase()
}

/** 提取完整拼音（无音调、无空格，用于连续匹配） */
export function getPinyinFull(text: string): string {
  if (!text) return ''
  return pinyin(text, { toneType: 'none', type: 'array' }).join('').toLowerCase()
}

/**
 * 判断 query 是否匹配 target（支持原文、拼音全拼、拼音首字母）
 */
export function matchPinyinQuery(target: string, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true

  const lower = target.toLowerCase()
  if (lower.includes(q)) return true

  const initials = getPinyinInitials(target)
  if (initials.includes(q)) return true

  const full = getPinyinFull(target)
  if (full.includes(q)) return true

  // 首字母逐字匹配：如 "wjcz" 匹配 "文件操作"
  let qi = 0
  for (const char of target) {
    if (qi >= q.length) break
    if (/[\u4e00-\u9fff]/.test(char)) {
      const initial = getPinyinInitials(char)
      if (initial.startsWith(q[qi]!)) qi++
    } else if (char.toLowerCase() === q[qi]) {
      qi++
    }
  }
  return qi === q.length
}
