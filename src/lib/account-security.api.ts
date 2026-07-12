/**
 * Customer account-security server fns (TanStack Start).
 *
 * Thin wrappers over the session-scoped server module. Server-only code is
 * imported INSIDE each handler closure so this module stays client-safe.
 * CSRF + verified-session enforcement lives in the server layer.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const deleteAccountSchema = z.object({
  currentPassword: z.string().max(200).optional(),
});

export const deleteAccount = createServerFn({ method: "POST" })
  .validator(deleteAccountSchema)
  .handler(async ({ data }) => {
    const { performAccountDeletion } = await import("@/lib/server/auth.server");
    return performAccountDeletion(data);
  });

export const signOutEverywhere = createServerFn({ method: "POST" }).handler(async () => {
  const { performSignOutEverywhere } = await import("@/lib/server/account-security.server");
  return performSignOutEverywhere();
});

export const getConnectedIdentities = createServerFn({ method: "GET" }).handler(async () => {
  const { listConnectedIdentities } = await import("@/lib/server/account-security.server");
  return listConnectedIdentities();
});

const linkIdentitySchema = z.object({ provider: z.enum(["google", "facebook"]) });

export const startIdentityLink = createServerFn({ method: "POST" })
  .validator(linkIdentitySchema)
  .handler(async ({ data }) => {
    const { performStartIdentityLink } = await import("@/lib/server/account-security.server");
    return performStartIdentityLink(data);
  });

const unlinkIdentitySchema = z.object({ identityId: z.string().min(1).max(200) });

export const unlinkIdentity = createServerFn({ method: "POST" })
  .validator(unlinkIdentitySchema)
  .handler(async ({ data }) => {
    const { performUnlinkIdentity } = await import("@/lib/server/account-security.server");
    return performUnlinkIdentity(data);
  });
