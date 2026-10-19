import type { Metadata } from 'next';
import SearchV2App from './SearchV2App';

export const metadata: Metadata = {
  title: 'Pathology Search',
  description: 'Search 58,000 digital pathology slides by diagnosis, organ or system.',
};

export default function SearchV2Page() {
  return <SearchV2App />;
}
