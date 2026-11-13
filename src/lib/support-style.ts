import type { ActivityEvent } from "../types";

export type SubKind = "prime" | "tier1" | "tier2" | "tier3";

export interface SubTierInfo {
  kind: SubKind;
  label: string;
  months?: number;
}

export interface SupportPresentation {
  isMonetized: boolean;
  rowClass: string;
  badgeClass: string;
  nameClass: string;
  tierTag?: string;
}

export function getSubTierInfo(event: ActivityEvent): SubTierInfo {
  const meta = event.metadata ?? {};
  const rawTier = String(event.tier ?? meta.tier ?? "").toLowerCase();
  const isPrime =
    meta.isPrime === true ||
    meta.is_prime === true ||
    rawTier === "prime";

  const rawMonths =
    typeof meta.cumulativeMonths === "number"
      ? meta.cumulativeMonths
      : typeof meta.months === "number"
        ? meta.months
        : undefined;
  const months = rawMonths && rawMonths > 0 ? rawMonths : undefined;

  if (isPrime) {
    return { kind: "prime", label: "Prime", months };
  }
  if (rawTier === "3000" || rawTier === "tier 3") {
    return { kind: "tier3", label: "Tier 3", months };
  }
  if (rawTier === "2000" || rawTier === "tier 2") {
    return { kind: "tier2", label: "Tier 2", months };
  }
  return { kind: "tier1", label: "Tier 1", months };
}

export function getSupportPresentation(
  event: ActivityEvent,
  options?: { isTop?: boolean },
): SupportPresentation {
  const isTop = Boolean(options?.isTop);

  if (event.eventType === "donation") {
    if (isTop) {
      return {
        isMonetized: true,
        rowClass:
          "border-amber-400/45 border-l-3 border-l-amber-400 bg-linear-to-r from-amber-400/16 via-amber-400/5 to-transparent",
        badgeClass:
          "bg-amber-300 text-amber-950 font-bold shadow-[0_0_18px_-4px_rgba(251,191,36,0.7)]",
        nameClass: "text-amber-200",
      };
    }
    return {
      isMonetized: true,
      rowClass:
        "border-emerald-500/30 border-l-3 border-l-emerald-400 bg-linear-to-r from-emerald-500/12 via-emerald-500/3 to-transparent hover:border-emerald-400/45",
      badgeClass:
        "border border-emerald-400/40 bg-emerald-400/20 text-emerald-200 font-bold",
      nameClass: "text-emerald-100",
    };
  }

  if (event.eventType === "cheer") {
    const bigCheer = (event.bits ?? 0) >= 1000;
    return {
      isMonetized: true,
      rowClass: bigCheer
        ? "border-amber-400/35 border-l-3 border-l-amber-400 bg-linear-to-r from-amber-400/14 via-amber-400/4 to-transparent hover:border-amber-400/50"
        : "border-amber-400/25 border-l-3 border-l-amber-400/85 bg-linear-to-r from-amber-400/10 to-transparent hover:border-amber-400/40",
      badgeClass: bigCheer
        ? "bg-amber-300 text-amber-950 font-bold"
        : "border border-amber-400/35 bg-amber-400/20 text-amber-200 font-semibold",
      nameClass: bigCheer ? "text-amber-200" : "text-amber-100",
    };
  }

  if (
    event.eventType === "subscription" ||
    event.eventType === "resubscription" ||
    event.eventType === "gift_subscription" ||
    event.eventType === "community_gift"
  ) {
    const sub = getSubTierInfo(event);
    const tierTag =
      sub.months && sub.months > 1 ? `${sub.label} · ${sub.months}M` : sub.label;

    if (sub.kind === "prime") {
      return {
        isMonetized: true,
        rowClass:
          "border-sky-400/30 border-l-3 border-l-sky-400 bg-linear-to-r from-sky-400/12 via-sky-400/3 to-transparent hover:border-sky-400/45",
        badgeClass:
          "border border-sky-400/35 bg-sky-400/20 text-sky-200 font-semibold",
        nameClass: "text-sky-100",
        tierTag,
      };
    }
    if (sub.kind === "tier3") {
      return {
        isMonetized: true,
        rowClass:
          "border-amber-400/35 border-l-3 border-l-amber-400 bg-linear-to-r from-amber-400/14 via-amber-400/4 to-transparent hover:border-amber-400/50",
        badgeClass:
          "border border-amber-400/40 bg-amber-400/20 text-amber-200 font-bold",
        nameClass: "text-amber-200",
        tierTag,
      };
    }
    if (sub.kind === "tier2") {
      return {
        isMonetized: true,
        rowClass:
          "border-fuchsia-400/30 border-l-3 border-l-fuchsia-400 bg-linear-to-r from-fuchsia-500/12 via-fuchsia-500/3 to-transparent hover:border-fuchsia-400/45",
        badgeClass:
          "border border-fuchsia-400/35 bg-fuchsia-500/20 text-fuchsia-200 font-semibold",
        nameClass: "text-fuchsia-100",
        tierTag,
      };
    }
    return {
      isMonetized: true,
      rowClass:
        "border-violet-400/25 border-l-3 border-l-violet-400 bg-linear-to-r from-violet-500/10 via-violet-500/3 to-transparent hover:border-violet-400/40",
      badgeClass:
        "border border-violet-400/35 bg-violet-500/20 text-violet-200 font-semibold",
      nameClass: "text-violet-100",
      tierTag,
    };
  }

  return {
    isMonetized: false,
    rowClass:
      "border-transparent bg-white/2 hover:border-line hover:bg-white/3",
    badgeClass: "border border-line text-muted",
    nameClass: "text-ink",
  };
}
