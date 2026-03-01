/**
 * Customer Quote Module
 * Calculates shipping quotes using pre-configured carrier pricing
 * Completely separate from Rate Comparison (supplier costs)
 * 
 * Supports 9 carriers: UNIUNI, GOFO, USPS, SmartPost, UPS, FedEx, FedEx AHS, FedEx OS, TEST
 */

// ============================================
// Unit Conversion Utilities
// ============================================

const INCH_TO_CM = 2.54;
const LB_TO_KG = 0.453592;
const CM_TO_INCH = 1 / INCH_TO_CM;
const KG_TO_LB = 1 / LB_TO_KG;

function convertToInchLb(weight, length, width, height) {
  return {
    weight: weight * KG_TO_LB,
    length: length * CM_TO_INCH,
    width: width * CM_TO_INCH,
    height: height * CM_TO_INCH
  };
}

function convertToCmKg(weight, length, width, height) {
  return {
    weight: weight * LB_TO_KG,
    length: length * INCH_TO_CM,
    width: width * INCH_TO_CM,
    height: height * INCH_TO_CM
  };
}

// ============================================
// Package Calculation Functions
// ============================================

/**
 * Convert and round dimensions according to rules:
 * - If using inch, round UP to integer
 * - If using cm, round UP to integer cm first, then convert to inch (÷2.54), then round UP to integer inch
 * @param {number} value - Dimension value
 * @param {string} unit - 'in' or 'cm'
 * @returns {number} Rounded up integer in inches
 */
function convertDimension(value, unit = 'in') {
  if (unit === 'cm') {
    // Round up cm first, then convert to inch, then round up again
    const roundedCm = Math.ceil(value);
    return Math.ceil(roundedCm / 2.54);
  }
  return Math.ceil(value);
}

/**
 * Convert and round weight according to rules:
 * - If using lbs, round UP to integer
 * - If using kg, convert to lbs (×2.20462) then round UP to integer
 * @param {number} value - Weight value
 * @param {string} unit - 'lb' or 'kg'
 * @returns {number} Rounded up integer in pounds
 */
function convertWeight(value, unit = 'lb') {
  if (unit === 'kg') {
    return Math.ceil(value * 2.20462);
  }
  return Math.ceil(value);
}

/**
 * Calculate package properties including DIM weight
 * Applies proper rounding rules:
 * 1. Dimensions: round up to integer (after converting from cm if needed)
 * 2. Weight: round up to integer (after converting from kg if needed)
 * 3. DIM weight: calculated with rounded dimensions, then round up to integer
 * 
 * @param {number} weight - Weight in lbs (or kg if weightUnit='kg')
 * @param {number} length - Length in inches (or cm if dimUnit='cm')
 * @param {number} width - Width in inches (or cm if dimUnit='cm')  
 * @param {number} height - Height in inches (or cm if dimUnit='cm')
 * @param {number} dimDivisor - DIM divisor for the carrier
 * @param {string} dimUnit - 'in' or 'cm' (default: 'in')
 * @param {string} weightUnit - 'lb' or 'kg' (default: 'lb')
 */
function calculatePackageProperties(weight, length, width, height, dimDivisor = 166, dimUnit = 'in', weightUnit = 'lb') {
  // Convert and round dimensions to integers in inches
  const lengthIn = convertDimension(length, dimUnit);
  const widthIn = convertDimension(width, dimUnit);
  const heightIn = convertDimension(height, dimUnit);
  
  // Convert and round weight to integer in pounds
  const actualWeightRounded = convertWeight(weight, weightUnit);
  
  // Sort dimensions: [longest, middle, shortest]
  const sortedDims = [lengthIn, widthIn, heightIn].sort((a, b) => b - a);
  
  // Calculate DIM weight with converted/rounded dimensions, then round UP to integer
  const volume = lengthIn * widthIn * heightIn;
  const dimWeight = Math.ceil(volume / dimDivisor);
  
  // Billed weight is the greater of actual or DIM weight (both already rounded)
  const billedWeight = Math.max(actualWeightRounded, dimWeight);
  
  // Calculate perimeter: L + (W + H) * 2
  const perimeter = sortedDims[0] + (sortedDims[1] + sortedDims[2]) * 2;
  
  return {
    actualWeight: weight,
    actualWeightRounded,
    dimWeight,
    billedWeight,
    sortedDims,
    perimeter,
    volume,
    // Include original and converted dimensions for reference
    originalDims: { length, width, height, unit: dimUnit },
    convertedDims: { length: lengthIn, width: widthIn, height: heightIn, unit: 'in' }
  };
}

// ============================================
// Carrier-Specific Logic
// ============================================

const CARRIER_RULES = {
  // 1. UNIUNI
  'UNIUNI': {
    isEligible: (pkg, config) => pkg.billedWeight <= config.maxWeight,
    
    getAdjustedWeight: (pkg, config) => pkg.billedWeight,
    
    getSurcharges: (pkg, config, options, zone) => {
      const surcharges = [];
      const dims = pkg.sortedDims;
      const perimeterCm = pkg.perimeter * INCH_TO_CM;
      const sc = config.surcharges || {};
      
      // AHS-Dimensions: any dimension > 18in OR perimeter > 150cm
      if (dims[0] > 18 || dims[1] > 18 || dims[2] > 18 || perimeterCm > 150) {
        surcharges.push({ name: 'AHS-Dim', amount: sc.oversize || 20 });
      }
      
      // Oversize: volume > 1728 cu in
      if (pkg.volume > 1728) {
        surcharges.push({ name: 'Oversize', amount: sc.oversizeLarge || 50 });
      }
      
      // AHS-Weight: > threshold, $X per pound over
      const threshold = sc.overweightThreshold || 20;
      if (pkg.billedWeight > threshold) {
        const overPounds = Math.ceil(pkg.billedWeight - threshold);
        const perLb = sc.overweightPerLb || 10;
        surcharges.push({ name: `AHS-Weight (+${overPounds}lb)`, amount: overPounds * perLb });
      }
      
      return surcharges;
    }
  },
  
  // 2. GOFO
  'GOFO': {
    isEligible: (pkg, config) => pkg.billedWeight <= config.maxWeight,
    
    getAdjustedWeight: (pkg, config) => pkg.billedWeight,
    
    getSurcharges: (pkg, config, options, zone) => {
      const surcharges = [];
      const dims = pkg.sortedDims;
      const sc = config.surcharges || {};
      const maxDims = sc.maxDimensions || [19, 15, 11];
      
      // AHS-Dimensions: exceeds max dimensions (sorted comparison)
      if (dims[0] > maxDims[0] || dims[1] > maxDims[1] || dims[2] > maxDims[2]) {
        surcharges.push({ name: 'AHS-Dim', amount: sc.oversize || 25 });
      }
      
      // AHS-Weight
      const threshold = sc.overweightThreshold || 10;
      if (pkg.billedWeight > threshold) {
        surcharges.push({ name: 'AHS-Weight', amount: sc.overweight || 25 });
      }
      
      return surcharges;
    }
  },
  
  // 3. USPS
  'USPS': {
    isEligible: (pkg, config) => {
      const dims = pkg.sortedDims;
      // Ineligible if length >= 20in
      if (dims[0] >= 20) return false;
      if (pkg.billedWeight > config.maxWeight) return false;
      return true;
    },
    
    getAdjustedWeight: (pkg, config) => pkg.billedWeight,
    getSurcharges: (pkg, config, options, zone) => []
  },
  
  // 4. FedEx SmartPost
  'SmartPost': {
    isEligible: (pkg, config) => {
      const dims = pkg.sortedDims;
      const perimeter = pkg.perimeter;
      
      // Ineligible if longest > 27in OR perimeter > 105in OR 2nd longest > 17in
      if (dims[0] > 27 || perimeter > 105 || dims[1] > 17) return false;
      if (pkg.billedWeight > config.maxWeight) return false;
      return true;
    },
    
    getAdjustedWeight: (pkg, config) => {
      // When 64in < perimeter <= 105in, min weight is 20lbs
      if (pkg.perimeter > 64 && pkg.perimeter <= 105) {
        return Math.max(pkg.billedWeight, 20);
      }
      return pkg.billedWeight;
    },
    
    getSurcharges: (pkg, config, options, zone) => {
      const surcharges = [];
      const dims = pkg.sortedDims;
      const perimeter = pkg.perimeter;
      const sc = config.surcharges || {};
      
      // Oversize: length > 26in OR 2nd longest > 16in OR perimeter > 105in
      if (dims[0] > 26 || dims[1] > 16 || perimeter > 105) {
        surcharges.push({ name: 'Oversize', amount: sc.oversize || 25 });
      }
      
      return surcharges;
    }
  },
  
  // 5. UPS
  'UPS': {
    isEligible: (pkg, config) => {
      const dims = pkg.sortedDims;
      const perimeter = pkg.perimeter;
      
      // Ineligible if longest > 47in OR 2nd longest > 29.5in OR perimeter > 102in
      if (dims[0] > 47 || dims[1] > 29.5 || perimeter > 102) return false;
      if (pkg.billedWeight > config.maxWeight) return false;
      return true;
    },
    
    getAdjustedWeight: (pkg, config) => pkg.billedWeight,
    
    getSurcharges: (pkg, config, options, zone) => {
      const surcharges = [];
      const isResidential = options.serviceType === 'residential';
      const sc = config.surcharges || {};
      
      if (isResidential && sc.residential) {
        surcharges.push({ name: 'Residential', amount: sc.residential });
      }
      
      return surcharges;
    },
    
    getDasSurcharge: (config, dasType, isResidential) => {
      const sc = config.surcharges || {};
      switch (dasType) {
        case 'das': 
          return sc.das ? (isResidential ? sc.das.residential : sc.das.commercial) : 0;
        case 'das_extended': 
          return sc.dasExtended ? (isResidential ? sc.dasExtended.residential : sc.dasExtended.commercial) : 0;
        case 'das_remote': 
          return sc.dasRemote || 0;
        default: return 0;
      }
    }
  },
  
  // 6. FedEx
  'FedEx': {
    isEligible: (pkg, config) => {
      const dims = pkg.sortedDims;
      const perimeter = pkg.perimeter;
      
      if (dims[0] > 47 || dims[1] > 29.5 || perimeter > 102) return false;
      if (pkg.billedWeight > config.maxWeight) return false;
      return true;
    },
    
    getAdjustedWeight: (pkg, config) => pkg.billedWeight,
    
    getSurcharges: (pkg, config, options, zone) => {
      const surcharges = [];
      const isResidential = options.serviceType === 'residential';
      const sc = config.surcharges || {};
      
      if (isResidential && sc.residential) {
        surcharges.push({ name: 'Residential', amount: sc.residential });
      }
      
      return surcharges;
    },
    
    getDasSurcharge: (config, dasType, isResidential) => {
      const sc = config.surcharges || {};
      switch (dasType) {
        case 'das': 
          return sc.das ? (isResidential ? sc.das.residential : sc.das.commercial) : 0;
        case 'das_extended': 
          return sc.dasExtended ? (isResidential ? sc.dasExtended.residential : sc.dasExtended.commercial) : 0;
        case 'das_remote': 
          return sc.dasRemote || 0;
        default: return 0;
      }
    }
  },
  
  // 7. FedEx AHS
  'FedExAHS': {
    isEligible: (pkg, config) => {
      const dims = pkg.sortedDims;
      const perimeter = pkg.perimeter;
      
      // Ineligible if longest > 108in OR perimeter > 165in
      if (dims[0] > 108 || perimeter > 165) return false;
      if (pkg.billedWeight > config.maxWeight) return false;
      
      // If package qualifies for FedEx OS, use FedEx OS instead of FedEx AHS
      // OS criteria: perimeter 126-161in (320-410cm) OR volume > 17280 cu in OR weight > 110lbs
      if ((perimeter >= 126 && perimeter <= 161) || pkg.volume > 17280 || pkg.billedWeight > 110) {
        return false; // Use FedEx OS instead
      }
      
      return true;
    },
    
    getAdjustedWeight: (pkg, config) => {
      const dims = pkg.sortedDims;
      const perimeter = pkg.perimeter;
      let minWeight = pkg.billedWeight;
      
      // AHS-Dimensions: longest 45-92in OR 2nd longest > 29.5in OR perimeter > 102 OR volume > 10368 - min 40lbs
      // Note: Oversize logic removed - if oversize, FedEx OS is used instead
      if ((dims[0] >= 45 && dims[0] <= 92) || dims[1] > 29.5 || perimeter > 102 || pkg.volume > 10368) {
        minWeight = Math.max(minWeight, 40);
      }
      
      return Math.max(pkg.billedWeight, minWeight);
    },
    
    getSurcharges: (pkg, config, options, zone) => {
      const surcharges = [];
      const dims = pkg.sortedDims;
      const perimeter = pkg.perimeter;
      const isResidential = options.serviceType === 'residential';
      const billedWeight = pkg.billedWeight;
      const sc = config.surcharges || {};
      
      // Residential surcharge (weight-based)
      if (isResidential && sc.residential) {
        const resiAmount = billedWeight > 70 ? sc.residential.over70 : sc.residential.under70;
        surcharges.push({ name: 'Residential', amount: resiAmount || 3.29 });
      }
      
      // Zone-based AHS surcharges
      // Note: Oversize is NOT applied here - if oversize conditions are met, FedEx OS is used instead
      const zoneRates = sc.ahsZoneBased?.[zone] || { ahsWeight: 8, ahsDim: 5 };
      
      // AHS-Weight: over 50lbs
      if (billedWeight > 50) {
        surcharges.push({ name: 'AHS-Weight', amount: zoneRates.ahsWeight });
      }
      // AHS-Dimensions: longest 45-92in OR 2nd longest > 29.5in OR perimeter > 102 OR volume > 10368
      else if ((dims[0] >= 45 && dims[0] <= 92) || dims[1] > 29.5 || perimeter > 102 || pkg.volume > 10368) {
        surcharges.push({ name: 'AHS-Dim', amount: zoneRates.ahsDim });
      }
      
      return surcharges;
    },
    
    getDasSurcharge: (config, dasType, isResidential) => {
      const sc = config.surcharges || {};
      switch (dasType) {
        case 'das': 
          return sc.das ? (isResidential ? sc.das.residential : sc.das.commercial) : 0;
        case 'das_extended': 
          return sc.dasExtended ? (isResidential ? sc.dasExtended.residential : sc.dasExtended.commercial) : 0;
        case 'das_remote': 
          return sc.dasRemote || 0;
        default: return 0;
      }
    }
  },
  
  // 8. FedEx OS
  'FedExOS': {
    isEligible: (pkg, config) => {
      const dims = pkg.sortedDims;
      const perimeter = pkg.perimeter;
      
      // Ineligible if longest > 108in OR perimeter > 165in (410cm)
      if (dims[0] > 108 || perimeter > 161) return false;
      
      // FedEx OS max 150lbs (with 90lb minimum)
      const adjustedWeight = Math.max(pkg.billedWeight, 90);
      if (adjustedWeight > config.maxWeight) return false;
      
      // FedEx OS is ONLY eligible when: 
      // perimeter 126-161in (320-410cm) OR volume > 17280 cu in OR weight > 110lbs
      if ((perimeter >= 126 && perimeter <= 161) || pkg.volume > 17280 || pkg.billedWeight > 110) {
        return true;
      }
      
      return false; // Not eligible if none of the OS conditions are met
    },
    
    getAdjustedWeight: (pkg, config) => {
      // FedEx OS always starts at 90lbs minimum
      return Math.max(pkg.billedWeight, 90);
    },
    
    getSurcharges: (pkg, config, options, zone) => {
      const surcharges = [];
      const isResidential = options.serviceType === 'residential';
      const sc = config.surcharges || {};
      
      // Residential surcharge
      if (isResidential && sc.residential) {
        surcharges.push({ name: 'Residential', amount: sc.residential });
      }
      
      // Oversize Surcharge (zone-based) - always applies for FedEx OS
      const zoneRates = sc.oversizeZoneBased || {};
      surcharges.push({ name: 'Oversize', amount: zoneRates[zone] || 50 });
      
      return surcharges;
    },
    
    getDasSurcharge: (config, dasType, isResidential) => {
      const sc = config.surcharges || {};
      switch (dasType) {
        case 'das': 
          return sc.das ? (isResidential ? sc.das.residential : sc.das.commercial) : 0;
        case 'das_extended': 
          return sc.dasExtended ? (isResidential ? sc.dasExtended.residential : sc.dasExtended.commercial) : 0;
        case 'das_remote': 
          return sc.dasRemote || 0;
        default: return 0;
      }
    }
  },
  
  // 9. TEST - Placeholder carrier for new suppliers without pricing
  'TEST': {
    isEligible: (pkg, config) => true, // Always eligible for comparison
    
    getAdjustedWeight: (pkg, config) => pkg.billedWeight,
    
    getSurcharges: (pkg, config, options, zone) => [], // No surcharges
    
    getDasSurcharge: (config, dasType, isResidential) => 0 // No DAS charges
  }
};

// ============================================
// Rate Lookup Functions
// ============================================

// Carriers that support ounce-based rates
const OUNCE_RATE_CARRIERS = ['UNIUNI', 'GOFO', 'USPS'];

/**
 * Get ounce-based rate from carrier configuration
 * @param {Object} carrierConfig - Carrier config with ounceRates
 * @param {number} zone - Zone number
 * @param {number} weightOz - Weight in ounces (already rounded up)
 * @returns {number|null} Rate or null if not found
 */
function getOunceRate(carrierConfig, zone, weightOz) {
  const ounceRates = carrierConfig.ounceRates;
  if (!ounceRates || !ounceRates.rates) return null;
  
  // Ounce rates use zones from baseRates (same zones array)
  const zones = ounceRates.zones || carrierConfig.baseRates?.zones || [1, 2, 3, 4, 5, 6, 7, 8];
  const zoneIndex = zones.indexOf(zone);
  if (zoneIndex === -1) return null;
  
  // Weight index: 1oz = index 0, 15oz = index 14
  const weightIndex = weightOz - 1;
  if (weightIndex < 0 || weightIndex >= ounceRates.rates.length) return null;
  
  const rate = ounceRates.rates[weightIndex]?.[zoneIndex];
  return (rate !== null && rate !== undefined && rate !== '') ? rate : null;
}

/**
 * Get base rate from carrier configuration (lb-based)
 */
function getBaseRate(carrierConfig, zone, weight) {
  const rates = carrierConfig.baseRates;
  if (!rates || !rates.rates || !rates.zones) return null;
  
  // Find zone index
  const zoneIndex = rates.zones.indexOf(zone);
  if (zoneIndex === -1) return null;
  
  // Find weight index (1-based weight, adjusting for weightStart)
  const weightStart = rates.weightStart || 1;
  const weightIndex = Math.ceil(weight) - weightStart;
  
  if (weightIndex < 0) return null;
  if (weightIndex >= rates.rates.length) {
    // Use the last available rate
    return rates.rates[rates.rates.length - 1]?.[zoneIndex] ?? null;
  }
  
  return rates.rates[weightIndex]?.[zoneIndex] ?? null;
}

/**
 * Get the best rate for a package - uses ounce rates for lightweight packages
 * if the carrier supports them and weight <= 15oz
 * @param {string} carrierId - Carrier ID
 * @param {Object} carrierConfig - Carrier configuration
 * @param {number} zone - Zone number
 * @param {number} weightLbs - Weight in lbs (actual weight before rounding)
 * @param {number} billedWeight - Billed weight (max of actual rounded or DIM)
 * @returns {Object} {rate, isOunceRate, weightUsed, weightUnit}
 */
function getBestRate(carrierId, carrierConfig, zone, weightLbs, billedWeight) {
  // Check if this carrier supports ounce rates and has them configured
  const supportsOunces = OUNCE_RATE_CARRIERS.includes(carrierId);
  const hasOunceRates = carrierConfig.ounceRates && carrierConfig.ounceRates.rates && carrierConfig.ounceRates.rates.length > 0;
  
  // Convert weight to ounces (round up)
  const weightOz = Math.ceil(weightLbs * 16);
  
  // Use ounce rates if: carrier supports it, has rates, weight <= 15oz, and DIM doesn't make it heavier
  // Note: For ounce-rate eligible packages, we compare actual oz weight only (DIM shouldn't apply for tiny packages)
  if (supportsOunces && hasOunceRates && weightOz <= 15) {
    const ounceRate = getOunceRate(carrierConfig, zone, weightOz);
    if (ounceRate !== null) {
      return {
        rate: ounceRate,
        isOunceRate: true,
        weightUsed: weightOz,
        weightUnit: 'oz'
      };
    }
  }
  
  // Fall back to lb-based rates
  const lbRate = getBaseRate(carrierConfig, zone, billedWeight);
  return {
    rate: lbRate,
    isOunceRate: false,
    weightUsed: Math.ceil(billedWeight),
    weightUnit: 'lb'
  };
}

/**
 * Calculate fuel surcharge on total amount (base + surcharges)
 * Fuel is calculated as: (Base + Surcharges) * fuelRate%, rounded to 2 decimal places
 */
function calculateFuelSurcharge(totalBeforeFuel, fuelRate) {
  if (!fuelRate || fuelRate === 0) return 0;
  return Math.round(totalBeforeFuel * (fuelRate / 100) * 100) / 100;
}

// ============================================
// Quote Calculation
// ============================================

/**
 * Calculate quote for a single carrier at a specific zone and DAS type
 */
function calculateCarrierQuote(carrierId, carrierConfig, pkgInput, zone, dasType, options, globalFuelRates) {
  const rules = CARRIER_RULES[carrierId];
  if (!rules) {
    return { eligible: false, reason: 'Unknown carrier' };
  }
  
  if (!carrierConfig.enabled) {
    return { eligible: false, reason: 'Carrier disabled' };
  }
  
  // Calculate package properties with carrier-specific DIM divisor
  const pkg = calculatePackageProperties(
    pkgInput.weight,
    pkgInput.length,
    pkgInput.width,
    pkgInput.height,
    carrierConfig.dimDivisor || 166
  );
  
  // Check eligibility
  if (!rules.isEligible(pkg, carrierConfig)) {
    return { eligible: false, reason: 'Exceeds limits' };
  }
  
  // Check zone support
  if (!carrierConfig.zones.includes(zone)) {
    return { eligible: false, reason: 'Zone not supported' };
  }
  
  // Get adjusted weight
  const adjustedWeight = rules.getAdjustedWeight(pkg, carrierConfig);
  
  // Check weight limits
  if (adjustedWeight > carrierConfig.maxWeight || adjustedWeight < carrierConfig.minWeight) {
    return { eligible: false, reason: 'Weight out of range' };
  }
  
  // Get best rate (checks ounce rates for lightweight packages if supported)
  const rateInfo = getBestRate(carrierId, carrierConfig, zone, pkgInput.weight, adjustedWeight);
  if (rateInfo.rate === null) {
    return { eligible: false, reason: 'No rate available' };
  }
  const baseRate = rateInfo.rate;
  
  // Get surcharges (skip for ounce-rate packages as they're lightweight)
  const isResidential = options.serviceType === 'residential';
  let surcharges = [];
  if (!rateInfo.isOunceRate) {
    // Only apply surcharges for lb-based rates
    surcharges = rules.getSurcharges ? rules.getSurcharges(pkg, carrierConfig, options, zone) : [];
  }
  
  // Add DAS surcharge if applicable
  let dasSurcharge = 0;
  if (dasType !== 'none' && rules.getDasSurcharge) {
    dasSurcharge = rules.getDasSurcharge(carrierConfig, dasType, isResidential);
  }
  
  // Calculate surcharge total first (needed for fuel calculation)
  const surchargeTotal = surcharges.reduce((sum, s) => sum + s.amount, 0);
  
  // Calculate fuel surcharge on (Base + All Surcharges)
  // Fuel = (Base + Surcharges + DAS) * fuelRate%, rounded to 2 decimal places
  let fuelAmount = 0;
  if (carrierConfig.hasFuel) {
    const fuelCategory = carrierConfig.fuelCategory || 'fedex';
    const fuelRate = globalFuelRates[fuelCategory] || options.fuelRates?.[fuelCategory] || 0;
    const totalBeforeFuel = baseRate + surchargeTotal + dasSurcharge;
    fuelAmount = calculateFuelSurcharge(totalBeforeFuel, fuelRate);
  }
  
  // Calculate total
  const totalCost = baseRate + surchargeTotal + dasSurcharge + fuelAmount;
  
  return {
    eligible: true,
    carrierId: carrierId,
    carrierName: carrierConfig.displayName || carrierConfig.name,
    billedWeight: rateInfo.isOunceRate ? rateInfo.weightUsed : adjustedWeight,
    billedWeightUnit: rateInfo.weightUnit,
    isOunceRate: rateInfo.isOunceRate,
    dimWeight: pkg.dimWeight,
    actualWeight: pkg.actualWeight,
    zone: zone,
    baseRate: baseRate,
    surcharges: surcharges,
    surchargeTotal: surchargeTotal,
    dasSurcharge: dasSurcharge,
    dasType: dasType,
    fuelAmount: fuelAmount,
    totalCost: Math.round(totalCost * 100) / 100
  };
}

/**
 * Generate quote matrix: best price per zone/DAS combination
 */
async function generateQuoteMatrix(weight, length, width, height, options) {
  const pkgInput = { weight, length, width, height };
  
  // Fetch quote pricing configuration
  const response = await fetch('/api/quote-pricing');
  const pricingConfig = await response.json();
  
  const carriers = pricingConfig.carriers || {};
  const globalFuelRates = pricingConfig.fuelRates || {};
  
  // Merge with options fuel rates (UI overrides)
  const fuelRates = {
    ...globalFuelRates,
    ...(options.fuelRates || {})
  };
  
  // Define zones and DAS types
  const zones = [2, 3, 4, 5, 6, 7, 8];
  const dasTypes = [
    { key: 'none', label: 'No DAS' },
    { key: 'das', label: 'DAS' },
    { key: 'das_extended', label: 'DAS Extended' },
    { key: 'das_remote', label: 'DAS Remote' }
  ];
  
  // Build matrix: rows = DAS types, columns = zones
  const matrix = {};
  
  for (const das of dasTypes) {
    matrix[das.key] = {};
    
    for (const zone of zones) {
      let bestQuote = null;
      let allQuotes = [];
      
      for (const [carrierId, carrierConfig] of Object.entries(carriers)) {
        // Skip TEST carrier - it's only for supplier comparison, not quote generation
        if (carrierId === 'TEST') continue;
        
        const quote = calculateCarrierQuote(
          carrierId, carrierConfig, pkgInput, zone, das.key, options, fuelRates
        );
        
        if (quote.eligible) {
          allQuotes.push(quote);
          if (!bestQuote || quote.totalCost < bestQuote.totalCost) {
            bestQuote = quote;
          }
        }
      }
      
      matrix[das.key][zone] = {
        best: bestQuote,
        all: allQuotes.sort((a, b) => a.totalCost - b.totalCost)
      };
    }
  }
  
  // Calculate package info for display (using 166 divisor for preview)
  const pkgInfo = calculatePackageProperties(weight, length, width, height, 166);
  
  return {
    matrix,
    zones,
    dasTypes,
    pkgInfo,
    input: pkgInput
  };
}

/**
 * Generate quotes for bulk packages
 */
async function generateBulkQuotes(packages, options) {
  const results = [];
  
  for (const pkg of packages) {
    const result = await generateQuoteMatrix(pkg.weight, pkg.length, pkg.width, pkg.height, options);
    results.push(result);
  }
  
  return results;
}

// ============================================
// Supplier Cost Calculation (for Profit Analysis)
// ============================================

// Map quote carrier IDs to supplier carrier categories
// Carrier IDs in quote_pricing.json are uppercase (UNIUNI, GOFO, etc.)
// Supplier categories match these exactly
const CARRIER_TO_SUPPLIER_MAP = {
  'UNIUNI': 'UNIUNI',
  'GOFO': 'GOFO',
  'USPS': 'USPS',
  'SmartPost': 'SmartPost',
  'UPS': 'UPS',
  'FedEx': 'FedEx',
  'FedExAHS': 'FedExAHS',
  'FedExOS': 'FedExOS',
  'TEST': 'TEST'
};

// Fuel surcharge groups for suppliers
const SUPPLIER_FUEL_GROUPS = {
  'FedEx': 'fedex',
  'FedExAHS': 'fedex',
  'FedExOS': 'fedex',
  'SmartPost': 'fedex',
  'UPS': 'ups',
  'UNIUNI': null,  // No fuel
  'GOFO': null,    // No fuel
  'USPS': null,    // No fuel
  'TEST': null     // No fuel
};

/**
 * Calculate supplier cost for a specific carrier, zone, and weight
 * @param {string} carrierId - Quote carrier ID (e.g., 'GOFO', 'UPS')
 * @param {number} zone - Shipping zone (2-8)
 * @param {number} billedWeight - Billed weight (in oz if isOunceRate, in lbs otherwise)
 * @param {string} dasType - DAS type ('none', 'das', 'das_extended', 'das_remote')
 * @param {boolean} isResidential - Whether it's residential delivery
 * @param {Object} globalFuelRates - Global fuel rates {fedex: X, ups: Y}
 * @param {Array} suppliers - Array of supplier objects
 * @param {Array} quoteSurcharges - Surcharges from the quote (to match supplier surcharges)
 * @param {boolean} isOunceRate - Whether the quote uses ounce-based pricing
 * @returns {Object} - {found: boolean, cheapest: {...}, all: [...]}
 */
function calculateSupplierCost(carrierId, zone, billedWeight, dasType, isResidential, globalFuelRates, suppliers, quoteSurcharges = [], isOunceRate = false) {
  const supplierCarrier = CARRIER_TO_SUPPLIER_MAP[carrierId];
  if (!supplierCarrier) {
    return { found: false, reason: 'Unknown carrier: ' + carrierId };
  }
  
  // Filter suppliers by carrier
  const matchingSuppliers = suppliers.filter(s => s.category === supplierCarrier);
  if (matchingSuppliers.length === 0) {
    return { found: false, reason: 'No suppliers for ' + supplierCarrier };
  }
  
  const results = [];
  
  for (const supplier of matchingSuppliers) {
    let baseRate = null;
    
    // Try to get ounce-based rate first if applicable
    if (isOunceRate && supplier.base_rates_oz && supplier.base_rates_oz.length > 0) {
      // billedWeight is in ounces (e.g., 4 for 4oz)
      const ozIndex = Math.ceil(billedWeight) - 1; // 1oz = index 0, 4oz = index 3
      const zones = supplier.zones_oz || [1, 2, 3, 4, 5, 6, 7, 8];
      // Convert zone to number for comparison (zones array contains numbers)
      const zoneNum = parseInt(zone, 10);
      const zoneIdx = zones.findIndex(z => parseInt(z, 10) === zoneNum);
      
      if (ozIndex >= 0 && ozIndex < supplier.base_rates_oz.length && zoneIdx >= 0) {
        const rateRow = supplier.base_rates_oz[ozIndex];
        if (rateRow && zoneIdx < rateRow.length) {
          baseRate = rateRow[zoneIdx];
        }
      }
    }
    
    // Fall back to lb-based rates if ounce rate not found
    if (baseRate === null || baseRate === undefined || baseRate === '') {
      const baseRates = supplier.hd_base_rates_lb || [];
      const lbZones = supplier.hd_zones_lb || [2, 3, 4, 5, 6, 7, 8];
      // For ounce-based quotes without supplier oz rates, use 1lb
      const weightLbs = isOunceRate ? 1 : Math.ceil(billedWeight);
      const weightIndex = weightLbs - 1; // 1-indexed to 0-indexed
      const zoneNum = parseInt(zone, 10);
      const zoneIndex = lbZones.findIndex(z => parseInt(z, 10) === zoneNum);
      
      if (weightIndex >= 0 && weightIndex < baseRates.length && zoneIndex >= 0) {
        const rateRow = baseRates[weightIndex];
        if (rateRow && zoneIndex < rateRow.length) {
          baseRate = rateRow[zoneIndex];
        }
      }
    }
    
    if (baseRate === null || baseRate === undefined || baseRate === '') {
      continue; // No rate found
    }
    
    // Calculate surcharges
    let surchargeTotal = 0;
    const surchargeBreakdown = [];
    
    // Add fixed surcharges
    if (supplier.fixed_surcharges) {
      for (const surcharge of supplier.fixed_surcharges) {
        const desc = (surcharge.description || '').toLowerCase();
        let shouldApply = false;
        
        // Residential surcharge
        if (isResidential && desc.includes('residential') && !desc.includes('das')) {
          shouldApply = true;
        }
        
        // DAS surcharges based on type
        if (dasType !== 'none') {
          if (isResidential) {
            if (dasType === 'das' && desc.includes('das') && desc.includes('resi') && !desc.includes('extended') && !desc.includes('remote')) {
              shouldApply = true;
            } else if (dasType === 'das_extended' && desc.includes('das') && desc.includes('extended') && desc.includes('resi')) {
              shouldApply = true;
            } else if (dasType === 'das_remote' && desc.includes('das') && desc.includes('remote') && desc.includes('resi')) {
              shouldApply = true;
            }
          } else {
            if (dasType === 'das' && desc.includes('das') && desc.includes('comm') && !desc.includes('extended') && !desc.includes('remote')) {
              shouldApply = true;
            } else if (dasType === 'das_extended' && desc.includes('das') && desc.includes('extended') && desc.includes('comm')) {
              shouldApply = true;
            } else if (dasType === 'das_remote' && desc.includes('das') && desc.includes('remote') && desc.includes('comm')) {
              shouldApply = true;
            }
          }
        }
        
        if (shouldApply) {
          surchargeTotal += surcharge.amount;
          surchargeBreakdown.push({ name: surcharge.description, amount: surcharge.amount });
        }
      }
    }
    
    // Add zone-based surcharges - ONLY if matching surcharge was applied in the quote
    // Map quote surcharge names to supplier surcharge descriptions
    const quoteSurchargeNames = quoteSurcharges.map(s => (s.name || '').toLowerCase());
    
    if (supplier.zone_based_surcharges) {
      for (const zs of supplier.zone_based_surcharges) {
        const zsDesc = (zs.description || zs.name || '').toLowerCase();
        
        // Check if this surcharge type was applied in the quote
        let shouldApply = false;
        
        // AHS-Weight matches - must have "weight" in both
        if (zsDesc.includes('ahs') && zsDesc.includes('weight')) {
          shouldApply = quoteSurchargeNames.some(n => n.includes('ahs') && n.includes('weight'));
        }
        // AHS-Dimensions matches - must have "dim" in both
        else if (zsDesc.includes('ahs') && zsDesc.includes('dim')) {
          shouldApply = quoteSurchargeNames.some(n => n.includes('ahs') && n.includes('dim'));
        }
        // Additional Handling matches - must specifically have "additional" or exact "ahs" without weight/dim
        else if (zsDesc.includes('additional') && zsDesc.includes('handling')) {
          shouldApply = quoteSurchargeNames.some(n => 
            n.includes('additional') || 
            (n === 'ahs' || (n.includes('ahs') && !n.includes('weight') && !n.includes('dim')))
          );
        }
        // Oversize matches
        else if (zsDesc.includes('oversize')) {
          shouldApply = quoteSurchargeNames.some(n => n.includes('oversize'));
        }
        // No generic match - only apply surcharges we explicitly recognize
        
        if (shouldApply && zs.zone_rates && zs.zone_rates[zone]) {
          const amt = parseFloat(zs.zone_rates[zone]) || 0;
          if (amt > 0) {
            surchargeTotal += amt;
            surchargeBreakdown.push({ name: (zs.description || zs.name) + ' (Z' + zone + ')', amount: amt });
          }
        }
      }
    }
    
    // Calculate fuel surcharge
    let fuelAmount = 0;
    const fuelGroup = SUPPLIER_FUEL_GROUPS[supplierCarrier];
    
    // Check for "No fuel surcharge for Home Delivery" special advantage
    const noFuelForHomeDelivery = supplier.no_fuel_home_delivery === true;
    const skipFuel = noFuelForHomeDelivery && isResidential;
    
    if (fuelGroup && !skipFuel) {
      const globalFuelRate = globalFuelRates[fuelGroup] || 0;
      
      if (supplier.fuel_type === 'fixed') {
        // Fixed fuel rate - use supplier's fixed percentage directly
        const fixedRate = parseFloat(supplier.fuel_fixed) || 0;
        const totalBeforeFuel = baseRate + surchargeTotal;
        fuelAmount = Math.round(totalBeforeFuel * fixedRate) / 100;
      } else {
        // Discount type - supplier gets X% discount off the market fuel rate
        // e.g., 15% discount means supplier charges 85% of market rate
        // Effective rate = marketRate × (1 - discount/100)
        const discount = parseFloat(supplier.fuel_discount) || 0;
        const effectiveFuelRate = globalFuelRate * (1 - discount / 100);
        const totalBeforeFuel = baseRate + surchargeTotal;
        fuelAmount = Math.round(totalBeforeFuel * effectiveFuelRate) / 100;
      }
    }
    
    // Apply markup as percentage
    const markupPercent = parseFloat(supplier.markup) || 0;
    const subtotal = baseRate + surchargeTotal + fuelAmount;
    const markupAmount = Math.round(subtotal * markupPercent) / 100;
    
    const totalCost = subtotal + markupAmount;
    
    results.push({
      supplierId: supplier.id,
      supplierName: supplier.name,
      carrier: supplierCarrier,
      baseRate: baseRate,
      surcharges: surchargeBreakdown,
      surchargeTotal: surchargeTotal,
      fuelAmount: fuelAmount,
      markup: markupAmount,
      totalCost: Math.round(totalCost * 100) / 100
    });
  }
  
  if (results.length === 0) {
    return { found: false, reason: 'No rates available' };
  }
  
  // Sort by total cost and get cheapest
  results.sort((a, b) => a.totalCost - b.totalCost);
  
  return {
    found: true,
    cheapest: results[0],
    all: results
  };
}

/**
 * Calculate profit for a quote result
 * @param {Object} quoteResult - Result from generateQuoteMatrix
 * @param {Array} suppliers - Array of supplier objects
 * @param {Object} globalFuelRates - Global fuel rates
 * @param {boolean} isResidential - Whether residential delivery
 * @returns {Object} - Matrix with profit info added
 */
async function calculateProfitMatrix(quoteResult, suppliers, globalFuelRates, isResidential = true) {
  const { matrix, zones, dasTypes, pkgInfo } = quoteResult;
  const profitMatrix = {};
  
  for (const das of dasTypes) {
    profitMatrix[das.key] = {};
    
    for (const zone of zones) {
      const cell = matrix[das.key][zone];
      
      if (cell.best) {
        // For each carrier option in the cell, calculate supplier cost
        const enrichedQuotes = [];
        
        for (const quote of cell.all) {
          const supplierCost = calculateSupplierCost(
            quote.carrierId,
            zone,
            quote.billedWeight,  // This is oz for ounce-based, lbs for lb-based
            das.key,
            isResidential,
            globalFuelRates,
            suppliers,
            quote.surcharges || [],  // Pass quote surcharges to match supplier surcharges
            quote.isOunceRate || false  // Pass whether this is an ounce-based quote
          );
          
          let profit = null;
          let profitPercent = null;
          
          if (supplierCost.found) {
            profit = Math.round((quote.totalCost - supplierCost.cheapest.totalCost) * 100) / 100;
            profitPercent = Math.round((profit / quote.totalCost) * 10000) / 100;
          }
          
          enrichedQuotes.push({
            ...quote,
            supplierCost: supplierCost.found ? supplierCost.cheapest.totalCost : null,
            supplierName: supplierCost.found ? supplierCost.cheapest.supplierName : null,
            profit: profit,
            profitPercent: profitPercent,
            supplierDetails: supplierCost.found ? supplierCost : null
          });
        }
        
        // Update best with enriched data
        const enrichedBest = enrichedQuotes.find(q => q.carrierId === cell.best.carrierId);
        
        profitMatrix[das.key][zone] = {
          best: enrichedBest,
          all: enrichedQuotes.sort((a, b) => a.totalCost - b.totalCost)
        };
      } else {
        profitMatrix[das.key][zone] = { best: null, all: [] };
      }
    }
  }
  
  return {
    ...quoteResult,
    matrix: profitMatrix
  };
}

// ============================================
// Rendering Functions
// ============================================

function formatCurrency(amount) {
  if (amount === null || amount === undefined) return '-';
  return '$' + amount.toFixed(2);
}

/**
 * Render quote matrix as a table
 * @param {Object} result - Quote matrix result
 * @param {HTMLElement} container - Container to render into
 * @param {Object} pkgOverride - Override package info
 * @param {Object} permissions - {canViewCost, canViewProfit}
 */
function renderQuoteMatrix(result, container, pkgOverride, permissions = {}) {
  const { matrix, zones, dasTypes, pkgInfo, input } = result;
  const pkg = pkgOverride || input;
  const { canViewCost = false, canViewProfit = false } = permissions;
  
  // Calculate DIM weights for different divisors (for display purposes)
  const dims = pkgInfo.convertedDims || { length: Math.ceil(pkg.length), width: Math.ceil(pkg.width), height: Math.ceil(pkg.height) };
  const volume = dims.length * dims.width * dims.height;
  const dimWeight166 = Math.ceil(volume / 166);
  const dimWeight225 = Math.ceil(volume / 225);
  const dimWeight250 = Math.ceil(volume / 250);
  const actualWeightRounded = Math.ceil(pkg.weight);
  
  // Check if package qualifies for ounce-based pricing (weight <= 15oz = 0.9375 lbs)
  const actualWeightOz = Math.ceil(pkg.weight * 16);
  const isOunceEligible = actualWeightOz <= 15;
  
  let html = '<div style="margin-bottom: 20px; padding: 15px; background: #f0f9ff; border-radius: 8px; border: 1px solid #bae6fd;">';
  html += '<h4 style="margin: 0 0 10px 0;">📦 Package Summary</h4>';
  html += '<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 15px; font-size: 14px;">';
  html += '<div><strong>Dimensions:</strong> ' + dims.length + '" × ' + dims.width + '" × ' + dims.height + '"</div>';
  
  // Show weight with ounce info if eligible
  if (isOunceEligible) {
    html += '<div><strong>Actual Weight:</strong> ' + pkg.weight.toFixed(2) + ' lbs = <strong style="color: #059669;">' + actualWeightOz + ' oz</strong></div>';
  } else {
    html += '<div><strong>Actual Weight:</strong> ' + pkg.weight.toFixed(2) + ' lbs → <strong>' + actualWeightRounded + ' lbs</strong></div>';
  }
  html += '<div><strong>Perimeter:</strong> ' + pkgInfo.perimeter.toFixed(1) + '"</div>';
  html += '<div><strong>Volume:</strong> ' + volume + ' cu in</div>';
  html += '</div>';
  
  // Show DIM weights for different divisors
  html += '<div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid #bae6fd;">';
  html += '<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; font-size: 13px;">';
  
  // UNIUNI/GOFO/USPS - show ounce pricing note if eligible
  if (isOunceEligible) {
    html += '<div style="background: #d1fae5; padding: 8px 12px; border-radius: 6px;">';
    html += '<strong>UNIUNI/GOFO/USPS:</strong> <span style="color: #059669; font-weight: 700;">⚡ ' + actualWeightOz + ' oz pricing</span></div>';
  } else {
    html += '<div style="background: #e0f2fe; padding: 8px 12px; border-radius: 6px;">';
    html += '<strong>UNIUNI/GOFO/USPS (÷166):</strong> DIM=' + dimWeight166 + ' → Billed=<span style="color: #1d4ed8; font-weight: 700;">' + Math.max(actualWeightRounded, dimWeight166) + '</span> lbs</div>';
  }
  
  html += '<div style="background: #fef3c7; padding: 8px 12px; border-radius: 6px;">';
  html += '<strong>SmartPost/UPS/FedEx (÷225):</strong> DIM=' + dimWeight225 + ' → Billed=<span style="color: #1d4ed8; font-weight: 700;">' + Math.max(actualWeightRounded, dimWeight225) + '</span> lbs</div>';
  html += '<div style="background: #fce7f3; padding: 8px 12px; border-radius: 6px;">';
  html += '<strong>FedEx AHS/OS (÷250):</strong> DIM=' + dimWeight250 + ' → Billed=<span style="color: #1d4ed8; font-weight: 700;">' + Math.max(actualWeightRounded, dimWeight250) + '</span> lbs</div>';
  html += '</div></div>';
  
  // Calculate and display warehouse operation fees
  const weightKg = pkg.weight * 0.453592; // Convert lbs to kg
  if (typeof window.calculateWarehouseOpsFee === 'function') {
    const warehouseFees = window.calculateWarehouseOpsFee(weightKg);
    if (warehouseFees.shelvingFee > 0 || warehouseFees.outboundFee > 0) {
      html += '<div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid #bae6fd;">';
      html += '<h4 style="margin: 0 0 8px 0; font-size: 13px; color: #92400e;">📦 一件代发库内操作费 (Warehouse Ops)</h4>';
      html += '<div style="display: flex; gap: 15px; font-size: 13px;">';
      html += '<div style="background: #fef3c7; padding: 8px 12px; border-radius: 6px;">';
      html += '<strong>散货上架费:</strong> $' + warehouseFees.shelvingFee.toFixed(2) + '</div>';
      html += '<div style="background: #fed7aa; padding: 8px 12px; border-radius: 6px;">';
      html += '<strong>出库操作费:</strong> $' + warehouseFees.outboundFee.toFixed(2) + '</div>';
      html += '<div style="background: #fbbf24; padding: 8px 12px; border-radius: 6px; color: #78350f; font-weight: 700;">';
      html += '<strong>Total:</strong> $' + warehouseFees.totalFee.toFixed(2) + '</div>';
      html += '</div>';
      html += '<div style="margin-top: 6px; font-size: 11px; color: #666;">Weight: ' + weightKg.toFixed(2) + ' kg (' + pkg.weight.toFixed(2) + ' lbs)</div>';
      html += '</div>';
    }
  }
  html += '</div>';
  
  // Generate unique prefix for this matrix
  const matrixId = 'matrix_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  
  html += '<div style="overflow-x: auto;">';
  html += '<table style="width: 100%; border-collapse: collapse; font-size: 13px;">';
  html += '<thead><tr style="background: linear-gradient(135deg, #1e293b 0%, #334155 100%); color: white;">';
  html += '<th style="padding: 12px; text-align: left; border: 1px solid #475569;">DAS Type</th>';
  
  for (const zone of zones) {
    html += '<th style="padding: 12px; text-align: center; border: 1px solid #475569;">Zone ' + zone + '</th>';
  }
  html += '</tr></thead><tbody>';
  
  // Reset quote data for this matrix
  window._quoteData = window._quoteData || {};
  
  for (const das of dasTypes) {
    const rowBg = das.key === 'none' ? 'background: #f0fdf4;' : 
                  das.key === 'das' ? 'background: #fefce8;' :
                  das.key === 'das_extended' ? 'background: #fff7ed;' : 'background: #fef2f2;';
    
    html += '<tr style="' + rowBg + '">';
    html += '<td style="padding: 12px; font-weight: 600; border: 1px solid #e5e7eb;">' + das.label + '</td>';
    
    for (const zone of zones) {
      const cell = matrix[das.key][zone];
      
      if (cell.best) {
        const cellId = matrixId + '_' + das.key + '_' + zone;
        html += '<td id="' + cellId + '" style="padding: 8px; text-align: center; border: 1px solid #e5e7eb; cursor: pointer;" ';
        html += 'onclick="window.CustomerQuote.showQuoteDetails(\'' + cellId + '\', ' + canViewCost + ', ' + canViewProfit + ')">';
        html += '<div style="font-size: 16px; font-weight: 700; color: #059669;">' + formatCurrency(cell.best.totalCost) + '</div>';
        html += '<div style="font-size: 11px; color: #374151; font-weight: 500;">' + cell.best.carrierName + '</div>';
        
        // Show profit info if permitted and available
        if (canViewProfit && cell.best.profit !== undefined && cell.best.profit !== null) {
          const profitColor = cell.best.profit >= 0 ? '#16a34a' : '#dc2626';
          html += '<div style="font-size: 10px; color: ' + profitColor + '; margin-top: 2px; font-weight: 600;">💰 ' + formatCurrency(cell.best.profit) + '</div>';
        } else if (canViewCost && cell.best.supplierCost !== undefined && cell.best.supplierCost !== null) {
          html += '<div style="font-size: 10px; color: #6366f1; margin-top: 2px;">📦 Cost: ' + formatCurrency(cell.best.supplierCost) + '</div>';
        }
        
        if (cell.all.length > 1) {
          html += '<div style="font-size: 10px; color: #3b82f6; margin-top: 2px;">+' + (cell.all.length - 1) + ' more</div>';
        }
        html += '</td>';
        
        // Store data for popup with unique key (include permission flags)
        window._quoteData[cellId] = { quotes: cell.all, canViewCost, canViewProfit };
      } else {
        html += '<td style="padding: 12px; text-align: center; border: 1px solid #e5e7eb; color: #9ca3af;">-</td>';
      }
    }
    
    html += '</tr>';
  }
  
  html += '</tbody></table></div>';
  
  // Legend
  html += '<div style="margin-top: 20px; padding: 15px; background: #f8fafc; border-radius: 8px; font-size: 12px; color: #64748b;">';
  html += '<strong>💡 Tips:</strong> Click on any price cell to see all available carriers for that zone/DAS combination. ';
  html += 'Prices include base rate, surcharges, DAS, and fuel (where applicable).';
  html += '</div>';
  
  container.innerHTML = html;
}

/**
 * Render bulk quote results
 */
function renderBulkResults(results, container, permissions = {}) {
  const { canViewCost = false, canViewProfit = false } = permissions;
  
  let html = '<div style="margin-bottom: 15px; padding: 15px; background: #f0f9ff; border-radius: 8px; border: 1px solid #bae6fd;">';
  html += '<h3 style="margin: 0 0 5px 0;">📦 Bulk Quote Results</h3>';
  html += '<p style="margin: 0; font-size: 14px; color: #0369a1;">Showing matrix for ' + results.length + ' package(s). Click on any price to see all options.</p>';
  html += '</div>';
  
  results.forEach((result, index) => {
    html += '<div style="margin-bottom: 30px; padding: 20px; border: 2px solid #e5e7eb; border-radius: 12px;">';
    html += '<h4 style="margin: 0 0 15px 0; color: #374151;">Package #' + (index + 1) + '</h4>';
    
    const tempDiv = document.createElement('div');
    renderQuoteMatrix(result, tempDiv, result.input, { canViewCost, canViewProfit });
    html += tempDiv.innerHTML;
    
    html += '</div>';
  });
  
  container.innerHTML = html;
}

/**
 * Show quote details popup
 */
function showQuoteDetails(cellId, canViewCost, canViewProfit) {
  const cellData = window._quoteData?.[cellId];
  if (!cellData) return;
  
  // Handle both old format (array) and new format (object with quotes array)
  const quotes = Array.isArray(cellData) ? cellData : cellData.quotes;
  const viewCost = canViewCost !== undefined ? canViewCost : (cellData.canViewCost || false);
  const viewProfit = canViewProfit !== undefined ? canViewProfit : (cellData.canViewProfit || false);
  
  if (!quotes || quotes.length === 0) return;
  
  let html = '<div style="max-height: 500px; overflow-y: auto;">';
  html += '<table style="width: 100%; border-collapse: collapse; font-size: 13px;">';
  html += '<thead><tr style="background: #f1f5f9;">';
  html += '<th style="padding: 10px; text-align: left;">Carrier</th>';
  html += '<th style="padding: 10px; text-align: right;">Base</th>';
  html += '<th style="padding: 10px; text-align: right;">Surcharges</th>';
  html += '<th style="padding: 10px; text-align: right;">DAS</th>';
  html += '<th style="padding: 10px; text-align: right;">Fuel</th>';
  html += '<th style="padding: 10px; text-align: right; font-weight: 700;">Total</th>';
  if (viewCost) {
    html += '<th style="padding: 10px; text-align: right; color: #6366f1;">Supplier Cost</th>';
  }
  if (viewProfit) {
    html += '<th style="padding: 10px; text-align: right; color: #16a34a;">Profit</th>';
  }
  html += '</tr></thead><tbody>';
  
  quotes.forEach((q, i) => {
    const bg = i === 0 ? 'background: #ecfdf5;' : (i % 2 === 0 ? '' : 'background: #f9fafb;');
    const weightUnit = q.billedWeightUnit || 'lb';
    const weightDisplay = weightUnit === 'oz' ? q.billedWeight + ' oz' : q.billedWeight + ' lbs';
    const rowId = 'carrier-row-' + i + '-' + Date.now();
    const allSuppliers = q.supplierDetails?.all || [];
    const hasMultipleSuppliers = allSuppliers.length > 1;
    
    html += '<tr style="' + bg + '" id="' + rowId + '">';
    html += '<td style="padding: 10px;">' + (i === 0 ? '⭐ ' : '') + q.carrierName;
    html += '<br><small style="color: #666;">Billed: ' + weightDisplay + '</small>';
    html += '</td>';
    html += '<td style="padding: 10px; text-align: right;">' + formatCurrency(q.baseRate) + '</td>';
    html += '<td style="padding: 10px; text-align: right;">';
    if (q.surcharges.length > 0) {
      html += formatCurrency(q.surchargeTotal);
      html += '<br><small style="color: #666;">' + q.surcharges.map(s => s.name).join(', ') + '</small>';
    } else {
      html += '-';
    }
    html += '</td>';
    html += '<td style="padding: 10px; text-align: right;">' + (q.dasSurcharge > 0 ? formatCurrency(q.dasSurcharge) : '-') + '</td>';
    html += '<td style="padding: 10px; text-align: right;">' + (q.fuelAmount > 0 ? formatCurrency(q.fuelAmount) : '-') + '</td>';
    html += '<td style="padding: 10px; text-align: right; font-weight: 700; color: #059669;">' + formatCurrency(q.totalCost) + '</td>';
    
    // Show all suppliers in the Cost column
    if (viewCost) {
      html += '<td style="padding: 10px; text-align: right; vertical-align: top;">';
      if (allSuppliers.length > 0) {
        allSuppliers.forEach((supplier, si) => {
          const isCheapest = si === 0;
          const supplierStyle = isCheapest 
            ? 'color: #6366f1; font-weight: 600;' 
            : 'color: #9ca3af; font-size: 12px;';
          html += '<div style="' + supplierStyle + (si > 0 ? ' margin-top: 4px; padding-top: 4px; border-top: 1px dashed #e5e7eb;' : '') + '">';
          html += formatCurrency(supplier.totalCost);
          html += '<br><small style="' + (isCheapest ? 'color: #6366f1;' : 'color: #9ca3af;') + '">' + supplier.supplierName + '</small>';
          html += '</div>';
        });
      } else {
        html += '-';
      }
      html += '</td>';
    }
    
    // Show profit for all suppliers
    if (viewProfit) {
      html += '<td style="padding: 10px; text-align: right; vertical-align: top;">';
      if (allSuppliers.length > 0) {
        allSuppliers.forEach((supplier, si) => {
          const profit = Math.round((q.totalCost - supplier.totalCost) * 100) / 100;
          const profitPercent = Math.round((profit / q.totalCost) * 10000) / 100;
          const isCheapest = si === 0;
          const profitColor = profit >= 0 ? (isCheapest ? '#16a34a' : '#86efac') : (isCheapest ? '#dc2626' : '#fca5a5');
          const fontWeight = isCheapest ? '600' : '400';
          const fontSize = isCheapest ? 'inherit' : '12px';
          html += '<div style="color: ' + profitColor + '; font-weight: ' + fontWeight + '; font-size: ' + fontSize + ';' + (si > 0 ? ' margin-top: 4px; padding-top: 4px; border-top: 1px dashed #e5e7eb;' : '') + '">';
          html += formatCurrency(profit);
          html += '<br><small>(' + profitPercent.toFixed(1) + '%)</small>';
          html += '</div>';
        });
      } else {
        html += '-';
      }
      html += '</td>';
    }
    
    html += '</tr>';
  });
  
  html += '</tbody></table></div>';
  
  // Create modal
  const modal = document.createElement('div');
  modal.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 9999;';
  modal.onclick = function(e) { if (e.target === modal) modal.remove(); };
  
  const content = document.createElement('div');
  content.style.cssText = 'background: white; padding: 24px; border-radius: 12px; max-width: 900px; width: 90%; max-height: 80vh; overflow: auto; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.25);';
  content.innerHTML = '<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">' +
    '<h3 style="margin: 0; color: #1e293b;">All Carrier Options (' + quotes.length + ')</h3>' +
    '<button onclick="this.closest(\'div[style*=fixed]\').remove()" style="background: #f1f5f9; border: none; font-size: 20px; cursor: pointer; padding: 8px 12px; border-radius: 6px;">✕</button>' +
    '</div>' + html;
  
  modal.appendChild(content);
  document.body.appendChild(modal);
}

// ============================================
// Export to Window
// ============================================

/**
 * Wrapper for getting base rate from quote pricing data structure
 * Used by matrix view in app.js
 * @param {Object} carrierPricing - Carrier pricing data from quote-pricing API
 * @param {string} carrierId - Carrier ID (e.g., 'FedEx', 'GOFO')
 * @param {number} weight - Weight value
 * @param {number} zone - Zone number
 * @param {string} serviceType - 'residential' or 'commercial' (not used in current structure)
 * @param {string} unit - 'oz' or 'lb' (default: 'lb')
 * @returns {number|null} Base rate or null if not found
 */
function getBaseRateFromPricing(carrierPricing, carrierId, weight, zone, serviceType = 'residential', unit = 'lb') {
  // Determine which rate table to use based on unit
  const rateConfig = unit === 'oz' ? carrierPricing.ounceRates : carrierPricing.baseRates;
  
  if (!rateConfig || !rateConfig.zones || !rateConfig.rates || !rateConfig.rates.length) {
    return null;
  }
  
  const zones = rateConfig.zones;
  const rates = rateConfig.rates;
  const weightStart = rateConfig.weightStart || 1;
  
  // Find zone index
  const zoneIndex = zones.indexOf(zone);
  if (zoneIndex === -1) return null;
  
  // Find weight index
  const weightIndex = Math.ceil(weight) - weightStart;
  
  if (weightIndex < 0) return null;
  if (weightIndex >= rates.length) {
    // Use the last available rate
    return rates[rates.length - 1]?.[zoneIndex] ?? null;
  }
  
  return rates[weightIndex]?.[zoneIndex] ?? null;
}

window.CustomerQuote = {
  calculatePackageProperties,
  generateQuoteMatrix,
  generateBulkQuotes,
  calculateSupplierCost,
  calculateProfitMatrix,
  renderQuoteMatrix,
  renderBulkResults,
  showQuoteDetails,
  convertToInchLb,
  convertToCmKg,
  getBaseRate: getBaseRateFromPricing,  // Use the new wrapper for external calls
  formatCurrency,
  CARRIER_RULES,
  CARRIER_TO_SUPPLIER_MAP,
  SUPPLIER_FUEL_GROUPS
};
