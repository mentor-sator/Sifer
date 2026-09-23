import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Orb } from './Orb';

const root = document.getElementById('orb-root');
if (!root) {
  throw new Error('missing #orb-root element');
}

createRoot(root).render(
  <StrictMode>
    <Orb />
  </StrictMode>,
);
