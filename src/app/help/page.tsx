'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { HelpScreen } from '@/components/screens/HelpScreen';

export default function HelpPage() {
  const router = useRouter();

  return (
    <div className="w-full h-full min-h-screen flex justify-center bg-slate-950">
      <div className="w-full max-w-md min-h-screen bg-white relative flex flex-col shadow-2xl overflow-hidden">
        <HelpScreen
          onNavigate={(screen) => {
            if (screen === 'home') {
              router.push('/');
            } else {
              router.push(`/?screen=${screen}`);
            }
          }}
          onBack={() => router.push('/')}
        />
      </div>
    </div>
  );
}
