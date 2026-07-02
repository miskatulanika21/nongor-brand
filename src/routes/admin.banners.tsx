import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AdminHeader } from "@/components/admin/AdminUI";
import heroImg from "@/assets/hero.webp";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { Plus, Pencil, Monitor, Smartphone } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/banners")({ component: Banners });

// TODO: persist banners via backend; schedule activation by active dates server-side.

interface Banner {
  id: string;
  title: string;
  subtitle: string;
  ctaText: string;
  ctaUrl: string;
  bgType: "image" | "maroon" | "gold";
  placement: "home-hero" | "home-strip" | "shop-top";
  startDate: string;
  endDate: string;
  active: boolean;
}

const SEED: Banner[] = [
  {
    id: "1",
    title: "Festive Eid Collection",
    subtitle: "Handcrafted kurtis & sarees, made for celebration",
    ctaText: "Shop now",
    ctaUrl: "/shop",
    bgType: "image",
    placement: "home-hero",
    startDate: "2026-06-01",
    endDate: "2026-07-15",
    active: true,
  },
  {
    id: "2",
    title: "Free Delivery over ৳3000",
    subtitle: "Across Bangladesh, limited time",
    ctaText: "Learn more",
    ctaUrl: "/delivery-policy",
    bgType: "gold",
    placement: "home-strip",
    startDate: "2026-06-10",
    endDate: "2026-06-30",
    active: false,
  },
];

const PLACEMENTS: Record<Banner["placement"], string> = {
  "home-hero": "Home hero",
  "home-strip": "Home strip",
  "shop-top": "Shop top",
};

function bgClass(t: Banner["bgType"]) {
  if (t === "maroon") return "bg-primary text-primary-foreground";
  if (t === "gold") return "bg-gradient-gold text-gold-foreground";
  return "text-white";
}

function Banners() {
  const [banners, setBanners] = useState<Banner[]>(SEED);
  const [editing, setEditing] = useState<Banner | null>(null);
  const [open, setOpen] = useState(false);

  const save = (b: Banner) => {
    setBanners((prev) =>
      prev.some((p) => p.id === b.id) ? prev.map((p) => (p.id === b.id ? b : p)) : [...prev, b],
    );
    setOpen(false);
    toast.success(editing ? "Banner updated (demo)" : "Banner created (demo)");
  };

  return (
    <div>
      <AdminHeader
        title="Banners"
        description="Manage homepage hero & promo banners."
        action={
          <Button
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            <Plus className="h-4 w-4" /> Add banner
          </Button>
        }
      />
      <div className="grid gap-4 sm:grid-cols-2">
        {banners.map((b) => (
          <div key={b.id} className="overflow-hidden rounded-xl border border-border bg-card">
            <BannerPreview banner={b} compact />
            <div className="flex items-center justify-between p-4">
              <div>
                <p className="font-medium text-foreground">{b.title}</p>
                <p className="text-xs text-muted-foreground">
                  {PLACEMENTS[b.placement]} · {b.startDate} → {b.endDate}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge
                  variant="outline"
                  className={
                    b.active
                      ? "border-success/40 text-success"
                      : "border-border text-muted-foreground"
                  }
                >
                  {b.active ? "Live" : "Draft"}
                </Badge>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setEditing(b);
                    setOpen(true);
                  }}
                >
                  <Pencil className="h-3.5 w-3.5" /> Edit
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <BannerDialog open={open} onOpenChange={setOpen} editing={editing} onSave={save} />
    </div>
  );
}

function BannerPreview({
  banner,
  compact,
  device = "desktop",
}: {
  banner: Banner;
  compact?: boolean;
  device?: "desktop" | "mobile";
}) {
  return (
    <div
      className={cn(
        "relative grid place-items-center overflow-hidden",
        bgClass(banner.bgType),
        compact ? "h-40" : device === "mobile" ? "h-72" : "h-56",
      )}
    >
      {banner.bgType === "image" && (
        <>
          <img src={heroImg} alt="" className="absolute inset-0 h-full w-full object-cover" />
          <div className="absolute inset-0 bg-black/40" />
        </>
      )}
      <div
        className={cn(
          "relative z-10 px-6 text-center",
          device === "mobile" ? "max-w-[220px]" : "max-w-md",
        )}
      >
        <h3
          className={cn("font-display font-semibold", device === "mobile" ? "text-xl" : "text-2xl")}
        >
          {banner.title || "Banner title"}
        </h3>
        <p className={cn("mt-1 opacity-90", device === "mobile" ? "text-xs" : "text-sm")}>
          {banner.subtitle || "Banner subtitle"}
        </p>
        {banner.ctaText && (
          <span className="mt-3 inline-block rounded-full bg-white/90 px-4 py-1.5 text-xs font-medium text-primary">
            {banner.ctaText}
          </span>
        )}
      </div>
    </div>
  );
}

function BannerDialog({
  open,
  onOpenChange,
  editing,
  onSave,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  editing: Banner | null;
  onSave: (b: Banner) => void;
}) {
  const [draft, setDraft] = useState<Banner>(
    editing ?? {
      id: "",
      title: "",
      subtitle: "",
      ctaText: "",
      ctaUrl: "",
      bgType: "image",
      placement: "home-hero",
      startDate: "",
      endDate: "",
      active: true,
    },
  );
  // re-seed when opening with a different banner
  const [lastId, setLastId] = useState<string | null>(null);
  if (open && editing && editing.id !== lastId) {
    setDraft(editing);
    setLastId(editing.id);
  }
  if (open && !editing && lastId !== "") {
    setDraft({
      id: "",
      title: "",
      subtitle: "",
      ctaText: "",
      ctaUrl: "",
      bgType: "image",
      placement: "home-hero",
      startDate: "",
      endDate: "",
      active: true,
    });
    setLastId("");
  }

  const set = (patch: Partial<Banner>) => setDraft((d) => ({ ...d, ...patch }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit banner" : "Add banner"}</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="desktop">
          <TabsList>
            <TabsTrigger value="desktop">
              <Monitor className="h-4 w-4" /> Desktop
            </TabsTrigger>
            <TabsTrigger value="mobile">
              <Smartphone className="h-4 w-4" /> Mobile
            </TabsTrigger>
          </TabsList>
          <TabsContent value="desktop">
            <div className="overflow-hidden rounded-lg border border-border">
              <BannerPreview banner={draft} />
            </div>
          </TabsContent>
          <TabsContent value="mobile">
            <div className="mx-auto w-64 overflow-hidden rounded-lg border border-border">
              <BannerPreview banner={draft} device="mobile" />
            </div>
          </TabsContent>
        </Tabs>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Title</Label>
            <Input value={draft.title} onChange={(e) => set({ title: e.target.value })} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Subtitle</Label>
            <Input value={draft.subtitle} onChange={(e) => set({ subtitle: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>CTA text</Label>
            <Input value={draft.ctaText} onChange={(e) => set({ ctaText: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>CTA URL</Label>
            <Input
              value={draft.ctaUrl}
              onChange={(e) => set({ ctaUrl: e.target.value })}
              placeholder="/shop"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Background type</Label>
            <Select
              value={draft.bgType}
              onValueChange={(v) => set({ bgType: v as Banner["bgType"] })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="image">Image</SelectItem>
                <SelectItem value="maroon">Maroon solid</SelectItem>
                <SelectItem value="gold">Gold gradient</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Placement</Label>
            <Select
              value={draft.placement}
              onValueChange={(v) => set({ placement: v as Banner["placement"] })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(PLACEMENTS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Active from</Label>
            <Input
              type="date"
              value={draft.startDate}
              onChange={(e) => set({ startDate: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Active until</Label>
            <Input
              type="date"
              value={draft.endDate}
              onChange={(e) => set({ endDate: e.target.value })}
            />
          </div>
          <label className="flex items-center justify-between rounded-lg border border-border p-3 sm:col-span-2">
            <span className="text-sm text-foreground">Active</span>
            <Switch checked={draft.active} onCheckedChange={(v) => set({ active: v })} />
          </label>
        </div>

        <DialogFooter>
          <Button onClick={() => onSave({ ...draft, id: draft.id || String(Date.now()) })}>
            {editing ? "Save changes" : "Create banner"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
