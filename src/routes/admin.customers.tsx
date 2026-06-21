import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AdminHeader } from "@/components/admin/AdminUI";
import { formatBDT } from "@/lib/brand";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/admin/customers")({
  component: Customers,
});

interface Cust {
  id: string;
  name: string;
  phone: string;
  address: string;
  orders: number;
  spent: number;
  returns: number;
  tags: string[];
}

const CUSTOMERS: Cust[] = [
  {
    id: "c1",
    name: "Tahmina Akter",
    phone: "01711-223344",
    address: "Dhanmondi, Dhaka",
    orders: 7,
    spent: 24800,
    returns: 0,
    tags: ["VIP", "Repeat Customer", "Custom Size Customer"],
  },
  {
    id: "c2",
    name: "Rumana Khan",
    phone: "01822-556677",
    address: "Gulshan, Dhaka",
    orders: 2,
    spent: 11200,
    returns: 1,
    tags: ["Repeat Customer"],
  },
  {
    id: "c3",
    name: "Nusrat Jahan",
    phone: "01933-889900",
    address: "Uttara, Dhaka",
    orders: 1,
    spent: 1470,
    returns: 0,
    tags: [],
  },
  {
    id: "c4",
    name: "Lamia Haque",
    phone: "01655-112233",
    address: "Chattogram",
    orders: 5,
    spent: 6200,
    returns: 3,
    tags: ["High Risk"],
  },
];

const TAG_TONE: Record<string, string> = {
  VIP: "border-gold/50 text-primary bg-gold/10",
  "Repeat Customer": "border-success/40 text-success",
  "High Risk": "border-destructive/40 text-destructive",
  "Custom Size Customer": "border-primary/30 text-primary",
};

function Customers() {
  const [active, setActive] = useState<Cust | null>(null);
  return (
    <div>
      <AdminHeader title="Customers" description={`${CUSTOMERS.length} customers`} />
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Customer</TableHead>
              <TableHead>Orders</TableHead>
              <TableHead>Spent</TableHead>
              <TableHead>Tags</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {CUSTOMERS.map((c) => (
              <TableRow key={c.id} className="cursor-pointer" onClick={() => setActive(c)}>
                <TableCell>
                  <p className="font-medium text-foreground">{c.name}</p>
                  <p className="text-xs text-muted-foreground">{c.phone}</p>
                </TableCell>
                <TableCell>{c.orders}</TableCell>
                <TableCell className="font-medium text-primary">{formatBDT(c.spent)}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {c.tags.map((t) => (
                      <Badge key={t} variant="outline" className={TAG_TONE[t]}>
                        {t}
                      </Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="sm">
                    View
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Sheet open={!!active} onOpenChange={(o) => !o && setActive(null)}>
        <SheetContent className="w-full sm:max-w-md">
          {active && (
            <>
              <SheetHeader>
                <SheetTitle className="font-display text-2xl">{active.name}</SheetTitle>
              </SheetHeader>
              <div className="mt-4 space-y-4 text-sm">
                <div className="rounded-lg bg-secondary p-3">
                  <p className="text-muted-foreground">{active.phone}</p>
                  <p className="text-muted-foreground">{active.address}</p>
                </div>
                <div className="grid grid-cols-3 gap-3 text-center">
                  <Stat label="Orders" value={active.orders} />
                  <Stat label="Spent" value={formatBDT(active.spent)} />
                  <Stat label="Returns" value={active.returns} />
                </div>
                <div>
                  <p className="mb-2 font-medium">Tags</p>
                  <div className="flex flex-wrap gap-1.5">
                    {active.tags.length ? (
                      active.tags.map((t) => (
                        <Badge key={t} variant="outline" className={TAG_TONE[t]}>
                          {t}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-muted-foreground">No tags</span>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="font-display text-xl text-primary">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
