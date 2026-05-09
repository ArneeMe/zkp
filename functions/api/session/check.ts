import { handleSessionCheck } from "../../../worker/src/session"

interface Env { KV: KVNamespace; DEV_MODE: string }

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  return handleSessionCheck(request, env)
}
