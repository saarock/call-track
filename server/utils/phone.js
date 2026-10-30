// Nepal is the company default. Other countries must supply an explicit country code.
export function normalizePhone(value) {
  if (typeof value !== "string" && typeof value !== "number") return value;
  let number = String(value).trim().replace(/[\s().-]/g, "");
  if (number.startsWith("00")) number = "+" + number.slice(2);
  if (/^9[678]\d{8}$/.test(number)) number = "+977" + number;
  else if (/^977\d{8,10}$/.test(number)) number = "+" + number;
  else if (/^0[1-9]\d{7,8}$/.test(number)) number = "+977" + number.slice(1);
  return number;
}
