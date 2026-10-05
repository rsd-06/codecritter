import { createRoot } from 'react-dom/client';
import { App } from './App';
import { createMockBridge } from './mock';
import { TauriBridge, installExternalLinks, isTauriRuntime } from '../tauri-bridge';

// Browser playground has no preload bridge: fall back to an in-memory mock.
const tauri = !window.critterSettings && isTauriRuntime();
if (tauri) installExternalLinks();
const bridge = window.critterSettings ?? (tauri ? new TauriBridge() : createMockBridge());
const el = document.getElementById('root');
if (el) createRoot(el).render(<App bridge={bridge} mock={!window.critterSettings && !tauri} />);
