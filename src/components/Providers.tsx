'use client';

import { SessionProvider } from 'next-auth/react';
import { ThemeProvider } from './ThemeProvider';
import { SearchProvider } from './SearchProvider';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <SearchProvider>
        <ThemeProvider>{children}</ThemeProvider>
      </SearchProvider>
    </SessionProvider>
  );
}
