import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import './style.css'

// The window is frameless, so the OS still paints its own controls over the title bar:
// traffic lights on the left on macOS, caption buttons on the right on Windows.
// Tag the platform so the title bar can reserve a safe zone on both sides.
const ua = navigator.userAgent
if (ua.includes('Windows')) document.documentElement.classList.add('is-windows')
else if (ua.includes('Macintosh')) document.documentElement.classList.add('is-mac')

createApp(App).use(createPinia()).mount('#app')
