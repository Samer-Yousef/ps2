'use client';

import { useSearch } from './SearchProvider';

export function DatabaseLoadingIndicator() {
  const { workerReady, initStatus } = useSearch();

  if (workerReady) return null;

  // Parse loading step from status message
  const getProgress = (status: string) => {
    if (status.includes('Loading database')) return { percent: 33, step: 1 };
    if (status.includes('Loading PCA')) return { percent: 66, step: 2 };
    if (status.includes('Loading embedding')) return { percent: 90, step: 3 };
    return { percent: 10, step: 0 };
  };

  const { percent, step } = getProgress(initStatus);

  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-blue-600 text-white shadow-lg">
      <div className="max-w-5xl mx-auto px-4 py-3">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            {/* Spinner */}
            <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
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
            <span className="font-medium">{initStatus}</span>
          </div>

          {/* Progress percentage */}
          <span className="text-sm font-mono">{percent}%</span>
        </div>

        {/* Progress bar */}
        <div className="w-full bg-blue-800 rounded-full h-2 overflow-hidden">
          <div
            className="bg-white h-full rounded-full transition-all duration-500 ease-out"
            style={{ width: `${percent}%` }}
          />
        </div>

        {/* Step indicator */}
        <div className="mt-2 text-xs text-blue-100">
          Step {step} of 3
        </div>
      </div>
    </div>
  );
}
