/**
 * Product data validation — checks completeness and correctness
 * before import or creation.
 */

import type { SupplierProductData } from "@domien-sev/shopify-sdk";

export interface ValidationIssue {
  row: number;
  field: string;
  message: string;
  severity: "error" | "warning";
}

export interface ValidationResult {
  valid: SupplierProductData[];
  issues: ValidationIssue[];
}

/**
 * Validate an array of supplier product data.
 * Returns valid products and a list of issues found.
 */
export function validateProducts(products: SupplierProductData[]): ValidationResult {
  const issues: ValidationIssue[] = [];
  const valid: SupplierProductData[] = [];
  const seenSkus = new Map<string, number>();

  for (let i = 0; i < products.length; i++) {
    const product = products[i];
    const rowNum = i + 1;
    let hasError = false;

    // Title is required
    if (!product.title || product.title.trim().length === 0) {
      issues.push({
        row: rowNum,
        field: "title",
        message: "Product title is required",
        severity: "error",
      });
      hasError = true;
    } else if (product.title.trim().length < 3) {
      issues.push({
        row: rowNum,
        field: "title",
        message: `Title "${product.title}" is suspiciously short (< 3 chars)`,
        severity: "warning",
      });
    }

    // Price validation
    if (product.price !== undefined && product.price !== null && product.price !== "") {
      const priceNum = typeof product.price === "number" ? product.price : parseFloat(String(product.price));
      if (isNaN(priceNum)) {
        issues.push({
          row: rowNum,
          field: "price",
          message: `Invalid price value: "${product.price}"`,
          severity: "error",
        });
        hasError = true;
      } else if (priceNum < 0) {
        issues.push({
          row: rowNum,
          field: "price",
          message: `Negative price: ${priceNum}`,
          severity: "error",
        });
        hasError = true;
      } else if (priceNum === 0) {
        issues.push({
          row: rowNum,
          field: "price",
          message: "Price is 0 — is this intentional?",
          severity: "warning",
        });
      } else if (priceNum > 50000) {
        issues.push({
          row: rowNum,
          field: "price",
          message: `Price seems unusually high: ${priceNum}`,
          severity: "warning",
        });
      }
    } else {
      issues.push({
        row: rowNum,
        field: "price",
        message: "No price specified",
        severity: "warning",
      });
    }

    // Compare at price validation
    if (product.compareAtPrice !== undefined && product.compareAtPrice !== null && product.compareAtPrice !== "") {
      const compareNum = typeof product.compareAtPrice === "number"
        ? product.compareAtPrice
        : parseFloat(String(product.compareAtPrice));
      const priceNum = typeof product.price === "number"
        ? product.price
        : parseFloat(String(product.price ?? "0"));

      if (isNaN(compareNum)) {
        issues.push({
          row: rowNum,
          field: "compareAtPrice",
          message: `Invalid compare-at price: "${product.compareAtPrice}"`,
          severity: "error",
        });
      } else if (!isNaN(priceNum) && compareNum <= priceNum) {
        issues.push({
          row: rowNum,
          field: "compareAtPrice",
          message: `Compare-at price (${compareNum}) should be higher than selling price (${priceNum})`,
          severity: "warning",
        });
      }
    }

    // SKU uniqueness
    if (product.sku && product.sku.trim().length > 0) {
      const skuKey = product.sku.trim().toUpperCase();
      const existingRow = seenSkus.get(skuKey);
      if (existingRow !== undefined) {
        issues.push({
          row: rowNum,
          field: "sku",
          message: `Duplicate SKU "${product.sku}" — also on row ${existingRow}`,
          severity: "error",
        });
        hasError = true;
      } else {
        seenSkus.set(skuKey, rowNum);
      }
    } else {
      issues.push({
        row: rowNum,
        field: "sku",
        message: "No SKU specified — Shopify will auto-generate one",
        severity: "warning",
      });
    }

    // Image URL validation
    if (product.imageUrls && product.imageUrls.length > 0) {
      for (const url of product.imageUrls) {
        if (!isValidUrl(url)) {
          issues.push({
            row: rowNum,
            field: "imageUrls",
            message: `Invalid image URL: "${url.substring(0, 80)}"`,
            severity: "error",
          });
          hasError = true;
        } else if (!isImageUrl(url)) {
          issues.push({
            row: rowNum,
            field: "imageUrls",
            message: `URL may not be an image (no image extension): "${url.substring(0, 80)}"`,
            severity: "warning",
          });
        }
      }
    } else {
      issues.push({
        row: rowNum,
        field: "imageUrls",
        message: "No images specified",
        severity: "warning",
      });
    }

    // Missing description is a warning (can be enriched later)
    if (!product.description || product.description.trim().length === 0) {
      issues.push({
        row: rowNum,
        field: "description",
        message: "No description — will be auto-generated during enrichment",
        severity: "warning",
      });
    }

    // Barcode format check (EAN-13)
    if (product.barcode && product.barcode.trim().length > 0) {
      const barcode = product.barcode.trim();
      if (!/^\d{8,14}$/.test(barcode)) {
        issues.push({
          row: rowNum,
          field: "barcode",
          message: `Barcode "${barcode}" doesn't match expected format (8-14 digits)`,
          severity: "warning",
        });
      }
    }

    if (!hasError) {
      valid.push(product);
    }
  }

  return { valid, issues };
}

/**
 * Format validation issues as a human-readable summary.
 */
export function formatIssuesSummary(issues: ValidationIssue[]): string {
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");

  const lines: string[] = [];

  if (errors.length > 0) {
    lines.push(`**${errors.length} error(s):**`);
    for (const err of errors.slice(0, 10)) {
      lines.push(`  Row ${err.row} [${err.field}]: ${err.message}`);
    }
    if (errors.length > 10) {
      lines.push(`  ... and ${errors.length - 10} more errors`);
    }
  }

  if (warnings.length > 0) {
    lines.push(`**${warnings.length} warning(s):**`);
    for (const warn of warnings.slice(0, 10)) {
      lines.push(`  Row ${warn.row} [${warn.field}]: ${warn.message}`);
    }
    if (warnings.length > 10) {
      lines.push(`  ... and ${warnings.length - 10} more warnings`);
    }
  }

  return lines.join("\n");
}

function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

function isImageUrl(url: string): boolean {
  const imageExtensions = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".bmp", ".tiff"];
  const lower = url.toLowerCase().split("?")[0] ?? "";
  return imageExtensions.some((ext) => lower.endsWith(ext));
}
