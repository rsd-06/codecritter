export const AGENT_PORT = 47626; // "626" for Experiment 626

/**
 * Peek mode: fraction of the overlay window (along the peek axis) that stays on screen.
 * main (peek/geometry.ts) slides the window by the rest; the overlay renderer (engine/peek.ts)
 * draws the character so its head sits inside this visible band. Keep both in sync via this constant.
 */
export const PEEK_VISIBLE_FRACTION = 0.6;
