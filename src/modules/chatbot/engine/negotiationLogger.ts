/**
 * Negotiation Logger Module
 *
 * Provides beautiful, formatted terminal output for negotiation rounds.
 * Displays decision engine logic, utility calculations, and round progression.
 *
 * @module negotiationLogger
 */

import type { Offer, Decision, BehavioralSignals, AdaptiveStrategyResult } from './types.js';
import type { NegotiationConfig } from './utility.js';

// ============================================================================
// ANSI Color Codes for Terminal Output
// ============================================================================

const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',

  // Text colors
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',

  // Bright colors
  brightRed: '\x1b[91m',
  brightGreen: '\x1b[92m',
  brightYellow: '\x1b[93m',
  brightBlue: '\x1b[94m',
  brightMagenta: '\x1b[95m',
  brightCyan: '\x1b[96m',

  // Background colors
  bgBlack: '\x1b[40m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
  bgMagenta: '\x1b[45m',
  bgCyan: '\x1b[46m',
  bgWhite: '\x1b[47m',
};

// ============================================================================
// Helper Functions
// ============================================================================

function colorize(text: string, ...colorCodes: string[]): string {
  return colorCodes.join('') + text + colors.reset;
}

function formatCurrency(value: number | null): string {
  if (value === null) return 'N/A';
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatPercent(value: number | null): string {
  if (value === null) return 'N/A';
  return `${(value * 100).toFixed(1)}%`;
}

function getActionColor(action: string): string {
  switch (action) {
    case 'ACCEPT': return colors.brightGreen;
    case 'COUNTER': return colors.brightBlue;
    case 'WALK_AWAY': return colors.brightRed;
    case 'ESCALATE': return colors.brightYellow;
    case 'ASK_CLARIFY': return colors.brightMagenta;
    default: return colors.white;
  }
}

function getUtilityColor(utility: number): string {
  if (utility >= 0.7) return colors.brightGreen;
  if (utility >= 0.5) return colors.brightBlue;
  if (utility >= 0.3) return colors.brightYellow;
  return colors.brightRed;
}

function createBox(title: string, content: string[], width: number = 70): string {
  const horizontalLine = '─'.repeat(width - 2);
  const topBorder = `┌${horizontalLine}┐`;
  const bottomBorder = `└${horizontalLine}┘`;

  const paddedTitle = ` ${title} `;
  const titleLine = `│${colorize(paddedTitle.padEnd(width - 2), colors.bold, colors.cyan)}│`;
  const separatorLine = `├${horizontalLine}┤`;

  const contentLines = content.map(line => {
    const visibleLength = line.replace(/\x1b\[[0-9;]*m/g, '').length;
    const padding = Math.max(0, width - 4 - visibleLength);
    return `│ ${line}${' '.repeat(padding)} │`;
  });

  return [topBorder, titleLine, separatorLine, ...contentLines, bottomBorder].join('\n');
}

// ============================================================================
// Main Logging Functions
// ============================================================================

/**
 * Log the start of a negotiation round
 */
export function logRoundStart(dealId: string, round: number, maxRounds: number): void {
  const header = `
${colors.bold}${colors.bgBlue}${colors.white}                                                                      ${colors.reset}
${colors.bold}${colors.bgBlue}${colors.white}   NEGOTIATION ROUND ${round}/${maxRounds}                                              ${colors.reset}
${colors.bold}${colors.bgBlue}${colors.white}   Deal: ${dealId.substring(0, 20)}...                                            ${colors.reset}
${colors.bold}${colors.bgBlue}${colors.white}                                                                      ${colors.reset}
`;
  console.log(header);
}

/**
 * Log the vendor offer details
 */
export function logVendorOffer(vendorMessage: string, extractedOffer: Offer): void {
  const content = [
    `${colorize('Message:', colors.dim)} "${vendorMessage.substring(0, 50)}${vendorMessage.length > 50 ? '...' : ''}"`,
    '',
    `${colorize('Extracted Offer:', colors.bold)}`,
    `  ${colorize('Price:', colors.cyan)}      ${formatCurrency(extractedOffer.total_price)}`,
    `  ${colorize('Terms:', colors.cyan)}      ${extractedOffer.payment_terms || 'Not specified'}`,
    `  ${colorize('Delivery:', colors.cyan)}   ${extractedOffer.delivery_date || extractedOffer.delivery_days ? `${extractedOffer.delivery_days} days` : 'Not specified'}`,
  ];

  if (extractedOffer.meta) {
    content.push('');
    content.push(`${colorize('Parse Metadata:', colors.dim)}`);
    if (extractedOffer.meta.currency_detected) {
      content.push(`  Currency: ${extractedOffer.meta.currency_detected}`);
    }
    if (extractedOffer.meta.raw_price_text) {
      content.push(`  Raw Price: "${extractedOffer.meta.raw_price_text}"`);
    }
  }

  console.log(createBox('VENDOR OFFER', content));
}

/**
 * Log the configuration thresholds
 */
export function logConfigThresholds(config: NegotiationConfig, priority: string): void {
  const acceptThreshold = config.accept_threshold ?? 0.70;
  const escalateThreshold = config.escalate_threshold ?? 0.50;
  const walkawayThreshold = config.walkaway_threshold ?? 0.30;

  const content = [
    `${colorize('Priority:', colors.bold)} ${colorize(priority, colors.brightYellow)}`,
    '',
    `${colorize('Decision Thresholds:', colors.bold)}`,
    `  ${colorize('ACCEPT:', colors.brightGreen)}     >= ${formatPercent(acceptThreshold)}`,
    `  ${colorize('COUNTER:', colors.brightBlue)}    ${formatPercent(escalateThreshold)} - ${formatPercent(acceptThreshold)}`,
    `  ${colorize('ESCALATE:', colors.brightYellow)}  ${formatPercent(walkawayThreshold)} - ${formatPercent(escalateThreshold)}`,
    `  ${colorize('WALK_AWAY:', colors.brightRed)}  < ${formatPercent(walkawayThreshold)}`,
    '',
    `${colorize('Price Parameters:', colors.bold)}`,
    `  Target:         ${formatCurrency((config.parameters?.total_price ?? (config.parameters as any)?.unit_price)?.target ?? 0)}`,
    `  Max Acceptable: ${formatCurrency((config.parameters?.total_price ?? (config.parameters as any)?.unit_price)?.max_acceptable ?? 0)}`,
    `  Anchor:         ${formatCurrency((config.parameters?.total_price ?? (config.parameters as any)?.unit_price)?.anchor ?? 0)}`,
    '',
    `${colorize('Weights:', colors.bold)}`,
    `  Price:  ${formatPercent((config.parameters?.total_price ?? (config.parameters as any)?.unit_price)?.weight ?? 0.6)}`,
    `  Terms:  ${formatPercent(config.parameters?.payment_terms?.weight ?? 0.4)}`,
  ];

  console.log(createBox('NEGOTIATION CONFIG', content));
}

/**
 * Log the utility calculation breakdown
 */
export function logUtilityCalculation(
  priceUtility: number,
  termsUtility: number,
  totalUtility: number,
  config: NegotiationConfig
): void {
  const priceWeight = (config.parameters?.total_price ?? (config.parameters as any)?.unit_price)?.weight ?? 0.6;
  const termsWeight = config.parameters?.payment_terms?.weight ?? 0.4;

  const weightedPrice = priceUtility * priceWeight;
  const weightedTerms = termsUtility * termsWeight;

  // Create a visual utility bar
  const barWidth = 40;
  const filledWidth = Math.round(totalUtility * barWidth);
  const emptyWidth = barWidth - filledWidth;
  const utilityBar = colorize('█'.repeat(filledWidth), getUtilityColor(totalUtility)) +
                     colorize('░'.repeat(emptyWidth), colors.dim);

  const content = [
    `${colorize('Component Utilities:', colors.bold)}`,
    '',
    `  Price Utility:    ${colorize(formatPercent(priceUtility), getUtilityColor(priceUtility))}`,
    `  × Weight (${formatPercent(priceWeight)}):  ${colorize(formatPercent(weightedPrice), colors.dim)}`,
    '',
    `  Terms Utility:    ${colorize(formatPercent(termsUtility), getUtilityColor(termsUtility))}`,
    `  × Weight (${formatPercent(termsWeight)}):  ${colorize(formatPercent(weightedTerms), colors.dim)}`,
    '',
    `${colorize('─'.repeat(40), colors.dim)}`,
    '',
    `  ${colorize('TOTAL UTILITY:', colors.bold)}  ${colorize(formatPercent(totalUtility), colors.bold, getUtilityColor(totalUtility))}`,
    '',
    `  [${utilityBar}]`,
  ];

  console.log(createBox('UTILITY CALCULATION', content));
}

/**
 * Log the decision result
 */
export function logDecision(decision: Decision, round: number): void {
  const actionColor = getActionColor(decision.action);

  const content = [
    `${colorize('Action:', colors.bold)} ${colorize(decision.action, colors.bold, actionColor)}`,
    `${colorize('Utility Score:', colors.bold)} ${colorize(formatPercent(decision.utilityScore), getUtilityColor(decision.utilityScore))}`,
    '',
    `${colorize('Reasons:', colors.bold)}`,
  ];

  decision.reasons.forEach((reason, i) => {
    content.push(`  ${i + 1}. ${reason}`);
  });

  if (decision.counterOffer) {
    content.push('');
    content.push(`${colorize('Counter Offer:', colors.bold, colors.cyan)}`);
    content.push(`  Price:    ${formatCurrency(decision.counterOffer.total_price)}`);
    content.push(`  Terms:    ${decision.counterOffer.payment_terms}`);
    if (decision.counterOffer.delivery_date) {
      content.push(`  Delivery: ${decision.counterOffer.delivery_date}`);
    }
  }

  console.log(createBox(`DECISION (Round ${round})`, content));
}

/**
 * Log the dynamic counter calculation
 */
export function logDynamicCounter(
  details: {
    priority: string;
    baseAggressiveness: number;
    roundAdjustment: number;
    concessionBonus: number;
    emphasisAdjustment: number;
    totalOffset: number;
    counterPrice: number;
    chosenTerms: string;
    strategy: string;
    vendorEmphasis?: string;
    emphasisConfidence?: number;
    priceCapped?: boolean;
  }
): void {
  const content = [
    `${colorize('Strategy:', colors.bold)} ${details.strategy}`,
    '',
    `${colorize('Calculation Breakdown:', colors.bold)}`,
    `  Base Aggressiveness:   ${formatPercent(details.baseAggressiveness)}`,
    `  Round Adjustment:      +${formatPercent(details.roundAdjustment)}`,
    `  Concession Bonus:      +${formatPercent(details.concessionBonus)}`,
    `  Emphasis Adjustment:   ${details.emphasisAdjustment >= 0 ? '+' : ''}${formatPercent(details.emphasisAdjustment)}`,
    `  ${colorize('─'.repeat(35), colors.dim)}`,
    `  ${colorize('Total Offset:', colors.bold)}         ${formatPercent(details.totalOffset)}`,
    '',
    `${colorize('Result:', colors.bold)}`,
    `  Counter Price: ${colorize(formatCurrency(details.counterPrice), colors.brightCyan)}`,
    `  Counter Terms: ${colorize(details.chosenTerms, colors.brightCyan)}`,
  ];

  if (details.priceCapped) {
    content.push('');
    content.push(`${colorize('Price Capped:', colors.bold, colors.yellow)} Yes (matched vendor offer, pushing on terms)`);
  }

  if (details.vendorEmphasis && details.vendorEmphasis !== 'unknown') {
    content.push('');
    content.push(`${colorize('Vendor Analysis:', colors.bold)}`);
    content.push(`  Emphasis:   ${details.vendorEmphasis}`);
    content.push(`  Confidence: ${formatPercent(details.emphasisConfidence || 0)}`);
  }

  console.log(createBox('DYNAMIC COUNTER CALCULATION', content));
}

/**
 * Log behavioral signals (when available)
 */
export function logBehavioralSignals(signals: BehavioralSignals): void {
  const content = [
    `${colorize('Concession Analysis:', colors.bold)}`,
    `  Velocity:      ${signals.concessionVelocity?.toFixed(2) || 'N/A'}/round`,
    `  Accelerating:  ${signals.concessionAccelerating ? colorize('Yes', colors.brightGreen) : colorize('No', colors.dim)}`,
    `  Last Size:     ${signals.lastConcessionSize?.toFixed(2) || 'N/A'}`,
    '',
    `${colorize('Convergence:', colors.bold)}`,
    `  Rate:          ${formatPercent(signals.convergenceRate || 0)}`,
    `  Is Converging: ${signals.isConverging ? colorize('Yes', colors.brightGreen) : colorize('No', colors.brightRed)}`,
    `  Is Stalling:   ${signals.isStalling ? colorize('Yes', colors.brightYellow) : colorize('No', colors.dim)}`,
    `  Is Diverging:  ${signals.isDiverging ? colorize('Yes', colors.brightRed) : colorize('No', colors.dim)}`,
    '',
    `${colorize('Momentum:', colors.bold)} ${signals.momentum !== undefined ? signals.momentum.toFixed(2) : 'N/A'}`,
    `${colorize('Sentiment:', colors.bold)} ${signals.latestSentiment || 'neutral'}`,
  ];

  console.log(createBox('BEHAVIORAL SIGNALS', content));
}

/**
 * Log adaptive strategy adjustments
 */
export function logAdaptiveStrategy(strategy: AdaptiveStrategyResult): void {
  const content = [
    `${colorize('Strategy Label:', colors.bold)} ${colorize(strategy.strategyLabel, colors.brightMagenta)}`,
    '',
    `${colorize('Adjustments:', colors.bold)}`,
    `  Aggressiveness: ${formatPercent(strategy.adjustedAggressiveness)}`,
  ];

  if (strategy.shouldEscalateEarly !== undefined) {
    content.push(`  Early Escalate: ${strategy.shouldEscalateEarly ? colorize('Yes', colors.brightYellow) : 'No'}`);
  }

  if (strategy.reasoning) {
    content.push('');
    content.push(`${colorize('Reason:', colors.dim)} ${strategy.reasoning}`);
  }

  console.log(createBox('ADAPTIVE STRATEGY', content));
}

/**
 * Log the round summary
 */
export function logRoundSummary(
  round: number,
  vendorPrice: number | null,
  counterPrice: number | null,
  utility: number,
  action: string,
  status: string
): void {
  const gap = vendorPrice && counterPrice ? vendorPrice - counterPrice : null;

  const summaryLine = `
${colors.bold}${colors.cyan}╔════════════════════════════════════════════════════════════════════╗${colors.reset}
${colors.bold}${colors.cyan}║${colors.reset}  ${colorize(`Round ${round} Summary`, colors.bold)}                                                  ${colors.bold}${colors.cyan}║${colors.reset}
${colors.bold}${colors.cyan}╠════════════════════════════════════════════════════════════════════╣${colors.reset}
${colors.bold}${colors.cyan}║${colors.reset}  Vendor Offer:  ${formatCurrency(vendorPrice).padEnd(15)} │ Counter Offer: ${formatCurrency(counterPrice).padEnd(15)}${colors.bold}${colors.cyan}║${colors.reset}
${colors.bold}${colors.cyan}║${colors.reset}  Gap:           ${gap !== null ? formatCurrency(gap).padEnd(15) : 'N/A'.padEnd(15)} │ Utility:       ${colorize(formatPercent(utility), getUtilityColor(utility))}            ${colors.bold}${colors.cyan}║${colors.reset}
${colors.bold}${colors.cyan}║${colors.reset}  Action:        ${colorize(action.padEnd(15), getActionColor(action))} │ Status:        ${status.padEnd(15)}${colors.bold}${colors.cyan}║${colors.reset}
${colors.bold}${colors.cyan}╚════════════════════════════════════════════════════════════════════╝${colors.reset}
`;
  console.log(summaryLine);
}

/**
 * Log a separator line
 */
export function logSeparator(): void {
  console.log(colorize('═'.repeat(70), colors.dim));
}

/**
 * Log the final deal status
 */
export function logDealStatus(status: string, reason: string): void {
  let bgColor: string;
  let statusText: string;

  switch (status) {
    case 'ACCEPTED':
      bgColor = colors.bgGreen;
      statusText = 'DEAL ACCEPTED';
      break;
    case 'WALKED_AWAY':
      bgColor = colors.bgRed;
      statusText = 'WALKED AWAY';
      break;
    case 'ESCALATED':
      bgColor = colors.bgYellow;
      statusText = 'ESCALATED FOR REVIEW';
      break;
    default:
      bgColor = colors.bgBlue;
      statusText = 'NEGOTIATING';
  }

  console.log(`
${colors.bold}${bgColor}${colors.white}                                                                      ${colors.reset}
${colors.bold}${bgColor}${colors.white}   ${statusText.padEnd(66)} ${colors.reset}
${colors.bold}${bgColor}${colors.white}   ${reason.substring(0, 66).padEnd(66)} ${colors.reset}
${colors.bold}${bgColor}${colors.white}                                                                      ${colors.reset}
`);
}

// ============================================================================
// Export All Functions
// ============================================================================

export default {
  logRoundStart,
  logVendorOffer,
  logConfigThresholds,
  logUtilityCalculation,
  logDecision,
  logDynamicCounter,
  logBehavioralSignals,
  logAdaptiveStrategy,
  logRoundSummary,
  logSeparator,
  logDealStatus,
};
