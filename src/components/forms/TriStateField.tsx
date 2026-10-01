"use client";

import { useTranslation } from "react-i18next";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** Radix Select reserves the empty string, so unset travels as a sentinel. */
const UNSET = "__unset__";
const ON = "__on__";
const OFF = "__off__";

interface TriStateFieldProps {
  id: string;
  /** The config key, shown verbatim because the file uses it. */
  name: string;
  value: boolean | null | undefined;
  hint?: string;
  onChange: (value: boolean | null) => void;
}

/**
 * Three-state boolean for niri's `Option<bool>` fields.
 *
 * Two states are not enough: an absent node means "niri's own default", which
 * for several flags is not the same thing as an explicit off. The control keeps
 * that third state reachable instead of collapsing it into false.
 */
export function TriStateField({ id, name, value, hint, onChange }: TriStateFieldProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="font-mono text-xs text-muted-foreground">
        {name}
      </Label>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      <Select
        value={value == null ? UNSET : value ? ON : OFF}
        onValueChange={(next) => onChange(next === UNSET ? null : next === ON)}
      >
        <SelectTrigger id={id} className="h-8 font-mono text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={UNSET} className="font-mono text-xs">
            {t("input.unset", { defaultValue: "niri default" })}
          </SelectItem>
          <SelectItem value={ON} className="font-mono text-xs">
            {t("input.tristate_on", { defaultValue: "on" })}
          </SelectItem>
          <SelectItem value={OFF} className="font-mono text-xs">
            {t("input.tristate_off", { defaultValue: "off" })}
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
