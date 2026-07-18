/**
 * Admin → Content → Founder Page (OWNER ONLY).
 *
 * Structured editor over the `founder_profile` CMS document. The storefront
 * layout is fixed in code, so this screen edits copy, images and list items
 * only — an owner can never break the page design. Edits go to a draft working
 * copy; Publish promotes the draft and stores a restorable revision.
 *
 * Gated by `founder.manage`, which only the owner role holds (permissions.ts);
 * the api.* RPCs independently re-check `role = 'owner'` SQL-side.
 */
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AdminHeader } from "@/components/admin/AdminUI";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  Loader2,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  ExternalLink,
  History,
  Upload,
  ImagePlus,
  Check,
  Undo2,
  Save,
} from "lucide-react";
import { toast } from "sonner";
import {
  loadFounderAdmin,
  saveFounderDraftFn,
  publishFounderFn,
  discardFounderDraftFn,
  loadFounderRevisions,
  restoreFounderRevisionFn,
  listMediaForFounder,
} from "@/lib/founder.api";
import {
  founderContentSchema,
  FOUNDER_ICON_KEYS,
  FOUNDER_ICON_LABELS,
  type FounderContent,
  type FounderIconKey,
  type FounderRevision,
} from "@/lib/founder-shared";
import type { MediaAsset } from "@/lib/media.schema";

export const Route = createFileRoute("/admin/founder")({
  head: () => ({ meta: [{ title: "Founder Page · Nongorr Admin" }] }),
  loader: async () => {
    const res = await loadFounderAdmin();
    return { profile: res.success ? res.profile : null, loadError: res.success ? null : res.error };
  },
  component: FounderAdmin,
});

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("en-GB");
}

/** Deep clone so edits never mutate loader data in place. */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

// ── Small field helpers ──────────────────────────────────────────────────────

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs uppercase tracking-wide text-muted-foreground">{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function SectionCard({
  title,
  description,
  children,
  action,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-soft">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-xl text-foreground">{title}</h3>
          {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        </div>
        {action}
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

function RowShell({
  index,
  count,
  onMove,
  onRemove,
  children,
}: {
  index: number;
  count: number;
  onMove: (to: number) => void;
  onRemove: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-background p-4">
      <div className="mb-3 flex items-center justify-between">
        <Badge variant="outline">#{index + 1}</Badge>
        <div className="flex gap-1">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label="Move up"
            disabled={index === 0}
            onClick={() => onMove(index - 1)}
          >
            <ArrowUp className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label="Move down"
            disabled={index === count - 1}
            onClick={() => onMove(index + 1)}
          >
            <ArrowDown className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label="Remove"
            onClick={onRemove}
            className="text-destructive"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function IconSelect({
  value,
  onChange,
}: {
  value: FounderIconKey;
  onChange: (v: FounderIconKey) => void;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as FounderIconKey)}>
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {FOUNDER_ICON_KEYS.map((k) => (
          <SelectItem key={k} value={k}>
            {FOUNDER_ICON_LABELS[k]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Media-library picker for the two image fields. */
function ImageField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: string | null;
  onChange: (url: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [media, setMedia] = useState<MediaAsset[]>([]);
  const [loading, setLoading] = useState(false);

  const openPicker = async () => {
    setOpen(true);
    setLoading(true);
    const res = await listMediaForFounder();
    setLoading(false);
    if (res.success) setMedia(res.media);
    else toast.error(res.error);
  };

  return (
    <Field label={label} hint={hint}>
      <div className="flex items-start gap-4">
        <div className="grid h-28 w-24 shrink-0 place-items-center overflow-hidden rounded-lg border border-border bg-secondary/40">
          {value ? (
            <img src={value} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="px-2 text-center text-[0.65rem] text-muted-foreground">
              Built-in image
            </span>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <Button type="button" variant="outline" size="sm" onClick={openPicker}>
            <ImagePlus className="h-4 w-4" /> {value ? "Change image" : "Pick from library"}
          </Button>
          {value && (
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
              <Undo2 className="h-4 w-4" /> Use built-in image
            </Button>
          )}
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Choose an image</DialogTitle>
            <DialogDescription>
              Upload new images in the{" "}
              <Link to="/admin/media-library" className="underline">
                Media Library
              </Link>
              .
            </DialogDescription>
          </DialogHeader>
          {loading ? (
            <div className="grid place-items-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : media.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
              <Upload className="mx-auto mb-2 h-5 w-5 text-gold" />
              No media yet.
            </div>
          ) : (
            <div className="grid max-h-[55vh] grid-cols-3 gap-3 overflow-y-auto sm:grid-cols-4">
              {media.map((m) => {
                const selected = m.publicUrl === value;
                return (
                  <button
                    key={m.publicUrl}
                    type="button"
                    onClick={() => {
                      onChange(m.publicUrl);
                      setOpen(false);
                    }}
                    className={`relative aspect-square overflow-hidden rounded-lg border-2 transition-colors ${
                      selected ? "border-primary" : "border-transparent hover:border-gold/50"
                    }`}
                  >
                    <img src={m.publicUrl} alt="" className="h-full w-full object-cover" />
                    {selected && (
                      <span className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-primary text-primary-foreground">
                        <Check className="h-3.5 w-3.5" />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Field>
  );
}

// ── Screen ───────────────────────────────────────────────────────────────────

function FounderAdmin() {
  const { profile, loadError } = Route.useLoaderData();
  const router = useRouter();
  const confirm = useConfirm();

  // The editor always works on the draft when one exists, else the live copy.
  const [content, setContent] = useState<FounderContent | null>(() =>
    profile ? clone(profile.draft ?? profile.content) : null,
  );
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<null | "save" | "publish" | "discard">(null);
  const [revisions, setRevisions] = useState<FounderRevision[] | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  const hasDraft = Boolean(profile?.draft);

  /** Immutable section updater — `set("hero", {...})` style edits. */
  const update = useMemo(
    () =>
      <K extends keyof FounderContent>(key: K, value: FounderContent[K]) => {
        setContent((prev) => (prev ? { ...prev, [key]: value } : prev));
        setDirty(true);
      },
    [],
  );

  if (loadError || !profile || !content) {
    return (
      <div>
        <AdminHeader title="Founder Page" description="Owner-only editor for the /founder page." />
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {loadError ?? "Could not load the founder profile."}
        </div>
      </div>
    );
  }

  const save = async () => {
    const parsed = founderContentSchema.safeParse(content);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Some fields need attention.");
      return;
    }
    setBusy("save");
    const res = await saveFounderDraftFn({ data: { content: parsed.data } });
    setBusy(null);
    if (res.success) {
      toast.success("Draft saved. Publish to make it live.");
      setDirty(false);
      router.invalidate();
    } else {
      toast.error(res.error);
    }
  };

  const publish = () =>
    confirm({
      title: "Publish the founder page?",
      description:
        "The saved draft replaces the live /founder page immediately. The previous version is kept as a restorable revision.",
      confirmText: "Publish",
      onConfirm: async () => {
        setBusy("publish");
        const res = await publishFounderFn();
        setBusy(null);
        if (res.success) {
          toast.success("Founder page published.");
          setDirty(false);
          router.invalidate();
        } else {
          toast.error(res.error);
        }
      },
    });

  const discard = () =>
    confirm({
      tone: "danger",
      title: "Discard the draft?",
      description: "Unpublished changes will be lost and the editor returns to the live copy.",
      confirmText: "Discard",
      icon: <Trash2 className="h-6 w-6" />,
      onConfirm: async () => {
        setBusy("discard");
        const res = await discardFounderDraftFn();
        setBusy(null);
        if (res.success) {
          toast.success("Draft discarded.");
          setContent(clone(profile.content));
          setDirty(false);
          router.invalidate();
        } else {
          toast.error(res.error);
        }
      },
    });

  const openHistory = async () => {
    setHistoryOpen(true);
    if (revisions) return;
    const res = await loadFounderRevisions();
    if (res.success) setRevisions(res.revisions);
    else toast.error(res.error);
  };

  const restore = async (rev: FounderRevision) => {
    const res = await restoreFounderRevisionFn({ data: { revisionId: rev.id } });
    if (res.success) {
      toast.success("Revision loaded into the draft. Review it, then publish.");
      setContent(clone(rev.content));
      setDirty(false);
      setHistoryOpen(false);
      router.invalidate();
    } else {
      toast.error(res.error);
    }
  };

  return (
    <div>
      <AdminHeader
        title="Founder Page"
        description="Owner-only. Edit the copy, images and story sections of the public /founder page. Changes are saved as a draft and go live when you publish."
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" asChild>
              <Link to="/founder" target="_blank">
                <ExternalLink className="h-4 w-4" /> View page
              </Link>
            </Button>
            <Button variant="outline" onClick={openHistory}>
              <History className="h-4 w-4" /> History
            </Button>
            <Button variant="outline" onClick={save} disabled={busy !== null}>
              {busy === "save" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Save draft
            </Button>
            <Button onClick={publish} disabled={busy !== null || (!hasDraft && !dirty)}>
              {busy === "publish" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Publish
            </Button>
          </div>
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
        {hasDraft ? (
          <Badge className="bg-gold text-gold-foreground">Unpublished draft</Badge>
        ) : (
          <Badge variant="outline">Live copy</Badge>
        )}
        {dirty && <span className="text-gold">Unsaved edits in this tab</span>}
        <span>Published {fmtDate(profile.published_at)}</span>
        {hasDraft && (
          <Button variant="ghost" size="sm" onClick={discard} disabled={busy !== null}>
            Discard draft
          </Button>
        )}
      </div>

      <Tabs defaultValue="hero">
        <TabsList className="flex-wrap">
          <TabsTrigger value="hero">Identity &amp; Hero</TabsTrigger>
          <TabsTrigger value="letter">Letter</TabsTrigger>
          <TabsTrigger value="philosophy">Philosophy</TabsTrigger>
          <TabsTrigger value="journey">Journey</TabsTrigger>
          <TabsTrigger value="craft">Craft</TabsTrigger>
          <TabsTrigger value="closing">Quote &amp; Connect</TabsTrigger>
        </TabsList>

        {/* IDENTITY & HERO */}
        <TabsContent value="hero" className="mt-4 space-y-5">
          <SectionCard title="Identity" description="Drives the page heading, SEO and Person data.">
            <Field label="Founder name">
              <Input
                value={content.name}
                onChange={(e) => update("name", e.target.value)}
                maxLength={120}
              />
            </Field>
            <Field label="Role">
              <Input
                value={content.role}
                onChange={(e) => update("role", e.target.value)}
                maxLength={160}
              />
            </Field>
            <Field label="Eyebrow" hint="Small uppercase line above the name.">
              <Input
                value={content.eyebrow}
                onChange={(e) => update("eyebrow", e.target.value)}
                maxLength={80}
              />
            </Field>
          </SectionCard>

          <SectionCard
            title="Search & social"
            description="Used in Google results and link previews."
          >
            <Field label="SEO title">
              <Input
                value={content.seo.title}
                onChange={(e) => update("seo", { ...content.seo, title: e.target.value })}
                maxLength={160}
              />
            </Field>
            <Field label="SEO description">
              <Textarea
                rows={3}
                value={content.seo.description}
                onChange={(e) => update("seo", { ...content.seo, description: e.target.value })}
                maxLength={300}
              />
            </Field>
          </SectionCard>

          <SectionCard title="Hero" description="The opening section of the page.">
            <Field label="Introduction">
              <Textarea
                rows={5}
                value={content.hero.intro}
                onChange={(e) => update("hero", { ...content.hero, intro: e.target.value })}
                maxLength={1200}
              />
            </Field>
            <ImageField
              label="Portrait"
              hint="Portrait orientation works best (4:5). Leave unset to use the built-in photo."
              value={content.hero.portraitUrl}
              onChange={(url) => update("hero", { ...content.hero, portraitUrl: url })}
            />
            <Field label="Portrait alt text" hint="Describes the photo for screen readers.">
              <Input
                value={content.hero.portraitAlt}
                onChange={(e) => update("hero", { ...content.hero, portraitAlt: e.target.value })}
                maxLength={240}
              />
            </Field>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                  Highlight tiles (up to 4)
                </Label>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={content.hero.stats.length >= 4}
                  onClick={() =>
                    update("hero", {
                      ...content.hero,
                      stats: [...content.hero.stats, { label: "Label", value: "Value" }],
                    })
                  }
                >
                  <Plus className="h-4 w-4" /> Add tile
                </Button>
              </div>
              {content.hero.stats.map((s, i) => (
                <RowShell
                  key={i}
                  index={i}
                  count={content.hero.stats.length}
                  onMove={(to) =>
                    update("hero", { ...content.hero, stats: move(content.hero.stats, i, to) })
                  }
                  onRemove={() =>
                    update("hero", {
                      ...content.hero,
                      stats: content.hero.stats.filter((_, j) => j !== i),
                    })
                  }
                >
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Label">
                      <Input
                        value={s.label}
                        maxLength={40}
                        onChange={(e) => {
                          const stats = [...content.hero.stats];
                          stats[i] = { ...s, label: e.target.value };
                          update("hero", { ...content.hero, stats });
                        }}
                      />
                    </Field>
                    <Field label="Value">
                      <Input
                        value={s.value}
                        maxLength={40}
                        onChange={(e) => {
                          const stats = [...content.hero.stats];
                          stats[i] = { ...s, value: e.target.value };
                          update("hero", { ...content.hero, stats });
                        }}
                      />
                    </Field>
                  </div>
                </RowShell>
              ))}
            </div>
          </SectionCard>
        </TabsContent>

        {/* LETTER */}
        <TabsContent value="letter" className="mt-4">
          <SectionCard
            title="In her words"
            description="The signed letter. Each paragraph is a separate block."
            action={
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={content.letter.paragraphs.length >= 8}
                onClick={() =>
                  update("letter", {
                    ...content.letter,
                    paragraphs: [...content.letter.paragraphs, ""],
                  })
                }
              >
                <Plus className="h-4 w-4" /> Add paragraph
              </Button>
            }
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Eyebrow">
                <Input
                  value={content.letter.eyebrow}
                  maxLength={80}
                  onChange={(e) => update("letter", { ...content.letter, eyebrow: e.target.value })}
                />
              </Field>
              <Field label="Title">
                <Input
                  value={content.letter.title}
                  maxLength={160}
                  onChange={(e) => update("letter", { ...content.letter, title: e.target.value })}
                />
              </Field>
            </div>
            {content.letter.paragraphs.map((p, i) => (
              <RowShell
                key={i}
                index={i}
                count={content.letter.paragraphs.length}
                onMove={(to) =>
                  update("letter", {
                    ...content.letter,
                    paragraphs: move(content.letter.paragraphs, i, to),
                  })
                }
                onRemove={() =>
                  update("letter", {
                    ...content.letter,
                    paragraphs: content.letter.paragraphs.filter((_, j) => j !== i),
                  })
                }
              >
                <Textarea
                  rows={4}
                  value={p}
                  maxLength={2000}
                  onChange={(e) => {
                    const paragraphs = [...content.letter.paragraphs];
                    paragraphs[i] = e.target.value;
                    update("letter", { ...content.letter, paragraphs });
                  }}
                />
              </RowShell>
            ))}
          </SectionCard>
        </TabsContent>

        {/* PHILOSOPHY */}
        <TabsContent value="philosophy" className="mt-4">
          <SectionCard
            title="Philosophy"
            description="Principle cards. Up to 6 — four fills the row neatly."
            action={
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={content.philosophy.items.length >= 6}
                onClick={() =>
                  update("philosophy", {
                    ...content.philosophy,
                    items: [
                      ...content.philosophy.items,
                      { icon: "sparkles", title: "New principle", body: "" },
                    ],
                  })
                }
              >
                <Plus className="h-4 w-4" /> Add principle
              </Button>
            }
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Eyebrow">
                <Input
                  value={content.philosophy.eyebrow}
                  maxLength={80}
                  onChange={(e) =>
                    update("philosophy", { ...content.philosophy, eyebrow: e.target.value })
                  }
                />
              </Field>
              <Field label="Title">
                <Input
                  value={content.philosophy.title}
                  maxLength={160}
                  onChange={(e) =>
                    update("philosophy", { ...content.philosophy, title: e.target.value })
                  }
                />
              </Field>
            </div>
            {content.philosophy.items.map((item, i) => (
              <RowShell
                key={i}
                index={i}
                count={content.philosophy.items.length}
                onMove={(to) =>
                  update("philosophy", {
                    ...content.philosophy,
                    items: move(content.philosophy.items, i, to),
                  })
                }
                onRemove={() =>
                  update("philosophy", {
                    ...content.philosophy,
                    items: content.philosophy.items.filter((_, j) => j !== i),
                  })
                }
              >
                <div className="grid gap-3 sm:grid-cols-[200px_1fr]">
                  <Field label="Icon">
                    <IconSelect
                      value={item.icon}
                      onChange={(icon) => {
                        const items = [...content.philosophy.items];
                        items[i] = { ...item, icon };
                        update("philosophy", { ...content.philosophy, items });
                      }}
                    />
                  </Field>
                  <Field label="Title">
                    <Input
                      value={item.title}
                      maxLength={80}
                      onChange={(e) => {
                        const items = [...content.philosophy.items];
                        items[i] = { ...item, title: e.target.value };
                        update("philosophy", { ...content.philosophy, items });
                      }}
                    />
                  </Field>
                </div>
                <Field label="Body">
                  <Textarea
                    rows={3}
                    value={item.body}
                    maxLength={600}
                    onChange={(e) => {
                      const items = [...content.philosophy.items];
                      items[i] = { ...item, body: e.target.value };
                      update("philosophy", { ...content.philosophy, items });
                    }}
                  />
                </Field>
              </RowShell>
            ))}
          </SectionCard>
        </TabsContent>

        {/* JOURNEY */}
        <TabsContent value="journey" className="mt-4">
          <SectionCard
            title="Journey timeline"
            description="Chapters shown down the gold timeline. Up to 8."
            action={
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={content.journey.items.length >= 8}
                onClick={() =>
                  update("journey", {
                    ...content.journey,
                    items: [
                      ...content.journey.items,
                      { icon: "sparkles", chapter: "New chapter", title: "", body: "" },
                    ],
                  })
                }
              >
                <Plus className="h-4 w-4" /> Add chapter
              </Button>
            }
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Eyebrow">
                <Input
                  value={content.journey.eyebrow}
                  maxLength={80}
                  onChange={(e) =>
                    update("journey", { ...content.journey, eyebrow: e.target.value })
                  }
                />
              </Field>
              <Field label="Title">
                <Input
                  value={content.journey.title}
                  maxLength={160}
                  onChange={(e) => update("journey", { ...content.journey, title: e.target.value })}
                />
              </Field>
            </div>
            {content.journey.items.map((item, i) => (
              <RowShell
                key={i}
                index={i}
                count={content.journey.items.length}
                onMove={(to) =>
                  update("journey", {
                    ...content.journey,
                    items: move(content.journey.items, i, to),
                  })
                }
                onRemove={() =>
                  update("journey", {
                    ...content.journey,
                    items: content.journey.items.filter((_, j) => j !== i),
                  })
                }
              >
                <div className="grid gap-3 sm:grid-cols-[200px_1fr_1fr]">
                  <Field label="Icon">
                    <IconSelect
                      value={item.icon}
                      onChange={(icon) => {
                        const items = [...content.journey.items];
                        items[i] = { ...item, icon };
                        update("journey", { ...content.journey, items });
                      }}
                    />
                  </Field>
                  <Field label="Chapter label">
                    <Input
                      value={item.chapter}
                      maxLength={60}
                      onChange={(e) => {
                        const items = [...content.journey.items];
                        items[i] = { ...item, chapter: e.target.value };
                        update("journey", { ...content.journey, items });
                      }}
                    />
                  </Field>
                  <Field label="Title">
                    <Input
                      value={item.title}
                      maxLength={120}
                      onChange={(e) => {
                        const items = [...content.journey.items];
                        items[i] = { ...item, title: e.target.value };
                        update("journey", { ...content.journey, items });
                      }}
                    />
                  </Field>
                </div>
                <Field label="Body">
                  <Textarea
                    rows={3}
                    value={item.body}
                    maxLength={1000}
                    onChange={(e) => {
                      const items = [...content.journey.items];
                      items[i] = { ...item, body: e.target.value };
                      update("journey", { ...content.journey, items });
                    }}
                  />
                </Field>
              </RowShell>
            ))}
          </SectionCard>
        </TabsContent>

        {/* CRAFT */}
        <TabsContent value="craft" className="mt-4">
          <SectionCard
            title="Her craft"
            description="Lifestyle image, supporting copy and the checklist beside it."
            action={
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={content.craft.details.length >= 10}
                onClick={() =>
                  update("craft", { ...content.craft, details: [...content.craft.details, ""] })
                }
              >
                <Plus className="h-4 w-4" /> Add detail
              </Button>
            }
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Eyebrow">
                <Input
                  value={content.craft.eyebrow}
                  maxLength={80}
                  onChange={(e) => update("craft", { ...content.craft, eyebrow: e.target.value })}
                />
              </Field>
              <Field label="Title">
                <Input
                  value={content.craft.title}
                  maxLength={160}
                  onChange={(e) => update("craft", { ...content.craft, title: e.target.value })}
                />
              </Field>
            </div>
            <Field label="Body">
              <Textarea
                rows={4}
                value={content.craft.body}
                maxLength={1200}
                onChange={(e) => update("craft", { ...content.craft, body: e.target.value })}
              />
            </Field>
            <ImageField
              label="Lifestyle image"
              hint="Portrait orientation (4:5). Leave unset to use the built-in photo."
              value={content.craft.imageUrl}
              onChange={(url) => update("craft", { ...content.craft, imageUrl: url })}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Image alt text">
                <Input
                  value={content.craft.imageAlt}
                  maxLength={240}
                  onChange={(e) => update("craft", { ...content.craft, imageAlt: e.target.value })}
                />
              </Field>
              <Field label="Caption" hint="Shown in italics under the image.">
                <Input
                  value={content.craft.imageCaption}
                  maxLength={240}
                  onChange={(e) =>
                    update("craft", { ...content.craft, imageCaption: e.target.value })
                  }
                />
              </Field>
            </div>
            {content.craft.details.map((d, i) => (
              <RowShell
                key={i}
                index={i}
                count={content.craft.details.length}
                onMove={(to) =>
                  update("craft", { ...content.craft, details: move(content.craft.details, i, to) })
                }
                onRemove={() =>
                  update("craft", {
                    ...content.craft,
                    details: content.craft.details.filter((_, j) => j !== i),
                  })
                }
              >
                <Input
                  value={d}
                  maxLength={160}
                  onChange={(e) => {
                    const details = [...content.craft.details];
                    details[i] = e.target.value;
                    update("craft", { ...content.craft, details });
                  }}
                />
              </RowShell>
            ))}
          </SectionCard>
        </TabsContent>

        {/* QUOTE & CONNECT */}
        <TabsContent value="closing" className="mt-4 space-y-5">
          <SectionCard title="Signature quote" description="The large centred quote near the end.">
            <Field label="Quote">
              <Textarea
                rows={3}
                value={content.quote.text}
                maxLength={400}
                onChange={(e) => update("quote", { ...content.quote, text: e.target.value })}
              />
            </Field>
            <Field label="Attribution">
              <Input
                value={content.quote.attribution}
                maxLength={120}
                onChange={(e) => update("quote", { ...content.quote, attribution: e.target.value })}
              />
            </Field>
          </SectionCard>

          <SectionCard title="Connect" description="The closing maroon call-to-action band.">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Eyebrow">
                <Input
                  value={content.connect.eyebrow}
                  maxLength={80}
                  onChange={(e) =>
                    update("connect", { ...content.connect, eyebrow: e.target.value })
                  }
                />
              </Field>
              <Field label="Title">
                <Input
                  value={content.connect.title}
                  maxLength={160}
                  onChange={(e) => update("connect", { ...content.connect, title: e.target.value })}
                />
              </Field>
            </div>
            <Field label="Body">
              <Textarea
                rows={3}
                value={content.connect.body}
                maxLength={600}
                onChange={(e) => update("connect", { ...content.connect, body: e.target.value })}
              />
            </Field>
            <Field
              label="Pre-filled WhatsApp message"
              hint="What the customer's message says when they tap Chat on WhatsApp."
            >
              <Input
                value={content.connect.whatsappMessage}
                maxLength={300}
                onChange={(e) =>
                  update("connect", { ...content.connect, whatsappMessage: e.target.value })
                }
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Founder's Facebook"
                hint="Her personal profile. Leave empty to link the Nongorr page instead."
              >
                <Input
                  value={content.connect.facebookUrl ?? ""}
                  maxLength={600}
                  placeholder="https://www.facebook.com/…"
                  onChange={(e) =>
                    update("connect", {
                      ...content.connect,
                      facebookUrl: e.target.value.trim() === "" ? null : e.target.value,
                    })
                  }
                />
              </Field>
              <Field
                label="Founder's Instagram"
                hint="Her personal profile. Leave empty to link the Nongorr account instead."
              >
                <Input
                  value={content.connect.instagramUrl ?? ""}
                  maxLength={600}
                  placeholder="https://www.instagram.com/…"
                  onChange={(e) =>
                    update("connect", {
                      ...content.connect,
                      instagramUrl: e.target.value.trim() === "" ? null : e.target.value,
                    })
                  }
                />
              </Field>
            </div>
          </SectionCard>
        </TabsContent>
      </Tabs>

      {/* HISTORY */}
      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Publish history</DialogTitle>
            <DialogDescription>
              The last 20 published versions. Restoring loads a version into the draft — review it,
              then publish.
            </DialogDescription>
          </DialogHeader>
          {revisions === null ? (
            <div className="grid place-items-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : revisions.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No revisions yet.</p>
          ) : (
            <ul className="max-h-[55vh] space-y-2 overflow-y-auto">
              {revisions.map((r) => (
                <li
                  key={r.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border p-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm text-foreground">{r.content.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {fmtDate(r.published_at)}
                      {r.published_by_email ? ` · ${r.published_by_email}` : ""}
                    </p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => restore(r)}>
                    Restore
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setHistoryOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
