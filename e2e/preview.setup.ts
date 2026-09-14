import { request } from "@playwright/test";
import { mkdir, rm } from "node:fs/promises";
import { previewAuthFile, previewOrigin } from "./helpers/preview-auth";

export default async function setupPreview() {
  const secret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  const origin = previewOrigin(process.env.E2E_BASE_URL);
  if (!secret || !origin) return;
  await mkdir("e2e/.auth", { recursive: true });
  await rm(previewAuthFile, { force: true });
  const context = await request.newContext();
  try {
    // Never forward the secret on a redirect or through browser-wide headers.
    const response = await context.get(origin, {
      headers: {
        "x-vercel-protection-bypass": secret,
        "x-vercel-set-bypass-cookie": "true",
      },
      maxRedirects: 0,
    });
    if (response.status() >= 400) throw new Error("Preview bypass was rejected");
    const state = await context.storageState();
    const host = new URL(origin).hostname;
    const cookies = state.cookies.filter((cookie) => cookie.name === "_vercel_jwt");
    if (!cookies.length) throw new Error("Vercel did not issue a preview bypass cookie");
    // Narrow even a parent-domain cookie to this exact deployment hostname.
    const cookieContext = await request.newContext({
      storageState: {
        cookies: cookies.map((cookie) => ({ ...cookie, domain: host })),
        origins: [],
      },
    });
    try {
      await cookieContext.storageState({ path: previewAuthFile });
    } finally {
      await cookieContext.dispose();
    }
  } finally {
    await context.dispose();
  }
}
