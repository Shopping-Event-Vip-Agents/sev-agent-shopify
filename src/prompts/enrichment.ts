/**
 * Prompt templates for AI-powered product data enrichment.
 */

/**
 * Generates missing product descriptions, SEO meta titles/descriptions, and tags.
 * Used with the Anthropic SDK to fill in incomplete product data.
 *
 * @param products - JSON array of products with their current data
 * @returns The prompt string to send to Claude
 */
export function buildEnrichmentPrompt(products: Array<{ title?: string; description?: string; tags?: string | string[]; productType?: string; vendor?: string }>): string {
  const productList = products.map((p, i) => {
    const parts = [`Product ${i + 1}:`];
    if (p.title) parts.push(`  Title: ${p.title}`);
    if (p.description) parts.push(`  Current description: ${p.description}`);
    if (p.productType) parts.push(`  Type: ${p.productType}`);
    if (p.vendor) parts.push(`  Vendor: ${p.vendor}`);
    if (p.tags) {
      const tagStr = Array.isArray(p.tags) ? p.tags.join(", ") : p.tags;
      parts.push(`  Current tags: ${tagStr}`);
    }
    return parts.join("\n");
  }).join("\n\n");

  return `Below are products that need enrichment. For each product, generate the missing fields.

Rules:
- Write all content in Dutch (NL)
- Descriptions should be 2-3 sentences, SEO-friendly, highlighting key features and benefits
- Tags should be relevant search terms (comma-separated, lowercase, max 10 tags)
- SEO meta title: max 60 characters, include product name and key feature
- SEO meta description: max 155 characters, compelling call-to-action
- If a field already exists, keep it unchanged unless it's clearly low quality

${productList}

Respond with a JSON array where each object has:
{
  "index": <number>,
  "description": "<enriched description or existing>",
  "tags": "<comma-separated tags>",
  "seoTitle": "<meta title>",
  "seoDescription": "<meta description>"
}

Return ONLY the JSON array, no additional text.`;
}

/**
 * Prompt for generating a single product description from minimal input.
 */
export function buildSingleProductPrompt(title: string, productType?: string, vendor?: string): string {
  return `Generate product content in Dutch (NL) for a Belgian e-commerce store.

Product: ${title}
${productType ? `Type: ${productType}` : ""}
${vendor ? `Vendor: ${vendor}` : ""}

Generate:
1. A compelling product description (2-3 sentences, SEO-friendly)
2. 5-10 relevant tags (comma-separated, lowercase)
3. SEO meta title (max 60 chars)
4. SEO meta description (max 155 chars)

Respond with a JSON object:
{
  "description": "...",
  "tags": "...",
  "seoTitle": "...",
  "seoDescription": "..."
}

Return ONLY the JSON object, no additional text.`;
}
