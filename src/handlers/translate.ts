/**
 * Translation handler — checks and fixes missing French translations
 * for Shopify products using DeepL.
 */

import type { RoutedMessage, AgentResponse } from "@domien-sev/shared-types";
import type { ShopifyAgent } from "../agent.js";
import {
  getAllProducts,
  getProductTranslations,
  registerTranslation,
} from "@domien-sev/shopify-sdk";
import type { ShopifyProduct } from "@domien-sev/shopify-sdk";

const SCAN_LIMIT = 50;

/**
 * Handle translation requests.
 * - If a specific product handle/title is mentioned, check that product
 * - Otherwise, scan recent products for missing FR translations
 */
export async function handleTranslate(
  message: RoutedMessage,
  agent: ShopifyAgent,
): Promise<AgentResponse> {
  if (!agent.shopifyClient) {
    return agent.reply(
      message,
      "Shopify client not configured. Set SHOPIFY_SHOP and SHOPIFY_ACCESS_TOKEN environment variables.",
    );
  }

  if (!agent.deeplClient) {
    return agent.reply(
      message,
      "DeepL client not configured. Set DEEPL_API_KEY environment variable.",
    );
  }

  const text = message.text.toLowerCase();

  // Check if user is asking about a specific product
  const specificProduct = extractProductReference(message.text);

  try {
    agent.status = "busy";

    if (specificProduct) {
      return await handleSpecificProductTranslation(message, agent, specificProduct);
    }

    return await handleBulkTranslationScan(message, agent);
  } catch (err) {
    agent.status = "online";
    const errMsg = err instanceof Error ? err.message : String(err);
    return agent.reply(message, `Translation check failed: ${errMsg}`);
  }
}

/**
 * Check and translate a specific product.
 */
async function handleSpecificProductTranslation(
  message: RoutedMessage,
  agent: ShopifyAgent,
  productRef: string,
): Promise<AgentResponse> {
  const products = await getAllProducts(agent.shopifyClient!, { limit: 250 });
  const product = products.find(
    (p) =>
      p.handle === productRef.toLowerCase() ||
      p.title.toLowerCase().includes(productRef.toLowerCase()),
  );

  if (!product) {
    agent.status = "online";
    return agent.reply(
      message,
      `Could not find product matching "${productRef}". Try using the exact product handle or title.`,
    );
  }

  // Check existing translations via GraphQL
  const translations = await getProductTranslations(
    agent.shopifyClient!,
    `gid://shopify/Product/${product.id}`,
    "fr",
  );

  const titleTranslation = translations.find((t) => t.key === "title");
  const descTranslation = translations.find((t) => t.key === "body_html");

  const missingFields: string[] = [];
  const translatedFields: string[] = [];

  // Translate missing title
  if (!titleTranslation?.value && product.title) {
    const frTitle = await agent.deeplClient!.translateText(product.title);
    await registerTranslation(
      agent.shopifyClient!,
      `gid://shopify/Product/${product.id}`,
      "fr",
      [{ key: "title", value: frTitle, translatableContentDigest: titleTranslation?.translatableContent?.digest ?? "" }],
    );
    translatedFields.push(`Title: "${frTitle}"`);
  } else if (titleTranslation?.value) {
    translatedFields.push(`Title: "${titleTranslation.value}" (existing)`);
  } else {
    missingFields.push("title (no source text)");
  }

  // Translate missing description
  if (!descTranslation?.value && product.body_html) {
    const frDesc = await agent.deeplClient!.translateText(product.body_html);
    await registerTranslation(
      agent.shopifyClient!,
      `gid://shopify/Product/${product.id}`,
      "fr",
      [{ key: "body_html", value: frDesc, translatableContentDigest: descTranslation?.translatableContent?.digest ?? "" }],
    );
    translatedFields.push(`Description: translated (${frDesc.substring(0, 60)}...)`);
  } else if (descTranslation?.value) {
    translatedFields.push(`Description: exists (${descTranslation.value.substring(0, 60)}...)`);
  } else {
    missingFields.push("description (no source text)");
  }

  agent.status = "online";

  const lines = [
    `**Translation check: ${product.title}** (${product.handle})`,
    "",
  ];

  if (translatedFields.length > 0) {
    lines.push("French translations:");
    for (const field of translatedFields) {
      lines.push(`  - ${field}`);
    }
  }

  if (missingFields.length > 0) {
    lines.push("");
    lines.push("Could not translate:");
    for (const field of missingFields) {
      lines.push(`  - ${field}`);
    }
  }

  return agent.reply(message, lines.join("\n"));
}

/**
 * Scan recent products for missing French translations and auto-translate.
 */
async function handleBulkTranslationScan(
  message: RoutedMessage,
  agent: ShopifyAgent,
): Promise<AgentResponse> {
  const products = await getAllProducts(agent.shopifyClient!, { limit: SCAN_LIMIT });

  let missingCount = 0;
  let translatedCount = 0;
  const issues: string[] = [];

  for (const product of products) {
    const translations = await getProductTranslations(
      agent.shopifyClient!,
      `gid://shopify/Product/${product.id}`,
      "fr",
    );

    const titleTranslation = translations.find((t) => t.key === "title");
    const descTranslation = translations.find((t) => t.key === "body_html");

    const fieldsToTranslate: Array<{
      key: string;
      value: string;
      translatableContentDigest: string;
    }> = [];

    if (!titleTranslation?.value && product.title) {
      missingCount++;
      const frTitle = await agent.deeplClient!.translateText(product.title);
      fieldsToTranslate.push({
        key: "title",
        value: frTitle,
        translatableContentDigest: titleTranslation?.translatableContent?.digest ?? "",
      });
    }

    if (!descTranslation?.value && product.body_html) {
      missingCount++;
      const frDesc = await agent.deeplClient!.translateText(product.body_html);
      fieldsToTranslate.push({
        key: "body_html",
        value: frDesc,
        translatableContentDigest: descTranslation?.translatableContent?.digest ?? "",
      });
    }

    if (fieldsToTranslate.length > 0) {
      try {
        await registerTranslation(
          agent.shopifyClient!,
          `gid://shopify/Product/${product.id}`,
          "fr",
          fieldsToTranslate,
        );
        translatedCount += fieldsToTranslate.length;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        issues.push(`${product.handle}: ${errMsg}`);
      }
    }
  }

  agent.status = "online";

  // Store scan results in shared memory
  await agent.setMemory(`translation-scan:${Date.now()}`, {
    scannedProducts: products.length,
    missingTranslations: missingCount,
    autoTranslated: translatedCount,
    errors: issues.length,
    timestamp: new Date().toISOString(),
  });

  const lines = [
    `**Translation scan complete** — scanned ${products.length} products`,
    "",
    `Found **${missingCount} missing** French translations.`,
    `Auto-translated: **${translatedCount}** fields via DeepL.`,
  ];

  if (issues.length > 0) {
    lines.push("");
    lines.push(`**${issues.length} error(s):**`);
    for (const issue of issues.slice(0, 5)) {
      lines.push(`  - ${issue}`);
    }
    if (issues.length > 5) {
      lines.push(`  ... and ${issues.length - 5} more`);
    }
  }

  return agent.reply(message, lines.join("\n"));
}

/**
 * Try to extract a product handle or title reference from the message.
 * Looks for quoted strings or text after "product" / "for" keywords.
 */
function extractProductReference(text: string): string | null {
  // Quoted reference: "product-handle" or 'product handle'
  const quotedMatch = text.match(/["']([^"']+)["']/);
  if (quotedMatch) return quotedMatch[1];

  // After keywords: translate "product-name"
  const afterKeyword = text.match(
    /(?:translate|vertaal|check|controleer)\s+(?:product\s+)?(\S+)/i,
  );
  if (afterKeyword && afterKeyword[1].length > 2) {
    const candidate = afterKeyword[1];
    // Skip common words that aren't product references
    if (!["all", "alle", "alles", "everything", "missing", "check"].includes(candidate.toLowerCase())) {
      return candidate;
    }
  }

  return null;
}
