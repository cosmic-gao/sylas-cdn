import { createApp, h } from 'vue'
import App from './App.vue'

// 全局声明
declare global {
  interface Window {
    vueApp?: ReturnType<typeof import('vue').createApp>
    __cdnComponents?: any[]
    Vue?: any;
  }
}

const app = createApp(App)

window.vueApp = app;
window.Vue = { h };

(window.__cdnComponents || []).forEach(comp => {
  app.component(comp.name, comp);
});

app.mount('#app')

