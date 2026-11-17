import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';
import { store } from './lib/store.svelte';

store.init();

export default mount(App, { target: document.getElementById('app')! });

if (import.meta.env.DEV) (window as unknown as { store: typeof store }).store = store;
