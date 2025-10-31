// green-xxxx.js
(function () {
  const MyButton = {
    name: 'MyButton',
    render() {
      return Vue.h('button', {
        style: { background: 'green' },
        onClick: () => alert('I am green')
      }, 'Click me green');
    }
  }

  // 挂到全局队列，等待统一注册
  window.__cdnComponents = window.__cdnComponents || [];
  window.__cdnComponents.push(MyButton);

  window.dispatchEvent(new CustomEvent('cdn-component-loaded', { detail: MyButton }));
})();