import type { Metadata } from 'next';
import SearchApp from './v2/SearchApp';

// The v2 interface IS the site now (cutover 2026-08-03). The previous interface
// remains browsable at /old, and /v2 redirects here.
export const metadata: Metadata = {
  title: 'Pathology Search',
  description: 'Search thousands of real pathology cases by diagnosis, site, or morphology.',
};

export default function Home() {
  return <SearchApp />;
}
