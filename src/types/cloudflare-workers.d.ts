declare module "cloudflare:workers" {
  export const env: Record<string, unknown>;
}

declare module "cloudflare:sockets" {
  export function connect(
    address: string | { hostname: string; port: number },
    options?: { secureTransport?: "off" | "on" | "starttls"; allowHalfOpen?: boolean },
  ): any;
}
