'use client';

import { useTheme } from './ThemeProvider';
import { useState, useRef, useEffect } from 'react';

export function ThemeSelector() {
  const { theme, setTheme } = useTheme();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const themes = [
    { value: 'light', label: 'Light', icon: '☀️' },
    { value: 'dark', label: 'Dark', icon: '🌙' },
    { value: 'sepia', label: 'Sepia', icon: '📄' },
  ] as const;

  const currentTheme = themes.find((t: typeof themes[number]) => t.value === theme) || themes[0];

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-center w-8 h-8 text-lg rounded hover:bg-gray-100 dark:hover:bg-gray-800 sepia:hover:bg-[#e8dfc8] transition-colors opacity-60 hover:opacity-100"
        title="Change theme"
      >
        <span>{currentTheme.icon}</span>
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-40 rounded-lg shadow-lg bg-white dark:bg-gray-800 sepia:bg-[#faf8f3] border border-gray-200 dark:border-gray-700 sepia:border-[#d9d0c0] overflow-hidden z-50">
          {themes.map((t) => (
            <button
              key={t.value}
              onClick={() => {
                setTheme(t.value);
                setIsOpen(false);
              }}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                theme === t.value
                  ? 'bg-blue-50 dark:bg-blue-900/20 sepia:bg-[#e8dfc8] text-blue-600 dark:text-blue-400 font-medium'
                  : 'hover:bg-gray-100 dark:hover:bg-gray-700 sepia:hover:bg-[#f0ebe0]'
              }`}
            >
              <span className="text-lg">{t.icon}</span>
              <span>{t.label}</span>
              {theme === t.value && (
                <svg className="w-4 h-4 ml-auto" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                    clipRule="evenodd"
                  />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
