import { useState } from 'react';
import { Phone, Mail, StickyNote, Users, CheckSquare } from 'lucide-react';
import { ContactAvatar } from './ContactAvatar';
import { contacts, deals, activities, accounts, useCases, stageConfig, useCaseStageConfig } from '@/lib/mockData';
import { useAppStore } from '@/store/appStore';

export function StageBadge({ stage }: { stage: keyof typeof stageConfig }) {
  const config = stageConfig[stage];
  return (
    <span
      className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold"
      style={{ backgroundColor: config.color + '18', color: config.color }}
    >
      {config.label}
    </span>
  );
}

export function LeadScoreBadge({ score }: { score: number }) {
  const color = score >= 80 ? 'hsl(152, 55%, 42%)' : score >= 50 ? 'hsl(38, 92%, 50%)' : 'hsl(var(--muted-foreground))';
  return (
    <span
      className="inline-flex items-center justify-center w-8 h-6 rounded-lg text-xs font-mono font-bold"
      style={{ backgroundColor: color + '18', color }}
    >
      {score}
    </span>
  );
}

export function AgentStatusDot() {
  return <div className="w-2.5 h-2.5 rounded-full bg-success animate-pulse-dot" />;
}

// Pipeline health for dashboard with Opportunities / Use Cases toggle
export function PipelineSnapshot() {
  const [view, setView] = useState<'opportunities' | 'use-cases'>('opportunities');

  const dealStages: (keyof typeof stageConfig)[] = ['closed_lost', 'closed_won', 'negotiation', 'proposal', 'qualification', 'prospecting'];
  const ucStages: (keyof typeof useCaseStageConfig)[] = ['sunset', 'scaling', 'production', 'poc', 'discovery'];

  const dealData = dealStages.map((stage) => {
    const stageDeals = deals.filter((d) => d.stage === stage);
    return { key: stage, label: stageConfig[stage].label, color: stageConfig[stage].color, count: stageDeals.length, total: stageDeals.reduce((sum, d) => sum + d.amount, 0) };
  });

  const ucData = ucStages.map((stage) => {
    const stageUCs = useCases.filter((u) => u.stage === stage);
    return { key: stage, label: useCaseStageConfig[stage].label, color: useCaseStageConfig[stage].color, count: stageUCs.length, total: stageUCs.reduce((sum, u) => sum + u.attributedARR, 0) };
  });

  const data = view === 'opportunities' ? dealData : ucData;
  const maxTotal = Math.max(...data.map((s) => s.total), 1);
  const valueLabel = view === 'opportunities' ? (v: number) => `$${(v / 1000).toFixed(0)}K` : (v: number) => v > 0 ? `$${(v / 1000).toFixed(0)}K ARR` : '$0';

  return (
    <div className="bg-card border border-border rounded-2xl p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-display font-bold text-foreground">Pipeline health</h3>
        <div className="flex items-center gap-0.5 bg-muted rounded-lg p-0.5">
          <button
            onClick={() => setView('opportunities')}
            className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all ${view === 'opportunities' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
          >
            Opps
          </button>
          <button
            onClick={() => setView('use-cases')}
            className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all ${view === 'use-cases' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
          >
            Use Cases
          </button>
        </div>
      </div>
      {/* Mobile: horizontal scroll cards */}
      <div className="flex gap-3 overflow-x-auto no-scrollbar md:hidden pb-1 -mx-1 px-1">
        {data.map((s) => (
          <div
            key={s.key}
            className="flex-shrink-0 w-28 rounded-xl p-3 border border-border"
            style={{ backgroundColor: s.color + '08' }}
          >
            <div className="w-3 h-3 rounded-full mb-2" style={{ backgroundColor: s.color }} />
            <p className="text-[10px] text-muted-foreground font-medium truncate">{s.label}</p>
            <p className="text-lg font-display font-bold text-foreground">{s.count}</p>
            <p className="text-[10px] text-muted-foreground font-mono">{valueLabel(s.total)}</p>
          </div>
        ))}
      </div>
      {/* Desktop: bars */}
      <div className="hidden md:block space-y-3">
        {data.map((s) => (
          <div key={s.key} className="flex items-center gap-3">
            <span className="text-xs w-28 truncate font-medium" style={{ color: s.color }}>{s.label}</span>
            <div className="flex-1 h-2.5 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{ width: `${(s.total / maxTotal) * 100}%`, backgroundColor: s.color }}
              />
            </div>
            <span className="text-xs text-muted-foreground font-mono w-8 text-right">{s.count}</span>
            <span className="text-xs text-foreground font-mono w-16 text-right">{valueLabel(s.total)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Account Health widget
export function AccountHealth() {
  const green = accounts.filter(a => a.healthScore >= 80);
  const yellow = accounts.filter(a => a.healthScore >= 50 && a.healthScore < 80);
  const red = accounts.filter(a => a.healthScore < 50);
  const total = accounts.length;

  const segments = [
    { label: 'Healthy', count: green.length, color: 'hsl(152, 55%, 42%)', bg: 'hsl(152, 55%, 42%)' },
    { label: 'At Risk', count: yellow.length, color: 'hsl(38, 92%, 50%)', bg: 'hsl(38, 92%, 50%)' },
    { label: 'Critical', count: red.length, color: 'hsl(var(--destructive))', bg: 'hsl(var(--destructive))' },
  ];

  return (
    <div className="bg-card border border-border rounded-2xl p-5 shadow-sm">
      <h3 className="font-display font-bold text-foreground mb-4">Account health</h3>
      {/* Mobile: horizontal scroll cards */}
      <div className="flex gap-3 overflow-x-auto no-scrollbar md:hidden pb-1 -mx-1 px-1">
        {segments.map((s) => (
          <div
            key={s.label}
            className="flex-shrink-0 w-28 rounded-xl p-3 border border-border"
            style={{ backgroundColor: s.bg + '08' }}
          >
            <div className="w-3 h-3 rounded-full mb-2" style={{ backgroundColor: s.color }} />
            <p className="text-[10px] text-muted-foreground font-medium truncate">{s.label}</p>
            <p className="text-lg font-display font-bold text-foreground">{s.count}</p>
            <p className="text-[10px] text-muted-foreground font-mono">{total > 0 ? Math.round((s.count / total) * 100) : 0}%</p>
          </div>
        ))}
      </div>
      {/* Desktop: bars */}
      <div className="hidden md:block space-y-3">
        {segments.map((s) => (
          <div key={s.label} className="flex items-center gap-3">
            <span className="text-xs w-28 truncate font-medium" style={{ color: s.color }}>{s.label}</span>
            <div className="flex-1 h-2.5 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{ width: total > 0 ? `${(s.count / total) * 100}%` : '0%', backgroundColor: s.color }}
              />
            </div>
            <span className="text-xs text-muted-foreground font-mono w-8 text-right">{s.count}</span>
            <span className="text-xs text-foreground font-mono w-16 text-right">{total > 0 ? Math.round((s.count / total) * 100) : 0}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function CommissionTracker() {
  const closedDeals = deals.filter((d) => d.stage === 'closed_won');
  const totalClosed = closedDeals.reduce((sum, d) => sum + d.amount, 0);
  const commission = totalClosed * 0.03;
  const goal = 100000;
  const progress = Math.min((commission / goal) * 100, 100);

  return (
    <div className="bg-card border border-border rounded-2xl p-5 shadow-sm">
      <h3 className="font-display font-bold text-foreground mb-4">Commission tracker</h3>
      <div className="flex items-center justify-center mb-4">
        <div className="relative w-32 h-32">
          <svg className="w-32 h-32 transform -rotate-90" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="40" fill="none" stroke="hsl(var(--muted))" strokeWidth="8" />
            <circle
              cx="50" cy="50" r="40" fill="none"
              stroke="hsl(var(--primary))"
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={`${progress * 2.51} 251`}
              className="transition-all duration-1000"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-xl font-display font-extrabold text-foreground">${(commission / 1000).toFixed(1)}K</span>
            <span className="text-[10px] text-muted-foreground">of ${(goal / 1000).toFixed(0)}K goal</span>
          </div>
        </div>
      </div>
      <div className="text-center">
        <p className="text-xs text-muted-foreground">Closed volume this month</p>
        <p className="text-sm font-display font-bold text-foreground mt-0.5">${(totalClosed / 1000).toFixed(0)}K</p>
      </div>
    </div>
  );
}

// Activity feed
export function ActivityFeed({ limit, activities: activitiesProp }: { limit?: number; activities?: typeof activities }) {
  const allItems = activitiesProp ?? activities;
  const items = limit ? allItems.slice(0, limit) : allItems;
  const { openDrawer } = useAppStore();

  const typeIcon = (type: string) => {
    const cls = "w-4 h-4 text-muted-foreground";
    switch (type) {
      case 'call': return <Phone className={cls} />;
      case 'email': return <Mail className={cls} />;
      case 'meeting': return <Users className={cls} />;
      case 'note': return <StickyNote className={cls} />;
      case 'task': return <CheckSquare className={cls} />;
      default: return <StickyNote className={cls} />;
    }
  };

  const timeAgo = (ts: string) => {
    const diff = Date.now() - new Date(ts).getTime();
    const hours = Math.floor(diff / 3600000);
    if (hours < 1) return 'just now';
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  return (
    <div className="space-y-1">
      {items.map((a) => (
        <div
          key={a.id}
          className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-muted/50 cursor-pointer transition-colors press-scale"
          onClick={() => openDrawer('contact', a.contactId)}
        >
          <span className="flex-shrink-0">{typeIcon(a.type)}</span>
          <ContactAvatar name={a.contactName} className="w-7 h-7 rounded-full text-[10px]" />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-foreground">
              <span className="font-semibold">{a.contactName}</span>
            </p>
            <p className="text-xs text-muted-foreground truncate">{a.description}</p>
          </div>
          <span className="text-[10px] text-muted-foreground flex-shrink-0 mt-1">{timeAgo(a.timestamp)}</span>
        </div>
      ))}
    </div>
  );
}
