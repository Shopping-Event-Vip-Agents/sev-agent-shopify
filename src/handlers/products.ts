import type { RoutedMessage, AgentResponse } from "@domien-sev/shared-types";
import { getProducts, getProductCount } from "@domien-sev/shopify-sdk";
import type { ShopifyAgent } from "../agent.js";

export async function handleProducts(agent: ShopifyAgent, message: RoutedMessage): Promise<AgentResponse> {
  const text = message.text.trim().toLowerCase();

  if (text.startsWith("count")) {
    const [active, draft, archived] = await Promise.all([
      getProductCount(agent.shopify, "active"),
      getProductCount(agent.shopify, "draft"),
      getProductCount(agent.shopify, "archived"),
    ]);

    return {
      channel_id: message.channel_id,
      thread_ts: message.thread_ts ?? message.ts,
      text: [
        "*Product Counts:*",
        `• Active: ${active}`,
        `• Draft: ${draft}`,
        `• Archived: ${archived}`,
        `• Total: ${active + draft + archived}`,
      ].join("\n"),
    };
  }

  // List products, optionally filter by vendor
  const vendorMatch = text.replace(/^(products|list)\s*/i, "").trim();
  const products = await getProducts(agent.shopify, { limit: 25, status: "active" });

  const filtered = vendorMatch
    ? products.filter((p) => p.vendor?.toLowerCase().includes(vendorMatch))
    : products;

  if (filtered.length === 0) {
    return {
      channel_id: message.channel_id,
      thread_ts: message.thread_ts ?? message.ts,
      text: vendorMatch
        ? `No active products found for vendor "${vendorMatch}".`
        : "No active products found.",
    };
  }

  const lines = filtered.slice(0, 20).map(
    (p) => `• *${p.title}* — ${p.vendor ?? "no vendor"} (${p.variants?.length ?? 0} variants, ${p.status})`,
  );

  return {
    channel_id: message.channel_id,
    thread_ts: message.thread_ts ?? message.ts,
    text: [
      `*Products${vendorMatch ? ` (${vendorMatch})` : ""}:* (showing ${lines.length}/${filtered.length})`,
      ...lines,
    ].join("\n"),
  };
}
