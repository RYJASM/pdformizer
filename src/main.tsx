import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/base.css';
import './styles/components.css';
import './styles/app.css';
import { App } from './App';
import { initWebApp, queueLaunchFiles } from './lib/platform';

initWebApp(queueLaunchFiles);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
