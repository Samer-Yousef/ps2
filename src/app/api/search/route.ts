import { NextRequest, NextResponse } from 'next/server';
import { performVectorSearch } from '@/lib/vectorSearch';

export async function GET(request: NextRequest) {
  const startTime = performance.now();

  try {
    const searchParams = request.nextUrl.searchParams;
    const query = searchParams.get('q');
    const limit = parseInt(searchParams.get('limit') || '10', 10);

    if (!query) {
      return NextResponse.json(
        { error: 'Query parameter "q" is required' },
        { status: 400 }
      );
    }

    // Perform vector search with timing
    const { results, embeddingTime, searchTime } = await performVectorSearch(query, limit);

    const totalTime = performance.now() - startTime;

    return NextResponse.json({
      query,
      results,
      performance: {
        mode: 'api' as const,
        searchTime,
        embeddingTime,
        totalTime,
        resultCount: results.length
      }
    });
  } catch (error) {
    console.error('Search error:', error);
    return NextResponse.json(
      {
        error: 'Failed to perform search',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}
