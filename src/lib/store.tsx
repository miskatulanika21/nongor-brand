import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { PRODUCTS, type Product } from "@/lib/products";
import {
  type DeliveryZone,
  normalizeZone,
  findCoupon,
  couponDiscount,
  type Coupon,
} from "@/lib/checkout-ui";

export interface CartItem {
  id: string;
  productId: string;
  name: string;
  image: string;
  price: number;
  qty: number;
  size?: string;
  customSize?: Record<string, string>;
  customCharge?: number;
}

export interface CheckoutUIState {
  deliveryZone: DeliveryZone;
  couponCode: string | null;
  orderNote: string;
  deliveryNote: string;
  savedForLater: CartItem[];
}

const DEFAULT_CHECKOUT_UI: CheckoutUIState = {
  deliveryZone: "dhaka",
  couponCode: null,
  orderNote: "",
  deliveryNote: "",
  savedForLater: [],
};

interface StoreState {
  cart: CartItem[];
  wishlist: string[];
  addToCart: (item: Omit<CartItem, "id">) => void;
  removeFromCart: (id: string) => void;
  updateQty: (id: string, qty: number) => void;
  clearCart: () => void;
  toggleWishlist: (productId: string) => void;
  isWishlisted: (productId: string) => boolean;
  cartCount: number;
  cartSubtotal: number;
  wishlistProducts: Product[];

  // Checkout UI state
  deliveryZone: DeliveryZone;
  setDeliveryZone: (zone: DeliveryZone) => void;
  couponCode: string | null;
  appliedCoupon: Coupon | null;
  discount: number;
  applyCoupon: (code: string) => { success: boolean; message: string };
  removeCoupon: () => void;
  orderNote: string;
  setOrderNote: (note: string) => void;
  deliveryNote: string;
  setDeliveryNote: (note: string) => void;

  // Saved for later
  savedForLater: CartItem[];
  saveForLater: (cartItemId: string) => void;
  moveToCart: (savedItemId: string) => void;
  removeSavedItem: (savedItemId: string) => void;
}

const StoreContext = createContext<StoreState | null>(null);

function load<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function loadCheckoutUI(): CheckoutUIState {
  const raw = load<Partial<CheckoutUIState> | null>("nongorr_checkout_ui", null);
  if (!raw || typeof raw !== "object") return DEFAULT_CHECKOUT_UI;
  return {
    deliveryZone: normalizeZone(raw.deliveryZone),
    couponCode: typeof raw.couponCode === "string" ? raw.couponCode : null,
    orderNote: typeof raw.orderNote === "string" ? raw.orderNote : "",
    deliveryNote: typeof raw.deliveryNote === "string" ? raw.deliveryNote : "",
    savedForLater: Array.isArray(raw.savedForLater) ? (raw.savedForLater as CartItem[]) : [],
  };
}

function newCartId(productId: string) {
  return `${productId}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [wishlist, setWishlist] = useState<string[]>([]);
  const [checkoutUI, setCheckoutUI] = useState<CheckoutUIState>(DEFAULT_CHECKOUT_UI);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setCart(load<CartItem[]>("nongorr_cart", []));
    setWishlist(load<string[]>("nongorr_wishlist", []));
    setCheckoutUI(loadCheckoutUI());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) localStorage.setItem("nongorr_cart", JSON.stringify(cart));
  }, [cart, hydrated]);
  useEffect(() => {
    if (hydrated) localStorage.setItem("nongorr_wishlist", JSON.stringify(wishlist));
  }, [wishlist, hydrated]);
  useEffect(() => {
    if (hydrated) localStorage.setItem("nongorr_checkout_ui", JSON.stringify(checkoutUI));
  }, [checkoutUI, hydrated]);

  const addToCart: StoreState["addToCart"] = (item) => {
    setCart((prev) => {
      const existing = prev.find(
        (c) => c.productId === item.productId && c.size === item.size && !item.customSize,
      );
      if (existing) {
        return prev.map((c) => (c.id === existing.id ? { ...c, qty: c.qty + item.qty } : c));
      }
      return [...prev, { ...item, id: newCartId(item.productId) }];
    });
  };

  const removeFromCart = (id: string) => setCart((p) => p.filter((c) => c.id !== id));
  const updateQty = (id: string, qty: number) =>
    setCart((p) => p.map((c) => (c.id === id ? { ...c, qty: Math.max(1, qty) } : c)));

  // clearCart clears the active cart + coupon + notes, but preserves
  // saved-for-later items, wishlist and selected delivery zone.
  const clearCart = () => {
    setCart([]);
    setCheckoutUI((s) => ({ ...s, couponCode: null, orderNote: "", deliveryNote: "" }));
  };

  const toggleWishlist = (productId: string) =>
    setWishlist((p) =>
      p.includes(productId) ? p.filter((x) => x !== productId) : [...p, productId],
    );
  const isWishlisted = (productId: string) => wishlist.includes(productId);

  const cartCount = cart.reduce((s, c) => s + c.qty, 0);
  const cartSubtotal = cart.reduce((s, c) => s + (c.price + (c.customCharge ?? 0)) * c.qty, 0);
  const wishlistProducts = PRODUCTS.filter((p) => wishlist.includes(p.id));

  const appliedCoupon = findCoupon(checkoutUI.couponCode);
  const discount = couponDiscount(appliedCoupon, cartSubtotal);

  const setDeliveryZone = (zone: DeliveryZone) =>
    setCheckoutUI((s) => ({ ...s, deliveryZone: normalizeZone(zone) }));

  const applyCoupon: StoreState["applyCoupon"] = (code) => {
    const match = findCoupon(code);
    if (!match) {
      setCheckoutUI((s) => ({ ...s, couponCode: null }));
      return { success: false, message: "Invalid coupon code" };
    }
    if (cartSubtotal < match.min) {
      setCheckoutUI((s) => ({ ...s, couponCode: null }));
      return {
        success: false,
        message: `Add ৳${(match.min - cartSubtotal).toLocaleString("en-BD")} more to use this coupon`,
      };
    }
    setCheckoutUI((s) => ({ ...s, couponCode: match.code }));
    return { success: true, message: `Coupon ${match.code} applied — ${match.label}` };
  };

  const removeCoupon = () => setCheckoutUI((s) => ({ ...s, couponCode: null }));
  const setOrderNote = (note: string) => setCheckoutUI((s) => ({ ...s, orderNote: note }));
  const setDeliveryNote = (note: string) => setCheckoutUI((s) => ({ ...s, deliveryNote: note }));

  const saveForLater = (cartItemId: string) => {
    setCart((prevCart) => {
      const item = prevCart.find((c) => c.id === cartItemId);
      if (!item) return prevCart;
      setCheckoutUI((s) => ({ ...s, savedForLater: [...s.savedForLater, item] }));
      return prevCart.filter((c) => c.id !== cartItemId);
    });
  };

  const moveToCart = (savedItemId: string) => {
    setCheckoutUI((s) => {
      const item = s.savedForLater.find((c) => c.id === savedItemId);
      if (!item) return s;
      setCart((prevCart) => {
        const idConflict = prevCart.some((c) => c.id === item.id);
        const restored = idConflict ? { ...item, id: newCartId(item.productId) } : item;
        return [...prevCart, restored];
      });
      return { ...s, savedForLater: s.savedForLater.filter((c) => c.id !== savedItemId) };
    });
  };

  const removeSavedItem = (savedItemId: string) =>
    setCheckoutUI((s) => ({
      ...s,
      savedForLater: s.savedForLater.filter((c) => c.id !== savedItemId),
    }));

  return (
    <StoreContext.Provider
      value={{
        cart,
        wishlist,
        addToCart,
        removeFromCart,
        updateQty,
        clearCart,
        toggleWishlist,
        isWishlisted,
        cartCount,
        cartSubtotal,
        wishlistProducts,
        deliveryZone: checkoutUI.deliveryZone,
        setDeliveryZone,
        couponCode: checkoutUI.couponCode,
        appliedCoupon,
        discount,
        applyCoupon,
        removeCoupon,
        orderNote: checkoutUI.orderNote,
        setOrderNote,
        deliveryNote: checkoutUI.deliveryNote,
        setDeliveryNote,
        savedForLater: checkoutUI.savedForLater,
        saveForLater,
        moveToCart,
        removeSavedItem,
      }}
    >
      {children}
    </StoreContext.Provider>
  );
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within StoreProvider");
  return ctx;
}
