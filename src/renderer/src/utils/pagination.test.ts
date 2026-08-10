import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildPaginationItems, normalizePageInput } from './pagination'

describe('buildPaginationItems', () => {
  it('shows every page when the total is five or fewer', () => {
    assert.deepEqual(buildPaginationItems(3, 5), [1, 2, 3, 4, 5])
  })

  it('uses compact items at the beginning, middle, and end', () => {
    assert.deepEqual(buildPaginationItems(1, 10), [1, 2, 'ellipsis', 10])
    assert.deepEqual(buildPaginationItems(5, 10), [1, 'ellipsis', 4, 5, 6, 'ellipsis', 10])
    assert.deepEqual(buildPaginationItems(9, 10), [1, 'ellipsis', 8, 9, 10])
  })

  it('shows a page number instead of hiding a one-page gap', () => {
    assert.deepEqual(buildPaginationItems(3, 6), [1, 2, 3, 4, 5, 6])
    assert.deepEqual(buildPaginationItems(4, 6), [1, 2, 3, 4, 5, 6])
  })
})

describe('normalizePageInput', () => {
  it('accepts integers and clamps them to the available range', () => {
    assert.equal(normalizePageInput('4', 10), 4)
    assert.equal(normalizePageInput('0', 10), 1)
    assert.equal(normalizePageInput('99', 10), 10)
  })

  it('rejects blank, non-numeric, and non-integer values', () => {
    assert.equal(normalizePageInput('', 10), null)
    assert.equal(normalizePageInput('abc', 10), null)
    assert.equal(normalizePageInput('2.5', 10), null)
  })
})
