import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { AdminHeader } from "@/components/admin/AdminUI";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { ImageFramer } from "@/components/admin/ImageFramer";
import { Images, Plus, Pencil, Trash2, Loader2, Star, ImagePlus, Check } from "lucide-react";
import { toast } from "sonner";
import {
  loadBanners,
  saveBanner,
  setBannerActiveFn,
  deleteBannerFn,
  listMediaForBanners,
} from "@/lib/banners.api";
import { bannerInputSchema, type AdminBanner } from "@/lib/banners-shared";
import type { MediaAsset } from "@/lib/media.schema";

export const Route = createFileRoute("/admin/banners")({
  head: () => ({ meta: [{ title: "Banners · Nongorr Admin" }] }),
  loader: async () => {
    const res = await loadBanners();
    return { banners: res.success ? res.banners : [], loadError: !res.success };
  },
  component: Banners,
});

function fmtDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("en-GB");
}

function Banners() {
  const { banners, loadError } = Route.useLoaderData();
  const router = useRouter();
  const [editing, setEditing] = useState<AdminBanner | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const confirm = useConfirm();
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = () => router.invalidate();

  // The lowest-sorted live banner is the one the storefront hero renders.
  const heroId = banners.find((b) => b.live)?.id ?? null;

  const openNew = () => {
    setEditing(null);
    setDialogOpen(true);
  };
  const openEdit = (b: AdminBanner) => {
    setEditing(b);
    setDialogOpen(true);
  };

  const toggle = async (b: AdminBanner) => {
    setBusyId(b.id);
    const res = await setBannerActiveFn({ data: { id: b.id, active: !b.is_active } });
    setBusyId(null);
    if (res.success) {
      toast.success(`Banner ${b.is_active ? "disabled" : "enabled"}.`);
      refresh();
    } else {
      toast.error(res.error);
    }
  };

  const askDelete = (b: AdminBanner) =>
    confirm({
      tone: "danger",
      title: "Delete this banner?",
      description: `"${b.title}" will be removed permanently. The homepage falls back to the built-in hero when no banner is live.`,
      confirmText: "Delete",
      icon: <Trash2 className="h-6 w-6" />,
      onConfirm: async () => {
        setBusyId(b.id);
        const res = await deleteBannerFn({ data: { id: b.id } });
        setBusyId(null);
        if (res.success) {
          toast.success("Banner deleted.");
          refresh();
        } else {
          toast.error(res.error);
        }
      },
    });

  return (
    <div>
      <AdminHeader
        title="Banners"
        description="The lowest-sorted live banner becomes the homepage hero. With no live banner, the storefront shows the built-in hero."
        action={
          <Button onClick={openNew}>
            <Plus className="h-4 w-4" /> New banner
          </Button>
        }
      />

      {loadError && (
        <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          Could not load banners. Refresh to try again.
        </div>
      )}

      {banners.length === 0 && !loadError ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center text-muted-foreground">
          <Images className="mx-auto mb-2 h-6 w-6 text-gold" />
          No banners yet. The homepage is showing the built-in hero.
        </div>
      ) : (
        <div className="space-y-3">
          {banners.map((b) => {
            const start = fmtDate(b.starts_at);
            const end = fmtDate(b.ends_at);
            const scheduled = b.is_active && !b.live;
            return (
              <div
                key={b.id}
                className="flex items-stretch gap-4 rounded-xl border border-border bg-card p-3"
              >
                <div className="relative h-24 w-32 shrink-0 overflow-hidden rounded-lg border border-border sm:w-40">
                  <img
                    src={b.image_url}
                    alt={b.image_alt ?? b.title}
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                </div>
                <div className="min-w-0 flex-1 py-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-display text-lg text-foreground">{b.title}</span>
                    {b.id === heroId && (
                      <Badge className="gap-1 bg-gold/15 text-primary hover:bg-gold/15">
                        <Star className="h-3 w-3" /> Hero
                      </Badge>
                    )}
                    <Badge
                      variant="outline"
                      className={
                        b.live
                          ? "border-success/40 text-success"
                          : scheduled
                            ? "border-gold/40 text-gold"
                            : "border-border text-muted-foreground"
                      }
                    >
                      {b.live ? "Live" : scheduled ? "Scheduled" : "Inactive"}
                    </Badge>
                  </div>
                  {b.subtitle && (
                    <p className="mt-0.5 truncate text-sm text-muted-foreground">{b.subtitle}</p>
                  )}
                  <p className="mt-1 text-xs text-muted-foreground">
                    Sort {b.sort_order}
                    {b.cta_label ? ` · ${b.cta_label} → ${b.cta_to}` : ""}
                    {start ? ` · from ${start}` : ""}
                    {end ? ` · until ${end}` : ""}
                  </p>
                  <div className="mt-2 flex items-center justify-between">
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(b)}>
                        <Pencil className="h-3.5 w-3.5" /> Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        onClick={() => askDelete(b)}
                        disabled={busyId === b.id}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    <div className="flex items-center gap-2">
                      {busyId === b.id && <Loader2 className="h-4 w-4 animate-spin text-gold" />}
                      <Switch
                        checked={b.is_active}
                        disabled={busyId === b.id}
                        onCheckedChange={() => toggle(b)}
                        aria-label={b.is_active ? "Disable banner" : "Enable banner"}
                      />
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <BannerDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
        onSaved={() => {
          setDialogOpen(false);
          refresh();
        }}
      />
    </div>
  );
}

interface FormState {
  eyebrow: string;
  title: string;
  subtitle: string;
  cta_label: string;
  cta_to: string;
  image_url: string;
  image_alt: string;
  card_title: string;
  card_subtitle: string;
  focal_x: number;
  focal_y: number;
  sort_order: string;
  is_active: boolean;
  starts_at: string;
  ends_at: string;
}

function toForm(b: AdminBanner | null): FormState {
  return {
    eyebrow: b?.eyebrow ?? "",
    title: b?.title ?? "",
    subtitle: b?.subtitle ?? "",
    cta_label: b?.cta_label ?? "",
    cta_to: b?.cta_to ?? "",
    image_url: b?.image_url ?? "",
    image_alt: b?.image_alt ?? "",
    card_title: b?.card_title ?? "",
    card_subtitle: b?.card_subtitle ?? "",
    focal_x: b?.focal_x ?? 0.5,
    focal_y: b?.focal_y ?? 0.5,
    sort_order: b ? String(b.sort_order) : "0",
    is_active: b?.is_active ?? false,
    starts_at: b?.starts_at ? b.starts_at.slice(0, 10) : "",
    ends_at: b?.ends_at ? b.ends_at.slice(0, 10) : "",
  };
}

function BannerDialog({
  open,
  onOpenChange,
  editing,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  editing: AdminBanner | null;
  onSaved: () => void;
}) {
  // Reset the form each time the dialog opens (key on id + open).
  const [form, setForm] = useState<FormState>(() => toForm(editing));
  const [formKey, setFormKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [library, setLibrary] = useState<MediaAsset[] | null>(null);
  const [loadingLib, setLoadingLib] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const key = `${open}:${editing?.id ?? "new"}`;
  if (key !== formKey) {
    setFormKey(key);
    setForm(toForm(editing));
    setPickerOpen(false);
  }

  const openPicker = async () => {
    setPickerOpen((v) => !v);
    if (library || loadingLib) return;
    setLoadingLib(true);
    const res = await listMediaForBanners();
    setLibrary(res.success ? res.media : []);
    setLoadingLib(false);
  };

  const submit = async () => {
    const payload = {
      id: editing?.id,
      eyebrow: form.eyebrow.trim() === "" ? null : form.eyebrow,
      title: form.title,
      subtitle: form.subtitle.trim() === "" ? null : form.subtitle,
      cta_label: form.cta_label.trim() === "" ? null : form.cta_label,
      cta_to: form.cta_to.trim() === "" ? null : form.cta_to,
      image_url: form.image_url,
      image_alt: form.image_alt.trim() === "" ? null : form.image_alt,
      card_title: form.card_title.trim() === "" ? null : form.card_title,
      card_subtitle: form.card_subtitle.trim() === "" ? null : form.card_subtitle,
      focal_x: form.focal_x,
      focal_y: form.focal_y,
      sort_order: Number(form.sort_order || 0),
      is_active: form.is_active,
      starts_at: form.starts_at || null,
      ends_at: form.ends_at || null,
    };

    // Client-side validation for immediate field feedback (server re-validates).
    const parsed = bannerInputSchema.safeParse(payload);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Please check the banner fields.");
      return;
    }

    setSaving(true);
    const res = await saveBanner({ data: parsed.data });
    setSaving(false);
    if (res.success) {
      toast.success(res.created ? "Banner created." : "Banner updated.");
      onSaved();
    } else {
      toast.error(res.error);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit banner" : "New banner"}</DialogTitle>
          <DialogDescription>
            The banner replaces the homepage hero's copy and image while it is live.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Headline</Label>
            <Input
              value={form.title}
              onChange={(e) => set("title", e.target.value)}
              placeholder="Eid Collection 2026 — now live"
              maxLength={120}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Eyebrow (optional)</Label>
            <Input
              value={form.eyebrow}
              onChange={(e) => set("eyebrow", e.target.value)}
              placeholder="Festive Edit"
              maxLength={80}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Sort (lowest live banner is the hero)</Label>
            <Input
              type="number"
              min={0}
              max={1000}
              value={form.sort_order}
              onChange={(e) => set("sort_order", e.target.value)}
            />
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <Label>Description (optional)</Label>
            <Input
              value={form.subtitle}
              onChange={(e) => set("subtitle", e.target.value)}
              placeholder="Handcrafted kurti and saree for the season."
              maxLength={300}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Button label (optional)</Label>
            <Input
              value={form.cta_label}
              onChange={(e) => set("cta_label", e.target.value)}
              placeholder="Shop the Edit"
              maxLength={60}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Button destination</Label>
            <Input
              value={form.cta_to}
              onChange={(e) => set("cta_to", e.target.value)}
              placeholder="/shop?filter=new-arrivals"
              maxLength={300}
            />
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <Label>Image (from the media library)</Label>
            <div className="flex items-start gap-3">
              {form.image_url ? (
                <img
                  src={form.image_url}
                  alt={form.image_alt || "Banner image"}
                  className="h-24 w-20 rounded-lg border border-border object-cover"
                />
              ) : (
                <div className="grid h-24 w-20 place-items-center rounded-lg border border-dashed border-border text-muted-foreground">
                  <Images className="h-5 w-5" />
                </div>
              )}
              <div className="flex-1 space-y-1.5">
                <Button type="button" variant="outline" size="sm" onClick={openPicker}>
                  <ImagePlus className="h-4 w-4" />
                  {form.image_url ? "Change image" : "Pick from library"}
                </Button>
                <Input
                  value={form.image_alt}
                  onChange={(e) => set("image_alt", e.target.value)}
                  placeholder="Image description for accessibility"
                  maxLength={300}
                />
              </div>
            </div>
            {pickerOpen && (
              <div className="rounded-lg border border-border p-2">
                {loadingLib ? (
                  <p className="p-2 text-xs text-muted-foreground">Loading media…</p>
                ) : library && library.length > 0 ? (
                  <div className="grid max-h-48 grid-cols-4 gap-2 overflow-y-auto sm:grid-cols-6">
                    {library.map((m) => {
                      const selected = m.publicUrl === form.image_url;
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => {
                            set("image_url", m.publicUrl);
                            setPickerOpen(false);
                          }}
                          className={`relative aspect-square overflow-hidden rounded-md border ${
                            selected ? "border-gold ring-2 ring-gold/40" : "border-border"
                          }`}
                          title={m.fileName}
                        >
                          <img
                            src={m.publicUrl}
                            alt={m.fileName}
                            loading="lazy"
                            className="h-full w-full object-cover"
                          />
                          {selected && (
                            <span className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-gold text-primary-foreground">
                              <Check className="h-3 w-3" />
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="p-2 text-xs text-muted-foreground">
                    No media yet. Upload images in the Media Library first.
                  </p>
                )}
              </div>
            )}

            {form.image_url && (
              <div className="mt-3 rounded-xl border border-border bg-muted/30 p-3">
                <ImageFramer
                  src={form.image_url}
                  focalX={form.focal_x}
                  focalY={form.focal_y}
                  onChange={({ x, y }) => setForm((f) => ({ ...f, focal_x: x, focal_y: y }))}
                  preview={{
                    eyebrow: form.eyebrow,
                    title: form.title,
                    subtitle: form.subtitle,
                    cardTitle: form.card_title,
                    cardSubtitle: form.card_subtitle,
                  }}
                />
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Image card title (optional)</Label>
            <Input
              value={form.card_title}
              onChange={(e) => set("card_title", e.target.value)}
              placeholder="Maroon Handloom Kurti"
              maxLength={120}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Image card caption (optional)</Label>
            <Input
              value={form.card_subtitle}
              onChange={(e) => set("card_subtitle", e.target.value)}
              placeholder="Embroidered · Custom-size ready"
              maxLength={160}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Starts (optional)</Label>
            <Input
              type="date"
              value={form.starts_at}
              onChange={(e) => set("starts_at", e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Ends (optional)</Label>
            <Input
              type="date"
              value={form.ends_at}
              onChange={(e) => set("ends_at", e.target.value)}
            />
          </div>

          <label className="flex items-center justify-between rounded-lg border border-border p-3 sm:col-span-2">
            <span className="text-sm text-foreground">Active</span>
            <Switch checked={form.is_active} onCheckedChange={(v) => set("is_active", v)} />
          </label>
        </div>

        <DialogFooter>
          <Button onClick={submit} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {editing ? "Save changes" : "Create banner"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
