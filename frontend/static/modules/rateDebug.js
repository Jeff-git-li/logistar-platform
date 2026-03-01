/**
 * Rate Debug Module (运费报价调试)
 * Allows users to view/edit quote pricing for each carrier in a zone-weight matrix,
 * toggle surcharges with editable amounts, and see supplier costs + profit for each cell.
 */

(function() {
  'use strict';

  let quotePricing = null;
  let suppliersData = null;
  let currentCarrier = null;
  let currentCarrierConfig = null;
  let editedRates = {}; // Track user edits: { "weight-zone": editedValue }
  let editedSurcharges = {}; // Track surcharge amount edits: { "carrierId-surchargeKey": editedValue }
  let activeSurcharges = {}; // Track which surcharges are toggled on
  let fuelRates = { fedex: 21.25, ups: 20.75 };
  let serviceType = 'residential'; // 'residential' or 'commercial'

  const CARRIER_ORDER = ['UNIUNI', 'GOFO', 'USPS', 'SmartPost', 'UPS', 'FedEx', 'FedExAHS', 'FedExOS', 'TEST'];

  const CARRIER_DISPLAY = {
    'UNIUNI': 'UNIUNI',
    'GOFO': 'GOFO',
    'USPS': 'USPS',
    'SmartPost': 'FedEx SmartPost',
    'UPS': 'UPS',
    'FedEx': 'FedEx',
    'FedExAHS': 'FedEx AHS',
    'FedExOS': 'FedEx OS',
    'TEST': 'TEST'
  };

  const CARRIER_COLORS = {
    'UNIUNI': '#10b981',
    'GOFO': '#f59e0b',
    'USPS': '#3b82f6',
    'SmartPost': '#8b5cf6',
    'UPS': '#6b4226',
    'FedEx': '#ff6900',
    'FedExAHS': '#ef4444',
    'FedExOS': '#ec4899',
    'TEST': '#9ca3af'
  };

  const SUPPLIER_FUEL_GROUPS = {
    'FedEx': 'fedex', 'FedExAHS': 'fedex', 'FedExOS': 'fedex', 'SmartPost': 'fedex',
    'UPS': 'ups', 'UNIUNI': null, 'GOFO': null, 'USPS': null, 'TEST': null
  };

  // ============================================
  // Data Loading
  // ============================================

  async function loadData() {
    try {
      const [qpRes, spRes] = await Promise.all([
        fetch('/api/quote-pricing'),
        fetch('/api/suppliers')
      ]);
      quotePricing = await qpRes.json();
      suppliersData = await spRes.json();

      fuelRates = {
        fedex: quotePricing.fuelRates?.fedex || 21.25,
        ups: quotePricing.fuelRates?.ups || 20.75
      };
    } catch (e) {
      console.error('Error loading rate debug data:', e);
    }
  }

  // ============================================
  // Helper: get surcharge amount (considering user edits)
  // ============================================

  function getSurchargeAmount(carrierId, surchargeKey, originalAmount) {
    const editKey = `${carrierId}-${surchargeKey}`;
    if (editedSurcharges[editKey] !== undefined) {
      return editedSurcharges[editKey];
    }
    return originalAmount;
  }

  // ============================================
  // Supplier Cost Calculation
  // ============================================

  function calculateSupplierCostForCell(carrierId, zone, weight, isOunce) {
    if (!suppliersData?.suppliers) return [];

    const matchingSuppliers = suppliersData.suppliers.filter(s => s.category === carrierId);
    if (matchingSuppliers.length === 0) return [];

    const results = [];
    const isResidential = serviceType === 'residential';

    for (const supplier of matchingSuppliers) {
      let baseRate = null;

      // Try ounce rates
      if (isOunce && supplier.base_rates_oz?.length > 0) {
        const ozIndex = Math.ceil(weight) - 1;
        const zones = supplier.zones_oz || [1,2,3,4,5,6,7,8];
        const zoneIdx = zones.indexOf(zone);
        if (ozIndex >= 0 && ozIndex < supplier.base_rates_oz.length && zoneIdx >= 0) {
          const row = supplier.base_rates_oz[ozIndex];
          if (row && zoneIdx < row.length) baseRate = row[zoneIdx];
        }
      }

      // Fall back to lb rates — use ground rates for commercial if available
      if (baseRate === null || baseRate === undefined) {
        let rates, lbZones, weightStart;
        if (!isResidential && supplier.ground_base_rates_lb?.length > 0) {
          rates = supplier.ground_base_rates_lb;
          lbZones = supplier.ground_zones_lb || supplier.hd_zones_lb || [2,3,4,5,6,7,8];
          weightStart = supplier.ground_weight_start_lb || supplier.hd_weight_start_lb || 1;
        } else {
          rates = supplier.hd_base_rates_lb || [];
          lbZones = supplier.hd_zones_lb || [2,3,4,5,6,7,8];
          weightStart = supplier.hd_weight_start_lb || 1;
        }
        const weightLbs = isOunce ? 1 : Math.ceil(weight);
        const weightIdx = weightLbs - weightStart;
        const zoneIdx = lbZones.indexOf(zone);
        if (weightIdx >= 0 && weightIdx < rates.length && zoneIdx >= 0) {
          const row = rates[weightIdx];
          if (row && zoneIdx < row.length) baseRate = row[zoneIdx];
        }
      }

      if (baseRate === null || baseRate === undefined || baseRate === '') continue;
      baseRate = parseFloat(baseRate);

      // Surcharges
      let surchargeTotal = 0;
      const surchargeBreakdown = [];

      // Fixed surcharges from supplier
      if (supplier.fixed_surcharges) {
        for (const sc of supplier.fixed_surcharges) {
          const desc = (sc.description || '').toLowerCase();
          let shouldApply = false;

          // Residential surcharge - auto-apply when residential
          if (isResidential && desc.includes('residential') && !desc.includes('das') && !desc.includes('remote')) {
            shouldApply = true;
          }

          // DAS Commercial - apply when das toggled on and commercial
          if (activeSurcharges.das && !isResidential && desc.includes('das') && desc.includes('comm') && !desc.includes('extended') && !desc.includes('remote')) {
            shouldApply = true;
          }

          // DAS Residential - apply when das toggled on and residential
          if (activeSurcharges.das && isResidential && desc.includes('das') && desc.includes('resi') && !desc.includes('extended') && !desc.includes('remote')) {
            shouldApply = true;
          }

          // DAS Extended Commercial
          if (activeSurcharges.dasExtended && !isResidential && desc.includes('das') && desc.includes('extended') && desc.includes('comm')) {
            shouldApply = true;
          }

          // DAS Extended Residential
          if (activeSurcharges.dasExtended && isResidential && desc.includes('das') && desc.includes('extended') && (desc.includes('resi') || desc.includes('residential'))) {
            shouldApply = true;
          }

          // DAS Remote
          if (activeSurcharges.dasRemote && desc.includes('das') && desc.includes('remote')) {
            if (!isResidential && desc.includes('comm')) shouldApply = true;
            if (isResidential && (desc.includes('resi') || desc.includes('residential'))) shouldApply = true;
            // If neither comm nor resi specified, apply regardless
            if (!desc.includes('comm') && !desc.includes('resi') && !desc.includes('residential')) shouldApply = true;
          }

          if (shouldApply) {
            surchargeTotal += sc.amount;
            surchargeBreakdown.push({ name: sc.description, amount: sc.amount });
          }
        }
      }

      // Zone-based surcharges - only apply ones the user has toggled on
      if (supplier.zone_based_surcharges) {
        for (const zs of supplier.zone_based_surcharges) {
          const zsDesc = (zs.description || '').toLowerCase();
          let surchargeKey = null;

          if (zsDesc.includes('ahs') && zsDesc.includes('weight')) surchargeKey = 'ahsWeight';
          else if (zsDesc.includes('ahs') && zsDesc.includes('dim')) surchargeKey = 'ahsDim';
          else if (zsDesc.includes('additional') && zsDesc.includes('handling')) surchargeKey = 'additionalHandling';
          else if (zsDesc.includes('oversize')) surchargeKey = 'oversize';

          if (surchargeKey && activeSurcharges[surchargeKey]) {
            const zoneStr = zone.toString();
            let amt = null;
            if (zs.zone_rates?.[zoneStr]) {
              amt = parseFloat(zs.zone_rates[zoneStr]);
            } else {
              // Try zone ranges
              for (const zk in (zs.zone_rates || {})) {
                if (zk.includes('-')) {
                  const [s, e] = zk.split('-').map(Number);
                  if (zone >= s && zone <= e) {
                    amt = parseFloat(zs.zone_rates[zk]);
                    break;
                  }
                }
              }
            }
            if (amt && amt > 0) {
              surchargeTotal += amt;
              surchargeBreakdown.push({ name: zs.description + ' (Z' + zone + ')', amount: amt });
            }
          }
        }
      }

      // Pickup fee per lb (UNIUNI only)
      let pickupFee = 0;
      if (carrierId === 'UNIUNI' && supplier.pickup_fee_per_lb && supplier.pickup_fee_per_lb > 0) {
        const poundsForPickup = Math.ceil(isOunce ? 1 : weight); // 1oz-1lb = 1lb, round up
        pickupFee = poundsForPickup * supplier.pickup_fee_per_lb;
      }

      // Fuel
      let fuelAmount = 0;
      const fuelGroup = SUPPLIER_FUEL_GROUPS[carrierId];
      const noFuelHD = supplier.no_fuel_home_delivery === true;
      const skipFuel = noFuelHD && isResidential;

      if (fuelGroup && !skipFuel) {
        const globalFuelRate = fuelRates[fuelGroup] || 0;
        const totalBeforeFuel = baseRate + surchargeTotal + pickupFee;

        if (supplier.fuel_type === 'fixed') {
          const fixedRate = parseFloat(supplier.fuel_fixed) || 0;
          fuelAmount = Math.round(totalBeforeFuel * fixedRate) / 100;
        } else {
          const discount = parseFloat(supplier.fuel_discount) || 0;
          const effectiveRate = globalFuelRate * (1 - discount / 100);
          fuelAmount = Math.round(totalBeforeFuel * effectiveRate) / 100;
        }
      }

      const markupPct = parseFloat(supplier.markup) || 0;
      const subtotal = baseRate + surchargeTotal + pickupFee + fuelAmount;
      const markupAmt = Math.round(subtotal * markupPct) / 100;
      const totalCost = Math.round((subtotal + markupAmt) * 100) / 100;

      results.push({
        name: supplier.name,
        baseRate,
        pickupFee,
        surcharges: surchargeBreakdown,
        surchargeTotal,
        fuelAmount,
        markup: markupAmt,
        totalCost
      });
    }

    results.sort((a, b) => a.totalCost - b.totalCost);
    return results;
  }

  // ============================================
  // Quote Price Calculation (what we charge the customer)
  // ============================================

  function getQuotePrice(carrierId, config, zone, weight, isOunce) {
    let baseRate = null;

    // Check for edited rate first
    const cellKey = `${weight}-${zone}`;
    if (editedRates[cellKey] !== undefined) {
      baseRate = editedRates[cellKey];
    } else {
      // Get from config
      if (isOunce && config.ounceRates?.rates) {
        const zones = config.ounceRates.zones || config.zones || [];
        const zoneIdx = zones.indexOf(zone);
        const weightIdx = Math.ceil(weight) - 1;
        if (zoneIdx >= 0 && weightIdx >= 0 && weightIdx < config.ounceRates.rates.length) {
          const row = config.ounceRates.rates[weightIdx];
          if (row && zoneIdx < row.length) baseRate = parseFloat(row[zoneIdx]);
        }
      }

      if (baseRate === null && config.baseRates?.rates) {
        const zones = config.baseRates.zones || config.zones || [];
        const zoneIdx = zones.indexOf(zone);
        const weightLbs = isOunce ? 1 : Math.ceil(weight);
        const weightStart = config.baseRates.weightStart || config.minWeight || 1;
        const weightIdx = weightLbs - weightStart;
        if (zoneIdx >= 0 && weightIdx >= 0 && weightIdx < config.baseRates.rates.length) {
          const row = config.baseRates.rates[weightIdx];
          if (row && zoneIdx < row.length) baseRate = parseFloat(row[zoneIdx]);
        }
      }
    }

    if (baseRate === null || isNaN(baseRate)) return null;

    // Add surcharges based on active toggles
    let surchargeTotal = 0;
    const surchargeBreakdown = [];
    const sc = config.surcharges || {};
    const isResidential = serviceType === 'residential';

    // 1) Residential surcharge (auto-applied based on serviceType)
    if (isResidential && sc.residential !== undefined) {
      if (typeof sc.residential === 'number') {
        const amt = getSurchargeAmount(carrierId, 'residential', sc.residential);
        surchargeTotal += amt;
        surchargeBreakdown.push({ name: 'Residential', amount: amt });
      } else if (typeof sc.residential === 'object') {
        // FedExAHS has weight-based residential: { under70, over70 }
        const origAmt = sc.residential.under70 || 0;
        const amt = getSurchargeAmount(carrierId, 'residential', origAmt);
        surchargeTotal += amt;
        surchargeBreakdown.push({ name: 'Residential', amount: amt });
      }
    }

    // 2) DAS surcharges (toggled by user) - for UPS, FedEx, FedExAHS, FedExOS
    if (activeSurcharges.das && sc.das) {
      let origAmt = 0;
      if (typeof sc.das === 'object') {
        origAmt = isResidential ? (sc.das.residential || 0) : (sc.das.commercial || 0);
      } else {
        origAmt = sc.das;
      }
      const editKey = isResidential ? 'dasResi' : 'dasComm';
      const amt = getSurchargeAmount(carrierId, editKey, origAmt);
      surchargeTotal += amt;
      surchargeBreakdown.push({ name: `DAS (${isResidential ? 'Resi' : 'Comm'})`, amount: amt });
    }

    if (activeSurcharges.dasExtended && sc.dasExtended) {
      let origAmt = 0;
      if (typeof sc.dasExtended === 'object') {
        origAmt = isResidential ? (sc.dasExtended.residential || 0) : (sc.dasExtended.commercial || 0);
      } else {
        origAmt = sc.dasExtended;
      }
      const editKey = isResidential ? 'dasExtResi' : 'dasExtComm';
      const amt = getSurchargeAmount(carrierId, editKey, origAmt);
      surchargeTotal += amt;
      surchargeBreakdown.push({ name: `DAS Ext (${isResidential ? 'Resi' : 'Comm'})`, amount: amt });
    }

    if (activeSurcharges.dasRemote && sc.dasRemote !== undefined) {
      const origAmt = typeof sc.dasRemote === 'number' ? sc.dasRemote : 0;
      const amt = getSurchargeAmount(carrierId, 'dasRemote', origAmt);
      surchargeTotal += amt;
      surchargeBreakdown.push({ name: 'DAS Remote', amount: amt });
    }

    // 3) AHS zone-based surcharges (FedExAHS)
    if (sc.ahsZoneBased && activeSurcharges.ahsWeight) {
      const zoneData = sc.ahsZoneBased[zone.toString()];
      if (zoneData?.ahsWeight) {
        const amt = getSurchargeAmount(carrierId, `ahsWeight-z${zone}`, zoneData.ahsWeight);
        surchargeTotal += amt;
        surchargeBreakdown.push({ name: 'AHS-Weight', amount: amt });
      }
    }
    if (sc.ahsZoneBased && activeSurcharges.ahsDim) {
      const zoneData = sc.ahsZoneBased[zone.toString()];
      if (zoneData?.ahsDim) {
        const amt = getSurchargeAmount(carrierId, `ahsDim-z${zone}`, zoneData.ahsDim);
        surchargeTotal += amt;
        surchargeBreakdown.push({ name: 'AHS-Dim', amount: amt });
      }
    }

    // 4) Oversize zone-based surcharges (FedExOS)
    if (sc.oversizeZoneBased && activeSurcharges.oversize) {
      const oversizeAmt = sc.oversizeZoneBased[zone.toString()] || 0;
      if (oversizeAmt > 0) {
        const amt = getSurchargeAmount(carrierId, `oversize-z${zone}`, oversizeAmt);
        surchargeTotal += amt;
        surchargeBreakdown.push({ name: 'Oversize', amount: amt });
      }
    }

    // 5) Simple flat surcharges (UNIUNI/GOFO style - non-zone-based)
    if (activeSurcharges.oversize && sc.oversize && !sc.oversizeZoneBased) {
      const amt = getSurchargeAmount(carrierId, 'oversize', sc.oversize);
      surchargeTotal += amt;
      surchargeBreakdown.push({ name: 'Oversize', amount: amt });
    }
    if (activeSurcharges.ahsDim && sc.ahsDimension && !sc.ahsZoneBased) {
      const amt = getSurchargeAmount(carrierId, 'ahsDimension', sc.ahsDimension);
      surchargeTotal += amt;
      surchargeBreakdown.push({ name: 'AHS-Dim', amount: amt });
    }
    if (activeSurcharges.overweight && sc.overweight) {
      const amt = getSurchargeAmount(carrierId, 'overweight', sc.overweight);
      surchargeTotal += amt;
      surchargeBreakdown.push({ name: 'Overweight', amount: amt });
    }
    if (activeSurcharges.ahs && sc.ahs) {
      const amt = getSurchargeAmount(carrierId, 'ahs', sc.ahs);
      surchargeTotal += amt;
      surchargeBreakdown.push({ name: 'AHS', amount: amt });
    }

    // Fuel
    let fuelAmount = 0;
    if (config.hasFuel) {
      const fuelCategory = config.fuelCategory || 'fedex';
      const fuelRate = fuelRates[fuelCategory] || 0;
      const totalBeforeFuel = baseRate + surchargeTotal;
      fuelAmount = Math.round(totalBeforeFuel * fuelRate) / 100;
    }

    const totalCost = Math.round((baseRate + surchargeTotal + fuelAmount) * 100) / 100;

    return {
      baseRate,
      surcharges: surchargeBreakdown,
      surchargeTotal,
      fuelAmount,
      totalCost
    };
  }

  // ============================================
  // UI Rendering
  // ============================================

  function render() {
    const container = document.getElementById('rate-debug-content');
    if (!container) return;

    if (!quotePricing?.carriers) {
      container.innerHTML = '<p style="color:#999; text-align:center; padding:40px;">加载中...</p>';
      return;
    }

    let html = '';

    // Controls bar
    html += '<div style="display:flex; gap:15px; flex-wrap:wrap; align-items:center; margin-bottom:20px; padding:15px; background:#f8fafc; border-radius:8px; border:1px solid #e2e8f0;">';

    // Carrier selector tabs
    html += '<div style="display:flex; gap:0; flex-wrap:wrap;">';
    for (const cid of CARRIER_ORDER) {
      const cfg = quotePricing.carriers[cid];
      if (!cfg || !cfg.enabled) continue;
      const isActive = cid === currentCarrier;
      const color = CARRIER_COLORS[cid];
      html += `<button class="rd-carrier-tab" data-carrier="${cid}" style="
        padding:8px 16px; border:none; cursor:pointer; font-size:13px; font-weight:600;
        background:${isActive ? color : '#e5e7eb'}; color:${isActive ? 'white' : '#374151'};
        border-radius:6px; margin-right:4px; margin-bottom:4px;
        transition: all 0.2s;
      ">${CARRIER_DISPLAY[cid]}</button>`;
    }
    html += '</div>';

    // Service type toggle + fuel rates
    html += '<div style="display:flex; gap:8px; align-items:center; margin-left:auto;">';
    html += '<label style="font-size:13px; font-weight:600;">配送:</label>';
    html += `<select id="rd-service-type" style="padding:6px 10px; border:1px solid #d1d5db; border-radius:6px; font-size:13px;">
      <option value="residential" ${serviceType==='residential'?'selected':''}>Residential</option>
      <option value="commercial" ${serviceType==='commercial'?'selected':''}>Commercial</option>
    </select>`;

    // Fuel rates
    html += '<label style="font-size:13px; font-weight:600; margin-left:10px;">FedEx Fuel%:</label>';
    html += `<input type="number" id="rd-fuel-fedex" value="${fuelRates.fedex}" step="0.25" style="width:70px; padding:6px; border:1px solid #d1d5db; border-radius:6px; font-size:13px;">`;
    html += '<label style="font-size:13px; font-weight:600; margin-left:6px;">UPS Fuel%:</label>';
    html += `<input type="number" id="rd-fuel-ups" value="${fuelRates.ups}" step="0.25" style="width:70px; padding:6px; border:1px solid #d1d5db; border-radius:6px; font-size:13px;">`;
    html += '</div>';
    html += '</div>';

    // Carrier content
    if (currentCarrier && quotePricing.carriers[currentCarrier]) {
      html += renderCarrierDebug(currentCarrier, quotePricing.carriers[currentCarrier]);
    } else {
      html += `<div style="text-align:center; color:#666; padding:60px 20px; background:#f8fafc; border-radius:12px; border:2px dashed #e5e7eb;">
        <div style="font-size:48px; margin-bottom:15px;">🔍</div>
        <p style="font-size:16px; margin:0 0 10px 0;">选择一个承运商开始运费报价调试</p>
        <p style="font-size:13px; color:#9ca3af; margin:0;">点击上方的承运商按钮，查看和编辑报价矩阵</p>
      </div>`;
    }

    container.innerHTML = html;
    bindEvents();
  }

  function renderCarrierDebug(carrierId, config) {
    const color = CARRIER_COLORS[carrierId];
    let html = '';

    // Carrier info header
    html += `<div style="background:${color}10; border:1px solid ${color}40; border-radius:8px; padding:15px; margin-bottom:15px;">`;
    html += `<div style="display:flex; gap:30px; flex-wrap:wrap; font-size:14px; align-items:center;">`;
    html += `<div><strong style="color:${color};">${CARRIER_DISPLAY[carrierId]}</strong></div>`;
    html += `<div>DIM: <strong>${config.dimDivisor}</strong></div>`;
    html += `<div>Weight: <strong>${config.minWeight || 0}-${config.maxWeight} lbs</strong></div>`;
    html += `<div>Zones: <strong>${(config.zones || []).join(', ')}</strong></div>`;
    html += `<div>Fuel: <strong>${config.hasFuel ? (config.fuelCategory === 'ups' ? 'UPS' : 'FedEx') : 'None'}</strong></div>`;
    html += '</div>';
    if (config.notes) {
      html += `<div style="margin-top:8px; font-size:12px; color:#666;">${config.notes}</div>`;
    }
    html += '</div>';

    // Surcharge toggles (with editable amounts)
    html += renderSurchargeToggles(carrierId, config);

    // Rate matrix
    const hasOunceRates = config.ounceRates?.rates?.length > 0;

    if (hasOunceRates) {
      html += '<h4 style="margin:20px 0 10px 0; color:#374151;">⚖️ 盎司费率</h4>';
      html += renderRateMatrix(carrierId, config, true);
    }

    html += `<h4 style="margin:20px 0 10px 0; color:#374151;">📊 磅费率</h4>`;
    html += renderRateMatrix(carrierId, config, false);

    return html;
  }

  function renderSurchargeToggles(carrierId, config) {
    const sc = config.surcharges || {};
    const isResidential = serviceType === 'residential';

    let html = '<div style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:15px; padding:12px; background:#fefce8; border:1px solid #fde68a; border-radius:8px; align-items:center;">';
    html += '<span style="font-weight:600; font-size:13px; color:#92400e; align-self:center;">附加费:</span>';

    const toggles = [];

    // Residential (auto-applied based on serviceType)
    if (sc.residential !== undefined) {
      let origAmt;
      if (typeof sc.residential === 'number') {
        origAmt = sc.residential;
      } else {
        origAmt = sc.residential.under70 || 0;
      }
      toggles.push({ key: 'residential', editKey: 'residential', label: 'Residential', amount: origAmt, auto: true });
    }

    // DAS options (UPS, FedEx, FedExAHS, FedExOS)
    if (sc.das) {
      if (isResidential) {
        toggles.push({ key: 'das', editKey: 'dasResi', label: 'DAS (Resi)', amount: sc.das.residential || 0 });
      } else {
        toggles.push({ key: 'das', editKey: 'dasComm', label: 'DAS (Comm)', amount: sc.das.commercial || 0 });
      }
    }
    if (sc.dasExtended) {
      if (isResidential) {
        toggles.push({ key: 'dasExtended', editKey: 'dasExtResi', label: 'DAS Ext (Resi)', amount: sc.dasExtended.residential || 0 });
      } else {
        toggles.push({ key: 'dasExtended', editKey: 'dasExtComm', label: 'DAS Ext (Comm)', amount: sc.dasExtended.commercial || 0 });
      }
    }
    if (sc.dasRemote !== undefined) {
      const dasRemoteAmt = typeof sc.dasRemote === 'number' ? sc.dasRemote : 0;
      toggles.push({ key: 'dasRemote', editKey: 'dasRemote', label: 'DAS Remote', amount: dasRemoteAmt });
    }

    // AHS options
    if (sc.ahsZoneBased) {
      // Zone-based: just a toggle, no single editable amount (varies per zone)
      toggles.push({ key: 'ahsWeight', editKey: null, label: 'AHS-Weight', zoneBased: true });
      toggles.push({ key: 'ahsDim', editKey: null, label: 'AHS-Dim', zoneBased: true });
    } else {
      if (sc.ahs !== undefined) toggles.push({ key: 'ahs', editKey: 'ahs', label: 'AHS', amount: sc.ahs });
      if (sc.ahsDimension !== undefined) toggles.push({ key: 'ahsDim', editKey: 'ahsDimension', label: 'AHS-Dim', amount: sc.ahsDimension });
      if (sc.overweight !== undefined) toggles.push({ key: 'overweight', editKey: 'overweight', label: 'Overweight', amount: sc.overweight });
    }

    if (sc.oversize !== undefined && !sc.oversizeZoneBased) {
      toggles.push({ key: 'oversize', editKey: 'oversize', label: 'Oversize', amount: sc.oversize });
    }
    if (sc.oversizeZoneBased) {
      toggles.push({ key: 'oversize', editKey: null, label: 'Oversize', zoneBased: true });
    }
    if (sc.oversizeLarge !== undefined) {
      toggles.push({ key: 'oversizeLarge', editKey: 'oversizeLarge', label: 'Oversize Large', amount: sc.oversizeLarge });
    }

    for (const t of toggles) {
      if (t.auto) {
        // Residential: auto-applied, show with editable amount
        const editKey = `${carrierId}-${t.editKey}`;
        const currentAmt = editedSurcharges[editKey] !== undefined ? editedSurcharges[editKey] : t.amount;
        html += `<div style="display:inline-flex; align-items:center; padding:4px 10px; border-radius:16px; font-size:12px; font-weight:500;
          background:#d1fae5; color:#065f46; border:1px solid #6ee7b7; gap:4px;"
          title="根据配送类型自动应用">`;
        html += `<span>✓ ${t.label}</span>`;
        html += `<span>$</span><input type="number" class="rd-surcharge-amount" data-carrier="${carrierId}" data-edit-key="${t.editKey}"
          value="${currentAmt.toFixed(2)}" step="0.01"
          style="width:55px; padding:1px 3px; border:1px solid #6ee7b7; border-radius:4px; font-size:11px; text-align:right; background:rgba(255,255,255,0.7);"
          onclick="event.stopPropagation()">`;
        html += '</div>';
      } else if (t.zoneBased) {
        // Zone-based surcharges - just a toggle, no single editable amount
        const isOn = activeSurcharges[t.key] || false;
        html += `<button class="rd-surcharge-toggle" data-key="${t.key}" style="
          padding:6px 12px; border:1px solid ${isOn ? '#059669' : '#d1d5db'}; border-radius:16px;
          font-size:12px; font-weight:500; cursor:pointer;
          background:${isOn ? '#d1fae5' : 'white'}; color:${isOn ? '#065f46' : '#6b7280'};
          transition: all 0.2s;
        ">${isOn ? '✓' : '○'} ${t.label} (zone)</button>`;
      } else {
        // Normal toggle with editable amount
        const isOn = activeSurcharges[t.key] || false;
        const editKey = `${carrierId}-${t.editKey}`;
        const currentAmt = editedSurcharges[editKey] !== undefined ? editedSurcharges[editKey] : (t.amount || 0);
        html += `<div style="display:inline-flex; align-items:center; gap:4px; padding:4px 6px 4px 10px; border:1px solid ${isOn ? '#059669' : '#d1d5db'}; border-radius:16px;
          background:${isOn ? '#d1fae5' : 'white'};">`;
        html += `<button class="rd-surcharge-toggle" data-key="${t.key}" style="
          border:none; background:transparent; cursor:pointer; font-size:12px; font-weight:500;
          color:${isOn ? '#065f46' : '#6b7280'}; padding:0;
        ">${isOn ? '✓' : '○'} ${t.label}</button>`;
        html += `<span style="color:${isOn ? '#065f46' : '#9ca3af'};">$</span>`;
        html += `<input type="number" class="rd-surcharge-amount" data-carrier="${carrierId}" data-edit-key="${t.editKey}"
          value="${currentAmt.toFixed(2)}" step="0.01"
          style="width:55px; padding:1px 3px; border:1px solid ${isOn ? '#6ee7b7' : '#e5e7eb'}; border-radius:4px; font-size:11px; text-align:right;
          background:${isOn ? 'rgba(255,255,255,0.7)' : '#f9fafb'}; color:${isOn ? '#065f46' : '#9ca3af'};"
          onclick="event.stopPropagation()">`;
        html += '</div>';
      }
    }

    html += '</div>';
    return html;
  }

  function renderRateMatrix(carrierId, config, isOunce) {
    const zones = isOunce
      ? (config.ounceRates?.zones || config.zones || [])
      : (config.baseRates?.zones || config.zones || []);

    let weights = [];
    let rates = [];

    if (isOunce) {
      rates = config.ounceRates?.rates || [];
      for (let i = 0; i < rates.length; i++) weights.push(i + 1);
    } else {
      rates = config.baseRates?.rates || [];
      const weightStart = config.baseRates?.weightStart || config.minWeight || 1;
      for (let i = 0; i < rates.length; i++) weights.push(weightStart + i);
    }

    if (zones.length === 0 || weights.length === 0) {
      return '<p style="color:#999; font-size:13px;">无费率数据</p>';
    }

    const tableId = `rd-matrix-${carrierId}-${isOunce ? 'oz' : 'lb'}`;
    let html = `<div style="max-height:600px; overflow:auto; border-radius:8px; box-shadow:0 1px 4px rgba(0,0,0,0.1);">`;
    html += `<table id="${tableId}" style="border-collapse:collapse; width:100%; font-size:12px;">`;

    // Header
    const headerColor = CARRIER_COLORS[carrierId];
    html += `<thead><tr style="background:${headerColor}; color:white; position:sticky; top:0; z-index:2;">`;
    html += `<th style="padding:10px 8px; border:1px solid rgba(255,255,255,0.2); position:sticky; left:0; background:${headerColor}; z-index:3; min-width:60px;">
      ${isOunce ? 'oz' : 'lbs'} \\ Zone</th>`;
    for (const z of zones) {
      html += `<th style="padding:10px 8px; border:1px solid rgba(255,255,255,0.2); min-width:140px; text-align:center;">Zone ${z}</th>`;
    }
    html += '</tr></thead>';

    // Body
    html += '<tbody>';
    for (let wi = 0; wi < weights.length; wi++) {
      const w = weights[wi];
      html += `<tr>`;
      html += `<td style="padding:8px; border:1px solid #e5e7eb; font-weight:700; background:#f1f5f9; position:sticky; left:0; z-index:1; text-align:center;">
        ${w}${isOunce ? ' oz' : ''}</td>`;

      for (let zi = 0; zi < zones.length; zi++) {
        const zone = zones[zi];
        const origRate = rates[wi]?.[zi];
        const cellKey = `${w}-${zone}`;
        const editedVal = editedRates[cellKey];
        const displayRate = editedVal !== undefined ? editedVal : origRate;
        const isEdited = editedVal !== undefined;

        // Calculate quote price and supplier costs
        const quotePrice = getQuotePrice(carrierId, config, zone, w, isOunce);
        const supplierCosts = calculateSupplierCostForCell(carrierId, zone, w, isOunce);

        html += `<td data-cell="${cellKey}" data-carrier="${carrierId}" data-zone="${zone}" data-weight="${w}" data-is-ounce="${isOunce}"
          style="padding:0; border:1px solid #e5e7eb; vertical-align:top; background:${isEdited ? '#fffbeb' : 'white'};">`;

        // Main cell content: editable base rate + total
        html += `<div style="padding:6px 8px;">`;
        html += `<div style="display:flex; justify-content:space-between; align-items:center;">`;
        html += `<input type="number" class="rd-rate-input" data-cell="${cellKey}" data-wi="${wi}" data-zi="${zi}" data-is-ounce="${isOunce}"
          value="${displayRate !== null && displayRate !== undefined ? parseFloat(displayRate).toFixed(2) : ''}"
          step="0.01" style="width:60px; padding:2px 4px; border:1px solid ${isEdited ? '#f59e0b' : '#e5e7eb'}; border-radius:3px;
          font-size:12px; text-align:right; background:${isEdited ? '#fffbeb' : 'white'};"
          onclick="event.stopPropagation()">`;

        if (quotePrice) {
          html += `<span style="font-weight:700; color:#1d4ed8; font-size:12px;">$${quotePrice.totalCost.toFixed(2)}</span>`;
        }
        html += '</div>';

        // Show surcharge breakdown
        if (quotePrice && quotePrice.surcharges.length > 0) {
          html += `<div style="font-size:10px; color:#6b7280; margin-top:2px;">`;
          html += quotePrice.surcharges.map(s => `${s.name}: $${s.amount.toFixed(2)}`).join(' + ');
          if (quotePrice.fuelAmount > 0) html += ` + Fuel: $${quotePrice.fuelAmount.toFixed(2)}`;
          html += '</div>';
        } else if (quotePrice && quotePrice.fuelAmount > 0) {
          html += `<div style="font-size:10px; color:#6b7280; margin-top:2px;">Fuel: $${quotePrice.fuelAmount.toFixed(2)}</div>`;
        }

        // Always show cost/profit panel (no expand/collapse)
        if (quotePrice) {
          html += renderCostProfitPanel(quotePrice, supplierCosts);
        }

        html += '</div>';
        html += '</td>';
      }
      html += '</tr>';
    }
    html += '</tbody></table></div>';

    return html;
  }

  function renderCostProfitPanel(quotePrice, supplierCosts) {
    if (supplierCosts.length === 0) {
      return `<div style="margin-top:4px; padding:6px; background:#fef2f2; border-radius:4px; font-size:10px; color:#dc2626;">
        无供应商数据</div>`;
    }

    let html = `<div style="margin-top:4px; border-top:1px solid #e5e7eb; padding-top:4px;">`;

    for (const sc of supplierCosts) {
      const profit = Math.round((quotePrice.totalCost - sc.totalCost) * 100) / 100;
      const profitPct = quotePrice.totalCost > 0 ? Math.round((profit / quotePrice.totalCost) * 10000) / 100 : 0;
      const profitColor = profit >= 0 ? '#059669' : '#dc2626';
      const profitBg = profit >= 0 ? '#ecfdf5' : '#fef2f2';

      html += `<div style="padding:4px 6px; margin-bottom:3px; background:${profitBg}; border-radius:4px; font-size:10px;">`;
      html += `<div style="display:flex; justify-content:space-between; align-items:center;">`;
      html += `<span style="font-weight:600; color:#374151; max-width:60px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${sc.name}">${sc.name}</span>`;
      html += `<span style="color:#6b7280;">$${sc.totalCost.toFixed(2)}</span>`;
      html += `<span style="font-weight:700; color:${profitColor};">`;
      html += `${profit >= 0 ? '+' : ''}$${profit.toFixed(2)}`;
      html += `<span style="font-size:9px; opacity:0.8;"> (${profitPct.toFixed(1)}%)</span>`;
      html += '</span>';
      html += '</div>';

      // Breakdown
      html += `<div style="font-size:9px; color:#9ca3af; margin-top:1px;">`;
      html += `Base: $${sc.baseRate.toFixed(2)}`;
      if (sc.pickupFee > 0) html += ` + Pickup: $${sc.pickupFee.toFixed(2)}`;
      if (sc.surchargeTotal > 0) html += ` + SC: $${sc.surchargeTotal.toFixed(2)}`;
      if (sc.fuelAmount > 0) html += ` + Fuel: $${sc.fuelAmount.toFixed(2)}`;
      if (sc.markup > 0) html += ` + Markup: $${sc.markup.toFixed(2)}`;
      html += '</div>';

      html += '</div>';
    }

    html += '</div>';
    return html;
  }

  // ============================================
  // Event Binding
  // ============================================

  function bindEvents() {
    // Carrier tabs
    document.querySelectorAll('.rd-carrier-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        currentCarrier = btn.dataset.carrier;
        currentCarrierConfig = quotePricing.carriers[currentCarrier];
        editedRates = {};
        editedSurcharges = {};
        activeSurcharges = {};
        render();
      });
    });

    // Service type
    const serviceSelect = document.getElementById('rd-service-type');
    if (serviceSelect) {
      serviceSelect.addEventListener('change', () => {
        serviceType = serviceSelect.value;
        render();
      });
    }

    // Fuel rates
    const fuelFedexInput = document.getElementById('rd-fuel-fedex');
    const fuelUpsInput = document.getElementById('rd-fuel-ups');
    if (fuelFedexInput) {
      fuelFedexInput.addEventListener('change', () => {
        fuelRates.fedex = parseFloat(fuelFedexInput.value) || 0;
        render();
      });
    }
    if (fuelUpsInput) {
      fuelUpsInput.addEventListener('change', () => {
        fuelRates.ups = parseFloat(fuelUpsInput.value) || 0;
        render();
      });
    }

    // Surcharge toggles
    document.querySelectorAll('.rd-surcharge-toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.key;
        activeSurcharges[key] = !activeSurcharges[key];
        render();
      });
    });

    // Surcharge amount edits
    document.querySelectorAll('.rd-surcharge-amount').forEach(input => {
      input.addEventListener('change', () => {
        const carrier = input.dataset.carrier;
        const editKey = input.dataset.editKey;
        const val = parseFloat(input.value);
        const fullKey = `${carrier}-${editKey}`;
        if (!isNaN(val)) {
          editedSurcharges[fullKey] = val;
        } else {
          delete editedSurcharges[fullKey];
        }
        render();
      });
      input.addEventListener('click', (e) => e.stopPropagation());
      input.addEventListener('focus', (e) => e.stopPropagation());
    });

    // Rate inputs
    document.querySelectorAll('.rd-rate-input').forEach(input => {
      input.addEventListener('change', () => {
        const cellKey = input.dataset.cell;
        const val = parseFloat(input.value);
        if (!isNaN(val)) {
          editedRates[cellKey] = val;
        } else {
          delete editedRates[cellKey];
        }
        render();
      });
      input.addEventListener('click', (e) => e.stopPropagation());
      input.addEventListener('focus', (e) => e.stopPropagation());
    });
  }

  // ============================================
  // Initialization
  // ============================================

  async function init() {
    await loadData();
    // Default to first enabled carrier
    if (quotePricing?.carriers) {
      for (const cid of CARRIER_ORDER) {
        if (quotePricing.carriers[cid]?.enabled) {
          currentCarrier = cid;
          currentCarrierConfig = quotePricing.carriers[cid];
          break;
        }
      }
    }
    render();
  }

  // Expose init
  window.initRateDebug = init;

})();
