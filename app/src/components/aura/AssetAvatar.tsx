import { Avatar } from "@/components/Avatar";

type AvatarSource = {
  /** Canonical identity (bytes32 handleId / address) — preferred seed. */
  id?: string;
  symbol: string;
  color: string;
  name?: string;
  image?: string;
  imageFit?: "cover" | "contain";
  /** Raw on-chain metadata JSON — <Avatar> parses the `photo` out of it. */
  metadata?: string | null;
};

/**
 * Thin adapter kept for existing call sites — all rendering lives in
 * <Avatar>, the single source of truth (Jazzicon identicon, rounded square).
 */
export function AssetAvatar({
  asset,
  size = 36,
  className,
}: {
  asset: AvatarSource;
  size?: number;
  className?: string;
}) {
  return (
    <Avatar
      seed={asset.id ?? asset.name ?? asset.symbol}
      image={asset.image}
      metadata={asset.metadata}
      imageFit={asset.imageFit}
      size={size}
      alt={asset.name ?? asset.symbol}
      className={className}
    />
  );
}
