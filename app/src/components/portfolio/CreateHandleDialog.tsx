import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { toast } from "sonner";
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
  { id: "sports", label: "Sports", code: 100_001_001 },
  { id: "culture", label: "Culture", code: 1 },
];

const WINDOW_OPTIONS = [15, 30, 60, 120, 240, 480, 1440];

/**
 * Create a handle: name/symbol/category/window → wallet-JWT → `POST
 * /v1/handles` → the oracle signs `HandleFactory.createHandle` with the
 * owner key (503 until HANDLE_OWNER_PRIVATE_KEY is configured).
 */
export function CreateHandleDialog({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [category, setCategory] = useState(CATEGORY_OPTIONS[0].code);
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
      fd.append("category", String(category));
      fd.append("windowMinutes", String(windowMinutes));
      if (photo) fd.append("photo", photo);
      return api<CreateHandleResult>("/handles", { method: "POST", body: fd });
    },
    onSuccess: (res) => {
      toast.success(`@${res.label} created`, {
        description: "Indexing — your new handle appears in a few seconds.",
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
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) create.reset();
      }}
    >
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create a handle</DialogTitle>
          <DialogDescription>
            Your on-chain identity — 3–20 chars, a-z and 0–9. The wallet signs the claim through the
            oracle.
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
              <Label>Category</Label>
              <Select value={String(category)} onValueChange={(v) => setCategory(Number(v))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORY_OPTIONS.map((c) => (
                    <SelectItem key={c.id} value={String(c.code)}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
                  Create handle
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
