'use client';

import { createContext, useContext, useEffect, useState } from 'react';

type Theme = 'light' | 'dark' | 'sepia';

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Initialize with light theme - this is the default
  const [theme, setTheme] = useState<Theme>('light');

  useEffect(() => {
    // On mount, check localStorage and apply the correct theme
    const savedTheme = localStorage.getItem('theme') as Theme | null;
    const themeToApply = savedTheme || 'light';

    // Apply the theme class to the HTML element
    document.documentElement.classList.remove('light', 'dark', 'sepia');
    document.documentElement.classList.add(themeToApply);

    // Update state if different from default
    if (themeToApply !== theme) {
      setTheme(themeToApply);
    }
  }, []);

  const changeTheme = (newTheme: Theme) => {
    setTheme(newTheme);
    localStorage.setItem('theme', newTheme);
    document.documentElement.classList.remove('light', 'dark', 'sepia');
    document.documentElement.classList.add(newTheme);
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme: changeTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
