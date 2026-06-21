import { createFileRoute } from "@tanstack/react-router";
import { AdminHeader } from "@/components/admin/AdminUI";

export const Route = createFileRoute("/admin/audit")({ component: Audit });

const LOGS = [
  { who: "Ayesha", what: "Verified payment for NGR-100231", when: "2026-06-14 10:21" },
  { who: "Farzana", what: "Added product 'Ivory Chikankari Kurti'", when: "2026-06-14 09:05" },
  {
    who: "Rina",
    what: "Updated courier status for NGR-100250 → Delivered",
    when: "2026-06-13 17:42",
  },
  { who: "Ayesha", what: "Created coupon EID2026", when: "2026-06-12 14:10" },
  { who: "Farzana", what: "Rejected payment for NGR-100199", when: "2026-06-11 11:33" },
];

function Audit() {
  return (
    <div>
      <AdminHeader title="Audit Logs" description="Every important action, tracked." />
      <div className="rounded-xl border border-border bg-card">
        {LOGS.map((l, i) => (
          <div key={i} className="flex items-center gap-4 border-b border-border p-4 last:border-0">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-secondary text-sm font-semibold text-primary">
              {l.who[0]}
            </div>
            <div className="flex-1">
              <p className="text-sm text-foreground">
                <strong>{l.who}</strong> {l.what}
              </p>
            </div>
            <span className="shrink-0 text-xs text-muted-foreground">{l.when}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
