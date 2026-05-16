/**
 * Shufersal DOM selectors — discovered from a live probe (May 2026).
 * Search URL: https://www.shufersal.co.il/online/he/search?text=<query>
 */

export const sel = {
  search: {
    input: 'input#js-site-search-input',
    tile: '.miglog-prod',
    tileNameAttr: 'data-product-name',
    tileSkuAttr: 'data-product-code',
    tilePriceAttr: 'data-product-price',
    tileSellingMethodAttr: 'data-selling-method',
    tilePurchasableAttr: 'data-product-purchasable',
    tileImage: '.imgContainer img',
    tileNameText: '.text.description strong',
    tileBrandSizeWrap: '.brand-name',
    tileBrandSizeSpan: 'span',
    tilePromoText: '.promotion-section .productInnerPromotion strong',
    tilePromoBadge: '.compareProductMobile',
    tileOutOfStock: '.miglog-prod-outOfStock-msg',
    tileLowStock: '.miglog-prod-lowStock-msg',
    tileAddBtn: 'button.js-add-to-cart, .miglog-prod-add',
  },
  tile: {
    bySkuAttr: (sku: string) => `[data-product-code="${sku}"].miglog-prod`,
    qtyInput: 'input.js-qty-selector-input',
    addBtn: 'button.js-add-to-cart',
    updateBtn: 'button.js-update-cart',
    removeBtn: 'button.js-remove-from-cart, .miglog-prod-remove',
  },
  cart: {
    badgeCount: '.js-mini-cart-count, .cart-count',
    line: 'article.miglog-prod.miglog-incart',
    lineSkuAttr: 'data-product-code',
    lineQtyAttr: 'data-entry-qty',
    lineName: 'h3.miglog-prod-name a',
    lineImg: '.miglog-prod-img-wrapper img',
    lineRemove: '.miglog-prod-remove',
    total: '.totalPrice',
    clear: 'a:has-text("ניקוי הסל"), button:has-text("ניקוי הסל")',
  },
  auth: {
    loginButton: '.js-login, a[href*="login"]',
    userIndicator: '.user-info, .js-logged-in-marker',
    loginForm: 'form[action*="login"]',
  },
  history: {
    ordersLink: 'a[href*="orders"]',
    orderRow: '.order-row, .miglog-order',
    orderDate: '.order-date',
    orderTotal: '.order-total',
    orderRepeatBtn: 'button.repeat-order',
  },
} as const;
