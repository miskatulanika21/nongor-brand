import { createFileRoute, Link } from "@tanstack/react-router";
import { AdminHeader } from "@/components/admin/AdminUI";
import { Button } from "@/components/ui/button";
import { FileText } from "lucide-react";

export const Route = createFileRoute("/admin/policies")({ component: Policies });

const POLICIES = [
  { name: "Delivery Policy", to: "/delivery-policy" },
  { name: "Return Policy", to: "/return-policy" },
  { name: "Custom Size Policy", to: "/custom-size-policy" },
  { name: "Privacy Policy", to: "/privacy-policy" },
  { name: "Terms & Conditions", to: "/terms" },
];

function Policies() {
  return (
    <div>
      <AdminHeader title="Policies" description="Edit the storefront policy pages." />
      <div className="space-y-2">
        {POLICIES.map((p) => (
          <div
            key={p.name}
            className="flex items-center justify-between rounded-xl border border-border bg-card p-4"
          >
            <span className="flex items-center gap-2 font-medium text-foreground">
              <FileText className="h-4 w-4 text-gold" />
              {p.name}
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" asChild>
                <Link to={p.to}>Preview</Link>
              </Button>
              <Button size="sm">Edit</Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
