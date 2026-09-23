/**
 * Headless mode for automation (screenshots, GUI checks): `PCD_HEADLESS=1`.
 * The window is never shown, there is no dock icon, and nothing takes focus,
 * so a run does not switch the owner's Mac to the app. Timers are not
 * throttled in the hidden window (the username search mines a proof of work
 * in `setTimeout` chunks).
 */
export const isHeadless = (env: NodeJS.ProcessEnv = process.env): boolean => env.PCD_HEADLESS === '1';
