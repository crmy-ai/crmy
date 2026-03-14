import { contacts, activities, stageConfig } from '@/lib/mockData';
import { ContactAvatar } from './ContactAvatar';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '@/store/appStore';
import { StageBadge, LeadScoreBadge } from './CrmWidgets';
import { Phone, Mail, StickyNote, Sparkles } from 'lucide-react';

export function ContactDrawer() {
  const { drawerEntityId, openAIWithContext, closeDrawer } = useAppStore();
  const navigate = useNavigate();
  const contact = contacts.find((c) => c.id === drawerEntityId);
  if (!contact) return <div className="p-4 text-muted-foreground">Contact not found</div>;

  const contactActivities = activities.filter((a) => a.contactId === contact.id);

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="p-6 border-b border-border">
        <div className="flex items-start gap-4">
          <ContactAvatar name={contact.name} className="w-14 h-14 rounded-2xl text-lg" />
          <div className="flex-1">
            <h2 className="font-display font-extrabold text-xl text-foreground">{contact.name}</h2>
            {contact.company && <p className="text-sm text-muted-foreground">{contact.company}</p>}
            {contact.pronouns && <p className="text-xs text-muted-foreground">{contact.pronouns}</p>}
            <div className="flex items-center gap-2 mt-2">
              <StageBadge stage={contact.stage} />
              <LeadScoreBadge score={contact.leadScore} />
            </div>
          </div>
        </div>
        <div className="flex gap-2 mt-4">
          <button className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-all press-scale">
            <Phone className="w-3.5 h-3.5" /> Call
          </button>
          <button className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-muted text-foreground text-sm font-medium hover:bg-muted/80 transition-all press-scale">
            <Mail className="w-3.5 h-3.5" /> Email
          </button>
          <button className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-muted text-foreground text-sm font-medium hover:bg-muted/80 transition-all press-scale">
            <StickyNote className="w-3.5 h-3.5" /> Note
          </button>
          <button
            onClick={() => { openAIWithContext({ type: 'contact', id: contact.id, name: contact.name, detail: contact.company }); closeDrawer(); navigate('/agent'); }}
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
        <p className="text-sm text-foreground leading-relaxed">{contact.aiSummary}</p>
        <button className="mt-2 text-xs text-accent font-semibold hover:underline">Regenerate</button>
      </div>

      {/* Details */}
      <div className="p-4 mx-4 mt-4 space-y-3">
        <h3 className="text-xs font-display font-bold text-muted-foreground">Details</h3>
        {[
          { label: 'Email', value: contact.email },
          { label: 'Phone', value: contact.phone },
          { label: 'Address', value: contact.address },
          { label: 'Source', value: contact.source },
          { label: 'Last Contacted', value: contact.lastContacted },
        ].map((field) => (
          <div key={field.label} className="flex items-center justify-between group">
            <span className="text-xs text-muted-foreground">{field.label}</span>
            <span className="text-sm text-foreground">{field.value}</span>
          </div>
        ))}
        <div className="flex items-center gap-1.5 flex-wrap mt-2">
          {contact.tags.map((tag) => (
            <span key={tag} className="px-2.5 py-1 rounded-lg bg-muted text-xs text-muted-foreground font-medium">{tag}</span>
          ))}
        </div>
      </div>

      {/* Timeline */}
      <div className="p-4 mx-4 mt-4 mb-6">
        <h3 className="text-xs font-display font-bold text-muted-foreground mb-3">Timeline</h3>
        <div className="space-y-3">
          {contactActivities.map((a) => (
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
          {contactActivities.length === 0 && (
            <p className="text-sm text-muted-foreground">No activity yet</p>
          )}
        </div>
      </div>
    </div>
  );
}
