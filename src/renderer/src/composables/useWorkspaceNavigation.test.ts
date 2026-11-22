import assert from 'node:assert/strict'
import test from 'node:test'
import { effectScope } from 'vue'
import { useWorkspaceNavigation } from './useWorkspaceNavigation'

function createStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    values
  }
}

test('starts on projects and restores the last selected view', () => {
  const storage = createStorage()
  const scope = effectScope()
  const first = scope.run(() => useWorkspaceNavigation(storage))!
  assert.equal(first.state.view, 'projects')
  first.navigate('scripts')
  scope.stop()

  const restoredScope = effectScope()
  const restored = restoredScope.run(() => useWorkspaceNavigation(storage))!
  assert.equal(restored.state.view, 'scripts')
  restoredScope.stop()
})

test('keeps project and script context when switching work areas', () => {
  const scope = effectScope()
  const navigation = scope.run(() => useWorkspaceNavigation(createStorage()))!
  navigation.setActiveProject('project-1')
  navigation.setActiveScript('script-1')
  navigation.navigate('history')

  assert.equal(navigation.state.activeProjectId, 'project-1')
  assert.equal(navigation.state.activeScriptId, 'script-1')
  assert.equal(navigation.state.view, 'history')
  scope.stop()
})

test('clamps persisted navigation and sidebar widths', () => {
  const storage = createStorage({
    'autoforge-workspace-layout': JSON.stringify({
      view: 'projects', navWidth: 2, contextWidth: 900, inspectorWidth: 10
    })
  })
  const scope = effectScope()
  const navigation = scope.run(() => useWorkspaceNavigation(storage))!

  assert.equal(navigation.state.navWidth, 160)
  assert.equal(navigation.state.contextWidth, 360)
  assert.equal(navigation.state.inspectorWidth, 260)
  scope.stop()
})
