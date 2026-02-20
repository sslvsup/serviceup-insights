import { z } from 'zod';

const lineItemSchema = z.object({
  item_type: z.enum([
    'labor', 'part', 'fee', 'shop_supply', 'hazmat', 'environmental',
    'sublet', 'tire', 'fluid', 'filter', 'discount', 'tax', 'misc', 'unknown',
  ]),
  name: z.string(),
  description: z.string().nullable().optional(),

  // Pricing
  quantity: z.number().default(1),
  unit_price: z.number().nullable().optional(),
  total_price: z.number().nullable().optional(),

  // Part-specific
  part_number: z.string().nullable().optional(),
  brand: z.string().nullable().optional(),
  is_oem: z.boolean().nullable().optional(),
  is_aftermarket: z.boolean().nullable().optional(),
  is_used: z.boolean().nullable().optional(),
  is_remanufactured: z.boolean().nullable().optional(),
  source: z.string().nullable().optional(),

  // Labor-specific
  hours: z.number().nullable().optional(),
  rate_per_hour: z.number().nullable().optional(),
  labor_type: z.string().nullable().optional(),
  technician: z.string().nullable().optional(),
  completion_date: z.string().nullable().optional(),

  // Tire-specific
  tire_size: z.string().nullable().optional(),
  tire_brand: z.string().nullable().optional(),
  tire_model: z.string().nullable().optional(),
  tire_position: z.string().nullable().optional(),

  // Fluid-specific
  fluid_type: z.string().nullable().optional(),
  fluid_quantity: z.number().nullable().optional(),
  fluid_unit: z.string().nullable().optional(),

  // Misc
  operation_type: z.string().nullable().optional(),
  repair_area: z.string().nullable().optional(),

  is_sublet: z.boolean().default(false),
  sublet_vendor: z.string().nullable().optional(),

  sort_order: z.number().default(0),
});

const serviceSchema = z.object({
  service_name: z.string().nullable().optional(),
  service_description: z.string().nullable().optional(),
  service_code: z.string().nullable().optional(),
  complaint: z.string().nullable().optional(),
  cause: z.string().nullable().optional(),
  correction: z.string().nullable().optional(),
  is_approved: z.boolean().nullable().optional(),
  is_recommended: z.boolean().nullable().optional(),
  is_declined: z.boolean().nullable().optional(),
  completion_date: z.string().nullable().optional(),
  service_subtotal: z.number().nullable().optional(),
  line_items: z.array(lineItemSchema).default([]),
  sort_order: z.number().default(0),
});

const extraFieldSchema = z.object({
  field_name: z.string(),
  field_value: z.string(),
  field_category: z.enum(['shop', 'vehicle', 'customer', 'financial', 'service', 'misc']).default('misc'),
  source_location: z.string().nullable().optional(),
});

export const invoiceParseSchema = z.object({
  is_valid_invoice: z.boolean(),
  parse_confidence: z.number().min(0).max(1),

  // Document IDs
  invoice_number: z.string().nullable().optional(),
  work_order_number: z.string().nullable().optional(),
  repair_order_number: z.string().nullable().optional(),
  purchase_order_number: z.string().nullable().optional(),
  estimate_number: z.string().nullable().optional(),
  authorization_number: z.string().nullable().optional(),

  // Dates (ISO format)
  invoice_date: z.string().nullable().optional(),
  estimate_date: z.string().nullable().optional(),
  due_date: z.string().nullable().optional(),
  promise_date: z.string().nullable().optional(),
  date_in: z.string().nullable().optional(),
  date_out: z.string().nullable().optional(),

  // Shop
  shop_name: z.string().nullable().optional(),
  shop_address: z.string().nullable().optional(),
  shop_city: z.string().nullable().optional(),
  shop_state: z.string().nullable().optional(),
  shop_zip: z.string().nullable().optional(),
  shop_phone: z.string().nullable().optional(),
  shop_email: z.string().nullable().optional(),
  shop_website: z.string().nullable().optional(),

  // Customer
  customer_name: z.string().nullable().optional(),
  customer_address: z.string().nullable().optional(),
  customer_phone: z.string().nullable().optional(),
  customer_email: z.string().nullable().optional(),
  bill_to_name: z.string().nullable().optional(),
  bill_to_address: z.string().nullable().optional(),
  ship_to_name: z.string().nullable().optional(),
  ship_to_address: z.string().nullable().optional(),
  remit_to_name: z.string().nullable().optional(),
  remit_to_address: z.string().nullable().optional(),

  // Vehicle
  vin: z.string().nullable().optional(),
  vehicle_year: z.string().nullable().optional(),
  vehicle_make: z.string().nullable().optional(),
  vehicle_model: z.string().nullable().optional(),
  vehicle_submodel: z.string().nullable().optional(),
  vehicle_engine: z.string().nullable().optional(),
  vehicle_color: z.string().nullable().optional(),
  vehicle_plate: z.string().nullable().optional(),
  vehicle_unit: z.string().nullable().optional(),
  mileage_in: z.number().nullable().optional(),
  mileage_out: z.number().nullable().optional(),

  // Financial totals (in dollars)
  subtotal: z.number().nullable().optional(),
  labor_total: z.number().nullable().optional(),
  parts_total: z.number().nullable().optional(),
  fees_total: z.number().nullable().optional(),
  shop_supplies: z.number().nullable().optional(),
  hazmat_fees: z.number().nullable().optional(),
  environmental_fees: z.number().nullable().optional(),
  discount_amount: z.number().nullable().optional(),
  discount_percent: z.number().nullable().optional(),
  tax_amount: z.number().nullable().optional(),
  tax_rate_percent: z.number().nullable().optional(),
  grand_total: z.number().nullable().optional(),
  balance_due: z.number().nullable().optional(),
  amount_paid: z.number().nullable().optional(),

  // Payment
  payment_terms: z.string().nullable().optional(),
  payment_method: z.string().nullable().optional(),

  // Approval
  approved_by: z.string().nullable().optional(),
  approved_at: z.string().nullable().optional(),
  customer_signature_present: z.boolean().default(false),

  // Terms
  warranty_text: z.string().nullable().optional(),
  terms_text: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),

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
