export function normalizeHttpsUrl(input: string) {
  const raw = String(input || "").trim();
  if (!raw) return "";

  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const parsed = new URL(withScheme);

  if (parsed.protocol !== "https:") {
    throw new Error("URL website wajib menggunakan https://");
  }

  if (!parsed.hostname || !parsed.hostname.includes(".")) {
    throw new Error("Domain website tidak valid.");
  }

  parsed.hash = "";

  return parsed.toString();
}

export function parseDomains(input: string) {
  return String(input || "")
    .split(/[\n,]/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .map((item) => item.replace(/^https?:\/\//i, "").split("/")[0])
    .filter((item, index, arr) => item.includes(".") && arr.indexOf(item) === index);
}

export function domainFromUrl(url: string) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function domainsToText(domains: any) {
  if (!domains) return "";
  if (Array.isArray(domains)) return domains.join("\n");
  if (typeof domains === "object") return Object.values(domains).map(String).join("\n");
  return "";
}
