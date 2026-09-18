'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '@/lib/supabase/client';
import { dataStore } from '@/lib/data/store';
import { UserProfile } from '@/types';
import { mapDbProfile } from '@/lib/supabase/mappers';
import { isAdminUser } from './admin';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: UserProfile | null;
  loading: boolean;
  isAdmin: boolean;
  isConfigured: boolean;
  isAuthModalOpen: boolean;
  openAuthModal: () => void;
  closeAuthModal: () => void;
  refreshProfile: () => Promise<UserProfile | null>;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string, displayName?: string) => Promise<{ error: string | null }>;
  signInWithGoogle: () => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  profile: null,
  loading: true,
  isAdmin: false,
  isConfigured: false,
  isAuthModalOpen: false,
  openAuthModal: () => {},
  closeAuthModal: () => {},
  refreshProfile: async () => null,
  signIn: async () => ({ error: null }),
  signUp: async () => ({ error: null }),
  signInWithGoogle: async () => ({ error: null }),
  signOut: async () => {},
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);

  const loadProfile = useCallback(async (authUser: User): Promise<UserProfile | null> => {
    if (!isSupabaseConfigured || !supabase) {
      const fallback: UserProfile = {
        id: authUser.id,
        displayName: authUser.user_metadata?.display_name || authUser.email?.split('@')[0] || null,
        subscriptionType: (authUser.user_metadata?.subscription_type === 'Pro' ? 'Pro' : 'Free'),
      };
      setProfile(fallback);
      return fallback;
    }

    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', authUser.id)
        .maybeSingle();

      if (error) {
        console.warn('Error fetching profile from Supabase:', error.message);
      }

      if (!data) {
        // Auto-create profile row if it doesn't exist yet
        const displayName = authUser.user_metadata?.display_name || authUser.email?.split('@')[0] || 'Member';
        const { data: inserted, error: insertError } = await supabase
          .from('profiles')
          .insert({
            id: authUser.id,
            display_name: displayName,
            subscription_type: 'Free',
          })
          .select()
          .maybeSingle();

        if (insertError) {
          console.warn('Error creating default profile in Supabase:', insertError.message);
        }

        const mapped: UserProfile = inserted
          ? mapDbProfile(inserted)
          : {
              id: authUser.id,
              displayName,
              subscriptionType: 'Free',
            };
        setProfile(mapped);
        return mapped;
      }

      // If there is no value in there, then default it to Free and update the field
      if (!data.subscription_type || (data.subscription_type !== 'Free' && data.subscription_type !== 'Pro')) {
        const { error: updateError } = await supabase
          .from('profiles')
          .update({ subscription_type: 'Free', updated_at: new Date().toISOString() })
          .eq('id', authUser.id);

        if (updateError) {
          console.warn('Error defaulting profile subscription_type to Free:', updateError.message);
        }
        data.subscription_type = 'Free';
      }

      const mapped = mapDbProfile(data);
      setProfile(mapped);
      return mapped;
    } catch (err) {
      console.error('Failed to load or initialize profile:', err);
      const fallback: UserProfile = {
        id: authUser.id,
        displayName: authUser.user_metadata?.display_name || authUser.email?.split('@')[0] || null,
        subscriptionType: 'Free',
      };
      setProfile(fallback);
      return fallback;
    }
  }, []);

  const refreshProfile = useCallback(async (): Promise<UserProfile | null> => {
    if (user) {
      return await loadProfile(user);
    }
    return null;
  }, [user, loadProfile]);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) {
      setLoading(false);
      return;
    }

    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        dataStore.syncUserSavedGraves(session.user.id);
        loadProfile(session.user);
      } else {
        setProfile(null);
      }
      setLoading(false);
    }).catch(() => {
      setLoading(false);
    });

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, newSession) => {
        setSession(newSession);
        setUser(newSession?.user ?? null);
        if (newSession?.user) {
          dataStore.syncUserSavedGraves(newSession.user.id);
          loadProfile(newSession.user);
        } else {
          setProfile(null);
        }
      }
    );

    return () => {
      subscription.unsubscribe();
    };
  }, [loadProfile]);

  const openAuthModal = () => setIsAuthModalOpen(true);
  const closeAuthModal = () => setIsAuthModalOpen(false);

  const signIn = async (email: string, password: string) => {
    if (!isSupabaseConfigured || !supabase) {
      return { error: 'Supabase is not configured' };
    }
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) return { error: error.message };
      return { error: null };
    } catch (err: any) {
      return { error: err.message || 'Failed to sign in' };
    }
  };

  const signUp = async (email: string, password: string, displayName?: string) => {
    if (!isSupabaseConfigured || !supabase) {
      return { error: 'Supabase is not configured' };
    }
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            display_name: displayName || email.split('@')[0],
            subscription_type: 'Free',
          },
        },
      });
      if (error) return { error: error.message };

      if (data?.session) {
        setSession(data.session);
        setUser(data.session.user);
        dataStore.syncUserSavedGraves(data.session.user.id);
        await loadProfile(data.session.user);
      } else {
        // If autoconfirm enabled or session pending, attempt immediate sign in
        const { data: signInData } = await supabase.auth
          .signInWithPassword({ email, password })
          .catch(() => ({ data: null }));
        if (signInData?.session) {
          setSession(signInData.session);
          setUser(signInData.session.user);
          dataStore.syncUserSavedGraves(signInData.session.user.id);
          await loadProfile(signInData.session.user);
        }
      }

      return { error: null };
    } catch (err: any) {
      return { error: err.message || 'Failed to sign up' };
    }
  };

  const signInWithGoogle = async () => {
    if (!isSupabaseConfigured || !supabase) {
      return { error: 'Supabase is not configured' };
    }
    try {
      const redirectUrl =
        typeof window !== 'undefined'
          ? `${window.location.origin}/auth/callback`
          : undefined;

      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: redirectUrl,
          queryParams: {
            access_type: 'offline',
            prompt: 'consent',
          },
        },
      });

      if (error) return { error: error.message };
      return { error: null };
    } catch (err: any) {
      return { error: err.message || 'Failed to initialize Google Sign In' };
    }
  };

  const signOut = async () => {
    if (isSupabaseConfigured && supabase) {
      await supabase.auth.signOut();
    }
    setUser(null);
    setSession(null);
    setProfile(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        profile,
        loading,
        isAdmin: isAdminUser(user),
        isConfigured: isSupabaseConfigured,
        isAuthModalOpen,
        openAuthModal,
        closeAuthModal,
        refreshProfile,
        signIn,
        signUp,
        signInWithGoogle,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);

