/** node-cron 六段式：秒 分 时 日 月 周 */

export type CronScheduleMode =
  | 'interval-minutes'
  | 'interval-hours'
  | 'daily'
  | 'weekly'
  | 'monthly'

export interface CronScheduleState {
  mode: CronScheduleMode
  intervalMinutes: number
  intervalHours: number
  minuteAt: number
  hourAt: number
  weekDays: number[]
  dayOfMonth: number
}

export const DEFAULT_CRON_EXPRESSION = '0 */30 * * * *'

export const DEFAULT_CRON_STATE: CronScheduleState = {
  mode: 'interval-minutes',
  intervalMinutes: 30,
  intervalHours: 1,
  minuteAt: 0,
  hourAt: 9,
  weekDays: [1],
  dayOfMonth: 1
}

const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'] as const

export function weekdayLabel(day: number): string {
  return WEEKDAY_LABELS[day] ?? String(day)
}

export function buildCronExpression(state: CronScheduleState): string {
  const minute = clamp(state.minuteAt, 0, 59)
  const hour = clamp(state.hourAt, 0, 23)

  switch (state.mode) {
    case 'interval-minutes': {
      const n = clamp(state.intervalMinutes, 1, 59)
      return `0 */${n} * * * *`
    }
    case 'interval-hours': {
      const n = clamp(state.intervalHours, 1, 23)
      return `0 ${minute} */${n} * * *`
    }
    case 'daily':
      return `0 ${minute} ${hour} * * *`
    case 'weekly': {
      const days = [...state.weekDays].sort((a, b) => a - b)
      const dayExpr = days.length > 0 ? days.join(',') : '1'
      return `0 ${minute} ${hour} * * ${dayExpr}`
    }
    case 'monthly': {
      const dom = clamp(state.dayOfMonth, 1, 31)
      return `0 ${minute} ${hour} ${dom} * *`
    }
  }
}

export function parseCronExpression(expression: string): CronScheduleState | null {
  const trimmed = expression.trim()
  if (!trimmed) return null

  const parts = trimmed.split(/\s+/)
  if (parts.length !== 6) return null

  const [second, minute, hour, day, month, weekday] = parts
  if (second !== '0' || month !== '*') return null

  const minuteNum = parseField(minute)
  const hourNum = parseField(hour)
  const dayNum = parseField(day)
  const weekdayNums = parseWeekdays(weekday)

  if (minute.startsWith('*/') && hour === '*' && day === '*' && weekday === '*') {
    const n = Number(minute.slice(2))
    if (Number.isInteger(n) && n >= 1 && n <= 59) {
      return { ...DEFAULT_CRON_STATE, mode: 'interval-minutes', intervalMinutes: n }
    }
  }

  if (hour.startsWith('*/') && day === '*' && weekday === '*') {
    const n = Number(hour.slice(2))
    if (minuteNum !== null && Number.isInteger(n) && n >= 1 && n <= 23) {
      return {
        ...DEFAULT_CRON_STATE,
        mode: 'interval-hours',
        intervalHours: n,
        minuteAt: minuteNum
      }
    }
  }

  if (
    minuteNum !== null &&
    hourNum !== null &&
    day === '*' &&
    weekday === '*'
  ) {
    return {
      ...DEFAULT_CRON_STATE,
      mode: 'daily',
      minuteAt: minuteNum,
      hourAt: hourNum
    }
  }

  if (
    minuteNum !== null &&
    hourNum !== null &&
    day === '*' &&
    weekdayNums !== null &&
    weekdayNums.length > 0
  ) {
    return {
      ...DEFAULT_CRON_STATE,
      mode: 'weekly',
      minuteAt: minuteNum,
      hourAt: hourNum,
      weekDays: weekdayNums
    }
  }

  if (
    minuteNum !== null &&
    hourNum !== null &&
    dayNum !== null &&
    weekday === '*'
  ) {
    return {
      ...DEFAULT_CRON_STATE,
      mode: 'monthly',
      minuteAt: minuteNum,
      hourAt: hourNum,
      dayOfMonth: dayNum
    }
  }

  return null
}

export function describeCronSchedule(state: CronScheduleState): string {
  const time = formatTime(state.hourAt, state.minuteAt)

  switch (state.mode) {
    case 'interval-minutes':
      return state.intervalMinutes === 1
        ? '每分钟执行一次'
        : `每 ${state.intervalMinutes} 分钟执行一次`
    case 'interval-hours':
      return state.intervalHours === 1
        ? `每小时第 ${state.minuteAt} 分执行`
        : `每 ${state.intervalHours} 小时第 ${state.minuteAt} 分执行`
    case 'daily':
      return `每天 ${time} 执行`
    case 'weekly': {
      if (state.weekDays.length === 0) return '请选择星期'
      const days = [...state.weekDays]
        .sort((a, b) => a - b)
        .map((d) => `周${weekdayLabel(d)}`)
        .join('、')
      return `每周 ${days} ${time} 执行`
    }
    case 'monthly':
      return `每月 ${state.dayOfMonth} 日 ${time} 执行`
  }
}

/** 将 Cron 表达式转为可读执行周期；无法解析时回退为原始表达式 */
export function describeCronExpression(expression: string | undefined): string {
  const trimmed = expression?.trim()
  if (!trimmed) return '未设置执行周期'
  const parsed = parseCronExpression(trimmed)
  if (parsed) return describeCronSchedule(parsed)
  return trimmed
}

export function normalizeCronExpression(expression: string | undefined): string {
  const trimmed = expression?.trim()
  if (!trimmed) return DEFAULT_CRON_EXPRESSION
  return parseCronExpression(trimmed) ? trimmed : DEFAULT_CRON_EXPRESSION
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)))
}

function parseField(field: string): number | null {
  if (!/^\d+$/.test(field)) return null
  const n = Number(field)
  return Number.isInteger(n) ? n : null
}

function parseWeekdays(field: string): number[] | null {
  if (field === '*') return null
  const nums = field.split(',').map((s) => Number(s.trim()))
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 6)) return null
  return [...new Set(nums)].sort((a, b) => a - b)
}

function formatTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}
