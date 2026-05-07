/**
 * Requisition Diff Utility
 * Calculates differences between old and new requisition states
 * for notification purposes when a requisition is updated.
 */

export interface FieldChange {
  field: string;
  label: string;
  oldValue: any;
  newValue: any;
}

export interface ProductChange {
  productId: number;
  productName: string;
  changes: FieldChange[];
  isNew?: boolean;
  isRemoved?: boolean;
}

export interface RequisitionDiff {
  requisitionChanges: FieldChange[];
  productChanges: ProductChange[];
  hasChanges: boolean;
}

/**
 * Field mapping for human-readable labels
 */
const FIELD_LABELS: Record<string, string> = {
  subject: "Title",
  deliveryDate: "Delivery Date",
  negotiationClosureDate: "Negotiation Closure Date",
  totalPrice: "Target Price",
  totalMaxPrice: "Maximum Price",
  maxDeliveryDate: "Maximum Delivery Date",
  payment_terms: "Payment Terms",
  net_payment_day: "Net Payment Days",
  pre_payment_percentage: "Pre-Payment Percentage",
  post_payment_percentage: "Post-Payment Percentage",
  qty: "Quantity",
  targetPrice: "Target Price",
  maximum_price: "Maximum Price",
};

/**
 * Format a value for display in notifications
 */
const formatValue = (value: any, field: string): string => {
  if (value === null || value === undefined) {
    return "Not set";
  }

  // Date fields
  if (field.toLowerCase().includes("date") && value) {
    const date = new Date(value);
    if (!isNaN(date.getTime())) {
      return date.toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    }
  }

  // Percentage fields
  if (field.includes("percentage") || field.includes("Percentage")) {
    return `${value}%`;
  }

  // Price fields
  if (field.toLowerCase().includes("price")) {
    const num = parseFloat(value);
    if (!isNaN(num)) {
      return `$${num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
  }

  return String(value);
};

/**
 * Compare two values considering type coercion for numeric strings
 */
const valuesAreEqual = (oldVal: any, newVal: any): boolean => {
  // Both null/undefined
  if (
    (oldVal === null || oldVal === undefined) &&
    (newVal === null || newVal === undefined)
  ) {
    return true;
  }

  // One is null/undefined, other is not
  if (
    oldVal === null ||
    oldVal === undefined ||
    newVal === null ||
    newVal === undefined
  ) {
    return false;
  }

  // For dates, compare timestamps
  if (oldVal instanceof Date && newVal instanceof Date) {
    return oldVal.getTime() === newVal.getTime();
  }

  // For strings that might be dates
  if (typeof oldVal === "string" && typeof newVal === "string") {
    const oldDate = new Date(oldVal);
    const newDate = new Date(newVal);
    if (!isNaN(oldDate.getTime()) && !isNaN(newDate.getTime())) {
      // Compare just the date part (ignore time for date-only fields)
      return oldDate.toDateString() === newDate.toDateString();
    }
  }

  // For numbers (including string numbers)
  const oldNum = parseFloat(oldVal);
  const newNum = parseFloat(newVal);
  if (!isNaN(oldNum) && !isNaN(newNum)) {
    return oldNum === newNum;
  }

  // String comparison
  return String(oldVal) === String(newVal);
};

/**
 * Calculate diff between old and new requisition states
 */
export const calculateRequisitionDiff = (
  oldReq: Record<string, any>,
  newReq: Record<string, any>,
  oldProducts: any[],
  newProducts: any[],
): RequisitionDiff => {
  const requisitionChanges: FieldChange[] = [];
  const productChanges: ProductChange[] = [];

  // Fields to compare on requisition level
  const requisitionFields = [
    "subject",
    "deliveryDate",
    "negotiationClosureDate",
    "totalPrice",
    "totalMaxPrice",
    "maxDeliveryDate",
    "payment_terms",
    "net_payment_day",
    "pre_payment_percentage",
    "post_payment_percentage",
  ];

  // Compare requisition fields
  for (const field of requisitionFields) {
    const oldVal = oldReq[field];
    const newVal = newReq[field];

    if (!valuesAreEqual(oldVal, newVal)) {
      requisitionChanges.push({
        field,
        label: FIELD_LABELS[field] || field,
        oldValue: formatValue(oldVal, field),
        newValue: formatValue(newVal, field),
      });
    }
  }

  // Build maps for product comparison
  const oldProductMap = new Map<number, any>();
  const newProductMap = new Map<number, any>();

  for (const product of oldProducts || []) {
    const productId = product.productId || product.id;
    if (productId) {
      oldProductMap.set(productId, product);
    }
  }

  for (const product of newProducts || []) {
    const productId =
      typeof product.productId === "string"
        ? parseInt(product.productId, 10)
        : product.productId;
    if (productId) {
      newProductMap.set(productId, product);
    }
  }

  // Find removed products
  for (const [productId, oldProduct] of oldProductMap) {
    if (!newProductMap.has(productId)) {
      productChanges.push({
        productId,
        productName:
          oldProduct.Product?.productName ||
          oldProduct.productName ||
          `Product #${productId}`,
        changes: [],
        isRemoved: true,
      });
    }
  }

  // Find added and modified products
  for (const [productId, newProduct] of newProductMap) {
    const oldProduct = oldProductMap.get(productId);
    const productName =
      newProduct.Product?.productName ||
      newProduct.productName ||
      `Product #${productId}`;

    if (!oldProduct) {
      // New product
      productChanges.push({
        productId,
        productName,
        changes: [],
        isNew: true,
      });
    } else {
      // Compare product fields
      const productFields = ["qty", "targetPrice", "maximum_price"];
      const changes: FieldChange[] = [];

      for (const field of productFields) {
        // Handle alternative field names
        let oldVal = oldProduct[field];
        let newVal = newProduct[field];

        // quantity might be stored as 'qty' or 'quantity'
        if (field === "qty") {
          oldVal = oldProduct.qty ?? oldProduct.quantity;
          newVal = newProduct.qty ?? newProduct.quantity;
        }

        if (!valuesAreEqual(oldVal, newVal)) {
          changes.push({
            field,
            label: FIELD_LABELS[field] || field,
            oldValue: formatValue(oldVal, field),
            newValue: formatValue(newVal, field),
          });
        }
      }

      if (changes.length > 0) {
        productChanges.push({
          productId,
          productName,
          changes,
        });
      }
    }
  }

  return {
    requisitionChanges,
    productChanges,
    hasChanges: requisitionChanges.length > 0 || productChanges.length > 0,
  };
};

/**
 * Generate a human-readable summary of changes for system messages.
 *
 * Internal/buyer view — includes strategy-sensitive fields (target price,
 * maximum price). Use generateVendorSafeChangeSummary() for vendor-facing
 * notifications.
 */
export const generateChangeSummary = (diff: RequisitionDiff): string => {
  const lines: string[] = [];

  if (diff.requisitionChanges.length > 0) {
    lines.push("**Requisition Changes:**");
    for (const change of diff.requisitionChanges) {
      lines.push(`- ${change.label}: ${change.oldValue} -> ${change.newValue}`);
    }
  }

  if (diff.productChanges.length > 0) {
    lines.push("");
    lines.push("**Product Changes:**");
    for (const pc of diff.productChanges) {
      if (pc.isNew) {
        lines.push(`- Added: ${pc.productName}`);
      } else if (pc.isRemoved) {
        lines.push(`- Removed: ${pc.productName}`);
      } else {
        lines.push(`- ${pc.productName}:`);
        for (const change of pc.changes) {
          lines.push(
            `  - ${change.label}: ${change.oldValue} -> ${change.newValue}`,
          );
        }
      }
    }
  }

  return lines.join("\n");
};

/**
 * Strategy-sensitive field labels that must NEVER appear in vendor-facing
 * notifications. Buyer's target price and max acceptable price are internal
 * negotiation parameters — exposing them gives the vendor an anchor.
 */
const STRATEGY_SENSITIVE_LABELS = new Set<string>([
  "Target Price",
  "Maximum Price",
]);

/**
 * Vendor-safe summary of requisition changes.
 *
 * Strips out strategy-sensitive fields entirely (Target Price, Maximum Price).
 * Returns null when nothing remains worth telling the vendor about — the
 * caller should skip the SYSTEM message in that case rather than send an
 * empty banner.
 *
 * Tone: written as a casual procurement-buyer note, not a system log line.
 */
export const generateVendorSafeChangeSummary = (
  diff: RequisitionDiff,
): string | null => {
  const reqLines: string[] = [];
  for (const change of diff.requisitionChanges) {
    if (STRATEGY_SENSITIVE_LABELS.has(change.label)) continue;
    reqLines.push(`- ${change.label}: ${change.newValue}`);
  }

  const productLines: string[] = [];
  for (const pc of diff.productChanges) {
    if (pc.isNew) {
      productLines.push(`- Added: ${pc.productName}`);
      continue;
    }
    if (pc.isRemoved) {
      productLines.push(`- Removed: ${pc.productName}`);
      continue;
    }
    const filtered = pc.changes.filter(
      (c) => !STRATEGY_SENSITIVE_LABELS.has(c.label),
    );
    if (filtered.length === 0) continue;
    productLines.push(`- ${pc.productName}:`);
    for (const change of filtered) {
      productLines.push(`  - ${change.label}: ${change.newValue}`);
    }
  }

  if (reqLines.length === 0 && productLines.length === 0) {
    return null;
  }

  const sections: string[] = [];
  if (reqLines.length > 0) {
    sections.push(`Updated requirements:\n${reqLines.join("\n")}`);
  }
  if (productLines.length > 0) {
    sections.push(`Line items:\n${productLines.join("\n")}`);
  }
  return sections.join("\n\n");
};
