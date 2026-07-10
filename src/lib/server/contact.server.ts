/**
 * Contact-message repository — SERVER ONLY.
 *
 * Wraps the service-role admin client over the api.* contact RPCs (REVOKE-d from
 * anon/authenticated). Authorization is enforced upstream by contact.api.ts
 * (CSRF + rate limit on submit; requirePermission / guardAdminWrite on the admin
 * reads/writes). snake→camel mapping; unknown errors collapse to internal_error.
 */
import { createAdminSupabaseClient } from "./supabase-admin.server";
import {
  CONTACT_ERROR_MESSAGES,
  type ContactMessageListResult,
  type ContactMessageRow,
  type ContactStatus,
} from "@/lib/contact-shared";

export class ContactError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "ContactError";
  }
}

function throwContactError(error: { message?: string }): never {
  const raw = (error.message ?? "").trim();
  throw new ContactError(raw in CONTACT_ERROR_MESSAGES ? raw : "internal_error");
}

export interface SubmitContactArgs {
  name: string;
  phone: string;
  message: string;
  reason: string;
  email?: string;
  orderNumber?: string;
}

export async function submitContactMessage(args: SubmitContactArgs): Promise<{ id: string }> {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin.schema("api").rpc("submit_contact_message", {
    p_name: args.name,
    p_phone: args.phone,
    p_message: args.message,
    p_reason: args.reason,
    p_email: args.email ?? null,
    p_order_number: args.orderNumber ?? null,
  });
  if (error) throwContactError(error);
  return { id: (data as { id: string }).id };
}

interface RawContactRow {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  reason: string;
  order_number: string | null;
  message: string;
  status: ContactStatus;
  handled_by_email: string | null;
  handled_at: string | null;
  created_at: string;
}

function mapRow(r: RawContactRow): ContactMessageRow {
  return {
    id: r.id,
    name: r.name,
    phone: r.phone,
    email: r.email,
    reason: r.reason,
    orderNumber: r.order_number,
    message: r.message,
    status: r.status,
    handledByEmail: r.handled_by_email,
    handledAt: r.handled_at,
    createdAt: r.created_at,
  };
}

export interface ListContactArgs {
  actorId: string;
  status?: ContactStatus;
  search?: string;
  limit?: number;
  offset?: number;
}

export async function listContactMessages(
  args: ListContactArgs,
): Promise<ContactMessageListResult> {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin.schema("api").rpc("list_contact_messages", {
    p_actor: args.actorId,
    p_status: args.status ?? null,
    p_search: args.search ?? null,
    p_limit: args.limit ?? 25,
    p_offset: args.offset ?? 0,
  });
  if (error) throwContactError(error);
  const raw = (data ?? { rows: [], total: 0 }) as { rows: RawContactRow[] | null; total: number };
  return { rows: (raw.rows ?? []).map(mapRow), total: raw.total ?? 0 };
}

export async function setContactMessageStatus(
  actorId: string,
  id: string,
  status: ContactStatus,
): Promise<void> {
  const admin = createAdminSupabaseClient();
  const { error } = await admin.schema("api").rpc("set_contact_message_status", {
    p_actor: actorId,
    p_id: id,
    p_status: status,
  });
  if (error) throwContactError(error);
}
