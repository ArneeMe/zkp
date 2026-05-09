import { handleHealth } from "../../worker/src/verify"

interface Env { KV: KVNamespace; DEV_MODE: string }

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  return handleHealth(request, env)
}
