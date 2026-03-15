import { cn } from '@/lib/utils';

const AVATAR_COLORS: { bg: string; dark?: boolean }[] = [
  { bg: '#FB990C' },   // primary
  { bg: '#F8BB59' },   // primary light
  { bg: '#C94408' },   // primary deep
  { bg: '#FDBA74', dark: true },  // warm peach
  { bg: '#F59E0B' },   // amber
  { bg: '#EA580C' },   // burnt orange
  { bg: '#FED7AA', dark: true },  // warm cream
  { bg: '#FCF1C1', dark: true },  // primary pale
];

function hashName(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash);
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return (parts[0]?.[0] ?? '?').toUpperCase();
}

interface ContactAvatarProps {
  name: string;
  className?: string;
  textClassName?: string;
}

export function ContactAvatar({ name, className, textClassName }: ContactAvatarProps) {
  const safeName = name || '?';
  const entry = AVATAR_COLORS[hashName(safeName) % AVATAR_COLORS.length];
  const initials = getInitials(safeName);

  return (
    <div
      className={cn('flex items-center justify-center flex-shrink-0 rounded-xl', className)}
      style={{ backgroundColor: entry.bg }}
    >
      <span className={cn('font-display font-bold select-none', entry.dark ? 'text-[#2A2A2E]' : 'text-white', textClassName)}>
        {safeName === '?' ? '?' : initials}
      </span>
    </div>
  );
}
