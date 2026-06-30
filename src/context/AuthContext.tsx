"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { User } from "@supabase/supabase-js";
import { getAuthCallbackUrl } from "@/lib/public-site-url";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { isSupabaseConfigured } from "@/lib/supabase/config";

const ALLOWED_DOMAIN = "ramosjames.com";

type AuthState = {
  user: User | null;
  loading: boolean;
  supabaseReady: boolean;
  signInWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

function emailDomain(email: string | null | undefined): string {
  return email?.split("@")[1]?.toLowerCase() ?? "";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const supabaseReady = isSupabaseConfigured();
  const [loading, setLoading] = useState(() => supabaseReady);

  useEffect(() => {
    if (!supabaseReady) {
      setLoading(false);
      return;
    }
    const supabase = createSupabaseBrowserClient();

    const applySession = async (u: User | null) => {
      if (u && emailDomain(u.email) !== ALLOWED_DOMAIN) {
        await supabase.auth.signOut();
        setUser(null);
        setLoading(false);
        return;
      }
      setUser(u);
      setLoading(false);
    };

    void supabase.auth.getSession().then(({ data: { session } }) => {
      void applySession(session?.user ?? null);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      void applySession(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, [supabaseReady]);

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      supabaseReady,
      signInWithGoogle: async () => {
        const supabase = createSupabaseBrowserClient();
        const { data, error } = await supabase.auth.signInWithOAuth({
          provider: "google",
          options: {
            redirectTo: getAuthCallbackUrl(),
            queryParams: { hd: ALLOWED_DOMAIN, prompt: "select_account" },
          },
        });
        if (error) throw error;
        if (data.url) window.location.assign(data.url);
      },
      logout: async () => {
        const supabase = createSupabaseBrowserClient();
        await supabase.auth.signOut();
      },
    }),
    [user, loading, supabaseReady]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
