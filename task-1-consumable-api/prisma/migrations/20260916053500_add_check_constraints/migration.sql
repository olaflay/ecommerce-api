-- Add Check Constraints for Data Storage Integrity (PRD §14)

-- Product stockQuantity must be non-negative (>= 0)
ALTER TABLE "Product" ADD CONSTRAINT "check_product_stock_non_negative" CHECK ("stockQuantity" >= 0);

-- Product price must be strictly positive (> 0)
ALTER TABLE "Product" ADD CONSTRAINT "check_product_price_positive" CHECK ("price" > 0);

-- OrderItem quantity must be at least 1 (>= 1)
ALTER TABLE "OrderItem" ADD CONSTRAINT "check_order_item_quantity_positive" CHECK ("quantity" >= 1);

-- OrderItem unitPrice must be strictly positive (> 0)
ALTER TABLE "OrderItem" ADD CONSTRAINT "check_order_item_unit_price_positive" CHECK ("unitPrice" > 0);
