export default {
    name: 'MyButton',
    template: `<button @click="onClick" style="background:red">Click me green</button>`,
    methods: {
        onClick() { alert('I am red') }
    }
}