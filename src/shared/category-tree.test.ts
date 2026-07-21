import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildCategoryTree,
  collectDescendantKeys,
  wouldCreateCycle,
  sumRecursiveCounts
} from './category-tree'

type Cat = { id: string; key: string; parentId: string | null; label: string }

const sample: Cat[] = [
  { id: 'a', key: 'browser', parentId: null, label: '浏览器' },
  { id: 'b', key: 'resume', parentId: 'a', label: '简历' },
  { id: 'c', key: 'deep', parentId: 'b', label: '深层' },
  { id: 'd', key: 'local', parentId: null, label: '本地' }
]

describe('category-tree', () => {
  it('buildCategoryTree nests children', () => {
    const tree = buildCategoryTree(sample)
    assert.equal(tree.length, 2)
    const browser = tree.find((n) => n.category.key === 'browser')!
    assert.equal(browser.children.length, 1)
    assert.equal(browser.children[0].children[0].category.key, 'deep')
  })

  it('collectDescendantKeys includes self and descendants', () => {
    assert.deepEqual(collectDescendantKeys(sample, 'browser').sort(), ['browser', 'deep', 'resume'].sort())
    assert.deepEqual(collectDescendantKeys(sample, 'deep'), ['deep'])
  })

  it('wouldCreateCycle detects loops', () => {
    assert.equal(wouldCreateCycle(sample, 'a', 'c'), true)
    assert.equal(wouldCreateCycle(sample, 'c', 'd'), false)
    assert.equal(wouldCreateCycle(sample, 'c', null), false)
  })

  it('sumRecursiveCounts rolls up', () => {
    const direct = new Map([
      ['browser', 1],
      ['resume', 2],
      ['deep', 3],
      ['local', 4]
    ])
    const totals = sumRecursiveCounts(sample, direct)
    assert.equal(totals.get('browser'), 6)
    assert.equal(totals.get('resume'), 5)
    assert.equal(totals.get('deep'), 3)
    assert.equal(totals.get('local'), 4)
  })
})
