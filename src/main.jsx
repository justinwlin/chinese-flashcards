import { render } from 'preact';
import { App } from './app.jsx';
import './styles.css';

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded) return;
    reloaded = true;
    window.location.reload();
  });
  window.addEventListener('load', () => {
    const swUrl = `${import.meta.env.BASE_URL}sw.js?v=2`;
    navigator.serviceWorker.register(swUrl, {
      scope: import.meta.env.BASE_URL,
      updateViaCache: 'none',
    }).then((registration) => {
      registration.update();
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') registration.update();
      });
    }).catch(() => {
      /* The page still works online if registration fails. */
    });
  });
}

render(<App />, document.getElementById('app'));
