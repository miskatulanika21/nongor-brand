import { PageHero, Prose } from "@/components/PageHero";
import { Markdown } from "@/components/Markdown";
import type { PublicSitePage } from "@/lib/pages-shared";

/**
 * Renders a CMS-published policy page (Stage 6 P4) in the exact PageHero+Prose
 * shell the static pages use; when the CMS row is unavailable the caller's
 * static JSX renders instead, so the storefront can never lose a policy page.
 */
export function CmsPolicyPage({
  page,
  fallback,
}: {
  page: PublicSitePage | null;
  fallback: React.ReactNode;
}) {
  if (!page) return <>{fallback}</>;
  return (
    <div>
      <PageHero
        eyebrow={page.eyebrow ?? undefined}
        title={page.title}
        description={page.description ?? undefined}
      />
      <Prose>
        <Markdown source={page.bodyMd} />
      </Prose>
    </div>
  );
}
