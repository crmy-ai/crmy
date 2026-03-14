import { deals, activities, stageConfig } from '@/lib/mockData';
import { ContactAvatar } from './ContactAvatar';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '@/store/appStore';
import { StageBadge } from './CrmWidgets';
import { Sparkles } from 'lucide-react';

export function DealDrawer() {
  const { drawerEntityId, openAIWithContext, closeDrawer } = useAppStore();
  const navigate = useNavigate();
  const deal = deals.find((d) => d.id === drawerEntityId);
  if (!deal) return <div className="p-4 text-muted-foreground">Deal not found</div>;

  const dealActivities = activities.filter((a) => a.dealId === deal.id);

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="p-6 border-b border-border">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="font-display font-extrabold text-xl text-foreground">{deal.name}</h2>
            <div className="flex items-center gap-3 mt-2">
              <span className="text-2xl font-display font-extrabold gradient-text">${(deal.amount / 1000).toFixed(0)}K</span>
              <StageBadge stage={deal.stage} />
              <span className="text-xs text-muted-foreground">{deal.probability}%</span>
            </div>
          </div>
          <button
            onClick={() => { openAIWithContext({ type: 'deal', id: deal.id, name: deal.name, detail: `$${(deal.amount / 1000).toFixed(0)}K` }); closeDrawer(); navigate('/agent'); }}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-accent/30 bg-accent/5 text-accent text-sm font-semibold hover:bg-accent/10 transition-all press-scale"
          >
            <Sparkles className="w-3.5 h-3.5" /> Edit
          </button>
        </div>
        {deal.property && <p className="text-sm text-muted-foreground mt-2">📍 {deal.property}</p>}
        <div className="flex items-center gap-2 mt-2">
          <ContactAvatar name={deal.contactName} className="w-6 h-6 rounded-full text-[9px]" />
          <span className="text-sm text-foreground font-medium">{deal.contactName}</span>
          {deal.daysInStage > 14 && (
            <span className="px-2 py-0.5 rounded-lg text-xs bg-destructive/15 text-destructive font-semibold">{deal.daysInStage}d stale</span>
          )}
        </div>
      </div>

      {/* AI Next Step */}
      <div className="p-4 mx-4 mt-4 rounded-2xl bg-gradient-to-br from-primary/10 to-primary/5 border border-primary/15">
        <div className="flex items-center gap-2 mb-2">
          <Sparkles className="w-4 h-4 text-primary" />
          <span className="text-xs font-display font-bold text-primary">AI suggested next step</span>
        </div>
        <p className="text-sm text-foreground">
          {deal.stage === 'negotiation'
            ? `Follow up on inspection results and confirm closing timeline with ${deal.contactName}.`
            : deal.stage === 'proposal'
            ? `Check application status and share pre-approval update with ${deal.contactName}.`
            : `Schedule a follow-up call with ${deal.contactName} to discuss next steps.`
          }
        </p>
        <button className="mt-3 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-all press-scale">
          Take Action
        </button>
      </div>

      {/* Notes */}
      <div className="p-4 mx-4 mt-4">
        <h3 className="text-xs font-display font-bold text-muted-foreground mb-2">Notes</h3>
        <p className="text-sm text-foreground">{deal.notes}</p>
      </div>

      {/* Timeline */}
      <div className="p-4 mx-4 mt-4 mb-6">
        <h3 className="text-xs font-display font-bold text-muted-foreground mb-3">Activity</h3>
        <div className="space-y-3">
          {dealActivities.map((a) => (
            <div key={a.id} className="flex gap-3">
              <div className="w-7 h-7 rounded-xl bg-muted flex items-center justify-center text-xs flex-shrink-0">
                {a.type === 'call' ? '📞' : a.type === 'email' ? '✉️' : a.type === 'meeting' ? '🤝' : a.type === 'task' ? '✅' : '📝'}
              </div>
              <div>
                <p className="text-sm text-foreground">{a.description}</p>
                <p className="text-xs text-muted-foreground">{new Date(a.timestamp).toLocaleDateString()}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
