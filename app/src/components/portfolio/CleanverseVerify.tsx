import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useHandleVerified, useVerifyHandle } from "@/queries/handles";

/**
 * Cleanverse CVI verification card — frontend → backend → onchain:
 * the user triggers verification, the backend checks the creator's A-Pass
 * through Cleanverse, and the result is written to `Handle.setVerified`
 * on-chain (drives the badge via the `verified` flag).
 */
export function CleanverseVerify({
  handleId,
  handleName,
}: {
  handleId: string;
  handleName: string;
}) {
  const status = useHandleVerified(handleId);
  const verify = useVerifyHandle();

  const verified = status.data?.verified === true;
  const result = verify.data;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle>Cleanverse Identity (CVI)</CardTitle>
          {status.isLoading ? (
            <Skeleton className="h-5 w-24" />
          ) : (
            <Badge variant={verified ? "default" : "secondary"}>
              {status.data?.verified === null
                ? "Chain unavailable"
                : verified
                  ? "Verified on-chain"
                  : "Not verified"}
            </Badge>
          )}
        </div>
        <CardDescription>
          @{handleName} — A-Pass identity verification, recorded on-chain (Handle.verified).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button
          onClick={() => verify.mutate(handleId)}
          disabled={verify.isPending || status.isLoading}
          className="w-full rounded-full"
        >
          {verify.isPending
            ? "Verifying…"
            : verified
              ? "Re-check verification"
              : "Verify with Cleanverse"}
        </Button>

        {verify.isError && (
          <p className="text-sm text-destructive">
            Verification failed:{" "}
            {verify.error instanceof Error ? verify.error.message : "unknown error"}
          </p>
        )}

        {result && (
          <div className="rounded-lg border border-border bg-secondary/40 p-3 text-sm">
            <p className="font-medium">
              {result.verification.verified ? (
                <>
                  A-Pass verified
                  {result.verification.tier ? ` · tier ${result.verification.tier}` : ""}
                </>
              ) : (
                "No A-Pass found for this wallet"
              )}
            </p>
            {result.verification.did && (
              <p className="mt-1 break-all text-xs text-muted-foreground">
                {result.verification.did}
              </p>
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              {result.verifiedOnChain === true
                ? "On-chain flag set: verified."
                : result.verifiedOnChain === false
                  ? "On-chain flag: not verified."
                  : "Chain gateway offline — on-chain flag not updated."}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
