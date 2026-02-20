import { getPrisma } from '../db/prisma';
import { InvoiceParseResult, ServiceResult, LineItemResult } from './schema';
import { logger } from '../utils/logger';

function toCents(dollars: number | null | undefined): number | null {
  if (dollars == null) return null;
  return Math.round(dollars * 100);
}

function parseDate(dateStr: string | null | undefined): Date | null {
  if (!dateStr) return null;
  try {
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

function buildItemData(item: LineItemResult): Record<string, unknown> {
  const data: Record<string, unknown> = {};

  // Part fields
  if (item.part_number != null) data.part_number = item.part_number;
  if (item.brand != null) data.brand = item.brand;
  if (item.is_oem != null) data.is_oem = item.is_oem;
  if (item.is_aftermarket != null) data.is_aftermarket = item.is_aftermarket;
  if (item.is_used != null) data.is_used = item.is_used;
  if (item.is_remanufactured != null) data.is_remanufactured = item.is_remanufactured;
  if (item.source != null) data.source = item.source;

  // Labor fields
  if (item.hours != null) data.hours = item.hours;
  if (item.rate_per_hour != null) data.rate_per_hour = item.rate_per_hour;
  if (item.labor_type != null) data.labor_type = item.labor_type;
  if (item.technician != null) data.technician = item.technician;
  if (item.completion_date != null) data.completion_date = item.completion_date;

  // Tire fields
  if (item.tire_size != null) data.tire_size = item.tire_size;
  if (item.tire_brand != null) data.tire_brand = item.tire_brand;
  if (item.tire_model != null) data.tire_model = item.tire_model;
  if (item.tire_position != null) data.tire_position = item.tire_position;

  // Fluid fields
  if (item.fluid_type != null) data.fluid_type = item.fluid_type;
  if (item.fluid_quantity != null) data.fluid_quantity = item.fluid_quantity;
  if (item.fluid_unit != null) data.fluid_unit = item.fluid_unit;

  // Misc
  if (item.operation_type != null) data.operation_type = item.operation_type;
  if (item.repair_area != null) data.repair_area = item.repair_area;
  if (item.is_sublet) data.is_sublet = item.is_sublet;
  if (item.sublet_vendor != null) data.sublet_vendor = item.sublet_vendor;
  if (item.description != null) data.description = item.description;

  return data;
}

function buildServiceData(service: ServiceResult): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  if (service.complaint) data.complaint = service.complaint;
  if (service.cause) data.cause = service.cause;
  if (service.correction) data.correction = service.correction;
  if (service.service_description) data.service_description = service.service_description;
  if (service.is_approved != null) data.is_approved = service.is_approved;
  if (service.is_recommended != null) data.is_recommended = service.is_recommended;
  if (service.is_declined != null) data.is_declined = service.is_declined;
  if (service.completion_date) data.completion_date = service.completion_date;
  if (service.service_code) data.service_code = service.service_code;
  if (service.service_subtotal != null) data.subtotal = service.service_subtotal;
  return data;
}

export interface InvoiceRecord {
  requestId: number;
  shopId?: number | null;
  vehicleId?: number | null;
  fleetId?: number | null;
  pdfUrl: string;
  shopName?: string | null;
  vehicleVin?: string | null;
  vehicleMake?: string | null;
  vehicleModel?: string | null;
  vehicleYear?: string | null;
  llmModel?: string;
  elapsedMs?: number;
}

/**
 * Persist a parsed invoice (plus its services and line items) to PostgreSQL.
 * Returns the created ParsedInvoice ID.
 */
export async function normalizeAndStore(
  record: InvoiceRecord,
  parsed: InvoiceParseResult,
): Promise<number> {
  const prisma = getPrisma();

  // Build the extracted_data JSONB — everything the LLM found
  const extractedData = {
    ...parsed,
    // Remove large fields that have dedicated columns
    services: undefined,
    raw_text: undefined,
    extras: parsed.extras,
  };

  // Determine invoice date (try parsed date, fall back to null)
  const invoiceDate = parseDate(parsed.invoice_date ?? parsed.estimate_date);

  const invoice = await prisma.parsedInvoice.upsert({
    where: {
      requestId_pdfUrl: {
        requestId: record.requestId,
        pdfUrl: record.pdfUrl,
      },
    },
    create: {
      requestId: record.requestId,
      shopId: record.shopId ?? null,
      vehicleId: record.vehicleId ?? null,
      fleetId: record.fleetId ?? null,
      pdfUrl: record.pdfUrl,
      pdfType: 'invoice',
      parseStatus: parsed.is_valid_invoice ? 'completed' : 'failed',
      invoiceDate,
      grandTotalCents: toCents(parsed.grand_total),
      laborTotalCents: toCents(parsed.labor_total),
      partsTotalCents: toCents(parsed.parts_total),
      taxAmountCents: toCents(parsed.tax_amount),
      pdfShopName: parsed.shop_name ?? record.shopName ?? null,
      pdfVin: parsed.vin ?? record.vehicleVin ?? null,
      paymentTerms: parsed.payment_terms ?? null,
      extractedData: extractedData as object,
      rawExtractedText: parsed.raw_text,
      rawLlmResponse: parsed as object,
      parseMeta: {
        llm_model: record.llmModel ?? 'gemini-2.5-flash',
        elapsed_ms: record.elapsedMs ?? 0,
        confidence: parsed.parse_confidence,
        parsed_at: new Date().toISOString(),
      },
    },
    update: {
      parseStatus: parsed.is_valid_invoice ? 'completed' : 'failed',
      invoiceDate,
      grandTotalCents: toCents(parsed.grand_total),
      laborTotalCents: toCents(parsed.labor_total),
      partsTotalCents: toCents(parsed.parts_total),
      taxAmountCents: toCents(parsed.tax_amount),
      pdfShopName: parsed.shop_name ?? record.shopName ?? null,
      pdfVin: parsed.vin ?? record.vehicleVin ?? null,
      paymentTerms: parsed.payment_terms ?? null,
      extractedData: extractedData as object,
      rawExtractedText: parsed.raw_text,
      rawLlmResponse: parsed as object,
      parseMeta: {
        llm_model: record.llmModel ?? 'gemini-2.5-flash',
        elapsed_ms: record.elapsedMs ?? 0,
        confidence: parsed.parse_confidence,
        parsed_at: new Date().toISOString(),
      },
      updatedAt: new Date(),
    },
  });

  // Ensure we have at least one service.
  // If the LLM returned no services but there are line items at the top level,
  // the schema design wraps them implicitly. If truly empty, create a placeholder
  // so the invoice record is still navigable.
  const services =
    parsed.services.length > 0
      ? parsed.services
      : [{ service_name: 'General Service', line_items: [], sort_order: 0 }];

  // Delete existing services/items for re-processing
  await prisma.parsedInvoiceLineItem.deleteMany({ where: { parsedInvoiceId: invoice.id } });
  await prisma.parsedInvoiceService.deleteMany({ where: { parsedInvoiceId: invoice.id } });

  for (const [si, service] of services.entries()) {
    const dbService = await prisma.parsedInvoiceService.create({
      data: {
        parsedInvoiceId: invoice.id,
        serviceName: service.service_name ?? 'General Service',
        serviceData: buildServiceData(service) as object,
        sortOrder: service.sort_order ?? si,
      },
    });

    for (const [li, item] of service.line_items.entries()) {
      await prisma.parsedInvoiceLineItem.create({
        data: {
          parsedInvoiceId: invoice.id,
          parsedServiceId: dbService.id,
          itemType: item.item_type,
          name: item.name,
          quantity: item.quantity,
          unitPriceCents: toCents(item.unit_price),
          totalPriceCents: toCents(item.total_price),
          itemData: buildItemData(item) as object,
          sortOrder: item.sort_order ?? li,
        },
      });
    }
  }

  logger.info('Invoice stored', {
    invoiceId: invoice.id,
    requestId: record.requestId,
    shopName: invoice.pdfShopName,
    total: invoice.grandTotalCents,
    services: services.length,
  });

  return invoice.id;
}
