'use client';

import { useSearch } from './SearchProvider';

export function DatabaseLoadingIndicator() {
  const { workerReady, initStatus } = useSearch();

  if (workerReady) return null;

  // Parse loading step from status message
  const getProgress = (status: string) => {
    if (status.includes('Level 1')) return { percent: 33, step: 1 };
    if (status.includes('Level 2')) return { percent: 66, step: 2 };
    if (status.includes('Level 3')) return { percent: 90, step: 3 };
    return { percent: 10, step: 0 };
  };

  const { percent, step } = getProgress(initStatus);

  return (
    <div className="w-full max-w-3xl mx-auto mt-8 p-8 bg-white dark:bg-gray-800 sepia:bg-[#faf8f3] border-2 border-gray-200 dark:border-gray-700 sepia:border-[#d9d0c0] rounded-xl shadow-lg">
      <div className="flex flex-col items-center">
        {/* Spinner */}
        <svg className="animate-spin h-12 w-12 text-blue-600 dark:text-blue-400 sepia:text-blue-600 mb-4" viewBox="0 0 24 24">
          <circle
            className="opacity-25"
            cx="12" cy="12" r="10"
            stroke="currentColor"
            strokeWidth="4"
            fill="none"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
        </svg>

        {/* Status text */}
        <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 sepia:text-gray-900 mb-2">
          {initStatus}
        </h3>

        {/* Progress bar */}
        <div className="w-full max-w-md mb-3">
          <div className="w-full bg-gray-200 dark:bg-gray-700 sepia:bg-[#e8dfc8] rounded-full h-3 overflow-hidden">
            <div
              className="bg-blue-600 dark:bg-blue-500 sepia:bg-blue-600 h-full rounded-full transition-all duration-500 ease-out"
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>

        {/* Progress percentage and step */}
        <div className="flex items-center gap-4 text-sm text-gray-600 dark:text-gray-400 sepia:text-gray-700">
          <span className="font-mono">{percent}%</span>
          <span>•</span>
          <span>Step {step} of 3</span>
        </div>

        {/* Description */}
        <p className="mt-4 text-sm text-gray-500 dark:text-gray-400 sepia:text-gray-600 text-center">
          Preparing pathology case database for searching...
        </p>
      </div>
    </div>
  );
}
