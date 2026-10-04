// Placeholder playground. P1-A will import the overlay app + a mock bridge here.
import { DEFAULT_SETTINGS } from '@shared/defaults';
import { startOverlay } from '../overlay/main';

const canvas = document.getElementById('stage');
if (canvas instanceof HTMLCanvasElement) startOverlay(canvas, DEFAULT_SETTINGS.scale * 2);
