import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ToastProvider } from './ui';
import './index.css';

/**
 * A page opened before a new version was published still points at the old file names of the parts loaded on demand
 * (report designs, PDF, Word…), which no longer exist: reload once to get the new version, and say so after the reload.
 */
export const UPDATED_KEY = 'hcm-updated-reload';
window.addEventListener('vite:preloadError', (event) => {
  try {
    const last = Number(sessionStorage.getItem(UPDATED_KEY) ?? 0);
    if (Date.now() - last < 60_000) return; // already reloaded a moment ago: let the error show instead of looping
    sessionStorage.setItem(UPDATED_KEY, String(Date.now()));
  } catch {
    /* private mode: reload anyway */
  }
  event.preventDefault();
  window.location.reload();
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </StrictMode>,
);
