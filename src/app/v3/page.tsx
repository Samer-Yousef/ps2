import type { Metadata } from 'next';
import SearchAppV3 from './SearchApp';

export const metadata: Metadata = {
  title: 'Pathology Search',
  description: 'Search thousands of real pathology cases by diagnosis, site, or morphology.',
  robots: { index: false, follow: false },
  alternates: { canonical: '/v3' },
};

export default function V3Page() {
  return <SearchAppV3 />;
}
