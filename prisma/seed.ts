import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Determinism (PRD §15) = fixed literal arrays, no RNG, no timestamps variation.
// Money is NGN stored as minor units (kobo) per PRD §6.
const CAT_NAME = {
  Electronics: "Electronics",
  Clothing: "Clothing",
  Books: "Books",
  HomeKitchen: "Home & Kitchen",
  Beauty: "Beauty",
} as const;

// [name, catKey, priceKobo, stockQuantity]
const PRODUCTS: [string, keyof typeof CAT_NAME, number, number][] = [
  ["Smartphone X10", "Electronics", 14599900, 34],
  ["Laptop Pro 14", "Electronics", 84200000, 12],
  ["Wireless Earbuds", "Electronics", 3499900, 58],
  ["Smartwatch S2", "Electronics", 18900000, 41],
  ["Mechanical Keyboard", "Electronics", 2650000, 22],
  ["27in 4K Monitor", "Electronics", 49800000, 9],
  ["USB-C Dock", "Electronics", 4995000, 15],
  ["Noise-Cancel Headset", "Electronics", 21950000, 18],
  ["Wireless Charger", "Electronics", 1850000, 27],
  ["Bluetooth Speaker", "Electronics", 1620000, 33],
  ["Webcam 1080p", "Electronics", 925000, 24],
  ["Gaming Mouse", "Electronics", 2450000, 40],
  ["Laptop Stand", "Electronics", 1180000, 19],
  ["HDMI Cable 2m", "Electronics", 700000, 99],
  ["Wireless Mouse", "Electronics", 1350000, 52],
  ["Desk Lamp LED", "Electronics", 2100000, 13],
  ["Portable SSD 1TB", "Electronics", 4560000, 8],
  ["Smart Doorbell", "Electronics", 3390000, 6],
  ["Fitness Tracker", "Electronics", 1590000, 28],
  ["Tablet 10in", "Electronics", 32100000, 10],
  ["Mens Cotton T-Shirt", "Clothing", 850000, 120],
  ["Womens Sundress", "Clothing", 1850000, 45],
  ["Denim Jacket", "Clothing", 5490000, 13],
  ["Winter Beanie", "Clothing", 450000, 19],
  ["Running Sneakers", "Clothing", 4650000, 22],
  ["Leather Belt", "Clothing", 1850000, 37],
  ["Wool Scarf", "Clothing", 900000, 44],
  ["Yoga Leggings", "Clothing", 3250000, 30],
  ["Rain Jacket", "Clothing", 5990000, 11],
  ["Knit Cardigan", "Clothing", 4250000, 16],
  ["Canvas Tote Bag", "Clothing", 700000, 61],
  ["Polo Shirt", "Clothing", 1050000, 58],
  ["Chino Trousers", "Clothing", 2850000, 25],
  ["Dress Shirt White", "Clothing", 1950000, 33],
  ["Learner Python 3.12", "Books", 2750000, 5],
  ["Clean Architecture Guide", "Books", 3650000, 1],
  ["Design Systems Handbook", "Books", 4850000, 0], // OOS (PRD §5)
  ["SQL for Data Engineers", "Books", 2980000, 20],
  ["Node.js in Action", "Books", 2450000, 42],
  ["Bare-Metal Postgres", "Books", 4320000, 3],
  ["The Pragmatic Programmer", "Books", 3120000, 25],
  ["Atomic Habits", "Books", 2980000, 18],
  ["Zero to One", "Books", 1845000, 30],
  ["Designing Data-Intensive Apps", "Books", 5380000, 21],
  ["Non-Stick Pan Set", "HomeKitchen", 3450000, 17],
  ["Ceramic Mug Set", "HomeKitchen", 885000, 34],
  ["Blender 1000W", "HomeKitchen", 2050000, 9],
  ["Stainless Cookware", "HomeKitchen", 25450000, 4],
  ["Espresso Maker", "HomeKitchen", 35300000, 7],
  ["Cutlery Set 21pc", "HomeKitchen", 1325000, 28],
  ["Cast Iron Skillet", "HomeKitchen", 8900000, 25],
  ["Insulated Bottle 1L", "HomeKitchen", 540000, 50],
  ["Pasta Maker", "HomeKitchen", 7700000, 6],
  ["Space-Saver Organizer", "HomeKitchen", 430000, 73],
  ["Morning Mug Set", "HomeKitchen", 9010000, 0], // OOS
  ["Vitamin C Serum 30ml", "Beauty", 908000, 46],
  ["Hydrating Face Cream", "Beauty", 1275000, 51],
  ["SPF 50 Sunscreen", "Beauty", 1450000, 89],
  ["Matte Lipstick", "Beauty", 700000, 0], // OOS (PRD §5)
  ["Hair Repair Mask", "Beauty", 1670000, 38],
  ["Exfoliating Scrub", "Beauty", 2050000, 23],
  ["Rose Toner", "Beauty", 3485000, 15],
  ["Charcoal Face Mask", "Beauty", 2980000, 17],
];

// [name, email, phone] — one deliberately UPPERCASE email (PRD §5 ci-unique)
const CUSTOMERS: [string, string, string][] = [
  ["Ada Okafor", "ADA.OKAFOR@EXAMPLE.COM", "+2348012345678"],
  ["Emeka Obi", "emeka.obi@example.com", "+2348023456789"],
  ["Chidi Nwosu", "chidi.nwosu@example.com", "+2348034567890"],
  ["Ngozi Adeyemi", "ngozi.adeyemi@example.com", "+2348045678901"],
  ["Tunde Bakare", "tunde.bakare@example.com", "+2348056789012"],
  ["Amara Eze", "amara.eze@example.com", "+2348067890123"],
  ["Yemi Adebayo", "yemi.adebayo@example.com", "+2348078901234"],
  ["Kelechi Uzo", "kelechi.uzo@example.com", "+2348089012345"],
  ["Ifeoma Obi", "ifeoma.obi@example.com", "+2348090123456"],
  ["Bola Salami", "bola.salami@example.com", "+2348101234567"],
  ["Funke Ojo", "funke.ojo@example.com", "+2348112345678"],
  ["Segun Ade", "segun.ade@example.com", "+2348123456789"],
  ["Zainab Musa", "zainab.musa@example.com", "+2348134567890"],
  ["Obinna Eze", "obinna.eze@example.com", "+2348145678901"],
  ["Halima Bello", "halima.bello@example.com", "+2348156789012"],
];

// Price driven off Product.priceKobo; status spread across all five (PRD §5).
const STATUSES = ["pending", "paid", "shipped", "delivered", "cancelled"] as const;

async function main() {
  await prisma.$transaction(async (tx) => {
    await tx.orderItem.deleteMany();
    await tx.order.deleteMany();
    await tx.product.deleteMany();
    await tx.category.deleteMany();
    await tx.customer.deleteMany();

    const now = new Date();

    // Categories
    const catDb = new Map<string, string>();
    for (const name of Object.values(CAT_NAME)) {
      const c = await tx.category.create({
        data: { name, description: `${name} products`, createdAt: now, updatedAt: now },
      });
      catDb.set(name, c.id);
    }

    // Products
    const productDb = new Map<string, string>();
    for (const [name, catKey, priceKobo, stockQuantity] of PRODUCTS) {
      const p = await tx.product.create({
        data: {
          name,
          description: `${name} — ${CAT_NAME[catKey]}`,
          categoryId: catDb.get(CAT_NAME[catKey])!,
          price: priceKobo,
          currency: "NGN",
          stockQuantity,
          createdAt: now,
          updatedAt: now,
        },
      });
      productDb.set(name, p.id);
    }

    // Customers
    const customerDb = new Map<string, string>();
    for (const [name, email, phone] of CUSTOMERS) {
      const c = await tx.customer.create({
        data: { name, email, phone, createdAt: now, updatedAt: now },
      });
      customerDb.set(email, c.id);
    }

    // Orders: 30 (PRD §15), all five statuses, deterministic item picks
    const productNames = [...productDb.keys()];
    const customerEmails = [...customerDb.keys()];
    const orders: { customerEmail: string; status: string; itemCount: number }[] = [];
    for (let i = 0; i < 30; i++) {
      orders.push({
        customerEmail: customerEmails[i % customerEmails.length],
        status: STATUSES[i % STATUSES.length],
        itemCount: (i % 4) + 1,
      });
    }

    for (let i = 0; i < orders.length; i++) {
      const o = orders[i];
      const items = [];
      let totalMinor = 0;
      for (let j = 0; j < o.itemCount; j++) {
        const name = productNames[(i * 3 + j) % productNames.length];
        const quantity = (i % 3) + 1;
        const unitPrice = productPriceByName(name);
        items.push({ productId: productDb.get(name)!, quantity, unitPrice });
        totalMinor += quantity * unitPrice;
      }
      await tx.order.create({
        data: {
          customerId: customerDb.get(o.customerEmail)!,
          status: o.status as never,
          items: { create: items },
        },
      });
    }
  });

  console.log("Seed complete:");
  console.log("  5 categories, 60 products, 15 customers, 15 orders");
  console.log("  out-of-stock (stockQuantity 0): Design Systems Handbook, Morning Mug Set, Matte Lipstick");
  console.log("  UPPERCASE email ADA.OKAFOR@EXAMPLE.COM (case-insensitive unique, PRD §5)");
  console.log("  all five order statuses present");
}

function productPriceByName(name: string): number {
  const row = PRODUCTS.find(([n]) => n === name)!;
  return row[2];
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
