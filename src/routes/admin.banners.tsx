import { createFileRoute } from "@tanstack/react-router";
import { Images } from "lucide-react";
import { ComingSoon } from "@/components/admin/AdminUI";

export const Route = createFileRoute("/admin/banners")({
  head: () => ({ meta: [{ title: "Banners · Nongorr Admin" }] }),
  component: Banners,
});

function Banners() {
  return (
    <ComingSoon
      title="Banners"
      icon={<Images className="h-7 w-7" />}
      description="Homepage banner management isn't built yet. It's parked here so the admin never shows banners that aren't really published — it will ship in a later stage."
    />
  );
}
