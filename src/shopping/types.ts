export type SellingMethod = 'unit' | 'weight';

export interface Product {
  sku: string;
  name: string;
  brand?: string;
  size?: string;
  price: number;
  imageUrl?: string;
  promo?: string;
  sellingMethod: SellingMethod;
  url?: string;
}

export type ShoppingAction = 'add' | 'remove';

export interface ShoppingItem {
  id: string;
  rawText: string;
  name: string;
  brand?: string;
  qty: number;
  weightKg?: number;
  action: ShoppingAction;
  cartIndexRef?: number;
}

export interface SearchResultBundle {
  itemId: string;
  query: string;
  exact: boolean;
  results: Product[];
  cursor: number;
}

export interface CartLine {
  sku: string;
  name: string;
  brand?: string;
  price: number;
  qty: number;
  imageUrl?: string;
}

export interface CartSnapshot {
  lines: CartLine[];
  total: number;
  itemCount: number;
}

export interface OrderHistoryEntry {
  id: string;
  date: string;
  total: number;
  itemCount: number;
}
