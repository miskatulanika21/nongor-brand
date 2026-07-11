import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { AdminHeader } from "@/components/admin/AdminUI";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Prose } from "@/components/PageHero";
import { Markdown } from "@/components/Markdown";
import { FileText, Lock, Pencil, Loader2, History, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import {
  loadSitePages,
  loadSitePageAdmin,
  saveSitePageDraftFn,
  publishSitePageFn,
  discardSitePageDraftFn,
  loadSitePageRevisions,
  restoreSitePageRevisionFn,
} from "@/lib/pages.api";
import {
  pageDraftSchema,
  type AdminSitePage,
  type AdminSitePageSummary,
  type CmsPageSlug,
  type SitePageRevision,
} from "@/lib/pages-shared";

export const Route = createFileRoute("/admin/policies")({
  head: () => ({ meta: [{ title: "Policies · Nongorr Admin" }] }),
  loader: async () => {
    const res = await loadSitePages();
    return { pages: res.success ? res.pages : [], loadError: !res.success };
  },
  component: Policies,
});

/** Pages with rich bespoke layouts that are edited in code, not in the CMS. */
const DESIGNED_PAGES = [
  { name: "Return & Exchange Policy", to: "/return-policy" },
  { name: "Custom Size Policy", to: "/custom-size-policy" },
  { name: "Privacy Policy", to: "/privacy-policy" },
  { name: "Terms & Conditions", to: "/terms" },
];

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("en-GB");
}

function Policies() {
  const { pages, loadError } = Route.useLoaderData();
  const router = useRouter();
  const [editingSlug, setEditingSlug] = useState<CmsPageSlug | null>(null);

  return (
    <div>
      <AdminHeader
        title="Policies"
        description="Edit the markdown-backed policy pages. Changes go live when published; every publish keeps a restorable revision."
      />

      {loadError && (
        <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          Could not load pages. Refresh to try again.
        </div>
      )}

      <h2 className="mb-2 font-display text-lg text-foreground">Editable pages</h2>
      <div className="space-y-2">
        {pages.map((p: AdminSitePageSummary) => (
          <div
            key={p.slug}
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4"
          >
            <div className="min-w-0">
              <span className="flex items-center gap-2 font-medium text-foreground">
                <FileText className="h-4 w-4 shrink-0 text-gold" />
                <span className="truncate">{p.title}</span>
                {p.has_draft && (
                  <Badge variant="outline" className="border-gold/40 text-gold">
                    Draft pending
                  </Badge>
                )}
              </span>
              <p className="mt-0.5 text-xs text-muted-foreground">
                /{p.slug} · published {fmtDate(p.published_at)} · {p.revision_count} revision
                {p.revision_count === 1 ? "" : "s"}
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" asChild>
                <Link to={`/${p.slug}` as never}>Preview</Link>
              </Button>
              <Button size="sm" onClick={() => setEditingSlug(p.slug as CmsPageSlug)}>
                <Pencil className="h-3.5 w-3.5" /> Edit
              </Button>
            </div>
          </div>
        ))}
      </div>

      <h2 className="mb-2 mt-8 font-display text-lg text-foreground">Designed pages</h2>
      <p className="mb-2 text-xs text-muted-foreground">
        These pages use rich, hand-crafted layouts (cards, timelines, accordions) and are edited in
        code, not here.
      </p>
      <div className="space-y-2">
        {DESIGNED_PAGES.map((p) => (
          <div
            key={p.name}
            className="flex items-center justify-between rounded-xl border border-border bg-card p-4"
          >
            <span className="flex items-center gap-2 font-medium text-foreground">
              <Lock className="h-4 w-4 text-muted-foreground" />
              {p.name}
            </span>
            <Button variant="outline" size="sm" asChild>
              <Link to={p.to as never}>Preview</Link>
            </Button>
          </div>
        ))}
      </div>

      <PageEditorDialog
        slug={editingSlug}
        onClose={() => setEditingSlug(null)}
        onChanged={() => router.invalidate()}
      />
    </div>
  );
}

interface FormState {
  eyebrow: string;
  title: string;
  description: string;
  body_md: string;
}

function toForm(page: AdminSitePage): FormState {
  const src = page.draft ?? page;
  return {
    eyebrow: src.eyebrow ?? "",
    title: src.title,
    description: src.description ?? "",
    body_md: src.body_md,
  };
}

function PageEditorDialog({
  slug,
  onClose,
  onChanged,
}: {
  slug: CmsPageSlug | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const confirm = useConfirm();
  const [page, setPage] = useState<AdminSitePage | null>(null);
  const [form, setForm] = useState<FormState>({
    eyebrow: "",
    title: "",
    description: "",
    body_md: "",
  });
  const [loadedSlug, setLoadedSlug] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [tab, setTab] = useState("edit");
  const [revisions, setRevisions] = useState<SitePageRevision[] | null>(null);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  // Load the full page each time the dialog opens for a slug.
  if (slug && slug !== loadedSlug) {
    setLoadedSlug(slug);
    setPage(null);
    setRevisions(null);
    setTab("edit");
    void loadSitePageAdmin({ data: { slug } }).then((res) => {
      if (res.success && res.page) {
        setPage(res.page);
        setForm(toForm(res.page));
      } else {
        toast.error(res.success ? "Page not found." : res.error);
        onClose();
      }
    });
  }
  if (!slug && loadedSlug) setLoadedSlug(null);

  const validated = () => {
    const parsed = pageDraftSchema.safeParse({ slug, ...form });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Please check the page fields.");
      return null;
    }
    return parsed.data;
  };

  const saveDraft = async (): Promise<boolean> => {
    const data = validated();
    if (!data) return false;
    setBusy("draft");
    const res = await saveSitePageDraftFn({ data });
    setBusy(null);
    if (!res.success) {
      toast.error(res.error);
      return false;
    }
    return true;
  };

  const onSaveDraft = async () => {
    if (await saveDraft()) {
      toast.success("Draft saved. Publish when you're ready to go live.");
      onChanged();
    }
  };

  const onPublish = async () => {
    if (!slug) return;
    if (!(await saveDraft())) return;
    setBusy("publish");
    const res = await publishSitePageFn({ data: { slug } });
    setBusy(null);
    if (res.success) {
      toast.success("Published. The storefront updates within a minute.");
      onChanged();
      onClose();
    } else {
      toast.error(res.error);
    }
  };

  const onDiscard = () =>
    confirm({
      tone: "danger",
      title: "Discard this draft?",
      description: "The unpublished working copy is removed; the live page is unaffected.",
      confirmText: "Discard",
      icon: <Trash2 className="h-6 w-6" />,
      onConfirm: async () => {
        if (!slug) return;
        setBusy("discard");
        const res = await discardSitePageDraftFn({ data: { slug } });
        setBusy(null);
        if (res.success) {
          toast.success("Draft discarded.");
          onChanged();
          onClose();
        } else {
          toast.error(res.error);
        }
      },
    });

  const loadHistory = async (forSlug: CmsPageSlug) => {
    const res = await loadSitePageRevisions({ data: { slug: forSlug } });
    setRevisions(res.success ? res.revisions : []);
    if (!res.success) toast.error(res.error);
  };

  const onTabChange = (value: string) => {
    setTab(value);
    // Load lazily on first visit to the History tab (onValueChange is the
    // reliable Radix hook — a Trigger onClick does not fire consistently).
    if (value === "history" && revisions === null && slug) void loadHistory(slug);
  };

  const onRestore = (rev: SitePageRevision) =>
    confirm({
      title: `Restore the ${fmtDate(rev.published_at)} version?`,
      description:
        "The revision is loaded into the editor as a draft — nothing goes live until you publish it.",
      confirmText: "Restore to draft",
      icon: <History className="h-6 w-6" />,
      onConfirm: async () => {
        if (!slug) return;
        setBusy("restore");
        const res = await restoreSitePageRevisionFn({ data: { slug, revisionId: rev.id } });
        setBusy(null);
        if (res.success) {
          setForm({
            eyebrow: rev.eyebrow ?? "",
            title: rev.title,
            description: rev.description ?? "",
            body_md: rev.body_md,
          });
          toast.success("Revision loaded into the editor. Publish to make it live.");
          onChanged();
        } else {
          toast.error(res.error);
        }
      },
    });

  return (
    <Dialog open={!!slug} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{page ? `Edit: ${page.title}` : "Loading…"}</DialogTitle>
          <DialogDescription>
            Save keeps a private draft; Publish puts it on the storefront and records a revision.
          </DialogDescription>
        </DialogHeader>

        {!page ? (
          <div className="grid place-items-center p-10">
            <Loader2 className="h-6 w-6 animate-spin text-gold" />
          </div>
        ) : (
          <Tabs value={tab} onValueChange={onTabChange}>
            <TabsList>
              <TabsTrigger value="edit">Edit</TabsTrigger>
              <TabsTrigger value="preview">Preview</TabsTrigger>
              <TabsTrigger value="history">History</TabsTrigger>
            </TabsList>

            <TabsContent value="edit" className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Title</Label>
                  <Input
                    value={form.title}
                    onChange={(e) => set("title", e.target.value)}
                    maxLength={160}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Eyebrow (small label above the title)</Label>
                  <Input
                    value={form.eyebrow}
                    onChange={(e) => set("eyebrow", e.target.value)}
                    maxLength={80}
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Intro line (under the title)</Label>
                  <Input
                    value={form.description}
                    onChange={(e) => set("description", e.target.value)}
                    maxLength={300}
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Body (markdown)</Label>
                  <Textarea
                    value={form.body_md}
                    onChange={(e) => set("body_md", e.target.value)}
                    className="min-h-72 font-mono text-xs leading-relaxed"
                    spellCheck={false}
                  />
                  <p className="text-xs text-muted-foreground">
                    Supports ## headings, - lists, 1. numbered lists, **bold**, *italic* and
                    [links](/faq). Check the Preview tab before publishing.
                  </p>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="preview">
              <div className="rounded-xl border border-border">
                <div className="border-b border-border bg-secondary/40 px-4 py-6 text-center">
                  {form.eyebrow && <span className="eyebrow">{form.eyebrow}</span>}
                  <h1 className="mt-1 font-display text-3xl text-foreground">{form.title}</h1>
                  {form.description && (
                    <p className="mx-auto mt-2 max-w-2xl text-sm text-muted-foreground">
                      {form.description}
                    </p>
                  )}
                </div>
                <Prose>
                  <Markdown source={form.body_md} />
                </Prose>
              </div>
            </TabsContent>

            <TabsContent value="history">
              {revisions === null ? (
                <div className="grid place-items-center p-8">
                  <Loader2 className="h-5 w-5 animate-spin text-gold" />
                </div>
              ) : revisions.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">No revisions yet.</p>
              ) : (
                <div className="space-y-2">
                  {revisions.map((rev, i) => (
                    <div
                      key={rev.id}
                      className="flex items-center justify-between rounded-lg border border-border p-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">
                          {rev.title}
                          {i === 0 && (
                            <Badge
                              variant="outline"
                              className="ml-2 border-success/40 text-success"
                            >
                              Current
                            </Badge>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {fmtDate(rev.published_at)}
                          {rev.published_by_email ? ` · ${rev.published_by_email}` : ""}
                        </p>
                      </div>
                      {i > 0 && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => onRestore(rev)}
                          disabled={busy !== null}
                        >
                          <History className="h-3.5 w-3.5" /> Restore
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>
        )}

        {page && (
          <DialogFooter className="gap-2 sm:justify-between">
            <div>
              {page.draft && (
                <Button
                  variant="ghost"
                  className="text-destructive"
                  onClick={onDiscard}
                  disabled={busy !== null}
                >
                  <Trash2 className="h-4 w-4" /> Discard draft
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={onSaveDraft} disabled={busy !== null}>
                {busy === "draft" && <Loader2 className="h-4 w-4 animate-spin" />} Save draft
              </Button>
              <Button onClick={onPublish} disabled={busy !== null}>
                {busy === "publish" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4" />
                )}
                Publish
              </Button>
            </div>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
