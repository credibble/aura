/**
 * Test-harness typing: the tests drive contracts by method name, but without
 * generated typechain bindings ethers v6 types every deployed contract as
 * `BaseContract`, which has no dynamic methods (`contract.updateAura(...)` is a
 * type error even though it works at runtime). This module augmentation
 * restores dynamic access for this project's tests.
 */
export {};

declare module "ethers" {
  interface BaseContract {
    [key: string]: any;
  }
}
