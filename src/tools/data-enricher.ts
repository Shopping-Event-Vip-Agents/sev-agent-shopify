/**
 * AI-powered product data enrichment using the Anthropic SDK.
 * Generates missing descriptions, SEO meta, and tags.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { SupplierProductData } from "@domien-sev/shopify-sdk";
import { buildEnrichmentPrompt } from "../prompts/enrichment.js";

interface EnrichmentResult {
  index: number;
  description: string;
  tags: string;
  seoTitle: string;
  seoDescription: string;
}

const BATCH_SIZE = 10;
const MODEL = "claude-sonnet-4-20250514";

/**
 * Enrich products with AI-generated content for missing fields.
 * Batches products to minimize API calls.
 *
 * @param products - Products with potentially missing data
 * @param anthropicApiKey - Anthropic API key for Claude
 * @returns Enriched copies of the products
 */
export async function enrichProducts(
  products: SupplierProductData[],
  anthropicApiKey: string,
): Promise<SupplierProductData[]> {
  const client = new Anthropic({ apiKey: anthropicApiKey });
  const enriched = [...products.map((p) => ({ ...p }))];

  // Find products that need enrichment (missing description or tags)
  const needsEnrichment = products
    .map((p, i) => ({ product: p, index: i }))
    .filter(
      ({ product }) =>
        !product.description?.trim() ||
        !product.tags ||
        (Array.isArray(product.tags) && product.tags.length === 0) ||
        (typeof product.tags === "string" && product.tags.trim().length === 0),
    );

  if (needsEnrichment.length === 0) {
    return enriched;
  }

  // Process in batches
  for (let batchStart = 0; batchStart < needsEnrichment.length; batchStart += BATCH_SIZE) {
    const batch = needsEnrichment.slice(batchStart, batchStart + BATCH_SIZE);
    const batchProducts = batch.map(({ product }) => ({
      title: product.title,
      description: product.description,
      tags: product.tags,
      productType: product.productType,
      vendor: product.vendor,
    }));

    const prompt = buildEnrichmentPrompt(batchProducts);

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system:
        "You are a Shopify product data specialist for a Belgian e-commerce store. Generate product content in Dutch (NL). Be concise, SEO-friendly.",
      messages: [{ role: "user", content: prompt }],
    });

    // Extract text from response
    const textBlock = response.content.find((block) => block.type === "text");
    if (!textBlock || textBlock.type !== "text") continue;

    const results = parseEnrichmentResponse(textBlock.text);

    // Apply enrichment results back to the products
    for (const result of results) {
      if (result.index < 0 || result.index >= batch.length) continue;

      const originalIndex = batch[result.index].index;
      const target = enriched[originalIndex];

      if (!target.description?.trim() && result.description) {
        target.description = result.description;
      }

      if (result.tags) {
        const currentTags = target.tags;
        const isEmpty =
          !currentTags ||
          (Array.isArray(currentTags) && currentTags.length === 0) ||
          (typeof currentTags === "string" && currentTags.trim().length === 0);

        if (isEmpty) {
          target.tags = result.tags;
        }
      }

      // Store SEO meta in the raw field for Matrixify formatting
      if (!target.raw) target.raw = {};
      if (result.seoTitle) target.raw["seoTitle"] = result.seoTitle;
      if (result.seoDescription) target.raw["seoDescription"] = result.seoDescription;
    }
  }

  return enriched;
}

/**
 * Parse the JSON response from Claude's enrichment prompt.
 * Handles potential JSON formatting issues.
 */
function parseEnrichmentResponse(responseText: string): EnrichmentResult[] {
  // Try to extract JSON array from the response
  const jsonMatch = responseText.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    console.warn("[data-enricher] Could not find JSON array in response");
    return [];
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as unknown;
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter(
        (item): item is EnrichmentResult =>
          typeof item === "object" &&
          item !== null &&
          typeof (item as Record<string, unknown>).index === "number",
      )
      .map((item) => ({
        index: item.index - 1, // Convert 1-based prompt index to 0-based
        description: String(item.description ?? ""),
        tags: String(item.tags ?? ""),
        seoTitle: String(item.seoTitle ?? ""),
        seoDescription: String(item.seoDescription ?? ""),
      }));
  } catch (err) {
    console.warn("[data-enricher] Failed to parse enrichment response:", err);
    return [];
  }
}
