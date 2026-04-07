import type { RoutedMessage, AgentResponse } from "@domien-sev/shared-types";
import {
  getAllTranslatableResources,
  getProductCount,
} from "@domien-sev/shopify-sdk";
import type { ShopifyAgent } from "../agent.js";

export async function handleStatus(agent: ShopifyAgent, message: RoutedMessage): Promise<AgentResponse> {
  const text = message.text.trim().toLowerCase();

  const [activeCount, resources] = await Promise.all([
    getProductCount(agent.shopify, "active"),
    getAllTranslatableResources(agent.shopify, "fr"),
  ]);

  const fullyTranslated = resources.filter((r) => {
    const translatedKeys = new Set(r.translations.map((t) => t.key));
    return r.translatableContent.every(
      (c) => !c.value || c.value.trim() === "" || translatedKeys.has(c.key),
    );
  });

  const untranslated = resources.length - fullyTranslated.length;
  const pct = resources.length > 0 ? Math.round((fullyTranslated.length / resources.length) * 100) : 100;

  // If "scan untranslated", show individual products
  if (text.includes("untranslated") || text.includes("scan")) {
    const missing = resources.filter((r) => {
      const translatedKeys = new Set(r.translations.map((t) => t.key));
      return r.translatableContent.some(
        (c) => c.value && c.value.trim() !== "" && !translatedKeys.has(c.key),
      );
    });

    const lines = missing.slice(0, 20).map((r) => {
      const translatedKeys = new Set(r.translations.map((t) => t.key));
      const missingFields = r.translatableContent
        .filter((c) => c.value && c.value.trim() !== "" && !translatedKeys.has(c.key))
        .map((c) => c.key);
      return `• \`${r.resourceId}\` — missing: ${missingFields.join(", ")}`;
    });

    return {
      channel_id: message.channel_id,
      thread_ts: message.thread_ts ?? message.ts,
      text: [
        `*Untranslated Products:* ${missing.length} found`,
        ...lines,
        missing.length > 20 ? `\n…and ${missing.length - 20} more` : null,
        `\nRun \`translate\` to start translating.`,
      ]
        .filter(Boolean)
        .join("\n"),
    };
  }

  // General status
  const deeplStatus = agent.deepl ? "connected" : "not configured";

  return {
    channel_id: message.channel_id,
    thread_ts: message.thread_ts ?? message.ts,
    text: [
      "*Shopify Agent Status:*",
      `• Shop: ${agent.shopify.shopName}`,
      `• Active products: ${activeCount}`,
      `• FR translation: ${fullyTranslated.length}/${resources.length} (${pct}%)`,
      `• Untranslated: ${untranslated}`,
      `• DeepL: ${deeplStatus}`,
    ].join("\n"),
  };
}
