import { ApiRouter } from "./router.js";
import { getProducts, getProduct, getProductCount, getAllTranslatableResources } from "@domien-sev/shopify-sdk";
import type { ShopifyAgent } from "../agent.js";

export function createApiRouter(agent: ShopifyAgent): ApiRouter {
  const router = new ApiRouter();

  // GET /api/products?status=active&limit=50&vendor=Bellerose
  router.get("/api/products", async (req) => {
    const status = (req.query.status as "active" | "draft" | "archived") || "active";
    const limit = parseInt(req.query.limit ?? "50", 10);

    const products = await getProducts(agent.shopify, { limit, status });

    const vendor = req.query.vendor?.toLowerCase();
    const filtered = vendor
      ? products.filter((p) => p.vendor?.toLowerCase().includes(vendor))
      : products;

    return { status: 200, data: { products: filtered, count: filtered.length } };
  });

  // GET /api/products/:id
  router.get("/api/products/:id", async (req) => {
    const id = parseInt(req.params.id, 10);
    const product = await getProduct(agent.shopify, id);
    return { status: 200, data: { product } };
  });

  // GET /api/products/count?status=active
  router.get("/api/products/count", async (req) => {
    const status = (req.query.status as "active" | "draft" | "archived") || undefined;
    const count = await getProductCount(agent.shopify, status);
    return { status: 200, data: { count } };
  });

  // GET /api/translations?locale=fr
  router.get("/api/translations", async (req) => {
    const locale = req.query.locale ?? "fr";
    const resources = await getAllTranslatableResources(agent.shopify, locale);

    const fullyTranslated = resources.filter((r) => {
      const translatedKeys = new Set(r.translations.map((t) => t.key));
      return r.translatableContent.every(
        (c) => !c.value || c.value.trim() === "" || translatedKeys.has(c.key),
      );
    });

    return {
      status: 200,
      data: {
        total: resources.length,
        translated: fullyTranslated.length,
        untranslated: resources.length - fullyTranslated.length,
        percentage: resources.length > 0
          ? Math.round((fullyTranslated.length / resources.length) * 100)
          : 100,
      },
    };
  });

  // GET /api/status
  router.get("/api/status", async () => {
    const activeCount = await getProductCount(agent.shopify, "active");
    return {
      status: 200,
      data: {
        agent: "shopify",
        shop: agent.shopify.shopName,
        activeProducts: activeCount,
        deepl: !!agent.deepl,
      },
    };
  });

  return router;
}
