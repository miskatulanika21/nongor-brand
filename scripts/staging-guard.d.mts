// Type declarations for the plain-ESM staging guard (scripts/staging-guard.mjs),
// so it can be imported from the TypeScript unit test.
export const PROD_REF: string;
export const REF_RE: RegExp;
export function isValidStagingRef(ref: unknown): boolean;
export function projectRefFromUrl(url: unknown): string | null;
export interface StagingGuardInput {
  linkedRef: string | null;
  declaredRef: string | null;
  supabaseUrl: string | null;
}
export interface StagingGuardResult {
  ok: boolean;
  ref?: string;
  error?: string;
}
export function evaluateStagingGuard(input: StagingGuardInput): StagingGuardResult;
export function readEnvVar(file: string, key: string): string | null;
