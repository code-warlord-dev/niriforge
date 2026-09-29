import { useTranslation } from "react-i18next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface SectionPlaceholderProps {
  pageId: string;
}

/** Temporary body for sections not yet implemented (Phase 2+). */
export function SectionPlaceholder({ pageId }: SectionPlaceholderProps) {
  const { t } = useTranslation();
  const title = t(`sidebar.${pageId}`, { defaultValue: pageId });

  return (
    <div className="p-6">
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{t("section.placeholder_body")}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground font-mono">{pageId}</p>
        </CardContent>
      </Card>
    </div>
  );
}
