import { NextRequest, NextResponse } from 'next/server';
import { renderQabrMapEmail } from '@/lib/email/emailBaseTemplate';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type') || 'confirmation';
  const format = searchParams.get('format') || 'html';

  let emailHtml = '';

  switch (type) {
    case 'confirmation':
      emailHtml = renderQabrMapEmail({
        preheader: "Confirm your email to activate your Ta'awun Qabr Map account and start preserving resting places.",
        title: 'Confirm Your Registration',
        headline: "Confirm Your Ta'awun Qabr Map Registration",
        bodyParagraphs: [
          'Thank you for registering with <strong>Ta\'awun Qabr Map</strong> &mdash; the community-powered platform for mapping, remembering, and navigating to the resting places of our loved ones.',
          'Please confirm your email address by clicking the button below to complete your registration and activate your account:',
        ],
        buttonText: 'Confirm Registration',
        buttonUrl: 'https://qabrmap.vercel.app?auth_confirm=demo_token',
        noticeText: 'This registration confirmation link will expire in 24 hours.',
        showFeatureBanner: true,
      });
      break;

    case 'magic_link':
      emailHtml = renderQabrMapEmail({
        preheader: "Click here to securely sign in to your Ta'awun Qabr Map account.",
        title: "Sign In to Ta'awun Qabr Map",
        headline: 'Your Passwordless Sign-In Link',
        bodyParagraphs: [
          "We received a request to sign in to your Ta'awun Qabr Map account without a password.",
          'Click the button below to securely access your saved cemeteries, survey sessions, and family graves:',
        ],
        buttonText: "Sign In to Ta'awun Qabr Map",
        buttonUrl: 'https://qabrmap.vercel.app?magic_link=demo_token',
        noticeText: 'This one-time sign-in link expires shortly and can only be used once.',
        showFeatureBanner: false,
      });
      break;

    case 'recovery':
      emailHtml = renderQabrMapEmail({
        preheader: "Choose a new password for your Ta'awun Qabr Map account.",
        title: 'Reset Your Password',
        headline: "Reset Your Ta'awun Qabr Map Password",
        bodyParagraphs: [
          "We received a request to reset the password for your Ta'awun Qabr Map account.",
          'Click the button below to choose a new, secure password and regain access to your profile:',
        ],
        buttonText: 'Reset Password',
        buttonUrl: 'https://qabrmap.vercel.app?reset_token=demo_token',
        noticeText: 'If you did not request a password reset, you can safely ignore this email.',
        showFeatureBanner: false,
      });
      break;

    case 'friday_reminder':
      emailHtml = renderQabrMapEmail({
        preheader: 'Jumu\'ah Mubarak &bull; A moment of remembrance for your loved ones.',
        title: 'Friday Remembrance',
        headline: 'Jumu\'ah Mubarak &bull; Friday Remembrance',
        bodyParagraphs: [
          'On this blessed day of Jumu\'ah, take a quiet moment to recite Surah Yaseen and make heartfelt Du\'a for your loved ones resting in our cemeteries.',
          'Open Ta\'awun Qabr Map to revisit your saved resting places and leave a quiet remembrance note:',
        ],
        buttonText: 'View My Saved Loved Ones',
        buttonUrl: 'https://qabrmap.vercel.app?tab=profile',
        showFeatureBanner: true,
      });
      break;

    case 'janazah_notice':
      emailHtml = renderQabrMapEmail({
        preheader: 'Janazah Announcement &bull; Funeral notice for our community.',
        title: 'Janazah Notice',
        headline: 'Community Janazah Announcement',
        bodyParagraphs: [
          '<em>Inna lillahi wa inna ilayhi raji\'un</em> (To Allah we belong and to Him is our return).',
          'A Janazah prayer and burial has been scheduled in the Cape Town area. View details, maps, and grave location on Ta\'awun Qabr Map:',
        ],
        buttonText: 'View Janazah Details & Directions',
        buttonUrl: 'https://qabrmap.vercel.app?cemetery=athlone',
        showFeatureBanner: false,
      });
      break;

    default:
      emailHtml = renderQabrMapEmail({
        preheader: "Ta'awun Qabr Map Notification",
        title: "Ta'awun Qabr Map Notification",
        headline: "Ta'awun Qabr Map Notification",
        bodyParagraphs: ["Thank you for using Ta'awun Qabr Map."],
        buttonText: "Open Ta'awun Qabr Map",
        buttonUrl: 'https://qabrmap.vercel.app',
      });
  }

  if (format === 'json') {
    return NextResponse.json({ type, html: emailHtml });
  }

  return new NextResponse(emailHtml, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
    },
  });
}
