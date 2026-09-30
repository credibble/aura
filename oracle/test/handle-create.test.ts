import { describe, expect, it } from "vitest";
import { BadRequestException, ServiceUnavailableException } from "@nestjs/common";
import { HandleCreateService } from "../src/api/handle-create.service";

const CONFIGURED = {
  HANDLE_OWNER_PRIVATE_KEY: "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  HANDLE_FACTORY_ADDRESS: "0x00000000000000000000000000000000000000f1",
  RPC_URL: "http://127.0.0.1:8545",
};

function makeService(
  vars: Record<string, string> = {},
  availability: { available: boolean; reason: string } = { available: true, reason: "available" },
) {
  const config = { get: (k: string) => vars[k] } as never;
  const portfolio = { availability: async () => availability } as never;
  return new HandleCreateService(config, portfolio);
}

const input = { name: "bitcoin", symbol: "BTC", categories: [1_000_001], windowMinutes: 15 };

describe("HandleCreateService", () => {
  it("503s until HANDLE_OWNER_PRIVATE_KEY and HANDLE_FACTORY_ADDRESS are set", async () => {
    await expect(makeService().create("0xabc", input)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    const noRpc = {
      HANDLE_OWNER_PRIVATE_KEY: CONFIGURED.HANDLE_OWNER_PRIVATE_KEY,
      HANDLE_FACTORY_ADDRESS: CONFIGURED.HANDLE_FACTORY_ADDRESS,
    };
    await expect(makeService(noRpc).create("0xabc", input)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    const rpcOnly = { RPC_URL: CONFIGURED.RPC_URL };
    await expect(makeService(rpcOnly).create("0xabc", input)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it("rejects malformed name, symbol, category and windowMinutes", async () => {
    const service = makeService(CONFIGURED);
    const creator = "0x1111111111111111111111111111111111111111";
    await expect(service.create(creator, { ...input, name: "ab" })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.create(creator, { ...input, name: "Bad Name!" })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.create(creator, { ...input, symbol: "TOOLONGSYM" })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.create(creator, { ...input, categories: [0.5] })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.create(creator, { ...input, categories: [] })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      service.create(creator, { ...input, categories: [1, 2, 3, 4, 5] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.create(creator, { ...input, windowMinutes: 20 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.create("not-an-address", input)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("surfaces the claim flow's availability rejection (reserved / claimed / CVI)", async () => {
    const service = makeService(CONFIGURED, { available: false, reason: "reserved" });
    const creator = "0x1111111111111111111111111111111111111111";
    await expect(service.create(creator, input)).rejects.toThrow(/not available \(reserved\)/);
  });
});
