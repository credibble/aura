import { Avatar } from "@/components/Avatar";
import { useHandleArtwork } from "@/queries/handles";

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
 * The handle avatar for call sites that hold an id/name/symbol but not the
 * metadata. All rendering lives in <Avatar> (Jazzicon identicon, rounded square);
 * THIS component resolves the real photo, so a call site cannot forget it.
 *
 * That was a recurring bug: every inline `asset={{ id, symbol, name }}` rendered
 * an identicon even though the handle had a photo — the leaderboard, "Who to
 * follow", search results, feed rows. Resolution order:
 *   1. an explicit `image`            (caller knows best)
 *   2. the handle's on-chain metadata by id
 *   3. …by display name / symbol
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
  const artwork = useHandleArtwork();
  const resolved = asset.image
    ? { image: asset.image, imageFit: asset.imageFit }
    : (() => {
        const byId = artwork(asset.id);
        if (byId.image) return byId;
        // Some rows only know a display name ("@elon", "Elon Musk").
        return artwork(asset.name ?? asset.symbol);
      })();

  return (
    <Avatar
      seed={asset.id ?? asset.name ?? asset.symbol}
      image={resolved.image}
      metadata={asset.metadata}
      imageFit={asset.imageFit ?? resolved.imageFit}
      size={size}
      alt={asset.name ?? asset.symbol}
      className={className}
    />
  );
}
