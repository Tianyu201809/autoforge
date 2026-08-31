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

test('selecting a category resets the status condition to all', () => {
  const store = useScriptStore()
  store.scripts.value = [
    script('running-in-category', { status: 'running' }),
    script('idle-in-category'),
    script('running-in-other-category', { category: 'other', status: 'running' })
  ]
  store.categoryDefinitions.value = [{ id: 'cat-id', key: 'cat', parentId: null }]
  store.navFilter.value = 'running'
  store.listFilter.value = {
    status: 'running',
    categoryKey: null,
    starredOnly: false,
    scheduledOnly: false
  }

  store.setCategoryFilter('cat')

  assert.equal(store.navFilter.value, 'all')
  assert.deepEqual(store.listFilter.value, {
    status: 'all',
    categoryKey: 'cat',
    starredOnly: false,
    scheduledOnly: false
  })
  assert.deepEqual(store.filteredScripts.value.map((item) => item.id), ['running-in-category', 'idle-in-category'])
})

test('category patches from the filter panel reset status and preserve other conditions', () => {
  const store = useScriptStore()
  store.scripts.value = [
    script('matching', {
      category: 'cat',
      status: 'error',
      starred: true,
      schedule: { enabled: true, expression: '* * * * *' }
    }),
    script('wrong-status', { category: 'cat', status: 'idle', starred: true, schedule: { enabled: true } }),
    script('wrong-category', { category: 'other', status: 'error', starred: true, schedule: { enabled: true } })
  ]
  store.categoryDefinitions.value = [{ id: 'cat-id', key: 'cat', parentId: null }]
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
    starredOnly: true,
    scheduledOnly: true
  })
  assert.deepEqual(store.filteredScripts.value.map((item) => item.id), ['matching', 'wrong-status'])
})
