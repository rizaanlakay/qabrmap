import { describe, it, expect } from 'vitest';
import { renderQabrMapEmail } from '../src/lib/email/emailBaseTemplate';

describe('Gmail-Friendly Email Template Generator Unit Tests', () => {
  it('renders complete table-based responsive HTML with correct branding', () => {
    const html = renderQabrMapEmail({
      preheader: 'Welcome to QabrMap - Please confirm your account',
      title: 'Confirm Your Registration',
      headline: 'Confirm Your QabrMap Registration',
      bodyParagraphs: [
        'Thank you for registering with QabrMap.',
        'Please confirm your email address by clicking the button below:',
      ],
      buttonText: 'Confirm Registration',
      buttonUrl: 'https://qabrmap.vercel.app?auth=123',
      noticeText: 'This link expires in 24 hours.',
      showFeatureBanner: true,
    });

    // Check basic HTML structure
    expect(html).toContain('<!DOCTYPE html');
    expect(html).toContain('<html');
    expect(html).toContain('</html>');

    // Check Gmail-friendly layout elements
    expect(html).toContain('max-width: 600px');
    expect(html).toContain('cellpadding="0"');
    expect(html).toContain('cellspacing="0"');

    // Check brand elements & praying hands icon reference
    expect(html).toContain("Ta'awun Qabr Map");
    expect(html).toContain('Find &bull; Remember &bull; Always');
    expect(html).toContain('https://qabrmap.vercel.app/icons/icon-192.png');
    expect(html).toContain('بِسْمِ ٱللَّٰهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ');

    // Check CTA button & direct fallback URL
    expect(html).toContain('Confirm Registration');
    expect(html).toContain('https://qabrmap.vercel.app?auth=123');

    // Check Notice text & values
    expect(html).toContain('This link expires in 24 hours.');
    expect(html).toContain('100% Free Forever');
  });

  it('renders one-time security code when token is provided', () => {
    const html = renderQabrMapEmail({
      preheader: 'Your verification code',
      title: 'Security Code',
      headline: 'Your Verification Code',
      bodyParagraphs: ['Use the code below to verify your identity:'],
      token: '849201',
    });

    expect(html).toContain('849201');
    expect(html).toContain('One-Time Security Code');
  });
});
