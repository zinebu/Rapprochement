import type { SepaOperationCandidate } from "./types";

type Props = {
  candidate: SepaOperationCandidate;
};

/** Masque les libellés liés au score (anciennes propositions en cache). */
function withoutScoreReasons(reasons: string[]): string[] {
  return reasons.filter(
    (r) => !/^Score\s+\d+/i.test(r.trim()) && !/seuil automatique/i.test(r)
  );
}

/** Pastilles : signaux de correspondance et raisons de non-auto-rapprochement. */
export function ReconciliationSuggestionChips({ candidate }: Props) {
  const matchReasons = withoutScoreReasons(candidate.reasons || []);
  const notAuto = withoutScoreReasons(candidate.notAutoReasons || []);

  if (!matchReasons.length && !notAuto.length) return null;

  return (
    <div className="flex flex-wrap gap-1.5">
      {matchReasons.map((reason, idx) => (
        <span
          key={`m-${idx}`}
          className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-700"
        >
          {reason}
        </span>
      ))}
      {notAuto.map((reason, idx) => (
        <span
          key={`n-${idx}`}
          className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-900 ring-1 ring-amber-200"
          title="Raison de non-rapprochement automatique"
        >
          {reason}
        </span>
      ))}
    </div>
  );
}
