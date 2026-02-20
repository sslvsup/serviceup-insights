import { z } from 'zod';

const lineItemSchema = z.object({
  item_type: z.enum([
    'labor', 'part', 'fee', 'shop_supply', 'hazmat', 'environmental',
    'sublet', 'tire', 'fluid', 'filter', 'discount', 'tax', 'misc', 'unknown',
  ]),
  name: z.string(),
  description: z.string().optional(),

  // Pricing
  quantity: z.number().default(1),
  unit_price: z.number().optional(),
  total_price: z.number().optional(),

  // Part-specific
  part_number: z.string().optional(),
  brand: z.string().optional(),
  is_oem: z.boolean().optional(),
  is_aftermarket: z.boolean().optional(),
  is_used: z.boolean().optional(),
  is_remanufactured: z.boolean().optional(),
  source: z.string().optional(),

  // Labor-specific
  hours: z.number().optional(),
  rate_per_hour: z.number().optional(),
  labor_type: z.string().optional(),
  technician: z.string().optional(),
  completion_date: z.string().optional(),

  // Tire-specific
  tire_size: z.string().optional(),
  tire_brand: z.string().optional(),
  tire_model: z.string().optional(),
  tire_position: z.string().optional(),

  // Fluid-specific
  fluid_type: z.string().optional(),
  fluid_quantity: z.number().optional(),
  fluid_unit: z.string().optional(),

  // Misc
  operation_type: z.string().optional(),
  repair_area: z.string().optional(),

  is_sublet: z.boolean().default(false),
  sublet_vendor: z.string().optional(),

  sort_order: z.number().default(0),
});

const serviceSchema = z.object({
  service_name: z.string().optional(),
  service_description: z.string().optional(),
  service_code: z.string().optional(),
  complaint: z.string().optional(),
  cause: z.string().optional(),
  correction: z.string().optional(),
  is_approved: z.boolean().optional(),
  is_recommended: z.boolean().optional(),
  is_declined: z.boolean().optional(),
  completion_date: z.string().optional(),
  service_subtotal: z.number().optional(),
  line_items: z.array(lineItemSchema).default([]),
  sort_order: z.number().default(0),
});

const extraFieldSchema = z.object({
  field_name: z.string(),
  field_value: z.string(),
  field_category: z.enum(['shop', 'vehicle', 'customer', 'financial', 'service', 'misc']).default('misc'),
  source_location: z.string().optional(),
});

export const invoiceParseSchema = z.object({
  is_valid_invoice: z.boolean(),
  parse_confidence: z.number().min(0).max(1),

  // Document IDs
  invoice_number: z.string().optional(),
  work_order_number: z.string().optional(),
  repair_order_number: z.string().optional(),
  purchase_order_number: z.string().optional(),
  estimate_number: z.string().optional(),
  authorization_number: z.string().optional(),

  // Dates (ISO format)
  invoice_date: z.string().optional(),
  estimate_date: z.string().optional(),
  due_date: z.string().optional(),
  promise_date: z.string().optional(),
  date_in: z.string().optional(),
  date_out: z.string().optional(),

  // Shop
  shop_name: z.string().optional(),
  shop_address: z.string().optional(),
  shop_city: z.string().optional(),
  shop_state: z.string().optional(),
  shop_zip: z.string().optional(),
  shop_phone: z.string().optional(),
  shop_email: z.string().optional(),
  shop_website: z.string().optional(),

  // Customer
  customer_name: z.string().optional(),
  customer_address: z.string().optional(),
  customer_phone: z.string().optional(),
  customer_email: z.string().optional(),
  bill_to_name: z.string().optional(),
  bill_to_address: z.string().optional(),
  ship_to_name: z.string().optional(),
  ship_to_address: z.string().optional(),
  remit_to_name: z.string().optional(),
  remit_to_address: z.string().optional(),

  // Vehicle
  vin: z.string().optional(),
  vehicle_year: z.string().optional(),
  vehicle_make: z.string().optional(),
  vehicle_model: z.string().optional(),
  vehicle_submodel: z.string().optional(),
  vehicle_engine: z.string().optional(),
  vehicle_color: z.string().optional(),
  vehicle_plate: z.string().optional(),
  vehicle_unit: z.string().optional(),
  mileage_in: z.number().optional(),
  mileage_out: z.number().optional(),

  // Financial totals (in dollars)
  subtotal: z.number().optional(),
  labor_total: z.number().optional(),
  parts_total: z.number().optional(),
  fees_total: z.number().optional(),
  shop_supplies: z.number().optional(),
  hazmat_fees: z.number().optional(),
  environmental_fees: z.number().optional(),
  discount_amount: z.number().optional(),
  discount_percent: z.number().optional(),
  tax_amount: z.number().optional(),
  tax_rate_percent: z.number().optional(),
  grand_total: z.number().optional(),
  balance_due: z.number().optional(),
  amount_paid: z.number().optional(),

  // Payment
  payment_terms: z.string().optional(),
  payment_method: z.string().optional(),

  // Approval
  approved_by: z.string().optional(),
  approved_at: z.string().optional(),
  customer_signature_present: z.boolean().default(false),

  // Terms
  warranty_text: z.string().optional(),
  terms_text: z.string().optional(),
  notes: z.string().optional(),

  // Structured data
  services: z.array(serviceSchema).default([]),

  // Catch-all for any fields not in the schema
  extras: z.array(extraFieldSchema).default([]),

  // Full text for backup + pgvector embedding
  raw_text: z.string(),
});

export type InvoiceParseResult = z.infer<typeof invoiceParseSchema>;
export type ServiceResult = z.infer<typeof serviceSchema>;
export type LineItemResult = z.infer<typeof lineItemSchema>;
