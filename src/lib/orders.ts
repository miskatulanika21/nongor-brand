export type OrderStatus =
  | "New Order"
  | "Payment Pending"
  | "Payment Verified"
  | "Confirmed"
  | "Processing"
  | "Courier Booked"
  | "Shipped"
  | "Delivered"
  | "Completed"
  | "Cancelled"
  | "Returned"
  | "Refund Pending"
  | "Refund Done";

export const ORDER_PIPELINE: OrderStatus[] = [
  "New Order",
  "Payment Pending",
  "Payment Verified",
  "Confirmed",
  "Processing",
  "Courier Booked",
  "Shipped",
  "Delivered",
  "Completed",
];

export interface OrderItem {
  name: string;
  image: string;
  qty: number;
  price: number;
  size?: string;
}

export interface Order {
  id: string;
  date: string;
  status: OrderStatus;
  customer: string;
  phone: string;
  address: string;
  district: string;
  items: OrderItem[];
  subtotal: number;
  shipping: number;
  total: number;
  paymentMethod: string;
  senderNumber: string;
  trxId: string;
  paymentStatus: "Pending" | "Verified" | "Rejected";
  courier?: string;
  trackingId?: string;
  note?: string;
}

import { PRODUCTS } from "@/lib/products";

export const ORDERS: Order[] = [
  {
    id: "NGR-100231",
    date: "2026-06-12",
    status: "Shipped",
    customer: "Tahmina Akter",
    phone: "01711-223344",
    address: "House 12, Road 5, Dhanmondi",
    district: "Dhaka",
    items: [
      { name: PRODUCTS[0].name, image: PRODUCTS[0].image, qty: 1, price: 2390, size: "M" },
      { name: PRODUCTS[8].name, image: PRODUCTS[8].image, qty: 2, price: 1190 },
    ],
    subtotal: 4770,
    shipping: 0,
    total: 4770,
    paymentMethod: "Manual bKash",
    senderNumber: "01711-223344",
    trxId: "8N7A6B5C4D",
    paymentStatus: "Verified",
    courier: "Steadfast",
    trackingId: "SF-99281",
  },
  {
    id: "NGR-100245",
    date: "2026-06-13",
    status: "Payment Pending",
    customer: "Rumana Khan",
    phone: "01822-556677",
    address: "Flat 4B, Gulshan 2",
    district: "Dhaka",
    items: [{ name: PRODUCTS[3].name, image: PRODUCTS[3].image, qty: 1, price: 6900 }],
    subtotal: 6900,
    shipping: 0,
    total: 6900,
    paymentMethod: "Manual bKash",
    senderNumber: "01822-556677",
    trxId: "9X8Y7Z6W5V",
    paymentStatus: "Pending",
  },
  {
    id: "NGR-100250",
    date: "2026-06-14",
    status: "Delivered",
    customer: "Nusrat Jahan",
    phone: "01933-889900",
    address: "Road 3, Uttara Sector 7",
    district: "Dhaka",
    items: [
      { name: PRODUCTS[6].name, image: PRODUCTS[6].image, qty: 1, price: 1390, size: "5–6 yrs" },
    ],
    subtotal: 1390,
    shipping: 80,
    total: 1470,
    paymentMethod: "Manual bKash",
    senderNumber: "01933-889900",
    trxId: "1A2B3C4D5E",
    paymentStatus: "Verified",
    courier: "Pathao",
    trackingId: "PT-44512",
  },
];

export const STATUS_TONE: Record<string, string> = {
  "Payment Pending": "bg-gold/20 text-gold-foreground border-gold/40",
  "Payment Verified": "bg-success/15 text-success border-success/30",
  Confirmed: "bg-success/15 text-success border-success/30",
  Processing: "bg-secondary text-secondary-foreground border-border",
  Shipped: "bg-primary/10 text-primary border-primary/30",
  Delivered: "bg-success/15 text-success border-success/30",
  Completed: "bg-success/15 text-success border-success/30",
  Cancelled: "bg-destructive/10 text-destructive border-destructive/30",
  Returned: "bg-destructive/10 text-destructive border-destructive/30",
};
