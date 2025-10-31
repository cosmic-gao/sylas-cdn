import { createApp, type App as VueApp, type Component, h } from 'vue'
import App from './App.vue'

// 全局声明
declare global {
  interface Window {
    vueApp?: VueApp<Element>
    __cdnComponents?: Component[]
    Vue?: { h: typeof h }
  }
}

// 创建 Vue 应用
const app = createApp(App)

// 挂载全局引用
window.vueApp = app
window.Vue = { h }

// 确保组件队列存在
window.__cdnComponents = window.__cdnComponents || []

// 注册已有组件
window.__cdnComponents.forEach((comp: Component) => {
  app.component(comp.name as string, comp)
})

// 使用 Proxy 监听后续组件 push
window.__cdnComponents = new Proxy(window.__cdnComponents, {
  set(target: Component[], prop, value) {
    if (!isNaN(Number(prop))) {
      app.component((value as Component).name as string, value as Component)
    }
    target[prop as any] = value
    return true
  }
})

app.mount('#app')
