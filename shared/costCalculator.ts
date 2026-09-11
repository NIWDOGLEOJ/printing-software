import {
  ColorMode,
  SidesMode,
  PricingSettings,
  CostCalculation,
  PrinterProfile,
  EffectivePricing,
  PrinterInfo,
} from './types.js';

export const DEFAULT_PRICING: PricingSettings = {
  bw_price_per_page: 2,
  color_price_per_page: 10,
  duplex_sheet_price_bw: 3,
  duplex_sheet_price_color: 18,
  default_printer: '',
  retention_hours: 24,
  global_duplex_enabled: true,
  color_available: true,
  duplex_available: true,
};

/**
 * Calculates effective customer print rates and availability flags
 * based strictly on currently active (non-maintenance) printer profiles.
 *
 * Algorithm:
 * - B/W Single: min(active_bw_printers.bw_single_price)
 * - B/W Duplex: min(active_bw_printers_with_duplex.bw_duplex_price)
 * - Color Single: min(active_color_printers.color_single_price)
 * - Color Duplex: min(active_color_printers_with_duplex.color_duplex_price)
 * - color_available: true only if at least one active printer supports color
 * - duplex_available: true only if global duplex is enabled AND at least one active printer has duplex enabled
 */
export function calculateEffectivePricing(
  profiles: PrinterProfile[],
  options?: {
    globalDuplexEnabled?: boolean;
    fallbackPricing?: Partial<PricingSettings>;
  }
): EffectivePricing {
  const globalDuplexEnabled = options?.globalDuplexEnabled !== false;
  const fallback: PricingSettings = {
    ...DEFAULT_PRICING,
    ...(options?.fallbackPricing || {}),
  };

  const activePrinters = profiles.filter((p) => p.is_active);
  const activeBwPrinters = activePrinters;
  const activeColorPrinters = activePrinters.filter((p) => p.supports_color);
  const activeDuplexPrinters = activePrinters.filter(
    (p) => p.supports_duplex && p.duplex_enabled && globalDuplexEnabled
  );
  const activeColorDuplexPrinters = activeColorPrinters.filter(
    (p) => p.supports_duplex && p.duplex_enabled && globalDuplexEnabled
  );

  const hasActivePrinters = activePrinters.length > 0;
  const colorAvailable = activeColorPrinters.length > 0;
  const duplexAvailable = globalDuplexEnabled && activeDuplexPrinters.length > 0;

  // Calculate lowest available rate among active printers
  const bwPrice = activeBwPrinters.length > 0
    ? Math.min(...activeBwPrinters.map((p) => p.bw_single_price))
    : fallback.bw_price_per_page;

  const bwDuplexPrice = activeDuplexPrinters.length > 0
    ? Math.min(...activeDuplexPrinters.map((p) => p.bw_duplex_price))
    : (activeBwPrinters.length > 0
        ? Math.min(...activeBwPrinters.map((p) => p.bw_duplex_price > 0 ? p.bw_duplex_price : p.bw_single_price * 1.5))
        : fallback.duplex_sheet_price_bw);

  const colorPrice = activeColorPrinters.length > 0
    ? Math.min(...activeColorPrinters.map((p) => p.color_single_price))
    : fallback.color_price_per_page;

  const colorDuplexPrice = activeColorDuplexPrinters.length > 0
    ? Math.min(...activeColorDuplexPrinters.map((p) => p.color_duplex_price))
    : (activeColorPrinters.length > 0
        ? Math.min(...activeColorPrinters.map((p) => p.color_duplex_price > 0 ? p.color_duplex_price : p.color_single_price * 1.8))
        : fallback.duplex_sheet_price_color);

  return {
    bw_price_per_page: bwPrice,
    color_price_per_page: colorPrice,
    duplex_sheet_price_bw: bwDuplexPrice,
    duplex_sheet_price_color: colorDuplexPrice,
    color_available: colorAvailable,
    duplex_available: duplexAvailable,
    global_duplex_enabled: globalDuplexEnabled,
    active_printers_count: activePrinters.length,
    has_active_printers: hasActivePrinters,
    active_printers: activePrinters.map((p) => p.name),
  };
}

/**
 * Smart Routing: Automatically chooses the optimal active printer
 * matching the order's color requirements and lowest rate,
 * while allowing manual overrides.
 */
export function findOptimalPrinter(params: {
  colorMode: ColorMode;
  sides?: SidesMode;
  profiles: PrinterProfile[];
  printers: PrinterInfo[];
}): string {
  const { colorMode, sides = 'single', profiles, printers } = params;

  // 1. Filter active printer profiles
  let candidates = profiles.filter((p) => p.is_active);

  // If color mode, restrict to profiles supporting color
  if (colorMode === 'color') {
    const colorCandidates = candidates.filter((p) => p.supports_color);
    if (colorCandidates.length > 0) {
      candidates = colorCandidates;
    } else {
      // If no active profile supports color, fallback to any profile supporting color
      const anyColor = profiles.filter((p) => p.supports_color);
      if (anyColor.length > 0) {
        candidates = anyColor;
      }
    }
  }

  // If duplex mode, prefer profiles that support and have duplex enabled
  if (sides === 'duplex') {
    const duplexCandidates = candidates.filter((p) => p.supports_duplex && p.duplex_enabled);
    if (duplexCandidates.length > 0) {
      candidates = duplexCandidates;
    }
  }

  // 2. Sort by lowest applicable rate
  candidates.sort((a, b) => {
    if (colorMode === 'color') {
      const rateA = sides === 'duplex' ? (a.color_duplex_price || a.color_single_price) : a.color_single_price;
      const rateB = sides === 'duplex' ? (b.color_duplex_price || b.color_single_price) : b.color_single_price;
      return rateA - rateB;
    } else {
      const rateA = sides === 'duplex' ? (a.bw_duplex_price || a.bw_single_price) : a.bw_single_price;
      const rateB = sides === 'duplex' ? (b.bw_duplex_price || b.bw_single_price) : b.bw_single_price;
      return rateA - rateB;
    }
  });

  // 3. Map best profile to discovered CUPS printers
  if (candidates.length > 0) {
    const best = candidates[0];
    const targetCups = (best.cups_printer_name || '').trim();
    const profileName = (best.name || '').trim();

    const normalize = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, '');
    const normTarget = normalize(targetCups);
    const normProf = normalize(profileName);

    const matched = printers.find((pr) => {
      const normPr = normalize(pr.name);
      if (normTarget && (normPr === normTarget || normPr.includes(normTarget) || normTarget.includes(normPr))) {
        return true;
      }
      if (normProf.includes('gx40') && normPr.includes('gx40')) return true;
      if (normProf.includes('4225') && normPr.includes('4225')) return true;
      return false;
    });

    if (matched) {
      return matched.name;
    }

    if (best.cups_printer_name) {
      return best.cups_printer_name;
    }
  }

  // Fallback to default printer among discovered
  const defaultPrinter = printers.find((p) => p.isDefault) || printers[0];
  return defaultPrinter ? defaultPrinter.name : '';
}

export function parsePageRange(rangeStr: string, totalPages: number): number[] {
  if (!rangeStr || rangeStr.trim().toLowerCase() === 'all' || rangeStr.trim() === '') {
    return Array.from({ length: Math.max(1, totalPages) }, (_, i) => i + 1);
  }

  const parts = rangeStr.split(',');
  const pagesSet = new Set<number>();

  for (const rawPart of parts) {
    const part = rawPart.trim();
    if (!part) continue;

    if (part.includes('-')) {
      const [startStr, endStr] = part.split('-');
      const start = parseInt(startStr, 10);
      const end = parseInt(endStr, 10);

      if (!isNaN(start) && !isNaN(end)) {
        const from = Math.max(1, Math.min(start, end));
        const to = Math.min(totalPages > 0 ? totalPages : 9999, Math.max(start, end));
        for (let i = from; i <= to; i++) {
          pagesSet.add(i);
        }
      }
    } else {
      const pageNum = parseInt(part, 10);
      if (!isNaN(pageNum) && pageNum >= 1) {
        if (totalPages <= 0 || pageNum <= totalPages) {
          pagesSet.add(pageNum);
        }
      }
    }
  }

  const sortedPages = Array.from(pagesSet).sort((a, b) => a - b);
  return sortedPages.length > 0 ? sortedPages : Array.from({ length: Math.max(1, totalPages) }, (_, i) => i + 1);
}

export function calculatePrintCost(params: {
  totalPages: number;
  pageRange?: string;
  colorMode: ColorMode;
  sides: SidesMode;
  copies: number;
  pricing?: Partial<PricingSettings>;
}): CostCalculation {
  const { totalPages, pageRange = 'all', colorMode, sides, copies, pricing = {} } = params;
  const rates: PricingSettings = { ...DEFAULT_PRICING, ...pricing };

  const validCopies = Math.max(1, Math.floor(copies || 1));
  const parsedPages = parsePageRange(pageRange, totalPages);
  const effectivePages = parsedPages.length;

  let sheets = effectivePages;
  let perCopyCost = 0;

  if (sides === 'duplex') {
    sheets = Math.ceil(effectivePages / 2);
    if (colorMode === 'bw') {
      perCopyCost = sheets * rates.duplex_sheet_price_bw;
    } else {
      perCopyCost = sheets * rates.duplex_sheet_price_color;
    }
  } else {
    // Single-sided
    sheets = effectivePages;
    if (colorMode === 'bw') {
      perCopyCost = effectivePages * rates.bw_price_per_page;
    } else {
      perCopyCost = effectivePages * rates.color_price_per_page;
    }
  }

  const totalCost = perCopyCost * validCopies;

  const modeLabel = colorMode === 'bw' ? 'B&W' : 'Color';
  const sidesLabel = sides === 'duplex' ? 'Duplex' : 'Single-side';
  const breakdownText = `${effectivePages} page${effectivePages > 1 ? 's' : ''} (${sheets} sheet${sheets > 1 ? 's' : ''}) • ${modeLabel} • ${sidesLabel} × ${validCopies} copy${validCopies > 1 ? 'ies' : ''}`;

  return {
    effectivePages,
    sheets,
    perCopyCost,
    totalCost,
    copies: validCopies,
    breakdownText,
  };
}
