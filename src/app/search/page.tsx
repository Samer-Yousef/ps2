import type { Metadata } from 'next';
import SearchApp from './SearchApp';

export const metadata: Metadata = {
  title: 'Pathology Search',
  description: 'Search 58,000 digital pathology slides by diagnosis, organ, system or behaviour, with differential-diagnosis suggestions.',
};

export default function SearchPage() {
  return <SearchApp />;
}
