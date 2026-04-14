export function parseMoneyToNumber(value) {
  if (value === null || value === undefined) return 0;

  let str = String(value).trim();
  if (!str) return 0;

  str = str
    .replace(/EUR/gi, "")
    .replace(/€/g, "")
    .replace(/\u00A0/g, " ")
    .trim();

  // enlève espaces
  str = str.replace(/\s+/g, "");

  const hasComma = str.includes(",");
  const hasDot = str.includes(".");

  if (hasComma && hasDot) {
    // ex: 12,000.00 ou 12.000,00
    if (str.lastIndexOf(",") > str.lastIndexOf(".")) {
      // format FR: 12.000,00
      str = str.replace(/\./g, "");
      str = str.replace(",", ".");
    } else {
      // format EN: 12,000.00
      str = str.replace(/,/g, "");
    }
  } else if (hasComma && !hasDot) {
    // 12000,00
    str = str.replace(",", ".");
  } else {
    // 12000.00 ou 12000
    str = str;
  }

  const num = Number(str);
  return Number.isFinite(num) ? num : 0;
}