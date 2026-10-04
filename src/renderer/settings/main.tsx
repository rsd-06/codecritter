import { createRoot } from 'react-dom/client';
import { App } from './App';
import { createMockBridge } from './mock';

// Browser playground has no preload bridge: fall back to an in-memory mock.
const bridge = window.critterSettings ?? createMockBridge();
const el = document.getElementById('root');
if (el) createRoot(el).render(<App bridge={bridge} mock={!window.critterSettings} />);
