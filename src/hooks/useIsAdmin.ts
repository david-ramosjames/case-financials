"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { getBrowserSupabase } from "@/lib/supabase/singleton";

const cache = new Map<string, Promise<boolean>>();

/** Admin = active admin/super_admin in DocketFlow's case_tracker_user_roles. `null` while checking. */
export function useIsAdmin(): boolean | null {
  const { user, supabaseReady } = useAuth();
  const userId = user?.id ?? null;
  const [isAdmin, setIsAdmin] = useState<{ userId: string; value: boolean } | null>(null);

  useEffect(() => {
    if (!supabaseReady || !userId) return;
    let check = cache.get(userId);
    if (!check) {
      check = Promise.resolve(
        getBrowserSupabase().rpc("case_tracker_is_admin")
      ).then(({ data, error }) => {
        if (error) {
          console.warn("[useIsAdmin]", error);
          cache.delete(userId);
          return false;
        }
        return data === true;
      });
      cache.set(userId, check);
    }
    let cancelled = false;
    void check.then((value) => {
      if (!cancelled) setIsAdmin({ userId, value });
    });
    return () => {
      cancelled = true;
    };
  }, [supabaseReady, userId]);

  if (!userId) return false;
  return isAdmin?.userId === userId ? isAdmin.value : null;
}
