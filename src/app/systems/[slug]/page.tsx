import { notFound } from 'next/navigation';
import Link from 'next/link';
import { SYSTEMS_DATA } from '@/lib/seo-data';
import { Metadata } from 'next';

// Generate static pages for all systems at build time
export async function generateStaticParams() {
  return SYSTEMS_DATA.map((system) => ({
    slug: system.slug,
  }));
}

// Generate unique metadata for each system page
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const system = SYSTEMS_DATA.find((s) => s.slug === slug);

  if (!system) {
    return {};
  }

  return {
    title: `${system.name} Pathology Cases`,
    description: `${system.description}. Educational pathology cases for medical students and healthcare professionals.`,
    keywords: [
      `${system.name} pathology`,
      system.name.toLowerCase(),
      'medical education',
      'pathology cases',
      'histopathology',
    ],
    openGraph: {
      title: `${system.name} Pathology Cases`,
      description: system.description,
      url: `/systems/${slug}`,
    },
    alternates: {
      canonical: `/systems/${slug}`,
    },
  };
}

export default async function SystemPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const system = SYSTEMS_DATA.find((s) => s.slug === slug);

  if (!system) {
    notFound();
  }

  return (
    <main className="min-h-screen bg-white dark:bg-gray-900 sepia:bg-[#faf8f3] p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-4xl font-bold text-gray-900 dark:text-white sepia:text-gray-900 mb-6">
          {system.name}
        </h1>

        <div className="prose prose-gray dark:prose-invert sepia:prose-stone max-w-none mb-8">
          <p className="text-lg text-gray-700 dark:text-gray-300 sepia:text-gray-800">
            {system.description}
          </p>

          <div className="mt-8 p-6 bg-gray-50 dark:bg-gray-800 sepia:bg-[#f0ebe0] rounded-lg">
            <h2 className="text-2xl font-semibold mb-4">Placeholder Content</h2>
            <p>
              This page will contain detailed information about {system.name} pathology cases.
              Content coming soon.
            </p>
          </div>
        </div>

        <div className="mt-8">
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
            Search Pathology Cases
          </Link>
        </div>
      </div>
    </main>
  );
}
