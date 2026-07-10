import { createFileRoute } from "@tanstack/react-router";
import { Ruler } from "lucide-react";
import { ComingSoon } from "@/components/admin/AdminUI";

export const Route = createFileRoute("/admin/size-settings")({
  head: () => ({ meta: [{ title: "Size Settings · Nongorr Admin" }] }),
  component: SizeSettings,
});

function SizeSettings() {
  return (
    <ComingSoon
      title="Size Settings"
      icon={<Ruler className="h-7 w-7" />}
      description="Configurable size charts aren't built yet — the earlier fields didn't save. It's parked here so nothing looks editable when it isn't. The public size guide still works today."
    />
  );
}
