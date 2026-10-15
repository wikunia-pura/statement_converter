import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';

// What no component catches — an error thrown in an event handler or a timer,
// a promise nobody awaited — is at least written down with its stack, rather
// than vanishing. Render errors are the views' ErrorBoundary's to show.
window.addEventListener('error', (event) => {
  console.error('[renderer] uncaught error:', event.error ?? event.message);
});
window.addEventListener('unhandledrejection', (event) => {
  console.error('[renderer] unhandled promise rejection:', event.reason);
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
