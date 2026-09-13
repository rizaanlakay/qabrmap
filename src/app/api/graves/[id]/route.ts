import { NextRequest, NextResponse } from 'next/server';
import { MOCK_GRAVES } from '@/lib/data/mockData';
import { dataStore } from '@/lib/data/store';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const grave = MOCK_GRAVES.find((g) => g.id === params.id || g.graveNumber === params.id);
  if (!grave) {
    return NextResponse.json({ success: false, error: 'Grave not found' }, { status: 404 });
  }

  const provenance = dataStore.getProvenanceLogs(grave.id);

  return NextResponse.json({
    success: true,
    data: {
      ...grave,
      provenance,
    },
  });
}
