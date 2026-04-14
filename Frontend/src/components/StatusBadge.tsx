import { cn } from "@/lib/utils";

type StatusType = "à payer" | "payée" | "encaissée" | "en retard" | "non_rapproché" | "partiel" | "rapproché" | "rapprochée" | "non_rapprochée";

const statusConfig: Record<StatusType, { label: string; className: string }> = {
  "à payer": { label: "À payer", className: "bg-warning/10 text-warning border-warning/20" },
  "payée": { label: "Payée", className: "bg-success/10 text-success border-success/20" },
  "encaissée": { label: "Encaissée", className: "bg-success/10 text-success border-success/20" },
  "en retard": { label: "En retard", className: "bg-destructive/10 text-destructive border-destructive/20" },
  "non_rapproché": { label: "Non rapproché", className: "bg-muted text-muted-foreground border-border" },
  "non_rapprochée": { label: "Non rapprochée", className: "bg-muted text-muted-foreground border-border" },
  "partiel": { label: "Partiel", className: "bg-warning/10 text-warning border-warning/20" },
  "rapproché": { label: "Rapproché", className: "bg-success/10 text-success border-success/20" },
  "rapprochée": { label: "Rapprochée", className: "bg-primary/10 text-primary border-primary/20" },
};

export function StatusBadge({ status }: { status: StatusType }) {
  const config = statusConfig[status] || { label: status, className: "bg-muted text-muted-foreground" };
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium", config.className)}>
      {config.label}
    </span>
  );
}
