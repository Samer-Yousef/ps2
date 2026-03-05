import Link from 'next/link';
import { SYSTEMS_DATA } from '@/lib/seo-data';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Browse Pathology Systems',
  description: 'Browse pathology cases by anatomical system. Explore 13 pathology systems including CNS, Breast, GI, and more with over 26,000 educational cases.',
  keywords: [
    'pathology systems',
    'anatomical pathology',
    'medical education',
    'pathology cases',
  ],
  openGraph: {
    title: 'Browse Pathology Systems',
    description: 'Explore pathology cases organized by anatomical system',
    url: '/browse',
  },
  alternates: {
    canonical: '/browse',
  },
};

export default function BrowsePage() {
  return (
    <main className="min-h-screen bg-white dark:bg-gray-900 sepia:bg-[#faf8f3] p-8">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-4xl font-bold text-gray-900 dark:text-white sepia:text-gray-900 mb-4">
          Browse Pathology Systems
        </h1>
        <p className="text-lg text-gray-700 dark:text-gray-300 sepia:text-gray-800 mb-8">
          Explore pathology cases organized by anatomical system. Each system contains hundreds of educational cases.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {SYSTEMS_DATA.map((system) => (
            <Link
              key={system.slug}
              href={`/systems/${system.slug}`}
              className="block p-6 bg-white dark:bg-gray-800 sepia:bg-[#f0ebe0] border border-gray-200 dark:border-gray-700 sepia:border-[#d9d0c0] rounded-lg hover:shadow-lg hover:border-blue-500 dark:hover:border-blue-400 transition-all"
            >
              <h2 className="text-xl font-bold text-gray-900 dark:text-white sepia:text-gray-900 mb-2">
                {system.name}
              </h2>
              <p className="text-gray-600 dark:text-gray-400 sepia:text-gray-700">
                {system.description}
              </p>
            </Link>
          ))}
        </div>

        <div className="mt-12 pt-8 border-t border-gray-200 dark:border-gray-700 sepia:border-[#d9d0c0]">
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-5 w-5"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z"
                clipRule="evenodd"
              />
            </svg>
            Search All Cases
          </Link>
        </div>
      </div>
    </main>
  );
}
