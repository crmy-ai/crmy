import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

function trimTrailingZero(value: string) {
  return value.endsWith('.0') ? value.slice(0, -2) : value;
}

export function formatCompactCurrency(value: number, currencySymbol = '$'): string {
  if (!Number.isFinite(value) || value === 0) return `${currencySymbol}0`;
  const sign = value < 0 ? '-' : '';
  const absolute = Math.abs(value);

  if (absolute < 1_000) {
    return `${sign}${currencySymbol}${Math.round(absolute).toLocaleString()}`;
  }

  if (absolute < 1_000_000) {
    const scaled = absolute / 1_000;
    const decimals = scaled < 100 ? 1 : 0;
    return `${sign}${currencySymbol}${trimTrailingZero(scaled.toFixed(decimals))}K`;
  }

  const scaled = absolute / 1_000_000;
  const decimals = scaled < 100 ? 1 : 0;
  return `${sign}${currencySymbol}${trimTrailingZero(scaled.toFixed(decimals))}M`;
}
