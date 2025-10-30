export default {
  name: 'MyButton',
  template: `<button @click="onClick" style="background:green">Click me red</button>`,
  methods: {
     onClick() { alert('I am red') }
  }
}