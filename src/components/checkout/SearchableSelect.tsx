/**
 * A select that grows a search box once the list gets long.
 *
 * Dhaka district alone offers 363 thanas. Scrolling that on a phone to find
 * "Dhanmondi" is not a usable checkout, and checkout is where abandonment
 * costs the most. Above SEARCH_THRESHOLD options this renders a filterable
 * command list; below it, a plain button-and-list, because a search box over
 * eight divisions is noise.
 *
 * Built on the existing Command (cmdk) + Popover primitives — no new
 * dependency, and it inherits the app's focus and keyboard behaviour.
 */
import { useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/** Lists longer than this get a search input. */
const SEARCH_THRESHOLD = 12;

export interface SelectOption {
  value: string;
  label: string;
  /** Extra text matched by search but not displayed (e.g. the Bengali name). */
  keywords?: string;
}

interface Props {
  options: SelectOption[];
  value?: string;
  onChange: (value: string) => void;
  placeholder: string;
  /** Shown inside the search box. */
  searchPlaceholder?: string;
  disabled?: boolean;
  loading?: boolean;
  invalid?: boolean;
  id?: string;
  ariaLabel?: string;
}

export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder,
  searchPlaceholder = "Type to search…",
  disabled,
  loading,
  invalid,
  id,
  ariaLabel,
}: Props) {
  const [open, setOpen] = useState(false);
  const selected = useMemo(() => options.find((o) => o.value === value), [options, value]);
  const withSearch = options.length > SEARCH_THRESHOLD;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel}
          aria-invalid={invalid || undefined}
          disabled={disabled || loading}
          className={cn(
            "w-full justify-between font-normal",
            !selected && "text-muted-foreground",
            invalid && "border-destructive",
          )}
        >
          <span className="truncate">
            {loading ? "Loading…" : (selected?.label ?? placeholder)}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[--radix-popover-trigger-width] p-0"
        align="start"
        // The list can be 363 items; keep the popover inside the viewport
        // rather than letting it grow past the fold on a phone.
        collisionPadding={8}
      >
        <Command
          filter={(itemValue, search) => {
            // cmdk passes the item's `value`; we search label + keywords via the
            // value string we build below, case-insensitively.
            return itemValue.toLowerCase().includes(search.toLowerCase()) ? 1 : 0;
          }}
        >
          {withSearch && <CommandInput placeholder={searchPlaceholder} />}
          <CommandList>
            <CommandEmpty>No match found.</CommandEmpty>
            <CommandGroup>
              {options.map((o) => (
                <CommandItem
                  key={o.value}
                  // cmdk filters on this string, so fold the searchable text in
                  // while keeping the rendered child as the display label.
                  value={`${o.label} ${o.keywords ?? ""}`.trim()}
                  onSelect={() => {
                    onChange(o.value);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn("mr-2 h-4 w-4", o.value === value ? "opacity-100" : "opacity-0")}
                  />
                  <span className="truncate">{o.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
