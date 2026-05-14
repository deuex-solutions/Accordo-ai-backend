import repo from "./dashboard.repo.js";
import userRepo from "../user/user.repo.js";
import { CustomError } from "../../utils/custom-error.js";



// ============================================================================
// Existing service (kept as-is)
// ============================================================================

const DAYS_IN_YEAR = 365;

const parseNumber = (value: any): number => {
  const parsed = Number.parseFloat(value);
  return Number.isNaN(parsed) ? 0 : parsed;
};

interface ContractDetail {
  productId: number;
  Price?: number;
  price?: number;
}

const calculateActualPrice = (requisition: any): number => {
  const products = new Map<number, number>();
  (requisition.RequisitionProduct || []).forEach((product: any) => {
    products.set(product.productId, parseNumber(product.qty));
  });

  let total = 0;
  (requisition.Contract || []).forEach((contract: any) => {
    if (contract.status !== "Accepted") {
      return;
    }

    const details = (() => {
      if (!contract.contractDetails) {
        return [];
      }
      if (Array.isArray(contract.contractDetails)) {
        return contract.contractDetails;
      }
      try {
        const parsed = JSON.parse(contract.contractDetails);
        return Array.isArray(parsed) ? parsed : [];
      } catch (error) {
        return [];
      }
    })();

    details.forEach((detail: ContractDetail) => {
      const qty = products.get(detail.productId) ?? 0;
      const price = parseNumber(detail.Price ?? detail.price);
      total += qty * price;
    });
  });

  return total;
};

const groupBy = <T, K>(array: T[], keyFn: (item: T) => K): Map<K, number> => {
  const map = new Map<K, number>();
  array.forEach((item) => {
    const key = keyFn(item);
    map.set(key, (map.get(key) || 0) + 1);
  });
  return map;
};

const formatDate = (date: Date): string =>
  new Date(date).toISOString().slice(0, 10);

const getWeekOfYear = (date: Date): number => {
  const d = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()),
  );
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(
    ((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7,
  );
  return week;
};

const buildTimeWiseCounts = (requisitions: any[], dayYear: string | number) => {
  const parsedDayYear = Number.parseInt(String(dayYear), 10);
  const deliveryDates = requisitions.map((req) => new Date(req.deliveryDate));

  if (parsedDayYear === 1) {
    const monthly = groupBy(deliveryDates, (date) =>
      date.toISOString().slice(0, 7),
    );
    return Array.from(monthly.entries()).map(
      ([delivery_month, requisition_count]) => ({
        delivery_month,
        requisition_count,
      }),
    );
  }

  if (parsedDayYear === 5) {
    const yearly = groupBy(deliveryDates, (date) => date.getUTCFullYear());
    return Array.from(yearly.entries()).map(
      ([delivery_year, requisition_count]) => ({
        delivery_year,
        requisition_count,
      }),
    );
  }

  const daily = groupBy(deliveryDates, (date) => formatDate(date));
  const weekly = groupBy(deliveryDates, (date) => getWeekOfYear(date));

  return {
    dailyReqCount: Array.from(daily.entries()).map(
      ([delivery_date, requisition_count]) => ({
        delivery_date,
        requisition_count,
      }),
    ),
    weeklyReqCount: Array.from(weekly.entries()).map(
      ([delivery_week, requisition_count]) => ({
        delivery_week,
        requisition_count,
      }),
    ),
  };
};

const buildCategorySummary = (requisitions: any[]) => {
  const categoryTotals = new Map<
    string,
    { total_price: number; actual_price: number }
  >();
  requisitions.forEach((req) => {
    const category = req.category || "Unknown";
    const current = categoryTotals.get(category) || {
      total_price: 0,
      actual_price: 0,
    };
    current.total_price += parseNumber(req.totalPrice);
    current.actual_price += calculateActualPrice(req);
    categoryTotals.set(category, current);
  });

  return Array.from(categoryTotals.entries()).map(([category, values]) => ({
    category,
    total_price: values.total_price,
    actual_price: values.actual_price,
  }));
};

const buildStatusCounts = (requisitions: any[]) => {
  const counts = groupBy(requisitions, (req) => req.status || "Unknown");
  return Array.from(counts.entries()).map(([status, requisition_count]) => ({
    status,
    requisition_count,
  }));
};

const buildRfqSummaries = (requisitions: any[]) => {
  const sorted = [...requisitions].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  const latest = sorted.slice(0, 2);

  const totalPriceRfq = latest.map((req) => ({
    rfqId: req.rfqId,
    totalPrice: parseNumber(req.totalPrice),
  }));

  const actualPriceRfq = latest.map((req) => ({
    rfqId: req.rfqId,
    actualPrice: calculateActualPrice(req),
  }));

  const priceSavingRfq = totalPriceRfq.map((item, index) => ({
    rfqId: item.rfqId,
    savingPrice: item.totalPrice - (actualPriceRfq[index]?.actualPrice ?? 0),
  }));

  return { totalPriceRfq, actualPriceRfq, priceSavingRfq };
};

const computeTotals = (requisitions: any[]) => {
  let totalBudget = 0;
  let actualPrice = 0;

  requisitions.forEach((req) => {
    const hasAcceptedContract = (req.Contract || []).some(
      (contract: any) => contract.status === "Accepted",
    );
    if (!hasAcceptedContract) {
      return;
    }
    totalBudget += parseNumber(req.totalPrice);
    actualPrice += calculateActualPrice(req);
  });

  return { totalBudget, actualPrice, totalSaving: totalBudget - actualPrice };
};

const getStartDate = (dayYear: string | number): Date => {
  const now = new Date();
  const parsed = Number.parseInt(String(dayYear), 10);
  if (parsed === 1 || parsed === 5) {
    const years = parsed;
    now.setUTCDate(now.getUTCDate() - years * DAYS_IN_YEAR);
    return now;
  }
  now.setUTCDate(now.getUTCDate() - 30);
  return now;
};

export const getDashboardService = async (
  userId: number,
  dayYear: string | number,
) => {
  try {
    const user = await userRepo.getUserProfile(userId);
    if (!user?.companyId) {
      throw new CustomError("User company not found", 404);
    }

    const fromDate = getStartDate(dayYear);
    const requisitions = await repo.findRequisitionsForCompany(
      user.companyId,
      fromDate,
    );
    const plainRequisitions = requisitions.map((req) =>
      req.get({ plain: true }),
    );

    const totals = computeTotals(plainRequisitions);
    const rfqIds = buildRfqSummaries(plainRequisitions);
    const categorySummary = buildCategorySummary(plainRequisitions);
    const statusSummary = buildStatusCounts(plainRequisitions);
    const timeWise = buildTimeWiseCounts(plainRequisitions, dayYear);

    return {
      getCategoryWiseRequisitionTotalPrice: categorySummary,
      statusWiseReqCount: statusSummary,
      timeWiseRequisitionCount: timeWise,
      rfqIds,
      totalBudget: totals.totalBudget,
      actualPrice: totals.actualPrice,
      totalSaving: totals.totalSaving,
    };
  } catch (error) {
    throw new CustomError(`Service ${error}`, 400);
  }
};

// ============================================================================
// New stats service
// ============================================================================

type Period = "7d" | "30d" | "90d" | "1y" | "all";

interface DateRange {
  from: Date;
  to: Date;
}

const PERIOD_DAYS: Record<string, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
  "1y": 365,
};

const getPeriodRange = (period: Period): DateRange => {
  const to = new Date();
  if (period === "all") {
    return { from: new Date(2000, 0, 1), to };
  }
  const days = PERIOD_DAYS[period] || 30;
  const from = new Date();
  from.setDate(from.getDate() - days);
  return { from, to };
};

const getPreviousPeriodRange = (period: Period): DateRange | null => {
  if (period === "all") return null;
  const days = PERIOD_DAYS[period] || 30;
  const to = new Date();
  to.setDate(to.getDate() - days);
  const from = new Date(to);
  from.setDate(from.getDate() - days);
  return { from, to };
};

// ---- KPI helpers ----

const computeSavings = (requisitions: any[]): number => {
  let total = 0;
  requisitions.forEach((req) => {
    const hasAccepted = (req.Contract || []).some(
      (c: any) => c.status === "Accepted",
    );
    if (!hasAccepted) return;
    const budget = parseNumber(req.totalPrice);
    const actual = calculateActualPrice(req);
    total += Math.max(0, budget - actual);
  });
  return total;
};

const computeAvgDealImprovement = (
  requisitions: any[],
  vendorBids: any[],
): number => {
  // Try from vendor bids first (priceReductionPercent)
  const reductions: number[] = [];
  vendorBids.forEach((bid: any) => {
    const metrics = bid.chatSummaryMetrics;
    if (
      metrics &&
      typeof metrics.priceReductionPercent === "number" &&
      metrics.priceReductionPercent > 0
    ) {
      reductions.push(metrics.priceReductionPercent);
    }
  });
  if (reductions.length > 0) {
    return reductions.reduce((a, b) => a + b, 0) / reductions.length;
  }

  // Fallback: compute from requisitions
  const improvements: number[] = [];
  requisitions.forEach((req) => {
    const hasAccepted = (req.Contract || []).some(
      (c: any) => c.status === "Accepted",
    );
    if (!hasAccepted) return;
    const budget = parseNumber(req.totalPrice);
    if (budget <= 0) return;
    const actual = calculateActualPrice(req);
    const improvement = ((budget - actual) / budget) * 100;
    if (improvement > 0) improvements.push(improvement);
  });
  if (improvements.length === 0) return 0;
  return improvements.reduce((a, b) => a + b, 0) / improvements.length;
};

const computeDelta = (
  current: number,
  previous: number,
  mode: "percent" | "absolute",
): { delta: number; trend: "up" | "down" | "neutral" } => {
  if (mode === "absolute") {
    const delta = current - previous;
    return { delta, trend: delta > 0 ? "up" : delta < 0 ? "down" : "neutral" };
  }
  if (previous === 0) {
    return {
      delta: current > 0 ? 100 : 0,
      trend: current > 0 ? "up" : "neutral",
    };
  }
  const delta = ((current - previous) / previous) * 100;
  return {
    delta: Math.round(delta * 10) / 10,
    trend: delta > 0 ? "up" : delta < 0 ? "down" : "neutral",
  };
};

// ---- Pipeline ----

const buildPipeline = (deals: any[]) => {
  const pipeline = { negotiating: 0, accepted: 0, walkedAway: 0, escalated: 0 };
  deals.forEach((deal: any) => {
    const status = deal.status || deal.get?.("status");
    if (status === "NEGOTIATING") pipeline.negotiating++;
    else if (status === "ACCEPTED") pipeline.accepted++;
    else if (status === "WALKED_AWAY") pipeline.walkedAway++;
    else if (status === "ESCALATED") pipeline.escalated++;
  });
  return pipeline;
};

// ---- Savings timeline ----

/**
 * Adaptive bucketing strategy:
 *   7d  → daily   (7 points)
 *   30d → daily   (30 points)
 *   90d → weekly  (~13 points)
 *   1y  → monthly (12 points)
 *   all → monthly (variable)
 *
 * Returns per-bucket savings (bars), cumulative running total (line),
 * and summary stats for inline callouts.
 */
const buildSavingsTimeline = (requisitions: any[], period: Period) => {
  const days = PERIOD_DAYS[period] || 30;
  const now = new Date();
  const start = new Date(now);
  start.setDate(start.getDate() - days);

  // Generate continuous time buckets with adaptive granularity
  const allBuckets: { key: string; label: string }[] = [];

  if (days <= 30) {
    // Daily buckets for 7d and 30d
    for (let i = 0; i <= days; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      allBuckets.push({
        key: d.toISOString().slice(0, 10),
        label:
          days <= 7
            ? d.toLocaleDateString("en-US", {
                weekday: "short",
                day: "numeric",
              })
            : d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      });
    }
  } else if (days <= 90) {
    // Weekly buckets for 90d
    const weekStart = new Date(start);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    while (weekStart <= now) {
      allBuckets.push({
        key: weekStart.toISOString().slice(0, 10),
        label: weekStart.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        }),
      });
      weekStart.setDate(weekStart.getDate() + 7);
    }
  } else {
    // Monthly buckets for 1y and all
    const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
    while (cursor <= now) {
      allBuckets.push({
        key: cursor.toISOString().slice(0, 7),
        label: cursor.toLocaleDateString("en-US", {
          month: "short",
          year: "2-digit",
        }),
      });
      cursor.setMonth(cursor.getMonth() + 1);
    }
  }

  // Initialize all buckets with 0
  const bucketValues = new Map<string, number>();
  allBuckets.forEach((b) => bucketValues.set(b.key, 0));

  // Determine which bucket key a date falls into
  const getBucketKey = (d: Date): string => {
    if (days <= 30) {
      return d.toISOString().slice(0, 10);
    } else if (days <= 90) {
      const ws = new Date(d);
      ws.setDate(d.getDate() - d.getDay());
      return ws.toISOString().slice(0, 10);
    } else {
      return d.toISOString().slice(0, 7);
    }
  };

  // Fill buckets with actual savings data — use accepted contract date
  requisitions.forEach((req) => {
    const acceptedContract = (req.Contract || []).find(
      (c: any) => c.status === "Accepted",
    );
    if (!acceptedContract) return;
    const savings =
      parseNumber(req.savingsInPrice) ||
      Math.max(0, parseNumber(req.totalPrice) - calculateActualPrice(req));
    const date = new Date(
      acceptedContract.updatedAt || acceptedContract.createdAt || req.createdAt,
    );
    const key = getBucketKey(date);
    if (bucketValues.has(key)) {
      bucketValues.set(key, (bucketValues.get(key) || 0) + savings);
    }
  });

  const labels = allBuckets.map((b) => b.label);
  const data = allBuckets.map((b) => Math.round(bucketValues.get(b.key) || 0));

  // Build cumulative running total
  const cumulative: number[] = [];
  let runningTotal = 0;
  for (const val of data) {
    runningTotal += val;
    cumulative.push(runningTotal);
  }

  // Summary stats
  const total = runningTotal;
  const nonZeroBuckets = data.filter((v) => v > 0).length;
  const avgPerBucket =
    nonZeroBuckets > 0 ? Math.round(total / nonZeroBuckets) : 0;
  let peakValue = 0;
  let peakIdx = 0;
  data.forEach((v, i) => {
    if (v > peakValue) {
      peakValue = v;
      peakIdx = i;
    }
  });

  return {
    labels,
    data,
    cumulative,
    summary: {
      total,
      avgPerBucket,
      peakValue: Math.round(peakValue),
      peakLabel: labels[peakIdx] || "",
    },
  };
};

// ---- Spend by category ----

const buildSpendByCategory = (requisitions: any[]) => {
  const totals = new Map<string, number>();
  let grandTotal = 0;

  requisitions.forEach((req) => {
    const cat = req.category || "Unknown";
    const price = parseNumber(req.totalPrice);
    totals.set(cat, (totals.get(cat) || 0) + price);
    grandTotal += price;
  });

  return Array.from(totals.entries())
    .map(([category, amount]) => ({
      category,
      amount: Math.round(amount),
      percentage: grandTotal > 0 ? Math.round((amount / grandTotal) * 100) : 0,
    }))
    .sort((a, b) => b.amount - a.amount);
};

// ---- Activity feed ----

const buildActivityFeed = (deals: any[], requisitions: any[]) => {
  const statusToType: Record<string, string> = {
    NEGOTIATING: "deal_started",
    ACCEPTED: "deal_accepted",
    WALKED_AWAY: "deal_walked_away",
    ESCALATED: "deal_escalated",
  };

  const activities: any[] = [];

  deals.forEach((deal: any) => {
    const d = deal.get ? deal.get({ plain: true }) : deal;
    const type = statusToType[d.status] || "deal_started";
    const reqData = d.Requisition || {};
    const vendorData = d.Vendor || {};

    activities.push({
      id: d.id,
      type,
      title: d.title || reqData.subject || "Deal update",
      description: `${vendorData.name || "Vendor"} — ${d.status?.toLowerCase()?.replace("_", " ") || "updated"}`,
      timestamp: d.updatedAt || d.createdAt,
      entityType: "deal",
      rfqId: reqData.id || d.requisitionId,
      vendorId: vendorData.id || d.vendorId,
      dealId: d.id,
    });
  });

  requisitions.forEach((req: any) => {
    const r = req.get ? req.get({ plain: true }) : req;
    activities.push({
      id: `req-${r.id}`,
      type: "requisition_created",
      title: r.subject || `RFQ ${r.rfqId}`,
      description: `New requisition created — ${r.category || "General"}`,
      timestamp: r.createdAt,
      entityType: "requisition",
      rfqId: r.id,
    });
  });

  return activities
    .sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    )
    .slice(0, 15);
};

// ---- Needs attention ----

const buildNeedsAttention = async (companyId: number, fromDate?: Date) => {
  const [
    stalledDeals,
    approachingDeals,
    escalatedDeals,
    unresponsiveContracts,
  ] = await Promise.all([
    repo.findStalledDeals(companyId, 3, fromDate),
    repo.findApproachingDeadlines(companyId, 5, fromDate),
    repo.findEscalatedDeals(companyId, fromDate),
    repo.findUnresponsiveVendors(companyId, 2, fromDate),
  ]);

  const stalledNegotiations = stalledDeals.map((deal: any) => {
    const d = deal.get ? deal.get({ plain: true }) : deal;
    const lastActivity = d.lastMessageAt || d.updatedAt;
    const daysSince = Math.floor(
      (Date.now() - new Date(lastActivity).getTime()) / (1000 * 60 * 60 * 24),
    );
    return {
      dealId: d.id,
      rfqId: d.Requisition?.id || d.requisitionId,
      vendorId: d.Vendor?.id || d.vendorId,
      title: d.title || d.Requisition?.subject || "Untitled",
      vendorName: d.Vendor?.name || "Unknown vendor",
      lastActivityAt: lastActivity,
      daysSinceActivity: daysSince,
    };
  });

  // Filter approaching deadlines by checking negotiationConfigJson
  const now = new Date();
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + 5);

  const approachingDeadlines = approachingDeals
    .map((deal: any) => {
      const d = deal.get ? deal.get({ plain: true }) : deal;
      const config = d.negotiationConfigJson;
      if (!config) return null;
      const deadline = config.deadline || config.negotiationControl?.deadline;
      if (!deadline) return null;
      const deadlineDate = new Date(deadline);
      if (isNaN(deadlineDate.getTime())) return null;
      if (deadlineDate <= now || deadlineDate > futureDate) return null;
      const daysRemaining = Math.ceil(
        (deadlineDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
      );
      return {
        dealId: d.id,
        rfqId: d.Requisition?.id || d.requisitionId,
        vendorId: d.vendorId,
        title: d.title || d.Requisition?.subject || "Untitled",
        deadline: deadline,
        daysRemaining,
      };
    })
    .filter(Boolean);

  const escalatedDealsList = escalatedDeals.map((deal: any) => {
    const d = deal.get ? deal.get({ plain: true }) : deal;
    return {
      dealId: d.id,
      rfqId: d.Requisition?.id || d.requisitionId,
      vendorId: d.Vendor?.id || d.vendorId,
      title: d.title || d.Requisition?.subject || "Untitled",
      vendorName: d.Vendor?.name || "Unknown vendor",
      escalatedAt: d.updatedAt,
      reason: "Max rounds exceeded",
    };
  });

  const unresponsiveVendors = unresponsiveContracts.map((contract: any) => {
    const c = contract.get ? contract.get({ plain: true }) : contract;
    const daysSince = Math.floor(
      (Date.now() - new Date(c.createdAt).getTime()) / (1000 * 60 * 60 * 24),
    );
    return {
      vendorId: c.vendorId,
      vendorName: c.Vendor?.name || "Unknown vendor",
      dealId: c.chatbotDealId || "",
      rfqId: c.Requisition?.id || c.requisitionId,
      lastNotifiedAt: c.createdAt,
      daysSinceNotification: daysSince,
    };
  });

  return {
    stalledNegotiations,
    approachingDeadlines,
    escalatedDeals: escalatedDealsList,
    unresponsiveVendors,
  };
};

// ============================================================================
// Main getStats service
// ============================================================================

export const getStatsService = async (
  userId: number,
  period: Period = "30d",
) => {
  try {
    const user = await userRepo.getUserProfile(userId);
    if (!user?.companyId) {
      throw new CustomError("User company not found", 404);
    }

    const companyId = user.companyId;
    const currentRange = getPeriodRange(period);
    const previousRange = getPreviousPeriodRange(period);

    // Fetch all data in parallel
    const [
      currentRequisitions,
      previousRequisitions,
      allDeals,
      periodDeals,
      previousDeals,
      allRequisitions,
      vendorBids,
      recentDeals,
      recentReqs,
    ] = await Promise.all([
      repo.findRequisitionsInPeriod(
        companyId,
        currentRange.from,
        currentRange.to,
      ),
      previousRange
        ? repo.findRequisitionsInPeriod(
            companyId,
            previousRange.from,
            previousRange.to,
          )
        : Promise.resolve([]),
      repo.findDealsForCompany(companyId),
      repo.findDealsForCompany(companyId, currentRange.from, currentRange.to),
      previousRange
        ? repo.findDealsForCompany(
            companyId,
            previousRange.from,
            previousRange.to,
          )
        : Promise.resolve([]),
      repo.findRequisitionsInPeriod(
        companyId,
        new Date(2000, 0, 1),
        new Date(),
      ),
      repo.findVendorBidsForCompany(
        companyId,
        currentRange.from,
        currentRange.to,
      ),
      repo.findRecentDeals(companyId, 15, currentRange.from, currentRange.to),
      repo.findRecentRequisitions(
        companyId,
        10,
        currentRange.from,
        currentRange.to,
      ),
    ]);

    const plainCurrent = currentRequisitions.map((r) => r.get({ plain: true }));
    const plainPrevious = previousRequisitions.map((r: any) =>
      r.get({ plain: true }),
    );
    const plainAllRequisitions = allRequisitions.map((r) =>
      r.get({ plain: true }),
    );
    const plainBids = vendorBids.map((b) => b.get({ plain: true }));

    // ---- KPIs ----
    const currentSavings = computeSavings(plainCurrent);
    const previousSavings = computeSavings(plainPrevious);
    const savingsDelta = computeDelta(
      currentSavings,
      previousSavings,
      "percent",
    );

    const activeNegotiations = periodDeals.filter(
      (d: any) => d.status === "NEGOTIATING",
    ).length;
    const prevActiveCount = previousDeals.filter(
      (d: any) => d.status === "NEGOTIATING",
    ).length;
    const activeNegDelta = computeDelta(
      activeNegotiations,
      prevActiveCount,
      "absolute",
    );

    const totalRequisitions = plainCurrent.length;
    const prevRequisitions = plainPrevious.length;
    const reqDelta = computeDelta(
      totalRequisitions,
      prevRequisitions,
      "percent",
    );

    const avgImprovement = computeAvgDealImprovement(plainCurrent, plainBids);
    const prevAvgImprovement = computeAvgDealImprovement(plainPrevious, []);
    const improvDelta = computeDelta(
      avgImprovement,
      prevAvgImprovement,
      "absolute",
    );

    const kpis = {
      totalSavings: { value: Math.round(currentSavings), ...savingsDelta },
      activeNegotiations: { value: activeNegotiations, ...activeNegDelta },
      totalRequisitions: { value: totalRequisitions, ...reqDelta },
      avgDealImprovement: {
        value: Math.round(avgImprovement * 10) / 10,
        ...improvDelta,
      },
    };

    // ---- Pipeline ----
    const negotiationPipeline = buildPipeline(allDeals);

    // ---- Savings timeline ----
    const savingsTimeline = buildSavingsTimeline(plainAllRequisitions, period);
    const prevSavingsTimeline = previousRange
      ? buildSavingsTimeline(plainPrevious, period)
      : {
          labels: [],
          data: [],
          cumulative: [],
          summary: { total: 0, avgPerBucket: 0, peakValue: 0, peakLabel: "" },
        };

    // Pad previous period cumulative to match current period length
    const prevCumulative = prevSavingsTimeline.cumulative;
    const paddedPrevCumulative = savingsTimeline.labels.map(
      (_: any, i: number) => prevCumulative[i] ?? 0,
    );

    const savingsOverTime = {
      labels: savingsTimeline.labels,
      data: savingsTimeline.data,
      cumulative: savingsTimeline.cumulative,
      previousPeriodCumulative: paddedPrevCumulative,
      summary: savingsTimeline.summary,
    };

    // ---- Spend by category ----
    const spendByCategory = buildSpendByCategory(plainAllRequisitions);

    // ---- Activity feed ----
    const recentActivity = buildActivityFeed(recentDeals, recentReqs);

    // ---- Needs attention ----
    const needsAttention = await buildNeedsAttention(
      companyId,
      currentRange.from,
    );

    return {
      kpis,
      negotiationPipeline,
      savingsOverTime,
      spendByCategory,
      recentActivity,
      needsAttention,
    };
  } catch (error) {
    if (error instanceof CustomError) throw error;
    throw new CustomError(`Dashboard stats error: ${error}`, 400);
  }
};
