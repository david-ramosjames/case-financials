"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

/** Old case-expenses URL — redirect into the unified case financials page. */
export default function CaseExpensesRedirectPage() {
  const params = useParams();
  const router = useRouter();
  const caseId = params.caseId as string;

  useEffect(() => {
    if (caseId) {
      router.replace(`/cases/${caseId}/financials/medical-expenses#case-expenses`);
    }
  }, [caseId, router]);

  return null;
}
