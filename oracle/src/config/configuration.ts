import { validateEnv, type Env } from "./env";

export const configuration = (): Env => validateEnv(process.env);