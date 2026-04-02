/**
 * Product creation handler — interactive single product creation via Slack.
 * Parses product details from the message, asks for missing fields,
 * and creates via Shopify API with auto-translation.
 */

import type { RoutedMessage, AgentResponse } from "@domien-sev/shared-types";
import type { ShopifyAgent } from "../agent.js";
import type { SupplierProductData } from "@domien-sev/shopify-sdk";
import { createProduct } from "@domien-sev/shopify-sdk";
import { enrichProducts } from "../tools/data-enricher.js";
import { registerTranslation, getProductTranslations } from "@domien-sev/shopify-sdk";

/**
 * Handle interactive product creation from a Slack message.
 * Extracts product details from natural language and asks for missing required fields.
 */
export async function handleProduct(
  message: RoutedMessage,
  agent: ShopifyAgent,
): Promise<AgentResponse> {
  if (!agent.shopifyClient) {
    return agent.reply(
      message,
      "Shopify client not configured. Set SHOPIFY_SHOP and SHOPIFY_ACCESS_TOKEN environment variables.",
    );
  }

  const text = message.text;

  // Check if this is a response to a previous "missing fields" request
  const pendingKey = `product:${message.channel_id}:pending`;
  const pendingData = await agent.getMemory(pendingKey);

  if (pendingData && pendingData.value.product) {
    return handleProductCompletion(message, agent, pendingData.value.product as SupplierProductData);
  }

  // Parse product details from the message
  const product = parseProductFromMessage(text);

  // Check required fields
  const missing: string[] = [];
  if (!product.title) missing.push("title/naam");
  if (!product.price) missing.push("price/prijs");

  if (missing.length > 0) {
    // Store partial product and ask for missing fields
    await agent.setMemory(pendingKey, {
      product,
      timestamp: new Date().toISOString(),
    });

    return agent.reply(message, [
      `I need a few more details to create this product:`,
      "",
      ...missing.map((f) => `  - **${f}**`),
      "",
      `Currently I have:`,
      product.title ? `  Title: ${product.title}` : "",
      product.price ? `  Price: ${product.price}` : "",
      product.sku ? `  SKU: ${product.sku}` : "",
      product.vendor ? `  Vendor: ${product.vendor}` : "",
      product.productType ? `  Type: ${product.productType}` : "",
      "",
      "Reply with the missing information and I'll create the product.",
    ]
      .filter((l) => l !== "")
      .join("\n"));
  }

  return createAndPublishProduct(message, agent, product);
}

/**
 * Handle completion of a partially specified product.
 */
async function handleProductCompletion(
  message: RoutedMessage,
  agent: ShopifyAgent,
  pendingProduct: SupplierProductData,
): Promise<AgentResponse> {
  const text = message.text;
  const updates = parseProductFromMessage(text);

  // Merge new data into the pending product
  const merged: SupplierProductData = {
    ...pendingProduct,
    title: updates.title || pendingProduct.title,
    description: updates.description || pendingProduct.description,
    price: updates.price || pendingProduct.price,
    sku: updates.sku || pendingProduct.sku,
    vendor: updates.vendor || pendingProduct.vendor,
    productType: updates.productType || pendingProduct.productType,
    tags: updates.tags || pendingProduct.tags,
    imageUrls: updates.imageUrls?.length ? updates.imageUrls : pendingProduct.imageUrls,
  };

  // Check if still missing required fields
  const missing: string[] = [];
  if (!merged.title) missing.push("title/naam");
  if (!merged.price) missing.push("price/prijs");

  if (missing.length > 0) {
    await agent.setMemory(`product:${message.channel_id}:pending`, {
      product: merged,
      timestamp: new Date().toISOString(),
    });

    return agent.reply(message, [
      `Still missing: ${missing.join(", ")}`,
      "",
      "Please provide the remaining required fields.",
    ].join("\n"));
  }

  // Clear pending state
  await agent.setMemory(`product:${message.channel_id}:pending`, { cleared: true });

  return createAndPublishProduct(message, agent, merged);
}

/**
 * Create a product in Shopify, enrich with AI if needed, and auto-translate.
 */
async function createAndPublishProduct(
  message: RoutedMessage,
  agent: ShopifyAgent,
  product: SupplierProductData,
): Promise<AgentResponse> {
  try {
    agent.status = "busy";

    // Enrich missing description/tags with AI
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    let enriched = product;

    if (anthropicKey && (!product.description?.trim() || !product.tags)) {
      const enrichedProducts = await enrichProducts([product], anthropicKey);
      enriched = enrichedProducts[0] ?? product;
    }

    // Prepare Shopify product payload
    const tags = Array.isArray(enriched.tags)
      ? enriched.tags.join(", ")
      : (enriched.tags ?? "");

    const shopifyPayload: Partial<import("@domien-sev/shopify-sdk").ShopifyProduct> = {
      title: enriched.title ?? "Untitled",
      body_html: wrapHtml(enriched.description ?? ""),
      vendor: enriched.vendor ?? "",
      product_type: enriched.productType ?? "",
      tags,
      status: "draft" as const,
      variants: [
        {
          price: String(enriched.price ?? "0"),
          sku: enriched.sku ?? "",
          weight: enriched.weight ? Number(enriched.weight) : 0,
          weight_unit: enriched.weightUnit ?? "kg",
        } as import("@domien-sev/shopify-sdk").ShopifyVariant,
      ],
      images: (enriched.imageUrls ?? []).map((src, i) => ({
        src,
      } as import("@domien-sev/shopify-sdk").ShopifyImage)),
    };

    // Create in Shopify
    const createdProduct = await createProduct(agent.shopifyClient!, shopifyPayload);

    // Auto-translate to French
    let translationStatus = "skipped (no DeepL client)";
    if (agent.deeplClient && createdProduct) {
      try {
        const fieldsToTranslate: Array<{
          key: string;
          value: string;
          translatableContentDigest: string;
        }> = [];

        if (createdProduct.title) {
          const frTitle = await agent.deeplClient.translateText(createdProduct.title);
          fieldsToTranslate.push({
            key: "title",
            value: frTitle,
            translatableContentDigest: "",
          });
        }

        if (createdProduct.body_html) {
          const frDesc = await agent.deeplClient.translateText(createdProduct.body_html);
          fieldsToTranslate.push({
            key: "body_html",
            value: frDesc,
            translatableContentDigest: "",
          });
        }

        if (fieldsToTranslate.length > 0) {
          await registerTranslation(
            agent.shopifyClient!,
            `gid://shopify/Product/${createdProduct.id}`,
            fieldsToTranslate.map((f) => ({ ...f, locale: "fr" })),
          );
          translationStatus = `${fieldsToTranslate.length} fields translated to French`;
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        translationStatus = `failed: ${errMsg}`;
      }
    }

    agent.status = "online";

    // Store event in shared memory
    await agent.setMemory(`product-created:${Date.now()}`, {
      shopifyId: createdProduct?.id,
      title: createdProduct?.title,
      handle: createdProduct?.handle,
      timestamp: new Date().toISOString(),
    });

    return agent.reply(message, [
      `Product created in Shopify (as draft):`,
      "",
      `  **${createdProduct?.title}**`,
      `  Handle: ${createdProduct?.handle}`,
      `  ID: ${createdProduct?.id}`,
      `  SKU: ${enriched.sku ?? "auto-generated"}`,
      `  Price: ${enriched.price}`,
      `  Tags: ${tags || "none"}`,
      `  Translation: ${translationStatus}`,
      "",
      `The product is saved as **draft**. Publish it in Shopify admin when ready.`,
      `Admin URL: https://${agent.shopifyClient!.shopName}.myshopify.com/admin/products/${createdProduct?.id}`,
    ].join("\n"));
  } catch (err) {
    agent.status = "online";
    const errMsg = err instanceof Error ? err.message : String(err);
    return agent.reply(message, `Failed to create product: ${errMsg}`);
  }
}

/**
 * Parse product fields from natural language message text.
 * Supports patterns like "title: Product Name" or "prijs: 29.99"
 */
function parseProductFromMessage(text: string): SupplierProductData {
  const product: SupplierProductData = {};

  // Title patterns
  const titleMatch = text.match(
    /(?:title|titel|naam|name|product)\s*[:=]\s*["']?([^"'\n,]+)["']?/i,
  );
  if (titleMatch) product.title = titleMatch[1].trim();

  // Price patterns
  const priceMatch = text.match(
    /(?:price|prijs|kost)\s*[:=]\s*[€$]?\s*(\d+[.,]?\d*)/i,
  );
  if (priceMatch) product.price = priceMatch[1].replace(",", ".");

  // SKU patterns
  const skuMatch = text.match(
    /(?:sku|artikelnummer|ref(?:erentie)?)\s*[:=]\s*["']?([^\s"',]+)["']?/i,
  );
  if (skuMatch) product.sku = skuMatch[1].trim();

  // Vendor patterns
  const vendorMatch = text.match(
    /(?:vendor|leverancier|merk|brand)\s*[:=]\s*["']?([^"'\n,]+)["']?/i,
  );
  if (vendorMatch) product.vendor = vendorMatch[1].trim();

  // Type patterns
  const typeMatch = text.match(
    /(?:type|categorie|category)\s*[:=]\s*["']?([^"'\n,]+)["']?/i,
  );
  if (typeMatch) product.productType = typeMatch[1].trim();

  // Description patterns
  const descMatch = text.match(
    /(?:description|beschrijving|omschrijving)\s*[:=]\s*["']?([^"'\n]+)["']?/i,
  );
  if (descMatch) product.description = descMatch[1].trim();

  // Tags patterns
  const tagsMatch = text.match(
    /(?:tags|labels|trefwoorden)\s*[:=]\s*["']?([^"'\n]+)["']?/i,
  );
  if (tagsMatch) product.tags = tagsMatch[1].trim();

  // Image URL patterns
  const imageMatch = text.match(
    /(?:image|afbeelding|foto|img)\s*[:=]\s*(https?:\/\/\S+)/i,
  );
  if (imageMatch) product.imageUrls = [imageMatch[1].trim()];

  // If no structured data found, try to use the whole text as a title
  // (for simple messages like "create product Surfboard Pro")
  if (!product.title) {
    const simpleMatch = text.match(
      /(?:create|new|add|maak|nieuw|voeg toe)\s+(?:product\s+)?["']?([^"'\n]{3,60})["']?/i,
    );
    if (simpleMatch) product.title = simpleMatch[1].trim();
  }

  return product;
}

function wrapHtml(text: string): string {
  if (!text.trim()) return "";
  if (text.trim().startsWith("<")) return text;
  return `<p>${text}</p>`;
}
