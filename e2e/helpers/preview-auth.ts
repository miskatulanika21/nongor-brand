/** Only this project's HTTPS deployments may receive the automation secret. */
export function previewOrigin(baseURL: string | undefined): string | null {
  if (!baseURL) return null;
  const url = new URL(baseURL);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    !/^(?:nongor-brand|nongor-brand-[a-z0-9-]+-nongorr)\.vercel\.app$/.test(url.hostname)
  )
    return null;
  return url.origin;
}

export const previewAuthFile = "e2e/.auth/preview.json";
