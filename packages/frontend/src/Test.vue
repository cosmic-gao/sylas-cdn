<template>
  <!-- 只有组件加载后才渲染 -->
  <component v-if="currentComponent" :is="currentComponent"></component>
</template>

<script lang="ts">
import { defineComponent, ref, onUnmounted } from 'vue'

export default defineComponent({
  setup() {
    const currentComponent = ref<null | any>(null)

    // 查找是否已有组件加载
    const comp = window.__cdnComponents?.find(c => c.name === 'MyButton')
    if (comp) currentComponent.value = comp

    // 监听远程组件加载事件
    const onComponentLoaded = (e: CustomEvent) => {
      if (e.detail.name === 'MyButton') {
        currentComponent.value = e.detail
      }
    }
    (window as any).addEventListener('cdn-component-loaded', onComponentLoaded)

    // 清理事件监听
    onUnmounted(() => {
      (window as any).removeEventListener('cdn-component-loaded', onComponentLoaded)
    })

    return { currentComponent }
  }
})
</script>
