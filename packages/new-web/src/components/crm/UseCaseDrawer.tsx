import { useCases, useCaseStageConfig, contacts } from '@/lib/mockData';
import { ContactAvatar } from './ContactAvatar';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '@/store/appStore';
import { Sparkles } from 'lucide-react';

export function UseCaseDrawer() {
  const { drawerEntityId, openAIWithContext, closeDrawer } = useAppStore();
  const navigate = useNavigate();
  const uc = useCases.find((u) => u.id === drawerEntityId);
  if (!uc) return <div className="p-4 text-muted-foreground">Use case not found</div>;

  const stages = ['discovery', 'poc', 'production', 'scaling', 'sunset'] as const;
  const currentIdx = stages.indexOf(uc.stage);
  const linkedContacts = contacts.filter((c) => uc.contactIds.includes(c.id));

  return (
    <div className="flex flex-col">
      <div className="p-6 border-b border-border">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="font-display font-bold text-xl text-foreground">{uc.name}</h2>
            <p className="text-sm text-muted-foreground mt-1">{uc.client}</p>
            {uc.attributedARR > 0 && (
              <p className="text-2xl font-display font-bold text-primary mt-2">${(uc.attributedARR / 1000).toFixed(0)}K <span className="text-sm text-muted-foreground font-normal">ARR</span></p>
            )}
          </div>
          <button
            onClick={() => { openAIWithContext({ type: 'use-case', id: uc.id, name: uc.name, detail: uc.client }); closeDrawer(); navigate('/agent'); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-accent/30 bg-accent/5 text-accent text-sm hover:bg-accent/10 transition-colors"
          >
            <Sparkles className="w-3.5 h-3.5" /> Edit
          </button>
        </div>
      </div>

      {/* Lifecycle rail */}
      <div className="px-6 py-4">
        <div className="flex items-center gap-1">
          {stages.map((stage, i) => {
            const config = useCaseStageConfig[stage];
            const isActive = i <= currentIdx;
            return (
              <div key={stage} className="flex-1 flex flex-col items-center gap-1">
                <div
                  className={`h-2 w-full rounded-full transition-colors ${isActive ? '' : 'bg-muted'}`}
                  style={isActive ? { backgroundColor: config.color } : undefined}
                />
                <span className="text-xs text-muted-foreground">{config.label}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="p-4 mx-4">
        <h3 className="text-xs font-mono text-muted-foreground uppercase tracking-wider mb-2">Description</h3>
        <p className="text-sm text-foreground">{uc.description}</p>
      </div>

      <div className="p-4 mx-4">
        <h3 className="text-xs font-mono text-muted-foreground uppercase tracking-wider mb-2">Linked Contacts</h3>
        <div className="space-y-2">
          {linkedContacts.map((c) => (
            <div key={c.id} className="flex items-center gap-2">
              <ContactAvatar name={c.name} className="w-6 h-6 rounded-full text-[10px]" />
              <span className="text-sm text-foreground">{c.name}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="p-4 mx-4 mt-2 rounded-lg border-l-4 border-accent bg-accent/5">
        <div className="flex items-center gap-2 mb-2">
          <Sparkles className="w-4 h-4 text-accent" />
          <span className="text-xs font-display font-semibold text-accent">AI Analysis</span>
        </div>
        <p className="text-sm text-foreground">
          {uc.stage === 'production' || uc.stage === 'scaling'
            ? `This use case is performing well with $${(uc.attributedARR / 1000).toFixed(0)}K attributed ARR over ${uc.daysActive} days. Continue nurturing the relationship and look for expansion opportunities.`
            : `This use case is in early stages. Focus on demonstrating value and establishing clear success metrics to move to the next stage.`
          }
        </p>
        <button className="mt-2 text-xs text-accent hover:underline">Regenerate</button>
      </div>
    </div>
  );
}
