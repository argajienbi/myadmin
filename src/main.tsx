import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import "leaflet/dist/leaflet.css";
import App from './App.tsx';
import './index.css';
import { ErrorBoundary } from './ErrorBoundary.tsx';
// @ts-ignore
import { registerSW } from 'virtual:pwa-register';

try {
  const isIframe = typeof window !== 'undefined' && window.self !== window.top;
  if (!isIframe) {
    registerSW({ immediate: true });
  } else {
    console.info("PWA Service Worker registration skipped inside sandbox iframe.");
  }
} catch (e) {
  console.warn("Service worker registration error:", e);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
