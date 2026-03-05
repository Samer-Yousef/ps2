import Link from 'next/link';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'About Pathology Search',
  description: 'Learn about Pathology Search - a comprehensive medical education platform for pathology case studies with over 26,000 educational cases.',
  keywords: [
    'pathology education',
    'medical education',
    'pathology database',
    'histopathology cases',
  ],
  openGraph: {
    title: 'About Pathology Search',
    description: 'Comprehensive medical education platform for pathology case studies',
    url: '/about',
  },
  alternates: {
    canonical: '/about',
  },
};

export default function AboutPage() {
  return (
    <main className="min-h-screen bg-white dark:bg-gray-900 sepia:bg-[#faf8f3] p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-4xl font-bold text-gray-900 dark:text-white sepia:text-gray-900 mb-8">
          About Pathology Search
        </h1>

        <div className="prose prose-gray dark:prose-invert sepia:prose-stone max-w-none space-y-8">
          <section>
            <h2 className="text-2xl font-semibold text-gray-900 dark:text-white sepia:text-gray-900 mb-4">
              Our Mission
            </h2>
            <p className="text-lg text-gray-700 dark:text-gray-300 sepia:text-gray-800">
              Pathology Search is a comprehensive medical education platform providing access to
              thousands of pathology cases for medical students, residents, and healthcare professionals.
              Our mission is to make pathology education accessible and searchable.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-gray-900 dark:text-white sepia:text-gray-900 mb-4">
              Database
            </h2>
            <p className="text-lg text-gray-700 dark:text-gray-300 sepia:text-gray-800 mb-4">
              Our database contains over 26,000 pathology cases sourced from trusted educational resources:
            </p>
            <ul className="list-disc list-inside space-y-2 text-gray-700 dark:text-gray-300 sepia:text-gray-800 ml-4">
              <li>Path Presenter</li>
              <li>Leeds Virtual Pathology</li>
              <li>Toronto Virtual Pathology</li>
              <li>RCPA</li>
              <li>Recut Club</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-gray-900 dark:text-white sepia:text-gray-900 mb-4">
              Technology
            </h2>
            <p className="text-lg text-gray-700 dark:text-gray-300 sepia:text-gray-800">
              Powered by advanced vector search and AI, our platform enables semantic search
              across pathology cases, helping you find relevant cases by description, clinical
              features, or diagnosis. All searches are performed client-side for instant results.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-gray-900 dark:text-white sepia:text-gray-900 mb-4">
              Features
            </h2>
            <ul className="list-disc list-inside space-y-2 text-gray-700 dark:text-gray-300 sepia:text-gray-800 ml-4">
              <li>Semantic search across 26,000+ pathology cases</li>
              <li>Filter by organ system, lineage, and source</li>
              <li>Clinical view mode with detailed case information</li>
              <li>Save favorite cases for quick reference</li>
              <li>Track your search history</li>
              <li>Dark mode and sepia theme options</li>
            </ul>
          </section>

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
              Start Searching
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
