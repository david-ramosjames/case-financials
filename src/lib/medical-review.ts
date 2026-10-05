import type { MedicalLedger, ProviderLedger } from "@/lib/medical-ledger";
import { alignProviderName, providerGroupKey } from "@/lib/medical-provider-summary";
import type { MedicalTrackerAttestation } from "@/lib/medical-attestation";
import type { MedicalProviderReview } from "@/lib/types";

export type ProviderReviewState = "needs_review" | "reviewed" | "certified";

export const PROVIDER_STATE_LABELS: Record<ProviderReviewState, string> = {
  needs_review: "Needs Review",
  reviewed: "Reviewed",
  certified: "Included in Certified Tracker",
};

export interface ProviderReviewStatus {
  provider: ProviderLedger;
  state: ProviderReviewState;
  review: MedicalProviderReview | null;
}

export interface MedicalReviewProgress {
  byKey: Map<string, ProviderReviewStatus>;
  /** Providers with at least one record that isn't excluded. */
  reviewable: ProviderReviewStatus[];
  needsReview: number;
  reviewed: number;
  certified: number;
}

/** Provider keys included in a current certification that covers medical. */
export function certifiedProviderKeys(
  attestation: MedicalTrackerAttestation | null,
  ledger: MedicalLedger
): Set<string> {
  const keys = new Set<string>();
  const providers = attestation?.snapshot.medical?.summary.providers ?? [];
  const liveNames = ledger.providers.map((p) => p.providerName);
  for (const p of providers) keys.add(providerGroupKey(alignProviderName(p.providerName, liveNames)));
  return keys;
}

export function buildReviewProgress(
  ledger: MedicalLedger,
  reviews: MedicalProviderReview[],
  certifiedKeys: Set<string>
): MedicalReviewProgress {
  // Older review rows stored keys with spaces between tokens.
  const reviewByKey = new Map(reviews.map((r) => [r.providerKey.replace(/ /g, ""), r]));
  const byKey = new Map<string, ProviderReviewStatus>();
  for (const provider of ledger.providers) {
    const review = reviewByKey.get(provider.key) ?? null;
    const reviewed = review?.fingerprint === provider.fingerprint;
    const state: ProviderReviewState = certifiedKeys.has(provider.key)
      ? "certified"
      : reviewed
        ? "reviewed"
        : "needs_review";
    byKey.set(provider.key, { provider, state, review: reviewed ? review : null });
  }
  const reviewable = [...byKey.values()].filter((s) =>
    s.provider.entries.some((e) => e.status !== "excluded")
  );
  return {
    byKey,
    reviewable,
    needsReview: reviewable.filter((s) => s.state === "needs_review").length,
    reviewed: reviewable.filter((s) => s.state === "reviewed").length,
    certified: reviewable.filter((s) => s.state === "certified").length,
  };
}
