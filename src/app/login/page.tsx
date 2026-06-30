"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { useHydrated } from "@/hooks/useHydrated";
import { PageSkeleton } from "@/components/PageSkeleton";
import { Button, PageWrapper } from "@/components/ui";

export default function LoginPage() {
  const router = useRouter();
  const hydrated = useHydrated();
  const { signInWithGoogle, user, loading, supabaseReady } = useAuth();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && user) router.replace("/");
  }, [loading, user, router]);

  if (!hydrated) return <PageSkeleton />;

  return (
    <PageWrapper>
      <div className="mx-auto max-w-md pt-16 text-center">
        <h1 className="text-2xl font-semibold text-text">Sign in</h1>
        <p className="mt-2 text-sm text-text-muted">Use your @ramosjames.com Google account.</p>
        {err && <p className="mt-4 text-sm text-danger">{err}</p>}
        <Button
          className="mt-8 w-full"
          disabled={!supabaseReady || busy}
          onClick={() => {
            setBusy(true);
            setErr(null);
            void signInWithGoogle().catch((e) => {
              setErr(e instanceof Error ? e.message : "Sign-in failed");
              setBusy(false);
            });
          }}
        >
          {busy ? "Redirecting…" : "Continue with Google"}
        </Button>
      </div>
    </PageWrapper>
  );
}
