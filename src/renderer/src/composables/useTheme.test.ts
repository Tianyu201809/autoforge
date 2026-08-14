import assert from 'node:assert/strict'
import test from 'node:test'
import { SKIN_PAIRS, SKIN_PRESETS } from './useTheme'

test('registers a graphite and snow skin pair', () => {
  const graphite = SKIN_PRESETS.find((skin) => skin.id === 'graphite')
  const snow = SKIN_PRESETS.find((skin) => skin.id === 'snow')

  assert.deepEqual(graphite, {
    id: 'graphite',
    name: '石墨',
    tagline: '近黑灰阶，克制专注',
    mode: 'dark',
    preview: { base: '#111110', panel: '#20201f', accent: '#e7e7e2' }
  })
  assert.deepEqual(snow, {
    id: 'snow',
    name: '净白',
    tagline: '纸白墨色，清晰纯粹',
    mode: 'light',
    preview: { base: '#f7f7f4', panel: '#ffffff', accent: '#1c1c1b' }
  })
  assert.equal(SKIN_PAIRS.graphite, 'snow')
  assert.equal(SKIN_PAIRS.snow, 'graphite')
})

test('every skin pair is reciprocal', () => {
  for (const [skin, pair] of Object.entries(SKIN_PAIRS)) {
    assert.equal(SKIN_PAIRS[pair as keyof typeof SKIN_PAIRS], skin)
  }
})
