import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ImagePlus, Loader2, Pencil, X } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AssetAvatar } from "@/components/aura/AssetAvatar";
import { useAuraAuth } from "@/lib/aura-auth";
import { portfolio, type HandleLink } from "@/lib/portfolio";
import { qk } from "@/queries/keys";

/**
 * Edit profile — a pencil that opens one small sheet: pick a photo file, rename,
 * change the symbol. The photo is uploaded by the ORACLE (multipart) and the
 * metadata write is signed server-side, so this is one request with no wallet
 * transaction.
 */
export function EditProfileDialog({ handle }: { handle: HandleLink }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(handle.name);
  const [symbol, setSymbol] = useState(handle.symbol);
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { auth, login } = useAuraAuth();
  const qc = useQueryClient();

  // Object-URL preview for the chosen file; revoked on change/unmount.
  useEffect(() => {
    if (!photo) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(photo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  const dirty = name !== handle.name || symbol !== handle.symbol || photo !== null;
  const canSave = dirty && !pending;

  const save = async () => {
    if (!auth.address) {
      void login();
      toast.info("Connect a wallet to edit your handle");
      return;
    }
    setPending(true);
    try {
      const res = await portfolio.updateHandle(handle.name.toLowerCase(), {
        name: name.trim(),
        symbol: symbol.trim().toUpperCase(),
        photo,
      });
      if (!res) {
        toast.error("Handle not found on-chain");
        return;
      }
      toast.success("Profile updated", { description: `tx ${res.tx.slice(0, 10)}…` });
      void qc.invalidateQueries({ queryKey: qk.handles });
      setOpen(false);
      setPhoto(null);
    } catch (e) {
      toast.error("Update failed", { description: (e as Error).message });
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setPhoto(null);
          setName(handle.name);
          setSymbol(handle.symbol);
        }
      }}
    >
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label="Edit profile"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-border/70 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <Pencil className="h-4 w-4" />
        </button>
      </DialogTrigger>
      <DialogContent className="w-[min(92vw,380px)] max-w-[380px] gap-0 rounded-3xl border-border/70 bg-card p-5 sm:rounded-3xl">
        <DialogTitle className="text-base font-semibold">Edit profile</DialogTitle>
        <p className="mt-1 text-[13px] text-muted-foreground">
          The handle people see everywhere. Uploaded and signed by Aura — no gas.
        </p>

        {/* Photo — a file, previewed in place */}
        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            aria-label="Choose photo"
            className="relative shrink-0 rounded-[24%] transition-opacity hover:opacity-90"
          >
            <AssetAvatar
              asset={{
                id: handle.id,
                symbol: handle.symbol,
                color: "hsl(var(--primary))",
                name: handle.name,
                image: preview ?? undefined,
              }}
              size={56}
              className="border border-border/70"
            />
            <span className="absolute -bottom-1 -right-1 grid h-6 w-6 place-items-center rounded-full border border-border bg-card text-muted-foreground">
              <ImagePlus className="h-3.5 w-3.5" />
            </span>
          </button>
          <div className="min-w-0 flex-1 leading-tight">
            <div className="text-[13px] font-medium">Photo</div>
            <div className="truncate text-xs text-muted-foreground">
              {photo ? photo.name : "PNG or JPG, up to 5 MB"}
            </div>
            {photo && (
              <button
                type="button"
                onClick={() => setPhoto(null)}
                className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-down"
              >
                <X className="h-3 w-3" /> Remove
              </button>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
          />
        </div>

        <div className="mt-4 grid gap-3">
          <label>
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Name
            </span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full rounded-xl border border-border/70 bg-transparent px-3 py-2 text-[15px] font-medium outline-none focus:border-primary/50"
            />
          </label>
          <label>
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Symbol
            </span>
            <input
              value={symbol}
              onChange={(e) => setSymbol(e.target.value.toUpperCase().slice(0, 8))}
              className="num mt-1 w-full rounded-xl border border-border/70 bg-transparent px-3 py-2 text-[15px] outline-none focus:border-primary/50"
            />
          </label>
        </div>

        <button
          type="button"
          onClick={() => void save()}
          disabled={!canSave}
          className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending && <Loader2 className="h-4 w-4 animate-spin" />}
          {pending ? "Saving…" : "Save profile"}
        </button>
      </DialogContent>
    </Dialog>
  );
}
