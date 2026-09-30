import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Loader2, Send, X } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { AssetAvatar } from "@/components/aura/AssetAvatar";
import { ReactionGifPicker } from "@/components/feeds/ReactionGifPicker";
import { CommentSkeleton } from "@/components/ui/skeletons";
import { InfiniteSentinel } from "@/components/InfiniteSentinel";
import { useAuraAuth } from "@/lib/aura-auth";
import { useAuraContracts } from "@/lib/contracts";
import { useHandles } from "@/lib/handle-store";
import { commentsOptions, useAddComment } from "@/queries/posts";
import { flatPages } from "@/queries/page";
import { cn } from "@/lib/utils";

/**
 * Comments on a feed: a composer (text + optional reaction GIF) and the thread
 * beneath it. Wallet-gated like every other write, and the GIF goes through the
 * oracle's comment endpoint so it renders for everyone.
 */
export function FeedComments({ postId }: { postId: string }) {
  const { address } = useAuraContracts();
  const { login } = useAuraAuth();
  const { handles, activeId } = useHandles();
  const active = handles.find((h) => h.id === activeId) ?? handles[0];
  const viewer = address?.toLowerCase() ?? null;

  const [text, setText] = useState("");
  const [gif, setGif] = useState<string | null>(null);
  const add = useAddComment(postId);
  const query = useInfiniteQuery(commentsOptions(postId, viewer));
  const comments = flatPages(query.data?.pages);

  const canSend = (text.trim().length > 0 || !!gif) && !!viewer && !add.isPending;

  const submit = () => {
    if (!viewer) {
      void login();
      return;
    }
    if (!canSend) return;
    add.mutate(
      {
        user: viewer,
        handle: active
          ? `@${(active.symbol || active.name).toLowerCase()}`
          : `@${viewer.slice(0, 8)}`,
        text: text.trim(),
        media: gif,
      },
      {
        onSuccess: () => {
          setText("");
          setGif(null);
        },
      },
    );
  };

  return (
    <section className="px-4 py-5 sm:px-6">
      <h2 className="text-sm font-semibold">
        Comments
        {comments.length > 0 && (
          <span className="num ml-1.5 text-muted-foreground">{comments.length}</span>
        )}
      </h2>

      {/* Composer */}
      <div className="mt-3 flex items-start gap-3">
        <AssetAvatar
          asset={{
            id: active?.id ?? viewer ?? "guest",
            symbol: (active?.symbol ?? active?.name ?? viewer ?? "you").toUpperCase().slice(0, 4),
            color: "hsl(var(--primary))",
            name: active?.name ?? "You",
          }}
          size={34}
          className="shrink-0 border border-border/70"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-end gap-1.5 border-b border-border/70 pb-1.5 focus-within:border-primary/50">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
              }}
              rows={1}
              placeholder={viewer ? "Add a comment…" : "Connect a wallet to comment…"}
              className="max-h-32 min-h-9 w-full resize-none bg-transparent py-2 text-[14px] leading-5 outline-none placeholder:text-muted-foreground/60"
            />
            <ReactionGifPicker onPick={setGif} />
            <button
              type="button"
              onClick={submit}
              disabled={!canSend}
              aria-label="Post comment"
              className={cn(
                "mb-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full transition-colors",
                canSend
                  ? "bg-primary text-primary-foreground hover:brightness-110"
                  : "text-muted-foreground/50",
              )}
            >
              {add.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
            </button>
          </div>

          {gif && (
            <div className="relative mt-2 w-fit">
              <img
                src={gif}
                alt="reaction"
                className="h-[92px] rounded-xl border border-border/70 object-cover"
              />
              <button
                type="button"
                onClick={() => setGif(null)}
                aria-label="Remove GIF"
                className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full border border-border bg-card text-muted-foreground hover:text-down"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Thread */}
      <div className="mt-5 divide-y divide-border/60">
        {query.isPending && [0, 1].map((i) => <CommentSkeleton key={i} withGif={i === 1} />)}

        {comments.map((c) => (
          <div key={c.id} className="flex items-start gap-3 py-3.5">
            <Avatar
              seed={c.user}
              size={32}
              alt={c.user}
              className="shrink-0 border border-border/70"
            />
            <div className="min-w-0 flex-1 leading-tight">
              <div className="flex items-center gap-1.5 text-[13px]">
                <span className="truncate font-semibold">{c.user}</span>
                <span className="truncate text-muted-foreground">{c.handle}</span>
                <span className="shrink-0 text-muted-foreground">· {c.ts}</span>
                {c.mine && (
                  <span className="shrink-0 rounded-full border border-border/70 px-1.5 text-[10px] text-muted-foreground">
                    you
                  </span>
                )}
              </div>
              {c.text && <p className="mt-1 text-[14px] leading-relaxed">{c.text}</p>}
              {c.media && (
                <img
                  src={c.media}
                  alt="reaction"
                  loading="lazy"
                  className="mt-2 h-[96px] rounded-xl border border-border/70 object-cover"
                />
              )}
            </div>
          </div>
        ))}

        {!query.isPending && comments.length === 0 && (
          <p className="py-6 text-[13px] text-muted-foreground">No comments yet — be the first.</p>
        )}

        {query.hasNextPage && (
          <InfiniteSentinel
            ready={!query.isFetchingNextPage}
            onEnd={() => void query.fetchNextPage()}
          />
        )}
      </div>
    </section>
  );
}
