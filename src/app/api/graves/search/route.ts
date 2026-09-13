import { NextRequest, NextResponse } from 'next/server';
import { MOCK_GRAVES } from '@/lib/data/mockData';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get('q') || '').trim().toLowerCase();
  const filter = searchParams.get('filter') || 'all';

  if (!q) {
    return NextResponse.json({ success: true, data: [] });
  }

  const results = MOCK_GRAVES.filter((g) => {
    const numMatch = g.graveNumber.toLowerCase().includes(q);
    const fullNameMatch = g.person?.fullName.toLowerCase().includes(q) ?? false;
    const firstNameMatch = g.person?.firstName.toLowerCase().includes(q) ?? false;
    const surnameMatch = g.person?.surname.toLowerCase().includes(q) ?? false;

    if (filter === 'names') return fullNameMatch || firstNameMatch || surnameMatch;
    if (filter === 'numbers') return numMatch;
    return numMatch || fullNameMatch || firstNameMatch || surnameMatch;
  });

  return NextResponse.json({
    success: true,
    data: results,
  });
}
