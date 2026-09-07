const STORAGE_KEY = 'text-block-history:theme';

type Preference = 'light' | 'dark' | 'device';

// A stored value of 'light' or 'dark' is an explicit choice; no stored
// value at all means "follow the OS", i.e. device default.
function getPreference(): Preference {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw === 'light' || raw === 'dark' ? raw : 'device';
}

// Beer CSS's own ui('mode', ...) setter already does the body classList
// swap (and would layer in material-dynamic-colors if that library were
// loaded); passing 'auto' asks it to resolve against the OS preference
// itself, so we never have to duplicate that matchMedia check by hand.
function applyPreference(preference: Preference): void {
  window.ui?.('mode', preference === 'device' ? 'auto' : preference);
}

const ICONS: Record<Preference, string> = { light: 'light_mode', dark: 'dark_mode', device: 'brightness_medium' };
const LABELS: Record<Preference, string> = { light: 'Light mode', dark: 'Dark mode', device: 'Device default' };
const CYCLE: Preference[] = ['light', 'dark', 'device'];

export function initThemeToggle(button: HTMLButtonElement): void {
  const icon = button.querySelector('i');

  const render = (preference: Preference): void => {
    if (icon) icon.textContent = ICONS[preference];
    button.title = LABELS[preference];
  };

  // The inline script in index.html already applied the initial class
  // (stored preference, or the OS setting) before this module ran.
  render(getPreference());

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (getPreference() !== 'device') return;
    applyPreference('device');
  });

  button.addEventListener('click', () => {
    const next = CYCLE[(CYCLE.indexOf(getPreference()) + 1) % CYCLE.length];
    if (next === 'device') localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, next);
    applyPreference(next);
    render(next);
  });
}
