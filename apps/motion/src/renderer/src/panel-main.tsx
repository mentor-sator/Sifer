import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Panel } from './Panel';

const root = document.getElementById('panel-root');
if (!root) {
  throw new Error('missing #panel-root element');
}

createRoot(root).render(
  <StrictMode>
    <Panel />
  </StrictMode>,
);
