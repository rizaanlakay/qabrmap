import { NextResponse } from 'next/server';
import { MOCK_CEMETERIES } from '@/lib/data/mockData';

export async function GET() {
  return NextResponse.json({
    success: true,
    data: MOCK_CEMETERIES,
  });
}
