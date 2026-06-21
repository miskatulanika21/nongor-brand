import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
  AdminHeader,
  PreviewNotice,
  AdminSectionCard,
  MockBadge,
} from "@/components/admin/AdminUI";
import { READY_SIZES, GIRLS_SIZES } from "@/lib/products";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowUp, ArrowDown, ImageOff } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/size-settings")({
  head: () => ({ meta: [{ title: "Size Settings · Nongorr Admin" }] }),
  component: SizeSettingsAdmin,
});

const MEASUREMENT_COLUMNS = ["Bust", "Waist", "Hip", "Shoulder", "Sleeve", "Dress length"] as const;

type Unit = "in" | "cm";

interface CustomField {
  id: string;
  label: string;
  required: boolean;
  instruction: string;
}

const DEFAULT_CUSTOM_FIELDS: CustomField[] = MEASUREMENT_COLUMNS.map((m, i) => ({
  id: `cf-${i}`,
  label: m,
  required: i < 4,
  instruction: "",
}));

function SizeSettingsAdmin() {
  const [unit, setUnit] = useState<Unit>("in");
  const [fields, setFields] = useState<CustomField[]>(DEFAULT_CUSTOM_FIELDS);

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= fields.length) return;
    setFields((fs) => {
      const next = [...fs];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };

  const handleUnitChange = (u: Unit) => {
    setUnit(u);
    toast("Display unit changed for new values only. Automatic conversion is not implemented.");
  };

  return (
    <div>
      <AdminHeader
        title="Size Settings"
        description="Configure size charts and custom measurements — local preview only."
      />
      <PreviewNotice className="mb-4" />
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Label htmlFor="unit-select" className="text-sm">
            Units
          </Label>
          <Select value={unit} onValueChange={(v) => handleUnitChange(v as Unit)}>
            <SelectTrigger id="unit-select" className="w-[150px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="in">Inches</SelectItem>
              <SelectItem value="cm">Centimetres</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <MockBadge label="No auto-conversion" />
      </div>

      <Tabs defaultValue="kurti">
        <TabsList className="flex-wrap">
          <TabsTrigger value="kurti">Kurti</TabsTrigger>
          <TabsTrigger value="three-piece">Stitched Three Piece</TabsTrigger>
          <TabsTrigger value="girls">Girls Dress</TabsTrigger>
          <TabsTrigger value="custom">Custom Measurements</TabsTrigger>
          <TabsTrigger value="other">Saree & Cosmetics</TabsTrigger>
        </TabsList>

        <TabsContent value="kurti" className="mt-4">
          <FixedChart title="Kurti size chart" sizes={[...READY_SIZES]} unit={unit} />
        </TabsContent>
        <TabsContent value="three-piece" className="mt-4">
          <FixedChart
            title="Stitched Three Piece size chart"
            sizes={[...READY_SIZES]}
            unit={unit}
          />
          <p className="mt-3 text-xs text-muted-foreground">
            Unstitched fabric does not use ready-size rows.
          </p>
        </TabsContent>
        <TabsContent value="girls" className="mt-4">
          <FixedChart title="Girls Dress size chart" sizes={[...GIRLS_SIZES]} unit={unit} />
        </TabsContent>

        <TabsContent value="custom" className="mt-4">
          <AdminSectionCard
            title="Custom measurement fields"
            description="Public custom-size forms are not connected to these local settings yet."
            action={<MockBadge label="Not connected" />}
          >
            <div className="space-y-3">
              {fields.map((f, i) => (
                <div key={f.id} className="rounded-xl border border-border p-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Move ${f.label} up`}
                        disabled={i === 0}
                        onClick={() => move(i, -1)}
                      >
                        <ArrowUp className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Move ${f.label} down`}
                        disabled={i === fields.length - 1}
                        onClick={() => move(i, 1)}
                      >
                        <ArrowDown className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="min-w-[10rem] flex-1 space-y-1.5">
                      <Label htmlFor={`label-${f.id}`} className="text-xs">
                        Visible label
                      </Label>
                      <Input
                        id={`label-${f.id}`}
                        value={f.label}
                        onChange={(e) =>
                          setFields((fs) =>
                            fs.map((x) => (x.id === f.id ? { ...x, label: e.target.value } : x)),
                          )
                        }
                      />
                    </div>
                    <label className="flex items-center gap-2 text-sm">
                      <Switch
                        checked={f.required}
                        onCheckedChange={(v) =>
                          setFields((fs) =>
                            fs.map((x) => (x.id === f.id ? { ...x, required: v } : x)),
                          )
                        }
                      />
                      Required
                    </label>
                    <Badge variant="outline">{unit === "in" ? "Inches" : "Centimetres"}</Badge>
                  </div>
                  <div className="mt-3 space-y-1.5">
                    <Label htmlFor={`instr-${f.id}`} className="text-xs">
                      Instruction text
                    </Label>
                    <Textarea
                      id={`instr-${f.id}`}
                      rows={2}
                      placeholder="How should the customer measure this?"
                      value={f.instruction}
                      onChange={(e) =>
                        setFields((fs) =>
                          fs.map((x) =>
                            x.id === f.id ? { ...x, instruction: e.target.value } : x,
                          ),
                        )
                      }
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 rounded-xl border border-dashed border-border p-4">
              <p className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
                <ImageOff className="h-4 w-4 text-muted-foreground" /> Help image
              </p>
              <Button variant="outline" disabled>
                Help-image upload — available after media storage integration
              </Button>
            </div>
          </AdminSectionCard>
        </TabsContent>

        <TabsContent value="other" className="mt-4">
          <AdminSectionCard title="Saree & Cosmetics">
            <p className="text-sm text-muted-foreground">
              No fixed size configuration required for these categories.
            </p>
          </AdminSectionCard>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function FixedChart({ title, sizes, unit }: { title: string; sizes: string[]; unit: Unit }) {
  return (
    <AdminSectionCard
      title={title}
      description={`Demo configuration only. Fixed size values have not been connected to the public Size Guide. Values shown in ${unit === "in" ? "inches" : "centimetres"}.`}
      action={<MockBadge label="Not configured" />}
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[40rem] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th scope="col" className="p-2">
                Size
              </th>
              {MEASUREMENT_COLUMNS.map((m) => (
                <th key={m} scope="col" className="p-2">
                  {m}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sizes.map((s) => (
              <tr key={s} className="border-b border-border last:border-0">
                <th scope="row" className="p-2 text-left font-medium text-foreground">
                  {s}
                </th>
                {MEASUREMENT_COLUMNS.map((m) => (
                  <td key={m} className="p-2">
                    <Input className="h-8 w-20" placeholder="—" aria-label={`${s} ${m}`} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Empty cells display “Not configured”. No measurement numbers are invented.
      </p>
    </AdminSectionCard>
  );
}
