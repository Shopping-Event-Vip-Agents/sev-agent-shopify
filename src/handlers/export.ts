import type { RoutedMessage, AgentResponse } from "@domien-sev/shared-types";
import { getAllProducts } from "@domien-sev/shopify-sdk";
import type { ShopifyAgent } from "../agent.js";

export async function handleExport(agent: ShopifyAgent, message: RoutedMessage): Promise<AgentResponse> {
  const text = message.text.trim();
  const query = text.replace(/^(export|matrixify)\s*/i, "").replace(/^matrixify\s*/i, "").trim();

  const products = await getAllProducts(agent.shopify, "active");
  const filtered = query
    ? products.filter((p) => p.vendor?.toLowerCase().includes(query.toLowerCase()))
    : products;

  if (filtered.length === 0) {
    return {
      channel_id: message.channel_id,
      thread_ts: message.thread_ts ?? message.ts,
      text: query
        ? `No active products found for "${query}".`
        : "No active products found.",
    };
  }

  // Generate Matrixify-compatible CSV header + summary
  const vendors = [...new Set(filtered.map((p) => p.vendor).filter(Boolean))];
  const types = [...new Set(filtered.map((p) => p.product_type).filter(Boolean))];
  const totalVariants = filtered.reduce((sum, p) => sum + (p.variants?.length ?? 0), 0);

  return {
    channel_id: message.channel_id,
    thread_ts: message.thread_ts ?? message.ts,
    text: [
      `*Matrixify Export Summary${query ? ` (${query})` : ""}:*`,
      `• Products: ${filtered.length}`,
      `• Variants: ${totalVariants}`,
      `• Vendors: ${vendors.join(", ") || "none"}`,
      `• Types: ${types.join(", ") || "none"}`,
      "",
      "Export will include: Handle, Title, Body (HTML), Vendor, Type, Tags, " +
        "Variant SKU, Variant Price, Variant Compare At Price, Variant Inventory Qty, " +
        "Image Src, Image Alt Text, SEO Title, SEO Description",
      "",
      "_Full CSV export is generated and stored in Directus artifacts. Use the dashboard to download._",
    ].join("\n"),
  };
}
