/**
 * Part A3 evidence — the planted voucher-dilution bug (files 07 / 08 / 09).
 *
 * Both implementations are transcribed verbatim from the Part A markdown into
 * this file so that the arithmetic in the hand trace and the diagnosis is
 * produced by running code, not by assertion. The `applyTieredDiscount_BUGGED`
 * body is byte-identical to the snippet in
 * part-a/07_bugged_coupon_calculator_actual.md.
 */
import { check, finishAndExit, header, note } from "./_bootstrap.js";

header(
  "PART A3 EVIDENCE: planted voucher-dilution bug — both implementations executed",
  "part-a/07_bugged_coupon_calculator_actual.md and part-a/08_bugged_coupon_calculator_intended.md"
);

// ---- transcribed verbatim from part-a/07 ----
function applyTieredDiscount_BUGGED(
  subtotalKobo: number,
  percentageDiscount: number,
  fixedVoucherKobo: number
): number {
  if (subtotalKobo <= 0) return 0;
  const afterVoucher = subtotalKobo - fixedVoucherKobo;
  const discountMultiplier = (100 - percentageDiscount) / 100;
  const finalTotal = afterVoucher * discountMultiplier;
  return Math.max(0, Math.round(finalTotal));
}

// ---- transcribed verbatim from part-a/09 (the corrected implementation) ----
function applyTieredDiscount_FIXED(
  subtotalKobo: number,
  percentageDiscount: number,
  fixedVoucherKobo: number
): number {
  if (subtotalKobo <= 0) return 0;
  const percentageDeduction = Math.round(
    (subtotalKobo * Math.min(Math.max(percentageDiscount, 0), 100)) / 100
  );
  const discountedSubtotal = subtotalKobo - percentageDeduction;
  const remainingTotal = discountedSubtotal - Math.max(fixedVoucherKobo, 0);
  return Math.max(0, remainingTotal);
}

const SUBTOTAL = 100_000; // 1,000 NGN
const PCT = 20;
const VOUCHER = 50_000; // 500 NGN

console.log("--- The worked example from part-a/09 section 3, executed ---");
console.log(`  inputs: subtotalKobo=${SUBTOTAL}  percentageDiscount=${PCT}  fixedVoucherKobo=${VOUCHER}`);

const afterVoucher = SUBTOTAL - VOUCHER;
const buggedRaw = afterVoucher * ((100 - PCT) / 100);
const bugged = applyTieredDiscount_BUGGED(SUBTOTAL, PCT, VOUCHER);
console.log(`  BUGGED  afterVoucher        = ${SUBTOTAL} - ${VOUCHER} = ${afterVoucher}`);
console.log(`  BUGGED  finalTotal          = ${afterVoucher} * ${(100 - PCT) / 100} = ${buggedRaw}`);
console.log(`  BUGGED  returned            = ${bugged} kobo (₦${bugged / 100})`);

const pctDeduction = Math.round((SUBTOTAL * Math.min(Math.max(PCT, 0), 100)) / 100);
const discounted = SUBTOTAL - pctDeduction;
const fixedRaw = discounted - Math.max(VOUCHER, 0);
const fixed = applyTieredDiscount_FIXED(SUBTOTAL, PCT, VOUCHER);
console.log(`  FIXED   percentageDeduction = ${SUBTOTAL} * ${PCT / 100} = ${pctDeduction}`);
console.log(`  FIXED   discountedSubtotal  = ${SUBTOTAL} - ${pctDeduction} = ${discounted}`);
console.log(`  FIXED   remainingTotal      = ${discounted} - ${VOUCHER} = ${fixedRaw}`);
console.log(`  FIXED   returned            = ${fixed} kobo (₦${fixed / 100})`);

check("bugged result", bugged, 40_000);
check("fixed result", fixed, 30_000);
check("customer lost 10000 kobo of voucher face value", bugged - fixed, 10_000);
console.log(`  effective total discount, bugged = ${SUBTOTAL - bugged} kobo`);
console.log(`  effective total discount, fixed  = ${SUBTOTAL - fixed} kobo`);
check("bugged effective discount", SUBTOTAL - bugged, 60_000);
check("fixed effective discount", SUBTOTAL - fixed, 70_000);
console.log("");

console.log("--- Voucher dilution across a sweep of voucher face values ---");
console.log("  subtotal=100000 kobo, 20% off; voucher face value vs value actually delivered");
console.log("  voucher |  buggy fee |  fixed fee |  face value lost by the customer");
for (const v of [10_000, 20_000, 30_000, 50_000, 80_000, 100_000, 150_000]) {
  const b = applyTieredDiscount_BUGGED(SUBTOTAL, PCT, v);
  const f = applyTieredDiscount_FIXED(SUBTOTAL, PCT, v);
  const deliveredFaceValue = SUBTOTAL - pctDeduction - b;
  const lost = v - deliveredFaceValue;
  console.log(
    `  ${String(v).padStart(7)} | ${String(b).padStart(10)} | ${String(f).padStart(10)} | ${String(lost).padStart(6)}`
  );
}
{
  const b = applyTieredDiscount_BUGGED(SUBTOTAL, PCT, 50_000);
  const deliveredFaceValue = SUBTOTAL - pctDeduction - b;
  check("500 NGN voucher delivers only 400 NGN of face value under the bug", deliveredFaceValue, 40_000);
}
console.log("");

console.log("--- The non-negative floor masks the bug at extreme voucher values ---");
for (const v of [80_001, 100_001, 200_000]) {
  const b = applyTieredDiscount_BUGGED(SUBTOTAL, PCT, v);
  const f = applyTieredDiscount_FIXED(SUBTOTAL, PCT, v);
  console.log(`  voucher=${String(v).padStart(7)} -> buggy=${String(b).padStart(7)} fixed=${String(f).padStart(7)}`);
}
check(
  "for voucher > subtotal the floor clamps both to 0, so the two agree and the bug hides",
  [
    applyTieredDiscount_BUGGED(SUBTOTAL, PCT, 200_000),
    applyTieredDiscount_FIXED(SUBTOTAL, PCT, 200_000),
  ],
  [0, 0]
);
console.log("");

console.log("--- Precondition enforcement declared in FAILS WHEN, versus what the code does ---");
{
  // part-a/08 FAILS WHEN declares percentageDiscount < 0 or > 100, and
  // fixedVoucherKobo < 0. The corrected implementation clamps rather than throws.
  const cases: Array<[string, number, number, number]> = [
    ["percentageDiscount = 150 (declared FAILS WHEN)", SUBTOTAL, 150, 50_000],
    ["percentageDiscount = -10 (declared FAILS WHEN)", SUBTOTAL, -10, 50_000],
    ["fixedVoucherKobo = -50_000 (declared FAILS WHEN)", SUBTOTAL, 20, -50_000],
  ];
  for (const [label, s, p, v] of cases) {
    let threw = false;
    let out = "";
    try {
      out = String(applyTieredDiscount_FIXED(s, p, v));
    } catch {
      threw = true;
    }
    console.log(`  ${label}: threw=${threw} result=${out}`);
  }
  check("out-of-range discount clamps to 100% and floors the total at 0", applyTieredDiscount_FIXED(SUBTOTAL, 150, 50_000), 0);
  check("negative discount clamps to 0%, so only the voucher applies", applyTieredDiscount_FIXED(SUBTOTAL, -10, 50_000), 50_000);
  check("negative voucher clamps to 0, so only the 20% applies", applyTieredDiscount_FIXED(SUBTOTAL, 20, -50_000), 80_000);
  note(
    "Resolution applied to part-a/08 and part-a/09",
    "FAILS WHEN no longer declares conditions the code does not enforce; the clamp behaviour is now stated as an explicit step instead."
  );
}

finishAndExit("partA3 coupon dilution bug");
