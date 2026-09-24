import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './index.css';
import { App } from './ui/App';
import { ProfilePicker } from './ui/Profiles';

const root = document.getElementById('root');
if (!root) throw new Error('missing #root');

/**
 * M18: a process started for the picker has no profile; everything else is
 * one profile's app. Asked once: a process never changes its profile.
 */
const start = async (): Promise<'picker' | 'app'> => {
  const profiles = window.desktop?.profiles;
  if (!profiles) return 'app';
  try {
    return (await profiles.state()).current === null ? 'picker' : 'app';
  } catch {
    return 'app';
  }
};

void start().then(mode => {
  const profiles = window.desktop?.profiles;
  createRoot(root).render(<StrictMode>{mode === 'picker' && profiles ? <ProfilePicker api={profiles} /> : <App />}</StrictMode>);
});
