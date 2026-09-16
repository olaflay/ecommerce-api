import { PrismaClient, OrderStatus } from "@prisma/client";
import { faker } from "@faker-js/faker";

const prisma = new PrismaClient();

// Target volumes per PRD §15
const NUM_CATEGORIES = 40;
const NUM_PRODUCTS = 400;
const NUM_CUSTOMERS = 400;
const NUM_ORDERS = 800;

// Curated base categories for realistic e-commerce taxonomy
const CATEGORY_NAMES = [
  "Electronics", "Computers", "Smartphones", "Audio", "Cameras", "Wearables",
  "Men's Fashion", "Women's Fashion", "Kids & Baby", "Footwear", "Watches", "Jewelry",
  "Home & Kitchen", "Furniture", "Bedding & Bath", "Home Decor", "Kitchen Appliances",
  "Beauty & Personal Care", "Skincare", "Haircare", "Fragrances", "Health & Wellness",
  "Sports & Outdoors", "Fitness Equipment", "Outdoor Recreation", "Cycling", "Camping",
  "Books & Stationery", "Fiction", "Non-Fiction", "Technical Books", "Office Supplies",
  "Toys & Games", "Board Games", "Video Games", "Musical Instruments",
  "Automotive Parts", "Tools & Home Improvement", "Pet Supplies", "Groceries & Gourmet"
];

const ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.pending,
  OrderStatus.paid,
  OrderStatus.shipped,
  OrderStatus.delivered,
  OrderStatus.cancelled,
];

async function main() {
  // Deterministic seed for reproducible data generation (PRD §15)
  faker.seed(42);

  console.log("🌱 Starting seed (destructive clean-and-regenerate)...");

  // Destructive wipe in FK-safe order
  await prisma.$transaction(async (tx) => {
    await tx.orderItem.deleteMany();
    await tx.order.deleteMany();
    await tx.product.deleteMany();
    await tx.category.deleteMany();
    await tx.customer.deleteMany();
  });

  const now = new Date();

  // 1. Seed Categories (40)
  console.log(`Generating ${NUM_CATEGORIES} categories...`);
  const categoryData = CATEGORY_NAMES.slice(0, NUM_CATEGORIES).map((name) => ({
    name,
    description: `${name} products and accessories`,
    createdAt: now,
    updatedAt: now,
  }));

  // Create categories and retrieve IDs
  const createdCategories = [];
  for (const cat of categoryData) {
    const created = await prisma.category.create({ data: cat });
    createdCategories.push(created);
  }

  // 2. Seed Customers (400)
  console.log(`Generating ${NUM_CUSTOMERS} customers...`);
  const customerRecords = [];
  const usedEmails = new Set<string>();

  // Deliberate test customer with uppercase input normalized to lowercase (PRD §5)
  const specialCustomer = {
    name: "Ada Okafor",
    email: "ada.okafor@example.com",
    phone: "+2348012345678",
    createdAt: now,
    updatedAt: now,
  };
  usedEmails.add(specialCustomer.email);
  customerRecords.push(specialCustomer);

  while (customerRecords.length < NUM_CUSTOMERS) {
    const firstName = faker.person.firstName();
    const lastName = faker.person.lastName();
    const email = faker.internet.email({ firstName, lastName }).toLowerCase();

    if (!usedEmails.has(email)) {
      usedEmails.add(email);
      customerRecords.push({
        name: `${firstName} ${lastName}`,
        email,
        phone: faker.helpers.fromRegExp(/\+23480[0-9]{8}/),
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  const createdCustomers = [];
  for (const cust of customerRecords) {
    const created = await prisma.customer.create({ data: cust });
    createdCustomers.push(created);
  }

  // 3. Seed Products (400)
  console.log(`Generating ${NUM_PRODUCTS} products...`);
  const createdProducts = [];
  for (let i = 0; i < NUM_PRODUCTS; i++) {
    const category = createdCategories[i % createdCategories.length]!;
    const name = `${faker.commerce.productName()} ${i + 1}`;
    const description = `${faker.commerce.productDescription()} [${category.name}]`;
    // Price in kobo (NGN minor units): e.g., 500 NGN = 50,000 kobo up to 500,000 NGN
    const price = faker.number.int({ min: 50000, max: 50000000 });

    // Deliberately force out-of-stock products for testing (PRD §15)
    // Products at indices 7, 14, 21, 28, 35, 42, 49, 56 will have stockQuantity = 0
    const stockQuantity = i % 7 === 0 && i < 60 ? 0 : faker.number.int({ min: 1, max: 150 });

    const created = await prisma.product.create({
      data: {
        name,
        description,
        categoryId: category.id,
        price,
        currency: "NGN",
        stockQuantity,
        createdAt: now,
        updatedAt: now,
      },
    });
    createdProducts.push(created);
  }

  // 4. Seed Orders (800) with 1-5 line items each
  console.log(`Generating ${NUM_ORDERS} orders...`);
  for (let i = 0; i < NUM_ORDERS; i++) {
    const customer = createdCustomers[i % createdCustomers.length]!;
    // Guaranteed balanced status distribution across all 5 statuses (PRD §15)
    const status = ORDER_STATUSES[i % ORDER_STATUSES.length]!;
    const itemCount = (i % 5) + 1; // 1 to 5 items

    const lineItems = [];
    let totalAmount = 0;
    const selectedProductIndices = new Set<number>();

    for (let j = 0; j < itemCount; j++) {
      const productIndex = (i * 3 + j * 7) % createdProducts.length;
      if (!selectedProductIndices.has(productIndex)) {
        selectedProductIndices.add(productIndex);
        const product = createdProducts[productIndex]!;
        const quantity = ((i + j) % 3) + 1;
        const unitPrice = product.price; // Snapshotted at current price

        lineItems.push({
          productId: product.id,
          quantity,
          unitPrice,
        });
        totalAmount += unitPrice * quantity;
      }
    }

    await prisma.order.create({
      data: {
        customerId: customer.id,
        status,
        totalAmount,
        currency: "NGN",
        createdAt: new Date(now.getTime() - i * 60000), // Slightly spread createdAt
        updatedAt: now,
        items: {
          create: lineItems,
        },
      },
    });
  }

  const categoryCount = await prisma.category.count();
  const productCount = await prisma.product.count();
  const oosCount = await prisma.product.count({ where: { stockQuantity: 0 } });
  const customerCount = await prisma.customer.count();
  const orderCount = await prisma.order.count();
  const orderItemCount = await prisma.orderItem.count();

  console.log("✅ Seed completed successfully!");
  console.log(`   Categories: ${categoryCount}`);
  console.log(`   Products:   ${productCount} (Out of stock: ${oosCount})`);
  console.log(`   Customers:  ${customerCount}`);
  console.log(`   Orders:     ${orderCount}`);
  console.log(`   OrderItems: ${orderItemCount}`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error("❌ Seed failed:", e);
    await prisma.$disconnect();
    process.exit(1);
  });
