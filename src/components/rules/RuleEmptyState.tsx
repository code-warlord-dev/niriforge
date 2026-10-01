import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

interface RuleEmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}

/**
 * Shown when a rule family has no nodes yet.
 *
 * There is no sample rule to fall back on: the config either has the nodes or
 * it does not, so the way out of this state is adding one or opening the file.
 */
export function RuleEmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
}: RuleEmptyStateProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <Icon className="h-8 w-8 text-muted-foreground" />
      <div className="space-y-1">
        <h3 className="text-lg font-medium">{title}</h3>
        <p className="mx-auto max-w-md text-sm text-muted-foreground">{description}</p>
      </div>
      {actionLabel && onAction && (
        <Button variant="outline" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
