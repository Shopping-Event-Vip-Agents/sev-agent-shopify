/**
 * Prompt templates for evaluating and checking translations.
 */

/**
 * Builds a prompt to evaluate whether existing translations are accurate
 * and contextually appropriate for an e-commerce product listing.
 */
export function buildTranslationCheckPrompt(
  items: Array<{
    field: string;
    sourceText: string;
    currentTranslation: string | null;
    sourceLang: string;
    targetLang: string;
  }>,
): string {
  const itemList = items
    .map((item, i) => {
      const parts = [
        `Item ${i + 1}:`,
        `  Field: ${item.field}`,
        `  Source (${item.sourceLang}): ${item.sourceText}`,
      ];
      if (item.currentTranslation) {
        parts.push(`  Current translation (${item.targetLang}): ${item.currentTranslation}`);
      } else {
        parts.push(`  Current translation (${item.targetLang}): MISSING`);
      }
      return parts.join("\n");
    })
    .join("\n\n");

  return `You are a translation quality checker for a Belgian e-commerce store.
Evaluate the following product field translations from ${items[0]?.sourceLang ?? "NL"} to ${items[0]?.targetLang ?? "FR"}.

For each item, assess:
- Is the translation accurate and natural?
- Is it appropriate for an e-commerce product listing?
- Are there any issues (grammar, tone, missing context)?

${itemList}

Respond with a JSON array where each object has:
{
  "index": <number>,
  "status": "ok" | "needs_review" | "missing",
  "issue": "<description of any issue, or null>",
  "suggestedTranslation": "<improved translation if needed, or null>"
}

Return ONLY the JSON array, no additional text.`;
}

/**
 * Builds a prompt to detect untranslated or suspiciously identical content
 * across NL and FR product fields.
 */
export function buildUntranslatedDetectionPrompt(
  products: Array<{
    handle: string;
    titleNL: string;
    titleFR: string | null;
    descriptionNL: string | null;
    descriptionFR: string | null;
  }>,
): string {
  const productList = products
    .map((p) => {
      return [
        `Handle: ${p.handle}`,
        `  Title NL: ${p.titleNL}`,
        `  Title FR: ${p.titleFR ?? "MISSING"}`,
        `  Description NL: ${p.descriptionNL?.substring(0, 200) ?? "MISSING"}`,
        `  Description FR: ${p.descriptionFR?.substring(0, 200) ?? "MISSING"}`,
      ].join("\n");
    })
    .join("\n\n");

  return `Check these product translations for a Belgian e-commerce store.
Flag products where:
1. French translation is completely missing
2. French text appears to be identical to Dutch (not translated)
3. French text appears machine-translated with obvious errors

${productList}

Respond with a JSON array of issues found:
{
  "handle": "<product handle>",
  "field": "title" | "description",
  "issue": "missing" | "identical" | "poor_quality",
  "details": "<explanation>"
}

If no issues found, return an empty array [].
Return ONLY the JSON array, no additional text.`;
}
