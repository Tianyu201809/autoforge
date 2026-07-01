<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import appIcon from './assets/icon-floating.png'

const dragging = ref(false)
const moved = ref(false)
let startX = 0
let startY = 0

function onPointerDown(event: PointerEvent): void {
  if (event.button !== 0) return
  event.preventDefault()
  dragging.value = true
  moved.value = false
  startX = event.screenX
  startY = event.screenY
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}

function onPointerMove(event: PointerEvent): void {
  if (!dragging.value) return
  event.preventDefault()
  const dx = Math.abs(event.screenX - startX)
  const dy = Math.abs(event.screenY - startY)
  if (dx <= 3 && dy <= 3) return

  if (!moved.value) {
    moved.value = true
    window.floatingBall.dragStart(startX, startY)
  }
  window.floatingBall.dragMove(event.screenX, event.screenY)
}

function onPointerUp(event: PointerEvent): void {
  if (!dragging.value) return
  event.preventDefault()
  dragging.value = false
  const target = event.currentTarget as HTMLElement
  if (target.hasPointerCapture(event.pointerId)) {
    target.releasePointerCapture(event.pointerId)
  }
  void window.floatingBall.dragEnd(event.screenX, event.screenY, moved.value)
  moved.value = false
}

function onContextMenu(event: MouseEvent): void {
  event.preventDefault()
  if (event.button !== 2) return
  window.floatingBall.openContextMenu()
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    void window.floatingBall.openMain()
  }
}

onMounted(() => {
  document.addEventListener('keydown', onKeyDown)
})

onUnmounted(() => {
  document.removeEventListener('keydown', onKeyDown)
})
</script>

<template>
  <div class="shell" @contextmenu="onContextMenu">
    <button
      type="button"
      class="ball"
      :class="{ 'ball--active': dragging }"
      title="Autoforge — 点击打开主界面，拖动可自由移动"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
    >
      <span class="ball__shadow" aria-hidden="true" />
      <span class="ball__body">
        <img :src="appIcon" alt="" class="ball__icon" draggable="false" width="56" height="56" />
        <span class="ball__shine" aria-hidden="true" />
        <span class="ball__rim" aria-hidden="true" />
      </span>
    </button>
  </div>
</template>

<style scoped>
.shell {
  width: 72px;
  height: 72px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border-radius: 50%;
  touch-action: none;
  user-select: none;
}

.ball {
  position: relative;
  width: 56px;
  height: 56px;
  padding: 0;
  border: 0;
  border-radius: 9999px;
  overflow: hidden;
  background: transparent;
  outline: none;
  touch-action: none;
  user-select: none;
  -webkit-user-drag: none;
  animation: ball-float 3s ease-in-out infinite;
}

.ball::before {
  content: '';
  position: absolute;
  inset: -2px;
  border-radius: 9999px;
  background: radial-gradient(circle, rgba(234, 88, 12, 0.28) 0%, transparent 72%);
  opacity: 0.45;
  animation: ball-glow 2.4s ease-in-out infinite;
  pointer-events: none;
  z-index: 0;
}

.ball__shadow {
  position: absolute;
  left: 50%;
  bottom: 2px;
  z-index: 0;
  width: 34px;
  height: 10px;
  border-radius: 9999px;
  background: radial-gradient(ellipse at center, rgba(0, 0, 0, 0.28) 0%, transparent 72%);
  transform: translateX(-50%);
  animation: ball-shadow 3s ease-in-out infinite;
  pointer-events: none;
}

.ball__body {
  position: relative;
  z-index: 1;
  display: block;
  width: 56px;
  height: 56px;
  border-radius: 9999px;
  box-shadow:
    0 1px 0 rgba(255, 255, 255, 0.28) inset,
    0 -2px 6px rgba(0, 0, 0, 0.28) inset,
    0 2px 6px rgba(0, 0, 0, 0.18);
  transition: box-shadow 0.15s ease, transform 0.15s ease;
}

.ball__icon {
  position: relative;
  z-index: 1;
  display: block;
  width: 56px;
  height: 56px;
  max-width: 56px;
  max-height: 56px;
  border-radius: 9999px;
  object-fit: cover;
  pointer-events: none;
  user-select: none;
  -webkit-user-drag: none;
}

.ball__shine {
  position: absolute;
  inset: 0;
  z-index: 2;
  border-radius: 9999px;
  background: radial-gradient(
    circle at 32% 26%,
    rgba(255, 255, 255, 0.55) 0%,
    rgba(255, 255, 255, 0.12) 24%,
    transparent 52%
  );
  pointer-events: none;
}

.ball__rim {
  position: absolute;
  inset: 0;
  z-index: 3;
  border-radius: 9999px;
  box-shadow:
    0 0 0 1px rgba(255, 255, 255, 0.16) inset,
    0 0 0 1px rgba(0, 0, 0, 0.12);
  pointer-events: none;
}

.ball--active {
  animation: none;
}

.ball--active::before {
  animation: none;
  opacity: 0.32;
}

.ball--active .ball__shadow {
  animation: none;
  width: 42px;
  opacity: 0.85;
  transform: translateX(-50%) scale(1.08);
}

.ball--active .ball__body {
  transform: translateY(1px);
  box-shadow:
    0 1px 0 rgba(255, 255, 255, 0.18) inset,
    0 -1px 4px rgba(0, 0, 0, 0.24) inset,
    0 1px 4px rgba(0, 0, 0, 0.16);
}

@keyframes ball-float {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-3px);
  }
}

@keyframes ball-shadow {
  0%,
  100% {
    opacity: 0.72;
    transform: translateX(-50%) scale(1);
  }
  50% {
    opacity: 0.42;
    transform: translateX(-50%) scale(0.86);
  }
}

@keyframes ball-glow {
  0%,
  100% {
    opacity: 0.4;
  }
  50% {
    opacity: 0.88;
  }
}

@media (prefers-reduced-motion: reduce) {
  .ball {
    animation: none;
  }

  .ball::before,
  .ball__shadow {
    animation: none;
  }

  .ball::before {
    opacity: 0.5;
  }
}
</style>
