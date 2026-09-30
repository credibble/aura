-- Backend aura snapshots are gone. The subgraph indexes every on-chain aura
-- record (value + delta + summary) and that series is the only aura history the
-- frontend reads, so the backend no longer keeps its own copy.
DROP TABLE IF EXISTS "aura_snapshots";
