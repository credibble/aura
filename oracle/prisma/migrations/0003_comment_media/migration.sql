-- Reaction GIFs on comments: a comment can carry an attached /gifs path.
ALTER TABLE "comments" ADD COLUMN IF NOT EXISTS "media" TEXT;
