import { createFileRoute } from "@tanstack/react-router";
import { TrendingUp } from "lucide-react";
import { ComingSoon } from "@/components/admin/AdminUI";

export const Route = createFileRoute("/admin/reports")({
  head: () => ({ meta: [{ title: "Reports · Nongorr Admin" }] }),
  component: Reports,
});

function Reports() {
  return (
    <ComingSoon
      title="Reports"
      icon={<TrendingUp className="h-7 w-7" />}
      description="Business reports aren't built yet. The earlier charts were demo numbers, so this is parked to avoid showing figures you might act on. Real reports (off live orders) come in a later stage."
    />
  );
}
