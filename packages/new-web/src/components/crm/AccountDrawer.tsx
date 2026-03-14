import { accounts, contacts, accountStageConfig } from '@/lib/mockData';
import { ContactAvatar } from './ContactAvatar';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '@/store/appStore';
import { Sparkles, Globe, Users, DollarSign, Building, Heart } from 'lucide-react';

function HealthBadge({ score }: { score: number }) {
  const color = score >= 80 ? 'text-green-400 bg-green-500/15' : score >= 50 ? 'text-yellow-400 bg-yellow-500/15' : 'text-red-400 bg-red-500/15';
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${color}`}>
      <Heart className="w-3 h-3" /> {score}
    </span>
  );
}

function StageBadge({ stage }: { stage: string }) {
  const config = accountStageConfig[stage as keyof typeof accountStageConfig];
  if (!config) return null;
  return (
    <span
      className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold border"
      style={{ borderColor: config.color, color: config.color, backgroundColor: `${config.color}15` }}
    >
      {config.label}
    </span>
  );
}

function formatRevenue(revenue: number) {
  if (revenue >= 1000000) return `$${(revenue / 1000000).toFixed(1)}M`;
  if (revenue >= 1000) return `$${(revenue / 1000).toFixed(0)}K`;
  return `$${revenue}`;
}

export function AccountDrawer() {
  const { drawerEntityId, openAIWithContext, closeDrawer } = useAppStore();
  const navigate = useNavigate();
  const account = accounts.find((a) => a.id === drawerEntityId);
  if (!account) return <div className="p-4 text-muted-foreground">Account not found</div>;

  const parentAccount = account.parentAccountId ? accounts.find(a => a.id === account.parentAccountId) : null;
  const accountContacts = contacts.filter(c => account.contactIds.includes(c.id));

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="p-6 border-b border-border">
        <div className="flex items-start gap-4">
          <img src={account.logo} alt="" className="w-14 h-14 rounded-2xl" />
          <div className="flex-1">
            <h2 className="font-display font-extrabold text-xl text-foreground">{account.name}</h2>
            <p className="text-sm text-muted-foreground">{account.industry}</p>
            <div className="flex items-center gap-2 mt-2">
              <StageBadge stage={account.stage} />
              <HealthBadge score={account.healthScore} />
            </div>
          </div>
        </div>
        <div className="flex gap-2 mt-4">
          <a href={`https://${account.website}`} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-all press-scale">
            <Globe className="w-3.5 h-3.5" /> Website
          </a>
          <button
            onClick={() => { openAIWithContext({ type: 'account', id: account.id, name: account.name, detail: account.industry }); closeDrawer(); navigate('/agent'); }}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-accent/30 bg-accent/5 text-accent text-sm font-semibold hover:bg-accent/10 transition-all ml-auto press-scale"
          >
            <Sparkles className="w-3.5 h-3.5" /> Edit
          </button>
        </div>
      </div>

      {/* AI Summary */}
      <div className="p-4 mx-4 mt-4 rounded-2xl border-l-4 border-accent bg-accent/5">
        <div className="flex items-center gap-2 mb-2">
          <Sparkles className="w-4 h-4 text-accent" />
          <span className="text-xs font-display font-bold text-accent">AI Summary</span>
        </div>
        <p className="text-sm text-foreground leading-relaxed">{account.aiSummary}</p>
        <button className="mt-2 text-xs text-accent font-semibold hover:underline">Regenerate</button>
      </div>

      {/* Details */}
      <div className="p-4 mx-4 mt-4 space-y-3">
        <h3 className="text-xs font-display font-bold text-muted-foreground">Details</h3>
        {[
          { label: 'Health Score', value: `${account.healthScore}/100` },
          { label: 'Industry', value: account.industry },
          { label: 'Employees', value: account.employeeCount.toLocaleString() },
          { label: 'Annual Revenue', value: formatRevenue(account.revenue) },
          { label: 'Currency', value: account.currencyCode },
          { label: 'Website', value: account.website },
          { label: 'Parent Account', value: parentAccount?.name ?? '—' },
        ].map((field) => (
          <div key={field.label} className="flex items-center justify-between group">
            <span className="text-xs text-muted-foreground">{field.label}</span>
            <span className="text-sm text-foreground">{field.value}</span>
          </div>
        ))}

        {/* Tags */}
        {account.tags.length > 0 && (
          <div className="pt-2">
            <span className="text-xs text-muted-foreground block mb-1.5">Tags</span>
            <div className="flex items-center gap-1.5 flex-wrap">
              {account.tags.map((tag) => (
                <span key={tag} className="px-2.5 py-1 rounded-lg bg-muted text-xs text-muted-foreground font-medium">{tag}</span>
              ))}
            </div>
          </div>
        )}

        {/* Custom Fields */}
        {account.customFields && Object.keys(account.customFields).length > 0 && (
          <div className="pt-2 space-y-3">
            <h3 className="text-xs font-display font-bold text-muted-foreground">Custom Fields</h3>
            {Object.entries(account.customFields).map(([key, value]) => (
              <div key={key} className="flex items-center justify-between group">
                <span className="text-xs text-muted-foreground">{key}</span>
                <span className="text-sm text-foreground">{value}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Contacts */}
      <div className="p-4 mx-4 mt-4 mb-6">
        <h3 className="text-xs font-display font-bold text-muted-foreground mb-3">
          <span className="inline-flex items-center gap-1"><Users className="w-3 h-3" /> Contacts ({accountContacts.length})</span>
        </h3>
        <div className="space-y-2">
          {accountContacts.map((c) => (
            <div key={c.id} className="flex items-center gap-3 p-2 rounded-xl hover:bg-muted/50 transition-colors cursor-pointer">
              <ContactAvatar name={c.name} className="w-8 h-8 text-xs" />
              <div>
                <p className="text-sm font-semibold text-foreground">{c.name}</p>
                <p className="text-xs text-muted-foreground">{c.email}</p>
              </div>
            </div>
          ))}
          {accountContacts.length === 0 && (
            <p className="text-sm text-muted-foreground">No contacts linked</p>
          )}
        </div>
      </div>
    </div>
  );
}
