import '../../styles.css';
import './web.css';
import { WebApp } from './WebApp';

document.addEventListener('DOMContentLoaded', () => {
    const appEl = document.getElementById('app');
    if (appEl) {
        const app = new WebApp(appEl);
        app.mount();
    }
});
