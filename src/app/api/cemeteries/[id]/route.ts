import { NextRequest, NextResponse } from 'next/server';
import { MOCK_CEMETERIES, MOCK_GRAVES } from '@/lib/data/mockData';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const cemetery = MOCK_CEMETERIES.find((c) => c.id === params.id || c.slug === params.id);
  if (!cemetery) {
    return NextResponse.json({ success: false, error: 'Cemetery not found' }, { status: 404 });
  }

  const graves = MOCK_GRAVES.filter((g) => g.cemeteryId === cemetery.id);
  return NextResponse.json({
    success: true,
    data: {
      ...cemetery,
      graves,
    },
  });
}
