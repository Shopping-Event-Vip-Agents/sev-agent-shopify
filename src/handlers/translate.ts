import type { RoutedMessage, AgentResponse } from "@domien-sev/shared-types";
import {
  getAllTranslatableResources,
  registerTranslation,
} from "@domien-sev/shopify-sdk";
import type { ShopifyAgent } from "../agent.js";

export async function handleTranslate(agent: ShopifyAgent, message: RoutedMessage): Promise<AgentResponse> {
  if (!agent.deepl) {
    return {
      channel_id: message.channel_id,
      thread_ts: message.thread_ts ?? message.ts,
      text: "DeepL is not configured. Set `DEEPL_API_KEY` in .env.",
    };
  }

  // Fetch all translatable resources
  const resources = await getAllTranslatableResources(agent.shopify, "fr");

  // Find products that are missing FR translations
  const untranslated = resources.filter((r) => {
    const translatedKeys = new Set(r.translations.map((t) => t.key));
    return r.translatableContent.some(
      (c) => c.value && c.value.trim() !== "" && !translatedKeys.has(c.key),
    );
  });

  if (untranslated.length === 0) {
    return {
      channel_id: message.channel_id,
      thread_ts: message.thread_ts ?? message.ts,
      text: `All ${resources.length} products already have FR translations.`,
    };
  }

  // Translate in batches (max 10 per run to avoid rate limits)
  const batch = untranslated.slice(0, 10);
  let translated = 0;
  let errors = 0;

  for (const resource of batch) {
    const translatedKeys = new Set(resource.translations.map((t) => t.key));
    const missing = resource.translatableContent.filter(
      (c) => c.value && c.value.trim() !== "" && !translatedKeys.has(c.key),
    );

    if (missing.length === 0) continue;

    try {
      // Translate all missing fields in one DeepL batch
      const sourceTexts = missing.map((c) => c.value);
      const frTexts = await agent.deepl.translateBatch(sourceTexts, "nl", "fr");

      const translations = missing.map((c, i) => ({
        key: c.key,
        value: frTexts[i],
        locale: "fr",
        translatableContentDigest: c.digest,
      }));

      await registerTranslation(agent.shopify, resource.resourceId, translations);
      translated++;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`Translation failed for ${resource.resourceId}: ${errMsg}`);
      errors++;
    }
  }

  return {
    channel_id: message.channel_id,
    thread_ts: message.thread_ts ?? message.ts,
    text: [
      `*Translation run complete:*`,
      `• Translated: ${translated}/${batch.length} products`,
      `• Remaining: ${untranslated.length - batch.length} products`,
      errors > 0 ? `• Errors: ${errors}` : null,
      untranslated.length > batch.length
        ? `\nRun \`translate\` again to continue with the next batch.`
        : null,
    ]
      .filter(Boolean)
      .join("\n"),
  };
}
