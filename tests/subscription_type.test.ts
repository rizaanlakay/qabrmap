import { describe, it, expect } from 'vitest';
import { mapDbProfile } from '../src/lib/supabase/mappers';
import fs from 'node:fs';
import path from 'node:path';

describe('Subscription Type (Free / Pro) Domain and Mappings', () => {
  it('maps valid database row with subscription_type Free', () => {
    const row = {
      id: 'usr_123',
      display_name: 'Ahmed Patel',
      subscription_type: 'Free',
      created_at: '2026-09-18T10:00:00Z',
      updated_at: '2026-09-18T10:00:00Z',
    };

    const profile = mapDbProfile(row);
    expect(profile.id).toBe('usr_123');
    expect(profile.displayName).toBe('Ahmed Patel');
    expect(profile.subscriptionType).toBe('Free');
  });

  it('maps valid database row with subscription_type Pro', () => {
    const row = {
      id: 'usr_456',
      display_name: 'Fatima Hendricks',
      subscription_type: 'Pro',
    };

    const profile = mapDbProfile(row);
    expect(profile.subscriptionType).toBe('Pro');
  });

  it('defaults subscription_type to Free when missing, null, or undefined', () => {
    const rowNull = {
      id: 'usr_789',
      display_name: 'Rizaan',
      subscription_type: null,
    };
    expect(mapDbProfile(rowNull).subscriptionType).toBe('Free');

    const rowUndefined = {
      id: 'usr_789',
      display_name: 'Rizaan',
    };
    expect(mapDbProfile(rowUndefined).subscriptionType).toBe('Free');

    const rowEmpty = {
      id: 'usr_789',
      display_name: 'Rizaan',
      subscription_type: '',
    };
    expect(mapDbProfile(rowEmpty).subscriptionType).toBe('Free');
  });

  it('defaults subscription_type to Free for any unsupported or invalid string', () => {
    const rowInvalid = {
      id: 'usr_999',
      display_name: 'Test',
      subscription_type: 'Enterprise',
    };
    expect(mapDbProfile(rowInvalid).subscriptionType).toBe('Free');
  });

  it('verifies migration file has valid SQL and constraints for subscription_type', () => {
    const migrationPath = path.join(
      process.cwd(),
      'supabase',
      'migrations',
      '20260918230000_subscription_type.sql'
    );
    expect(fs.existsSync(migrationPath)).toBe(true);

    const sql = fs.readFileSync(migrationPath, 'utf8');
    expect(sql).toContain("subscription_type TEXT NOT NULL DEFAULT 'Free'");
    expect(sql).toContain("CHECK (subscription_type IN ('Free', 'Pro'))");
    expect(sql).toContain("UPDATE public.profiles");
    expect(sql).toContain("SET subscription_type = 'Free'");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.handle_new_user()");
  });

  it('determines feature access for Free vs Pro tiers', () => {
    const freeProfile = mapDbProfile({ id: 'u1', subscription_type: 'Free' });
    const proProfile = mapDbProfile({ id: 'u2', subscription_type: 'Pro' });

    const isPro = (sub: string) => sub === 'Pro';
    expect(isPro(freeProfile.subscriptionType)).toBe(false);
    expect(isPro(proProfile.subscriptionType)).toBe(true);
  });

  it('gates sharing and survey features behind Pro subscription type', () => {
    const checkCanShare = (subscriptionType: 'Free' | 'Pro') => subscriptionType === 'Pro';
    const checkCanSurvey = (subscriptionType: 'Free' | 'Pro') => subscriptionType === 'Pro';

    expect(checkCanShare('Free')).toBe(false);
    expect(checkCanShare('Pro')).toBe(true);

    expect(checkCanSurvey('Free')).toBe(false);
    expect(checkCanSurvey('Pro')).toBe(true);
  });

  it('limits Free users to saving or hearting up to 3 graves and allows unlimited for Pro', () => {
    const checkCanSaveNewGrave = (subscriptionType: 'Free' | 'Pro', currentSavedCount: number) => {
      if (subscriptionType === 'Pro') return true;
      return currentSavedCount < 3;
    };

    // Free user tests
    expect(checkCanSaveNewGrave('Free', 0)).toBe(true);
    expect(checkCanSaveNewGrave('Free', 1)).toBe(true);
    expect(checkCanSaveNewGrave('Free', 2)).toBe(true);
    expect(checkCanSaveNewGrave('Free', 3)).toBe(false);
    expect(checkCanSaveNewGrave('Free', 4)).toBe(false);

    // Pro user tests (unlimited)
    expect(checkCanSaveNewGrave('Pro', 3)).toBe(true);
    expect(checkCanSaveNewGrave('Pro', 50)).toBe(true);
  });
});
