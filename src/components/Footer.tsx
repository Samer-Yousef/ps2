import Link from 'next/link';
import Image from 'next/image';
import { SYSTEMS_DATA } from '@/lib/seo-data';

export function Footer() {
  return (
    <footer className="bg-gray-50 dark:bg-gray-900 sepia:bg-[#f0ebe0] border-t border-gray-200 dark:border-gray-800 sepia:border-[#d9d0c0] mt-auto">
      <div className="max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* About Section */}
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white sepia:text-gray-900 mb-4">
              Pathology Search
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 sepia:text-gray-700 mb-4">
              Medical education platform with 26,000+ pathology cases.
            </p>
            <div className="flex gap-4 mb-4">
              <Link
                href="/about"
                className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
              >
                About
              </Link>
              <Link
                href="/browse"
                className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
              >
                Browse
              </Link>
            </div>

            {/* Contact Info */}
            <div className="space-y-2">
              <a
                href="mailto:sameryousefsamer@gmail.com"
                className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 sepia:text-gray-700 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-4 w-4"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path d="M2.003 5.884L10 9.882l7.997-3.998A2 2 0 0016 4H4a2 2 0 00-1.997 1.884z" />
                  <path d="M18 8.118l-8 4-8-4V14a2 2 0 002 2h12a2 2 0 002-2V8.118z" />
                </svg>
                sameryousefsamer@gmail.com
              </a>
              <a
                href="https://www.linkedin.com/in/samer-yousef-a17514200/"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 sepia:text-gray-700 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-4 w-4"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
                </svg>
                LinkedIn
              </a>
            </div>
          </div>

          {/* Partnership Section */}
          <div className="flex flex-col justify-center items-start md:items-end">
            <p className="text-sm text-gray-600 dark:text-gray-400 sepia:text-gray-700 mb-3">
              In partnership with
            </p>
            <Image
              src="/pprenter_logo.jpg"
              alt="PathPresenter Logo"
              width={200}
              height={60}
              className="object-contain"
            />
          </div>
        </div>

        <div className="mt-8 pt-8 border-t border-gray-200 dark:border-gray-800 sepia:border-[#d9d0c0]">
          <p className="text-xs text-gray-500 dark:text-gray-500 sepia:text-gray-600 text-center">
            © {new Date().getFullYear()} Pathology Search. Educational resource for medical professionals.
          </p>
        </div>
      </div>
    </footer>
  );
}
