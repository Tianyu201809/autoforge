/** 仅 `type: "number"` 且配置合法时，表单同时显示滑块和数字框。 */
export interface NumberSliderDeclaration {
  ui?: 'slider'
  min?: number
  max?: number
  step?: number
}

export interface NumberSliderConfig {
  ui: 'slider'
  min: number
  max: number
  step: number
}

function finiteNumber(raw: unknown): number | undefined {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  if (typeof raw === 'string' && raw.trim()) {
    const value = Number(raw)
    if (Number.isFinite(value)) return value
  }
  return undefined
}

function decimalPlaces(value: number): number {
  const text = value.toString()
  if (/e/i.test(text)) {
    const [base, expText] = text.toLowerCase().split('e')
    const exp = Number(expText)
    const fraction = base.split('.')[1]?.length ?? 0
    return Math.max(0, fraction - exp)
  }
  const fraction = text.split('.')[1]
  return fraction ? fraction.length : 0
}

function roundTo(value: number, places: number): number {
  return Number(value.toFixed(places))
}

/** 合法时返回调整柄配置；否则调用方应退回普通数字框。 */
export function parseNumberSlider(input: {
  type?: string
  ui?: unknown
  min?: unknown
  max?: unknown
  step?: unknown
}): NumberSliderConfig | undefined {
  if (input.type !== 'number' || input.ui !== 'slider') return undefined
  const min = finiteNumber(input.min)
  const max = finiteNumber(input.max)
  const step = finiteNumber(input.step)
  if (min === undefined || max === undefined || step === undefined) return undefined
  if (step <= 0 || min > max) return undefined
  return { ui: 'slider', min, max, step }
}

/** 先夹到区间内，再对齐到从 min 起算的步进。最大值对不齐步进时取不超过它的最近一档。 */
export function snapNumberToSlider(value: number, slider: NumberSliderConfig): number {
  const { min, max, step } = slider
  const places = Math.max(decimalPlaces(step), decimalPlaces(min))
  const clamped = Math.min(max, Math.max(min, value))
  let snapped = roundTo(min + Math.round((clamped - min) / step) * step, places)
  if (snapped > max) {
    snapped = roundTo(min + Math.floor((max - min) / step) * step, places)
  }
  if (snapped < min) snapped = roundTo(min, places)
  if (snapped > max) snapped = roundTo(max, places)
  return snapped
}

export function formatSliderNumber(value: number, slider: NumberSliderConfig): string {
  const places = Math.max(decimalPlaces(slider.step), decimalPlaces(slider.min))
  return snapNumberToSlider(value, slider).toFixed(places)
}

/** 空值或非数字时滑块停在最小值，不代表该值已写入。 */
export function sliderThumbValue(raw: string, slider: NumberSliderConfig): number {
  const value = Number(raw)
  if (!Number.isFinite(value)) return slider.min
  return Math.min(slider.max, Math.max(slider.min, value))
}

export function commitSliderValue(raw: string, slider: NumberSliderConfig): string {
  const value = Number(raw)
  return formatSliderNumber(Number.isFinite(value) ? value : slider.min, slider)
}

/** 输入过程中的原文在失焦时再提交。空字符串保持为空；无法解析的文本原样保留。 */
export function commitNumberInput(raw: string, slider: NumberSliderConfig): string {
  if (!raw.trim()) return ''
  const value = Number(raw)
  if (!Number.isFinite(value)) return raw
  return formatSliderNumber(value, slider)
}
