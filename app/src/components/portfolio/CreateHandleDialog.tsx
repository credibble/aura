import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { notifyError } from "@/lib/notify";
import { START_FARMING, START_FARMING_SHORT } from "@/lib/voice";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, GUEST_SEED } from "@/components/Avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api";
import { useAuraAuth } from "@/lib/aura-auth";
import { useAuraContracts } from "@/lib/contracts";
import { reloadHandles } from "@/lib/handle-store";
import { useEnsureJwt } from "@/lib/jwt";
import { windowLabels } from "@/queries/handles";
import { qk } from "@/queries/keys";

type CreateHandleResult = { handleId: string; label: string; address: string; tx: string };

/** Category codes that round-trip `categoryFromCode` (1=crypto, 2=ai,
 *  100=sports, 0=culture) — same code space as HandleFactory.createHandle. */
const CATEGORY_OPTIONS: { id: string; label: string; code: number }[] = [
  { id: "crypto", label: "Crypto", code: 1_000_001 },
  { id: "ai", label: "AI", code: 2_000_001 },
  { id: "sports", label: "Sports", code: 3 },
  { id: "culture", label: "Culture", code: 1 },
];

const WINDOW_OPTIONS = [15, 30, 60, 120, 240, 480, 1440];

/**
 * Create a handle: name/symbol/category/window → wallet-JWT → `POST
 * /v1/handles` → the oracle signs `HandleFactory.createHandle` with the
 * owner key (503 until HANDLE_OWNER_PRIVATE_KEY is configured).
 */
export function CreateHandleDialog({
  children,
  open: openProp,
  onOpenChange,
}: {
  children?: ReactNode;
  /** Controlled open state — omit to keep the dialog self-managed (the
   *  default, triggered by `children`). The handle switcher controls it so the
   *  dialog outlives the popover it was opened from. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = openProp ?? internalOpen;
  const setOpen = (next: boolean) => {
    if (openProp === undefined) setInternalOpen(next);
    onOpenChange?.(next);
  };
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  // A handle can belong to several families (a footballer is sport AND people);
  // the FIRST one is its primary category.
  const [categories, setCategories] = useState<number[]>([CATEGORY_OPTIONS[0].code]);
  const [windowMinutes, setWindowMinutes] = useState(WINDOW_OPTIONS[0]);
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  // Object-URL preview for the picked photo; revoked on change/unmount.
  useEffect(() => {
    if (!photo) {
      setPhotoUrl(null);
      return;
    }
    const url = URL.createObjectURL(photo);
    setPhotoUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  const ensureJwt = useEnsureJwt();
  const { address } = useAuraContracts();
  const { login } = useAuraAuth();
  const qc = useQueryClient();

  const create = useMutation({
    mutationFn: async () => {
      await ensureJwt();
      // multipart/form-data: the backend's multer stores `photo` (image) and
      // merges the Cloudinary URL into the on-chain metadata JSON.
      const fd = new FormData();
      fd.append("name", name);
      fd.append("symbol", symbol);
      // Repeated keys → the oracle reads them as `categories: number[]`.
      for (const code of categories) fd.append("categories", String(code));
      fd.append("windowMinutes", String(windowMinutes));
      if (photo) fd.append("photo", photo);
      return api<CreateHandleResult>("/handles", { method: "POST", body: fd });
    },
    onSuccess: (res) => {
      toast.success(`@${res.label} is live`, {
        description: "Indexing — give it a few seconds to show up.",
      });
      void qc.invalidateQueries({ queryKey: qk.handles });
      if (address) {
        void qc.invalidateQueries({ queryKey: qk.userHandles(address.toLowerCase()) });
        void reloadHandles(qc, address);
      }
      setOpen(false);
      setName("");
      setSymbol("");
      setPhoto(null);
      setCategories([CATEGORY_OPTIONS[0].code]);
      setWindowMinutes(WINDOW_OPTIONS[0]);
    },
    onError: (e: Error) => notifyError(e, "Create handle"),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) create.reset();
      }}
    >
      {children != null ? <DialogTrigger asChild>{children}</DialogTrigger> : null}
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{START_FARMING}</DialogTitle>
          <DialogDescription>
            Your on-chain identity — 3–20 chars, a-z and 0–9. The wallet signs the claim through the
            oracle; you get the aura.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!address) {
              void login();
              toast.info("Connect a wallet to create a handle");
              return;
            }
            create.mutate();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="handle-name">Name</Label>
            <Input
              id="handle-name"
              autoFocus
              placeholder="bitcoin"
              value={name}
              onChange={(e) =>
                setName(
                  e.target.value
                    .toLowerCase()
                    .replace(/[^a-z0-9]/g, "")
                    .slice(0, 20),
                )
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="handle-symbol">Symbol</Label>
            <Input
              id="handle-symbol"
              placeholder="BTC"
              value={symbol}
              onChange={(e) =>
                setSymbol(
                  e.target.value
                    .toUpperCase()
                    .replace(/[^A-Z0-9]/g, "")
                    .slice(0, 8),
                )
              }
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              {/* Multi-select: the first pick is the primary category. */}
              <Label>Categories</Label>
              <div className="flex flex-wrap gap-1.5">
                {CATEGORY_OPTIONS.map((c) => {
                  const on = categories.includes(c.code);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() =>
                        setCategories((prev) => {
                          if (prev.includes(c.code)) {
                            // Never leave the handle with zero categories.
                            return prev.length === 1 ? prev : prev.filter((x) => x !== c.code);
                          }
                          return prev.length >= 4 ? prev : [...prev, c.code];
                        })
                      }
                      className={cn(
                        "rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors",
                        on
                          ? "border-primary bg-primary/15 text-foreground"
                          : "border-border text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {c.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Window</Label>
              <Select
                value={String(windowMinutes)}
                onValueChange={(v) => setWindowMinutes(Number(v))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WINDOW_OPTIONS.map((m) => (
                    <SelectItem key={m} value={String(m)}>
                      {windowLabels(m).long}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="handle-photo">Photo (optional)</Label>
            <div className="flex items-center gap-3">
              {/* Live preview of the handle's avatar — the same identicon the
                  new handle gets across the app; the photo overrides it. */}
              <Avatar
                seed={name.trim() || GUEST_SEED}
                image={photoUrl}
                alt="Handle photo"
                size={48}
                className="shrink-0 border border-border"
              />
              <div className="flex items-center gap-2">
                <input
                  id="handle-photo"
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
                />
                <label
                  htmlFor="handle-photo"
                  className="inline-flex h-8 cursor-pointer items-center rounded-md border border-border px-3 text-sm font-medium hover:bg-secondary/60"
                >
                  {photo ? "Change" : "Choose photo"}
                </label>
                {photo && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setPhoto(null)}>
                    Remove
                  </Button>
                )}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Stored on the handle's on-chain metadata via Cloudinary.
            </p>
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name || !symbol || create.isPending}>
              {create.isPending ? (
                "Creating…"
              ) : (
                <>
                  <Plus className="h-4 w-4" />
                  {START_FARMING_SHORT}
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
