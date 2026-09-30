import { useCallback, useMemo } from "react";
import { useWallets } from "@privy-io/react-auth";
import {
  createPublicClient,
  createWalletClient,
  custom,
  encodeFunctionData,
  http,
  type Address,
  type Hash,
  type TransactionReceipt,
} from "viem";
import {
  monad,
  CONTRACTS,
  MARKET_MAKER_ABI,
  ORDER_BOOK_ABI,
  STAKE_ABI,
  POOL_ABI,
  ERC20_ABI,
  HANDLE_ABI,
  MINT_ABI,
} from "./chain";

/** A write result — hash + the confirmed receipt (waits for confirmations). */
export type ConfirmedWrite = { hash: Hash; receipt: TransactionReceipt };

/**
 * Privy + viem contract layer. The Privy EMBEDDED WALLET is the signer (beyond
 * auth): every write is signed via its EIP-1193 provider with a viem wallet
 * client, then WAITS for the transaction receipt (confirmations). Read calls
 * use a public client on Monad. Addresses come from VITE_*_ADDRESS.
 */
export function useAuraContracts() {
  const { wallets } = useWallets();
  const wallet = useMemo(
    () => wallets.find((w) => w.connectorType === "embedded") ?? wallets[0] ?? null,
    [wallets],
  );

  const publicClient = useMemo(() => createPublicClient({ chain: monad, transport: http() }), []);

  /** Sign + submit a raw call via the Privy wallet, then wait for its receipt. */
  const sendAndConfirm = useCallback(
    async (
      to: Address,
      data: `0x${string}`,
      value: bigint = 0n,
      confirmations = 1,
    ): Promise<ConfirmedWrite> => {
      if (!wallet) throw new Error("No Privy wallet connected");
      await wallet.switchChain?.(monad.id);
      const provider = await wallet.getEthereumProvider();
      const walletClient = createWalletClient({
        chain: monad,
        transport: custom(provider),
        account: wallet.address as Address,
      });
      const hash = await walletClient.sendTransaction({ to, data, value, chain: monad });
      const receipt = await publicClient.waitForTransactionReceipt({
        hash,
        confirmations,
        timeout: 120_000,
      });
      if (receipt.status !== "success") throw new Error(`Tx ${hash} reverted`);
      return { hash, receipt };
    },
    [wallet, publicClient],
  );

  /** Encode a contract write (ABI + function + args) → calldata. */
  const write = useCallback(
    (abi: readonly unknown[], fn: string, args: readonly unknown[] = []) =>
      (
        encodeFunctionData as unknown as (x: {
          abi: readonly unknown[];
          functionName: string;
          args: readonly unknown[];
        }) => `0x${string}`
      )({ abi, functionName: fn, args }),
    [],
  );

  const addr = (name: keyof typeof CONTRACTS): Address => {
    const a = CONTRACTS[name];
    if (!a) throw new Error(`${name.toUpperCase()}_ADDRESS not configured`);
    return a as Address;
  };

  /** Unlimited approval — used for trusted, user-chosen spenders (vaults). */
  const MAX_UINT256 = (1n << 256n) - 1n;

  const api = useMemo(() => {
    const market = () => addr("marketMaker");
    const orderBook = () => addr("orderBook");
    const pool = () => addr("pool");
    const aura = () => addr("auraToken");
    const usdc = () => addr("usdc");
    /** Account for reads that default to the connected wallet — throws a
     *  friendly error instead of passing `undefined` into viem. */
    const holder = (account?: Address): Address => {
      if (account) return account;
      if (wallet?.address) return wallet.address as Address;
      throw new Error("Connect a wallet to read balances");
    };

    return {
      // --- ERC20 (any token — balance / allowance / approve / transfer) ----
      /** Read a token balance (defaults to the connected wallet). */
      readTokenBalance: (token: Address, account?: Address) =>
        publicClient.readContract({
          address: token,
          abi: ERC20_ABI,
          functionName: "balanceOf",
          args: [holder(account)],
        }),
      /** Read an allowance for any token. */
      readAllowance: (token: Address, owner: Address, spender: Address) =>
        publicClient.readContract({
          address: token,
          abi: ERC20_ABI,
          functionName: "allowance",
          args: [owner, spender],
        }),
      /** Approve `spender` to move `amount` of `token` — confirmed. */
      approve: (token: Address, spender: Address, amount: bigint) =>
        sendAndConfirm(token, write(ERC20_ABI, "approve", [spender, amount])),
      /**
       * Ensure `spender` can pull at least `amount` of USDC. Approves MAX once
       * (a market/vault is an address you chose) so a trade can never fail on a
       * stale or too-small allowance — "exceeds allowance" reverts mid-trade
       * were the whole reason for the second signature.
       */
      ensureUsdcAllowance: async (spender: Address, amount: bigint): Promise<boolean> => {
        if (!wallet) throw new Error("No Privy wallet connected");
        const owner = wallet.address as Address;
        const current = (await publicClient.readContract({
          address: usdc(),
          abi: ERC20_ABI,
          functionName: "allowance",
          args: [owner, spender],
        })) as bigint;
        if (current >= amount) return false;
        await sendAndConfirm(usdc(), write(ERC20_ABI, "approve", [spender, MAX_UINT256]));
        return true;
      },
      /**
       * Test-collateral faucet. The deployed USDC is `MockUSDC` on testnet (its
       * `mint` is public), so a fresh wallet can fund itself instead of staring
       * at an un-funded balance — every trade otherwise reverts on transfer.
       */
      mintUsdc: async (amount: bigint): Promise<ConfirmedWrite> => {
        if (!wallet) throw new Error("No Privy wallet connected");
        return sendAndConfirm(usdc(), write(MINT_ABI, "mint", [wallet.address as Address, amount]));
      },
      /**
       * Ensure a stake vault can pull at least `amount` AURA. Approves MAX once
       * (a staking vault is an address you chose) so later deposits need no
       * extra signature; skips entirely when the allowance already covers it.
       */
      ensureAuraAllowance: async (spender: Address, amount: bigint): Promise<boolean> => {
        if (!wallet) throw new Error("No Privy wallet connected");
        const owner = wallet.address as Address;
        const current = (await publicClient.readContract({
          address: aura(),
          abi: ERC20_ABI,
          functionName: "allowance",
          args: [owner, spender],
        })) as bigint;
        if (current >= amount) return false;
        await sendAndConfirm(aura(), write(ERC20_ABI, "approve", [spender, MAX_UINT256]));
        return true;
      },

      // --- MarketMaker ---------------------------------------------------
      /** Buy shares of an outcome with `amountIn` USDC (minShares = slippage guard). */
      buy: (oracle: Address, outcome: bigint, amountIn: bigint, minShares = 0n) =>
        sendAndConfirm(
          market(),
          write(MARKET_MAKER_ABI, "buy", [oracle, outcome, amountIn, minShares]),
        ),
      /** Cash out / sell shares before settlement at the live LMSR price. */
      sell: (oracle: Address, outcome: bigint, delta: bigint, minProceeds = 0n) =>
        sendAndConfirm(
          market(),
          write(MARKET_MAKER_ABI, "sell", [oracle, outcome, delta, minProceeds]),
        ),
      /** Redeem winning shares 1:1 after settlement. */
      claim: (oracle: Address, outcome: bigint) =>
        sendAndConfirm(market(), write(MARKET_MAKER_ABI, "claim", [oracle, outcome])),
      /** Live LMSR price of an outcome (1e18 = 100%). */
      readPrice: (oracle: Address, outcome: bigint) =>
        publicClient.readContract({
          address: market(),
          abi: MARKET_MAKER_ABI,
          functionName: "priceOf",
          args: [oracle, outcome],
        }),
      /** USDC proceeds for burning `delta` shares at the live LMSR price. */
      readSellProceeds: (oracle: Address, outcome: bigint, delta: bigint) =>
        publicClient.readContract({
          address: market(),
          abi: MARKET_MAKER_ABI,
          functionName: "sellProceeds",
          args: [oracle, outcome, delta],
        }),
      /** Exact LMSR cost of minting `delta` shares (the buy-side quote). */
      readBuyCost: (oracle: Address, outcome: bigint, delta: bigint) =>
        publicClient.readContract({
          address: market(),
          abi: MARKET_MAKER_ABI,
          functionName: "buyCost",
          args: [oracle, outcome, delta],
        }) as Promise<bigint>,
      /** Trading fee (bps) the market charges on buys/sells. */
      readMarketFeeBps: () =>
        publicClient.readContract({
          address: market(),
          abi: MARKET_MAKER_ABI,
          functionName: "feeBips",
        }) as Promise<bigint>,
      /** The account's outcome-share balance (sell / sell-limit validation). */
      readOutcomeShares: (oracle: Address, outcome: bigint, account?: Address) =>
        publicClient.readContract({
          address: market(),
          abi: MARKET_MAKER_ABI,
          functionName: "shares",
          args: [holder(account), oracle, outcome],
        }) as Promise<bigint>,
      /** Is this window still open for trading? */
      readWindowOpen: (oracle: Address) =>
        publicClient.readContract({
          address: market(),
          abi: MARKET_MAKER_ABI,
          functionName: "isOpen",
          args: [oracle],
        }) as Promise<boolean>,
      /** Allow the OrderBook to escrow this account's outcome shares (sell side). */
      approveOutcomeShares: (oracle: Address, outcome: bigint, amount: bigint) =>
        sendAndConfirm(market(), write(MARKET_MAKER_ABI, "approve", [oracle, outcome, amount])),

      // --- OrderBook (resting limit orders) -------------------------------
      /**
       * Rest a limit order: side=true buys `size` shares at `price` (1e18),
       * escrowing size×price USDC; side=false sells `size` shares (needs an
       * outcome-share approval first). `expiresAt` = unix seconds (0 = never).
       */
      placeOrder: (
        oracle: Address,
        outcome: bigint,
        side: boolean,
        price: bigint,
        size: bigint,
        expiresAt: bigint,
      ) =>
        sendAndConfirm(
          orderBook(),
          write(ORDER_BOOK_ABI, "placeOrder", [oracle, outcome, side, price, size, expiresAt]),
        ),
      /** Cancel a resting order — escrow returns to the maker. */
      cancelOrder: (oracle: Address, orderId: `0x${string}`) =>
        sendAndConfirm(orderBook(), write(ORDER_BOOK_ABI, "cancelOrder", [oracle, orderId])),

      // --- Stake vault (per-handle) --------------------------------------
      stakeDeposit: (stakeAddress: Address, amount: bigint) =>
        sendAndConfirm(stakeAddress, write(STAKE_ABI, "deposit", [amount])),
      stakeWithdraw: (stakeAddress: Address, shares: bigint) =>
        sendAndConfirm(stakeAddress, write(STAKE_ABI, "withdraw", [shares])),
      stakeReward: (stakeAddress: Address, amount: bigint, memo: string) =>
        sendAndConfirm(stakeAddress, write(STAKE_ABI, "reward", [amount, memo])),
      /** Vault state: total AURA staked on the handle, shares out, share price. */
      readStakeStats: async (
        stakeAddress: Address,
      ): Promise<{ totalAssets: bigint; totalSupply: bigint; valuePerToken: bigint }> => {
        const [totalAssets, totalSupply, valuePerToken] = (await Promise.all([
          publicClient.readContract({
            address: stakeAddress,
            abi: STAKE_ABI,
            functionName: "totalAssets",
          }),
          publicClient.readContract({
            address: stakeAddress,
            abi: ERC20_ABI,
            functionName: "totalSupply",
          }),
          publicClient.readContract({
            address: stakeAddress,
            abi: STAKE_ABI,
            functionName: "valuePerToken",
          }),
        ])) as [bigint, bigint, bigint];
        return { totalAssets, totalSupply, valuePerToken };
      },
      /** The account's stake receipts (the vault is an ERC20 of shares). */
      readStakeShares: (stakeAddress: Address, account?: Address) =>
        publicClient.readContract({
          address: stakeAddress,
          abi: ERC20_ABI,
          functionName: "balanceOf",
          args: [holder(account)],
        }) as Promise<bigint>,
      /** AURA value of the account's stake receipts. */
      readStakeEarned: (stakeAddress: Address, account?: Address) =>
        publicClient.readContract({
          address: stakeAddress,
          abi: STAKE_ABI,
          functionName: "earned",
          args: [holder(account)],
        }) as Promise<bigint>,

      // --- Pool (auraLP vault) -------------------------------------------
      poolDeposit: (amount: bigint) => sendAndConfirm(pool(), write(POOL_ABI, "deposit", [amount])),
      poolWithdraw: (shares: bigint) =>
        sendAndConfirm(pool(), write(POOL_ABI, "withdraw", [shares])),
      /** auraLP receipt balance (the Pool contract is itself an ERC20). */
      readPoolShares: (account?: Address) =>
        publicClient.readContract({
          address: pool(),
          abi: ERC20_ABI,
          functionName: "balanceOf",
          args: [holder(account)],
        }) as Promise<bigint>,
      /** USDC value of the account's auraLP receipts. */
      readPoolEarned: (account?: Address) =>
        publicClient.readContract({
          address: pool(),
          abi: POOL_ABI,
          functionName: "earned",
          args: [holder(account)],
        }) as Promise<bigint>,
      /** Aggregate pool state: depth, idle/reserved split, share value, supply. */
      readPoolStats: async (): Promise<{
        totalAssets: bigint;
        idle: bigint;
        reserved: bigint;
        valuePerToken: bigint;
        totalSupply: bigint;
      }> => {
        const [totalAssets, idle, reserved, valuePerToken, totalSupply] = (await Promise.all([
          publicClient.readContract({
            address: pool(),
            abi: POOL_ABI,
            functionName: "totalAssets",
          }),
          publicClient.readContract({ address: pool(), abi: POOL_ABI, functionName: "idle" }),
          publicClient.readContract({
            address: pool(),
            abi: POOL_ABI,
            functionName: "totalReserved",
          }),
          publicClient.readContract({
            address: pool(),
            abi: POOL_ABI,
            functionName: "valuePerToken",
          }),
          publicClient.readContract({
            address: pool(),
            abi: ERC20_ABI,
            functionName: "totalSupply",
          }),
        ])) as [bigint, bigint, bigint, bigint, bigint];
        return { totalAssets, idle, reserved, valuePerToken, totalSupply };
      },

      // --- AURA -----------------------------------------------------------
      approveAura: (spender: Address, amount: bigint) =>
        sendAndConfirm(aura(), write(ERC20_ABI, "approve", [spender, amount])),
      /** AURA balance of the connected wallet (stake pre-flight). */
      readAuraBalance: (account?: Address) =>
        publicClient.readContract({
          address: aura(),
          abi: ERC20_ABI,
          functionName: "balanceOf",
          args: [holder(account)],
        }) as Promise<bigint>,

      // --- Handle (creator-user actions only) -----------------------------
      // Protocol/oracle writes (settle, updateAura, claimProtocol) live in the
      // relayer / CRE workflow — NOT the frontend.
      handleClaim: (handleAddress: Address) =>
        sendAndConfirm(handleAddress, write(HANDLE_ABI, "claim", [])),
      /** Claimable creator revenue — the USDC held by the Handle contract. */
      readHandleRevenue: (handleAddress: Address) =>
        publicClient.readContract({
          address: usdc(),
          abi: ERC20_ABI,
          functionName: "balanceOf",
          args: [handleAddress],
        }) as Promise<bigint>,
      handleAddSource: (handleAddress: Address, source: string) =>
        sendAndConfirm(handleAddress, write(HANDLE_ABI, "addSource", [source])),
      /** Owner-only profile edit — name/symbol/photo ride in the metadata JSON. */
      handleSetMetadata: (handleAddress: Address, metadata: string) =>
        sendAndConfirm(handleAddress, write(HANDLE_ABI, "setMetadata", [metadata])),
    };
  }, [sendAndConfirm, write]);

  return {
    address: (wallet?.address ?? null) as Address | null,
    wallet,
    publicClient,
    sendAndConfirm,
    api,
  };
}
