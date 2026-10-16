import { useEffect, useState } from 'react';

type ThemeChoice = 'light' | 'dark' | 'auto';

const STORAGE_KEY = 'wf-theme';

/**
 * WF-DS 0.1 theme switcher: Light / Auto / Dark.
 * Auto = remove the `data-theme` attribute so the
 * prefers-color-scheme media query decides. The choice is persisted in
 * localStorage; index.html applies it before first paint to avoid a
 * theme flash. This stores a UI preference only — never record data.
 */
export default function ThemeSwitcher() {
  const [choice, setChoice] = useState<ThemeChoice>(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === 'light' || stored === 'dark' || stored === 'auto' ? stored : 'auto';
  });

  useEffect(() => {
    if (choice === 'auto') {
      document.documentElement.removeAttribute('data-theme');
      window.localStorage.setItem(STORAGE_KEY, 'auto');
    } else {
      document.documentElement.dataset.theme = choice;
      window.localStorage.setItem(STORAGE_KEY, choice);
    }
  }, [choice]);

  const options: { value: ThemeChoice; label: string }[] = [
    { value: 'light', label: 'Light' },
    { value: 'auto', label: 'Auto' },
    { value: 'dark', label: 'Dark' },
  ];

  return (
    <div className="theme-switch" role="group" aria-label="Colour theme" data-testid="theme-switcher">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          data-testid={`theme-${option.value}`}
          aria-pressed={choice === option.value}
          onClick={() => setChoice(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
