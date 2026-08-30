import assert from 'node:assert/strict'
import { test } from 'node:test'

globalThis.localStorage = {
  getItem: () => null,
  setItem: () => undefined
}

const { useScriptStore } = await import('./useScriptStore.ts')

function script(id, overrides = {}) {
  return {
    id,
    name: id,
    description: '',
    category: 'cat',
    categoryLabel: '分类',
    archived: false,
    starred: false,
    status: 'idle',
    ...overrides
  }
}

test('selecting a category resets conflicting filters and searches all scripts', () => {
  const store = useScriptStore()
  store.scripts.value = [
    script('archived-in-category', { archived: true }),
    script('idle-in-category'),
    script('running-in-other-category', { category: 'other', status: 'running' })
  ]
  store.categoryDefinitions.value = [{ id: 'cat-id', key: 'cat', parentId: null }]
  store.navFilter.value = 'running'
  store.listFilter.value = {
    status: 'running',
    categoryKey: null,
    starredOnly: true,
    scheduledOnly: true
  }

  store.setCategoryFilter('cat')

  assert.equal(store.navFilter.value, 'all')
  assert.deepEqual(store.listFilter.value, {
    status: 'all',
    categoryKey: 'cat',
    starredOnly: false,
    scheduledOnly: false
  })
  assert.deepEqual(new Set(store.filteredScripts.value.map((item) => item.id)), new Set(['idle-in-category', 'archived-in-category']))
})

test('category patches from the filter panel use the same override behavior', () => {
  const store = useScriptStore()
  store.navFilter.value = 'starred'
  store.listFilter.value = {
    status: 'error',
    categoryKey: null,
    starredOnly: true,
    scheduledOnly: true
  }

  store.setListFilter({ categoryKey: 'cat' })

  assert.equal(store.navFilter.value, 'all')
  assert.deepEqual(store.listFilter.value, {
    status: 'all',
    categoryKey: 'cat',
    starredOnly: false,
    scheduledOnly: false
  })
})
