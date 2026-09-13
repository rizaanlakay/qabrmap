'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '@/lib/supabase/client';
import { dataStore } from '@/lib/data/store';
import { isAdminUser } from './admin';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  isAdmin: boolean;
  isConfigured: boolean;
  isAuthModalOpen: boolean;
  openAuthModal: () => void;
  closeAuthModal: () => void;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string, displayName?: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  loading: true,
  isAdmin: false,
  isConfigured: false,
  isAuthModalOpen: false,
  openAuthModal: () => {},
  closeAuthModal: () => {},
  signIn: async () => ({ error: null }),
  signUp: async () => ({ error: null }),
  signOut: async () => {},
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);

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
        }
      }
    );

    return () => {
      subscription.unsubscribe();
    };
  }, []);

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
          },
        },
      });
      if (error) return { error: error.message };

      if (data?.session) {
        setSession(data.session);
        setUser(data.session.user);
        dataStore.syncUserSavedGraves(data.session.user.id);
      } else {
        // If autoconfirm enabled or session pending, attempt immediate sign in
        const { data: signInData } = await supabase.auth
          .signInWithPassword({ email, password })
          .catch(() => ({ data: null }));
        if (signInData?.session) {
          setSession(signInData.session);
          setUser(signInData.session.user);
          dataStore.syncUserSavedGraves(signInData.session.user.id);
        }
      }

      return { error: null };
    } catch (err: any) {
      return { error: err.message || 'Failed to sign up' };
    }
  };

  const signOut = async () => {
    if (isSupabaseConfigured && supabase) {
      await supabase.auth.signOut();
    }
    setUser(null);
    setSession(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        loading,
        isAdmin: isAdminUser(user),
        isConfigured: isSupabaseConfigured,
        isAuthModalOpen,
        openAuthModal,
        closeAuthModal,
        signIn,
        signUp,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
