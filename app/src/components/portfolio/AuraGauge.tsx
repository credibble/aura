import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { GRADUATION_AURA, type HandleLink } from "@/lib/portfolio";

/**
 * Aura gauge — the handle's live Aura (0–100+) and the trading-graduation
 * threshold (100). A handle can only be graduated to trading prediction once
 * it holds ≥ 100 Aura.
 */
export function AuraGauge({ handle }: { handle: HandleLink }) {
  const aura = handle.aura;
  const graduated = aura >= GRADUATION_AURA;
  const pct = Math.min(100, Math.round((aura / (GRADUATION_AURA * 2)) * 100));

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle>Aura</CardTitle>
          <Badge variant={graduated ? "default" : "secondary"}>
            {graduated ? "Graduated — Trading" : `${GRADUATION_AURA - aura} to graduation`}
          </Badge>
        </div>
        <CardDescription>Live aura score from your connected sources.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-end gap-1">
          <span className={cn("text-4xl font-bold tabular-nums", graduated ? "text-primary" : "")}>
            {aura.toFixed(1)}
          </span>
          <span className="pb-1 text-sm text-muted-foreground">/ 200</span>
        </div>
        <Progress value={pct} className="h-2" />
        <div className="flex justify-between text-[11px] text-muted-foreground">
          <span>0</span>
          <span className="font-medium text-foreground">Graduate at {GRADUATION_AURA}</span>
          <span>200</span>
        </div>
        {!graduated && (
          <p className="text-xs text-muted-foreground">
            Reach <span className="font-semibold text-foreground">{GRADUATION_AURA} Aura</span> to
            unlock trading prediction for this handle.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
