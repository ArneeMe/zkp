import { handleSession } from "../../../worker/src/session"

interface Env { KV: KVNamespace; DEV_MODE: string }

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  return handleSession(request, env)
}
