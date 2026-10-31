import { render } from 'preact';
import { App } from './app.jsx';
import './styles.css';

const buildSha = __BUILD_SHA__;

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  let registrationRef = null;
  let hadController = Boolean(navigator.serviceWorker.controller);
  let reloadForUpdate = false;

  const announce = () => window.dispatchEvent(new CustomEvent('cf-update'));

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadForUpdate) {
      window.location.reload();
      return;
    }
    if (hadController) announce();
    hadController = true;
  });

  window.addEventListener('cf-apply-update', () => {
    const waiting = registrationRef?.waiting;
    if (waiting) {
      reloadForUpdate = true;
      waiting.postMessage({ type: 'SKIP_WAITING' });
      return;
    }
    window.location.reload();
  });

  const watch = (registration) => {
    registrationRef = registration;
    const track = (worker) => {
      if (!worker) return;
      worker.addEventListener('statechange', () => {
        if (!navigator.serviceWorker.controller) return;
        if (worker.state === 'installed' || worker.state === 'activated') announce();
      });
    };
    if (registration.waiting && navigator.serviceWorker.controller) announce();
    track(registration.installing);
    registration.addEventListener('updatefound', () => track(registration.installing));
  };

  const checkDeployedSha = async () => {
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}version.json?ts=${Date.now()}`, { cache: 'no-store' });
      if (!response.ok) return;
      const data = await response.json();
      if (data.sha && data.sha !== buildSha) announce();
    } catch {
      /* Offline launches keep the installed copy. */
    }
  };

  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js?build=${buildSha}`, {
      scope: import.meta.env.BASE_URL,
      updateViaCache: 'none',
    }).then((registration) => {
      watch(registration);
      registration.update();
      checkDeployedSha();
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') return;
        registration.update();
        checkDeployedSha();
      });
    }).catch(() => {
      /* The page still works online if registration fails. */
    });
  });
}

render(<App />, document.getElementById('app'));
