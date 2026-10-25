/**
 * fetch for Android. Requests to other origins go through the NativeHttp plugin, which is the
 * app's only network client: it applies the cleartext rule (http only to loopback, private and
 * link-local addresses, where a user's own node lives) and sends no cookies, no referrer and no
 * WebView user agent. Bodies cross the bridge as base64 so binary blocks and OHTTP work.
 */
import { NativeHttp, isNative } from "./native.ts";
import { b64, unb64 } from "./bytes.ts";

const nativeFetch = window.fetch.bind(window);

async function bodyBytes(body: BodyInit | null | undefined): Promise<Uint8Array | undefined> {
  if (body === undefined || body === null) return undefined;
  if (typeof body === "string") return new TextEncoder().encode(body);
  if (body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (ArrayBuffer.isView(body)) return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
  if (body instanceof Blob) return new Uint8Array(await body.arrayBuffer());
  if (body instanceof URLSearchParams) return new TextEncoder().encode(body.toString());
  throw new TypeError("unsupported request body");
}

export function installFetch(): void {
  if (!isNative()) return;
  // Security audit v1 (item 5): the wallet core asks for mailbox keys through the relay this way.
  (globalThis as { __pbFetchViaRelay?: (relay: string, url: string) => Promise<Uint8Array> }).__pbFetchViaRelay = async (relay, url) =>
    unb64((await NativeHttp.viaRelay({ relay, url })).body);
  window.fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const req = input instanceof Request ? input : null;
    const url = new URL(req ? req.url : String(input), location.href);
    if (url.origin === location.origin) return nativeFetch(input, init);
    const signal = init.signal ?? req?.signal ?? undefined;
    if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
    const headers: Record<string, string> = {};
    new Headers(init.headers ?? req?.headers ?? {}).forEach((v, k) => (headers[k] = v));
    const body = await bodyBytes(init.body ?? (req ? new Uint8Array(await req.clone().arrayBuffer()) : undefined));
    const method = (init.method ?? req?.method ?? "GET").toUpperCase();
    const call = NativeHttp.request({ url: url.href, method, headers, body: body && body.length ? b64(body) : undefined, timeoutMs: 60_000 });
    const res = await (signal
      ? Promise.race([
          call,
          new Promise<never>((_, rej) => signal.addEventListener("abort", () => rej(signal.reason ?? new DOMException("Aborted", "AbortError")), { once: true })),
        ])
      : call).catch((e: unknown) => {
      if (e instanceof DOMException) throw e;
      throw new TypeError(e instanceof Error ? e.message : "network error");
    });
    const bytes = unb64(res.body);
    const nullBody = res.status === 204 || res.status === 304 || method === "HEAD";
    const out = new Response(nullBody ? null : (bytes as unknown as BodyInit), { status: res.status, headers: res.headers });
    Object.defineProperty(out, "url", { value: res.url });
    return out;
  };
}
