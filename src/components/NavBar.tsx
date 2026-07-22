"use client";

import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui";

const LOGO_URL =
  "https://res.cloudinary.com/dmmxuoa3p/image/upload/v1783363036/logo_rdt8yk.webp";

export function NavBar() {
  const { user, logout, loading } = useAuth();

  return (
    <header className="border-b border-navy-deep bg-navy text-white">
      <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-4 px-6 py-3 lg:px-10">
        <Link href="/" className="flex items-center gap-3 text-white">
          <img
            src={LOGO_URL}
            alt="Ramos James Law"
            className="h-9 w-auto object-contain sm:h-10"
          />
          <span className="font-serif text-lg font-semibold tracking-tight">
            Case Financials
          </span>
        </Link>
        <nav className="flex items-center gap-3 text-sm">
          <Link href="/" className="text-white/80 hover:text-white">
            Cases
          </Link>
          <Link href="/log" className="text-white/80 hover:text-white">
            Expense Log
          </Link>
          {!loading && user ? (
            <>
              <span className="hidden text-white/60 sm:inline">{user.email}</span>
              <Button
                size="sm"
                variant="secondary"
                className="border-0 bg-white/10 text-white ring-1 ring-white/25 hover:bg-white/20"
                onClick={() => void logout()}
              >
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
