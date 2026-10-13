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
  CHARACTER_HAIR,
  CHARACTER_HAIR_STYLES,
  CHARACTER_OUTFIT,
  CHARACTER_SKIN,
  CharacterSprite,
} from "@/components/aura/CharacterSprite";
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
import { categoryFromCode, windowLabels } from "@/queries/handles";
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
  // Character builder: the appearance is saved in the handle's on-chain metadata
  // (`character.look`) and the world sprite honours it, so the user's villager is
  // theirs. Kept as small palette indices to fit the metadata budget.
  const [look, setLook] = useState<{ skin: number; hair: number; style: number; outfit: number }>({
    skin: 1,
    hair: 0,
    style: 0,
    outfit: 0,
  });

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
      // The oracle merges this object into the on-chain metadata JSON; the world
      // sprite reads `character.look` back.
      fd.append("metadata", JSON.stringify({ character: { look } }));
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
      setLook({ skin: 1, hair: 0, style: 0, outfit: 0 });
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
          <div className="space-y-2 rounded-xl border border-border/70 p-3">
            <div className="flex items-center justify-between">
              <Label>Character</Label>
              <span className="text-xs text-muted-foreground">This is how you appear in the world</span>
            </div>
            <div className="flex items-start gap-4">
              <div className="relative h-[104px] w-[104px] shrink-0 place-items-center rounded-xl border border-border bg-secondary/20">
                <CharacterSprite
                  id={name || "preview"}
                  name={name || undefined}
                  category={categoryFromCode(categories[0] ?? CATEGORY_OPTIONS[0].code)}
                  character={{ look }}
                />
              </div>
              <div className="min-w-0 flex-1 space-y-2">
                <SwatchRow
                  label="Skin"
                  palette={CHARACTER_SKIN}
                  value={look.skin}
                  onPick={(i) => setLook((l) => ({ ...l, skin: i }))}
                />
                <SwatchRow
                  label="Hair"
                  palette={CHARACTER_HAIR}
                  value={look.hair}
                  onPick={(i) => setLook((l) => ({ ...l, hair: i }))}
                />
                <div className="flex items-center gap-2">
                  <span className="w-12 shrink-0 text-xs text-muted-foreground">Style</span>
                  <div className="flex gap-1.5">
                    {Array.from({ length: CHARACTER_HAIR_STYLES }).map((_, i) => (
                      <button
                        key={i}
                        type="button"
                        aria-label={`Hair style ${i + 1}`}
                        aria-pressed={look.style === i}
                        onClick={() => setLook((l) => ({ ...l, style: i }))}
                        className={cn(
                          "h-6 w-6 rounded-md border text-[10px] font-semibold transition-colors",
                          look.style === i
                            ? "border-primary bg-primary/15 text-foreground"
                            : "border-border text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {i + 1}
                      </button>
                    ))}
                  </div>
                </div>
                <SwatchRow
                  label="Outfit"
                  palette={CHARACTER_OUTFIT}
                  value={look.outfit}
                  onPick={(i) => setLook((l) => ({ ...l, outfit: i }))}
                />
              </div>
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

/** One row of colour swatches for the character builder. */
function SwatchRow({
  label,
  palette,
  value,
  onPick,
}: {
  label: string;
  palette: readonly (readonly [string, string])[];
  value: number;
  onPick: (i: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-12 shrink-0 text-xs text-muted-foreground">{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {palette.map((c, i) => (
          <button
            key={i}
            type="button"
            aria-label={`${label} option ${i + 1}`}
            aria-pressed={value === i}
            onClick={() => onPick(i)}
            style={{ background: c[0] }}
            className={cn(
              "h-6 w-6 rounded-full border transition-transform hover:scale-110",
              value === i ? "border-foreground ring-2 ring-primary/60" : "border-black/20",
            )}
          />
        ))}
      </div>
    </div>
  );
}
