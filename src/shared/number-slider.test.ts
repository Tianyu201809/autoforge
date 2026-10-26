import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  commitNumberInput,
  commitSliderValue,
  parseNumberSlider,
  sliderThumbValue
} from './number-slider'
import { validateManifest } from './script-contract'

const slider = { ui: 'slider' as const, min: 0, max: 100, step: 1 }

describe('parseNumberSlider', () => {
  it('keeps a valid number slider', () => {
    assert.deepEqual(parseNumberSlider({ type: 'number', ui: 'slider', min: 0, max: 100, step: 1 }), slider)
  })

  it('accepts numeric strings', () => {
    assert.deepEqual(parseNumberSlider({ type: 'number', ui: 'slider', min: '0', max: '1', step: '0.1' }), {
      ui: 'slider',
      min: 0,
      max: 1,
      step: 0.1
    })
  })

  it('rejects incomplete, reversed, or non-number fields', () => {
    assert.equal(parseNumberSlider({ type: 'number', ui: 'slider', min: 0, max: 10 }), undefined)
    assert.equal(parseNumberSlider({ type: 'number', ui: 'slider', min: 10, max: 0, step: 1 }), undefined)
    assert.equal(parseNumberSlider({ type: 'number', ui: 'slider', min: 0, max: 10, step: 0 }), undefined)
    assert.equal(parseNumberSlider({ type: 'text', ui: 'slider', min: 0, max: 10, step: 1 }), undefined)
    assert.equal(parseNumberSlider({ type: 'number', min: 0, max: 10, step: 1 }), undefined)
  })
})

describe('slider commits', () => {
  it('snaps a drag and keeps one decimal for a fractional step', () => {
    assert.equal(commitSliderValue('80.6', slider), '81')
    assert.equal(commitSliderValue('-4', slider), '0')
    assert.equal(commitSliderValue('140', slider), '100')
    assert.equal(
      commitSliderValue('0.30000000000000004', { ui: 'slider', min: 0, max: 1, step: 0.1 }),
      '0.3'
    )
  })

  it('stops short of a max that is not on the step lattice', () => {
    assert.equal(commitSliderValue('10', { ui: 'slider', min: 0, max: 10, step: 3 }), '9')
  })

  it('clamps a typed value on blur and preserves an empty or non-numeric draft', () => {
    assert.equal(commitNumberInput('80.4', slider), '80')
    assert.equal(commitNumberInput('  ', slider), '')
    assert.equal(commitNumberInput('abc', slider), 'abc')
    assert.equal(sliderThumbValue('', slider), 0)
    assert.equal(sliderThumbValue('140', slider), 100)
  })
})

describe('manifest number slider', () => {
  it('keeps slider fields on env and params, and drops an invalid slider', () => {
    const result = validateManifest({
      autoforge: '1.0',
      name: 'demo',
      env: [{ key: 'QUALITY', label: '质量', type: 'number', ui: 'slider', min: 0, max: 100, step: 1 }],
      params: [
        { key: 'LEVEL', label: '级别', type: 'number', ui: 'slider', min: 1, max: 5, step: 1 },
        { key: 'COUNT', label: '数量', type: 'number', ui: 'slider', min: 5, max: 1, step: 1 },
        { key: 'PLAIN', label: '普通', type: 'number', default: '3' }
      ]
    })
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.deepEqual(result.manifest.env?.[0], {
      key: 'QUALITY',
      label: '质量',
      description: undefined,
      required: false,
      secret: false,
      type: 'number',
      options: undefined,
      default: undefined,
      ui: 'slider',
      min: 0,
      max: 100,
      step: 1
    })
    assert.equal(result.manifest.params?.[0].ui, 'slider')
    assert.equal(result.manifest.params?.[1].ui, undefined)
    assert.equal(result.manifest.params?.[1].min, undefined)
    assert.equal(result.manifest.params?.[2].ui, undefined)
    assert.equal(result.manifest.params?.[2].default, '3')
  })
})
