"use client";

import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui";

export function NavBar() {
  const { user, logout, loading } = useAuth();

  return (
    <header className="border-b border-border bg-navy text-white">
      <div className="mx-auto flex max-w-[1280px] items-center justify-between gap-4 px-6 py-3 lg:px-8">
        <Link href="/" className="font-serif text-lg font-semibold tracking-tight text-white">
          Case Financials
        </Link>
        <nav className="flex items-center gap-3 text-sm">
          <Link href="/" className="text-white/80 hover:text-white">
            Cases
          </Link>
          {!loading && user ? (
            <>
              <span className="hidden text-white/60 sm:inline">{user.email}</span>
              <Button size="sm" variant="secondary" onClick={() => void logout()}>
                Sign out
              </Button>
            </>
          ) : !loading ? (
            <Link href="/login" className="text-white/80 hover:text-white">
              Sign in
            </Link>
          ) : null}
        </nav>
      </div>
    </header>
  );
}
