import { createRoot } from 'react-dom/client';
import { App } from './App';
import { createMockBridge } from './mock';
import { TauriBridge, installExternalLinks, isTauriRuntime } from '../tauri-bridge';

// Browser playground has no Tauri runtime: fall back to an in-memory mock.
const tauri = isTauriRuntime();
if (tauri) installExternalLinks();
const bridge = tauri ? new TauriBridge() : createMockBridge();
const el = document.getElementById('root');
if (el) createRoot(el).render(<App bridge={bridge} mock={!tauri} />);
