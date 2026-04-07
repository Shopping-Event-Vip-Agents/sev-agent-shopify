import type { RoutedMessage, AgentResponse } from "@domien-sev/shared-types";
import { getProducts, updateProduct } from "@domien-sev/shopify-sdk";
import type { ShopifyAgent } from "../agent.js";

export async function handleEnrich(agent: ShopifyAgent, message: RoutedMessage): Promise<AgentResponse> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      channel_id: message.channel_id,
      thread_ts: message.thread_ts ?? message.ts,
      text: "AI enrichment requires `ANTHROPIC_API_KEY` in .env.",
    };
  }

  const text = message.text.trim();
  const query = text.replace(/^(enrich|enhance)\s*/i, "").trim();

  // Fetch products to enrich
  const products = await getProducts(agent.shopify, { limit: 50, status: "active" });
  const filtered = query
    ? products.filter(
        (p) =>
          p.title?.toLowerCase().includes(query.toLowerCase()) ||
          p.vendor?.toLowerCase().includes(query.toLowerCase()),
      )
    : products.filter((p) => !p.body_html || p.body_html.trim().length < 50);

  if (filtered.length === 0) {
    return {
      channel_id: message.channel_id,
      thread_ts: message.thread_ts ?? message.ts,
      text: query
        ? `No products matching "${query}" need enrichment.`
        : "No products need enrichment (all have descriptions > 50 chars).",
    };
  }

  // Enrich up to 5 products per run
  const batch = filtered.slice(0, 5);
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const claude = new Anthropic();
  let enriched = 0;

  for (const product of batch) {
    try {
      const prompt = [
        `Write a compelling product description in Dutch (NL) for this fashion product:`,
        `- Title: ${product.title}`,
        `- Vendor: ${product.vendor ?? "unknown"}`,
        `- Type: ${product.product_type ?? "unknown"}`,
        `- Tags: ${product.tags ?? "none"}`,
        product.body_html ? `- Current description: ${product.body_html.substring(0, 200)}` : null,
        ``,
        `Requirements:`,
        `- 2-3 paragraphs, HTML formatted`,
        `- Highlight materials, fit, and styling tips`,
        `- Professional tone, appealing to fashion-conscious shoppers`,
        `- Dutch language only`,
      ]
        .filter(Boolean)
        .join("\n");

      const response = await claude.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 500,
        messages: [{ role: "user", content: prompt }],
      });

      const newDescription =
        response.content[0].type === "text" ? response.content[0].text : "";

      if (newDescription) {
        await updateProduct(agent.shopify, product.id, {
          body_html: newDescription,
        });
        enriched++;
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`Enrichment failed for ${product.title}: ${errMsg}`);
    }
  }

  return {
    channel_id: message.channel_id,
    thread_ts: message.thread_ts ?? message.ts,
    text: [
      `*Enrichment complete:*`,
      `• Enriched: ${enriched}/${batch.length} products`,
      `• Remaining: ${filtered.length - batch.length}`,
      filtered.length > batch.length
        ? `\nRun \`enrich${query ? ` ${query}` : ""}\` again to continue.`
        : null,
    ]
      .filter(Boolean)
      .join("\n"),
  };
}
