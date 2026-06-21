import { createFileRoute, useRouteContext } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AdminHeader } from "@/components/admin/AdminUI";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { Check, Plus, ShieldAlert, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { listStaff, provisionStaff, updateStaffRole, setStaffActive } from "@/lib/staff.api";
import { ADMIN_PERMISSIONS, ROLE_PERMISSIONS } from "@/lib/permissions";
import type { StaffRole } from "@/lib/auth-types";

export const Route = createFileRoute("/admin/staff")({ component: StaffPage });

interface StaffRow {
  userId: string;
  email: string | null;
  role: StaffRole;
  isActive: boolean;
  displayName: string | null;
}

const ROLE_TONE: Record<StaffRole, string> = {
  owner: "border-gold/50 text-primary bg-gold/10",
  admin: "border-primary/30 text-primary",
  staff: "border-border text-muted-foreground",
};

function StaffPage() {
  const { staff: me } = useRouteContext({ from: "/admin" }) as { staff: { role: StaffRole } };
  const isOwner = me.role === "owner";
  const [rows, setRows] = useState<StaffRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    const result = await listStaff();
    if (result.success) setRows(result.staff);
    else toast.error(result.error);
    setLoading(false);
  }

  useEffect(() => {
    refresh().catch(() => setLoading(false));
  }, []);

  async function onRoleChange(row: StaffRow, newRole: StaffRole) {
    if (newRole === row.role) return;
    setBusyId(row.userId);
    const result = await updateStaffRole({ data: { targetUserId: row.userId, newRole } });
    if (result.success) {
      toast.success(result.message);
      await refresh();
    } else {
      toast.error(result.error);
    }
    setBusyId(null);
  }

  async function onActiveToggle(row: StaffRow, active: boolean) {
    setBusyId(row.userId);
    const result = await setStaffActive({ data: { targetUserId: row.userId, active } });
    if (result.success) {
      toast.success(result.message);
      await refresh();
    } else {
      toast.error(result.error);
    }
    setBusyId(null);
  }

  // Owners may assign owner/admin/staff; admins may assign only staff.
  const assignableRoles: StaffRole[] = isOwner ? ["owner", "admin", "staff"] : ["staff"];

  return (
    <div>
      <AdminHeader
        title="Staff Roles"
        description="Manage team access. All changes are enforced and audited server-side."
        action={
          <Button onClick={() => setInviteOpen(true)}>
            <Plus className="h-4 w-4" /> Invite staff
          </Button>
        }
      />

      <div className="mb-6 flex items-start gap-2 rounded-xl border border-gold/40 bg-gold/5 p-3 text-sm text-muted-foreground">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-gold" />
        Owner-only protections apply: the last active owner cannot be demoted or deactivated, and
        only an owner can assign the owner or admin role.
      </div>

      {loading ? (
        <div className="grid place-items-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((s) => {
            const canManageRow = isOwner || s.role === "staff";
            return (
              <div
                key={s.userId}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4"
              >
                <div className="flex items-center gap-3">
                  <div className="grid h-10 w-10 place-items-center rounded-full bg-gradient-gold text-sm font-semibold text-gold-foreground">
                    {(s.displayName || s.email || "?")[0]?.toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium text-foreground">{s.displayName || s.email}</p>
                    <p className="text-xs text-muted-foreground">{s.email}</p>
                  </div>
                  {!s.isActive && (
                    <Badge variant="outline" className="border-destructive/40 text-destructive">
                      Inactive
                    </Badge>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  <Select
                    value={s.role}
                    onValueChange={(v) => onRoleChange(s, v as StaffRole)}
                    disabled={!canManageRow || busyId === s.userId}
                  >
                    <SelectTrigger className="w-[7.5rem]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {/* Always include the current role so it displays; gate the rest. */}
                      {Array.from(new Set([s.role, ...assignableRoles])).map((r) => (
                        <SelectItem key={r} value={r} disabled={!assignableRoles.includes(r)}>
                          {r.charAt(0).toUpperCase() + r.slice(1)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Badge variant="outline" className={ROLE_TONE[s.role]}>
                    {s.role}
                  </Badge>
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    Active
                    <Switch
                      checked={s.isActive}
                      onCheckedChange={(v) => onActiveToggle(s, v)}
                      disabled={!canManageRow || busyId === s.userId}
                    />
                  </label>
                </div>
              </div>
            );
          })}
          {rows.length === 0 && (
            <p className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
              No staff accounts yet.
            </p>
          )}
        </div>
      )}

      <PermissionMatrix />

      <InviteDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        assignableRoles={assignableRoles}
        onInvited={refresh}
      />
    </div>
  );
}

/** Read-only matrix rendered from the real permission registry. */
function PermissionMatrix() {
  const roles: StaffRole[] = ["owner", "admin", "staff"];
  return (
    <div className="mt-8 overflow-x-auto rounded-xl border border-border bg-card">
      <div className="border-b border-border p-4">
        <h2 className="font-display text-xl text-foreground">Permission matrix</h2>
        <p className="text-xs text-muted-foreground">
          The authoritative grants enforced by the server for each role.
        </p>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Permission</TableHead>
            {roles.map((r) => (
              <TableHead key={r} className="text-center capitalize">
                {r}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {ADMIN_PERMISSIONS.map((perm) => (
            <TableRow key={perm}>
              <TableCell className="font-mono text-xs text-foreground">{perm}</TableCell>
              {roles.map((r) => (
                <TableCell key={r} className="text-center">
                  {ROLE_PERMISSIONS[r].has(perm) ? (
                    <Check className="mx-auto h-4 w-4 text-success" />
                  ) : (
                    <X className="mx-auto h-4 w-4 text-muted-foreground/40" />
                  )}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function InviteDialog({
  open,
  onOpenChange,
  assignableRoles,
  onInvited,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  assignableRoles: StaffRole[];
  onInvited: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<StaffRole>("staff");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const result = await provisionStaff({
      data: { email: email.trim(), role, displayName: name.trim() || undefined },
    });
    setBusy(false);
    if (result.success) {
      toast.success(result.message);
      onOpenChange(false);
      setName("");
      setEmail("");
      setRole("staff");
      onInvited();
    } else {
      toast.error(result.error);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invite staff</DialogTitle>
        </DialogHeader>
        <form id="invite-form" className="space-y-4" onSubmit={onSubmit}>
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" />
          </div>
          <div className="space-y-1.5">
            <Label>Email</Label>
            <Input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@nongorr.com"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as StaffRole)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {assignableRoles.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r.charAt(0).toUpperCase() + r.slice(1)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              An invitation email with a secure setup link will be sent. No password is set here.
            </p>
          </div>
        </form>
        <DialogFooter>
          <Button type="submit" form="invite-form" disabled={busy}>
            {busy ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" />
            )}
            Send invite
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
