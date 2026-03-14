import { useState } from 'react';
import { TopBar } from '@/components/layout/TopBar';
import { Link, Route, Routes, useLocation } from 'react-router-dom';
import { CircleUser, Lock, Link2, ListFilter, Copy, Trash2, Plus, Palette } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { useAppStore } from '@/store/appStore';

const settingsNav = [
  { icon: CircleUser, label: 'Profile', path: '/settings' },
  { icon: Palette, label: 'Appearance', path: '/settings/appearance' },
  { icon: Lock, label: 'API Keys', path: '/settings/api-keys' },
  { icon: Link2, label: 'Webhooks', path: '/settings/webhooks' },
  { icon: ListFilter, label: 'Custom Fields', path: '/settings/custom-fields' },
];

/* ─── Profile ─── */
function ProfileSettings() {
  return (
    <div>
      <h2 className="font-display font-bold text-lg text-foreground mb-6">Profile</h2>
      <div className="space-y-5 max-w-md">
        {[
          { label: 'Name', value: 'Alex Rivera' },
          { label: 'Email', value: 'alex.rivera@crmy.io' },
          { label: 'Role', value: 'Admin' },
        ].map((field) => (
          <div key={field.label} className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{field.label}</label>
            <div className="h-10 px-3 flex items-center rounded-lg border border-border bg-muted/50 text-sm text-foreground">
              {field.value}
            </div>
          </div>
        ))}
        <p className="text-xs text-muted-foreground">Profile details are managed by your organization administrator.</p>
      </div>
    </div>
  );
}

/* ─── Appearance ─── */
function AppearanceSettings() {
  const { darkVariant, setDarkVariant } = useAppStore();

  const variants: { key: 'warm' | 'charcoal'; label: string; description: string; preview: string }[] = [
    { key: 'warm', label: 'Warm Brown', description: 'Dark theme with warm, earthy brown tones', preview: 'bg-[hsl(15,25%,7%)]' },
    { key: 'charcoal', label: 'Charcoal', description: 'Dark theme with cool, navy-charcoal tones', preview: 'bg-[hsl(220,16%,8%)]' },
  ];

  return (
    <div>
      <h2 className="font-display font-bold text-lg text-foreground mb-2">Appearance</h2>
      <p className="text-sm text-muted-foreground mb-6">Choose your preferred dark mode style.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-md">
        {variants.map((v) => (
          <button
            key={v.key}
            onClick={() => setDarkVariant(v.key)}
            className={`flex flex-col gap-3 p-4 rounded-xl border-2 transition-all text-left ${
              darkVariant === v.key
                ? 'border-primary bg-primary/5'
                : 'border-border hover:border-muted-foreground/30'
            }`}
          >
            <div className={`w-full h-16 rounded-lg ${v.preview} border border-border/30 flex items-end p-2`}>
              <div className="flex gap-1">
                <div className="w-6 h-2 rounded-full bg-[hsl(24,95%,53%)]" />
                <div className="w-4 h-2 rounded-full bg-white/20" />
              </div>
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">{v.label}</p>
              <p className="text-xs text-muted-foreground">{v.description}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ─── API Keys ─── */
type ApiKey = { id: string; name: string; prefix: string; createdAt: string };

function ApiKeysSettings() {
  const [keys, setKeys] = useState<ApiKey[]>([
    { id: 'k1', name: 'Production', prefix: 'crmy_pk_****a3f2', createdAt: '2026-02-10' },
    { id: 'k2', name: 'Staging', prefix: 'crmy_pk_****9b1c', createdAt: '2026-03-01' },
  ]);
  const [newKeyName, setNewKeyName] = useState('');
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const createKey = () => {
    if (!newKeyName.trim()) return;
    const generated = `crmy_pk_${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 10)}`;
    const newKey: ApiKey = {
      id: `k${Date.now()}`,
      name: newKeyName.trim(),
      prefix: `crmy_pk_****${generated.slice(-4)}`,
      createdAt: new Date().toISOString().split('T')[0],
    };
    setKeys(prev => [newKey, ...prev]);
    setRevealedKey(generated);
    setNewKeyName('');
    setShowCreate(false);
    toast({ title: 'API key created', description: 'Copy it now — it won\'t be shown again.' });
  };

  const revokeKey = (id: string) => {
    setKeys(prev => prev.filter(k => k.id !== id));
    toast({ title: 'API key revoked' });
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="font-display font-bold text-lg text-foreground">API Keys</h2>
        <button onClick={() => setShowCreate(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors">
          <Plus className="w-3.5 h-3.5" /> New Key
        </button>
      </div>

      {showCreate && (
        <div className="mb-5 p-4 rounded-xl border border-border bg-muted/30 space-y-3 max-w-md">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Key Name</label>
          <input
            value={newKeyName} onChange={(e) => setNewKeyName(e.target.value)}
            placeholder="e.g. Production, CI/CD"
            className="w-full h-9 px-3 rounded-lg border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring"
            onKeyDown={(e) => e.key === 'Enter' && createKey()}
          />
          <div className="flex gap-2">
            <button onClick={createKey} disabled={!newKeyName.trim()} className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 disabled:opacity-40 transition-colors">Create</button>
            <button onClick={() => { setShowCreate(false); setNewKeyName(''); }} className="px-3 py-1.5 rounded-lg bg-muted text-muted-foreground text-xs font-semibold hover:text-foreground transition-colors">Cancel</button>
          </div>
        </div>
      )}

      {revealedKey && (
        <div className="mb-5 p-4 rounded-xl border border-accent/30 bg-accent/5 space-y-2 max-w-lg">
          <p className="text-xs font-semibold text-accent">Your new API key (shown once):</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs text-foreground bg-background px-3 py-2 rounded-lg border border-border font-mono break-all">{revealedKey}</code>
            <button onClick={() => { navigator.clipboard.writeText(revealedKey); toast({ title: 'Copied!' }); }} className="p-2 rounded-lg hover:bg-muted transition-colors">
              <Copy className="w-4 h-4 text-muted-foreground" />
            </button>
          </div>
          <button onClick={() => setRevealedKey(null)} className="text-xs text-muted-foreground hover:text-foreground transition-colors">Dismiss</button>
        </div>
      )}

      <div className="space-y-2">
        {keys.map((k) => (
          <div key={k.id} className="flex items-center gap-3 p-3 rounded-xl border border-border bg-card hover:bg-muted/30 transition-colors">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground">{k.name}</p>
              <p className="text-xs text-muted-foreground font-mono">{k.prefix}</p>
            </div>
            <span className="text-xs text-muted-foreground hidden sm:block">{k.createdAt}</span>
            <button onClick={() => revokeKey(k.id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        {keys.length === 0 && <p className="text-sm text-muted-foreground py-4">No API keys. Create one to get started.</p>}
      </div>
    </div>
  );
}

/* ─── Webhooks ─── */
type WebhookEntry = { id: string; url: string; events: string[]; createdAt: string };

const availableEvents = [
  'contact.created', 'contact.updated', 'contact.deleted',
  'account.created', 'account.updated',
  'deal.created', 'deal.updated', 'deal.stage_changed',
  'activity.created',
  'use_case.created', 'use_case.updated',
];

function WebhooksSettings() {
  const [webhooks, setWebhooks] = useState<WebhookEntry[]>([
    { id: 'wh1', url: 'https://api.example.com/webhooks/crmy', events: ['contact.created', 'deal.stage_changed'], createdAt: '2026-03-05' },
  ]);
  const [showCreate, setShowCreate] = useState(false);
  const [newUrl, setNewUrl] = useState('');
  const [selectedEvents, setSelectedEvents] = useState<string[]>([]);

  const toggleEvent = (ev: string) => {
    setSelectedEvents(prev => prev.includes(ev) ? prev.filter(e => e !== ev) : [...prev, ev]);
  };

  const createWebhook = () => {
    if (!newUrl.trim() || selectedEvents.length === 0) return;
    setWebhooks(prev => [{ id: `wh${Date.now()}`, url: newUrl.trim(), events: selectedEvents, createdAt: new Date().toISOString().split('T')[0] }, ...prev]);
    setNewUrl('');
    setSelectedEvents([]);
    setShowCreate(false);
    toast({ title: 'Webhook created' });
  };

  const deleteWebhook = (id: string) => {
    setWebhooks(prev => prev.filter(w => w.id !== id));
    toast({ title: 'Webhook deleted' });
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="font-display font-bold text-lg text-foreground">Webhooks</h2>
        <button onClick={() => setShowCreate(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors">
          <Plus className="w-3.5 h-3.5" /> Add Webhook
        </button>
      </div>

      {showCreate && (
        <div className="mb-5 p-4 rounded-xl border border-border bg-muted/30 space-y-3 max-w-lg">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Endpoint URL</label>
            <input
              value={newUrl} onChange={(e) => setNewUrl(e.target.value)}
              placeholder="https://your-api.com/webhook"
              className="w-full h-9 px-3 rounded-lg border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Event Types</label>
            <div className="flex flex-wrap gap-1.5">
              {availableEvents.map((ev) => (
                <button
                  key={ev}
                  onClick={() => toggleEvent(ev)}
                  className={`px-2 py-1 rounded-md text-[11px] font-mono transition-colors border ${
                    selectedEvents.includes(ev)
                      ? 'bg-primary/15 border-primary/30 text-primary'
                      : 'bg-muted/50 border-border text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {ev}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={createWebhook} disabled={!newUrl.trim() || selectedEvents.length === 0} className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 disabled:opacity-40 transition-colors">Create</button>
            <button onClick={() => { setShowCreate(false); setNewUrl(''); setSelectedEvents([]); }} className="px-3 py-1.5 rounded-lg bg-muted text-muted-foreground text-xs font-semibold hover:text-foreground transition-colors">Cancel</button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {webhooks.map((wh) => (
          <div key={wh.id} className="p-3 rounded-xl border border-border bg-card hover:bg-muted/30 transition-colors">
            <div className="flex items-center gap-3 mb-2">
              <p className="text-sm font-mono text-foreground flex-1 truncate">{wh.url}</p>
              <span className="text-xs text-muted-foreground hidden sm:block">{wh.createdAt}</span>
              <button onClick={() => deleteWebhook(wh.id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="flex flex-wrap gap-1">
              {wh.events.map((ev) => (
                <span key={ev} className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-muted text-muted-foreground">{ev}</span>
              ))}
            </div>
          </div>
        ))}
        {webhooks.length === 0 && <p className="text-sm text-muted-foreground py-4">No webhooks configured.</p>}
      </div>
    </div>
  );
}

/* ─── Custom Fields ─── */
type CustomField = { id: string; name: string; type: string; objectType: string; createdAt: string };

const objectTypes = [
  { key: 'contact', label: 'Contact' },
  { key: 'account', label: 'Account' },
  { key: 'opportunity', label: 'Opportunity' },
  { key: 'activity', label: 'Activity' },
  { key: 'use_case', label: 'Use Case' },
];

const fieldTypes = ['Text', 'Number', 'Date', 'Dropdown', 'Checkbox', 'URL', 'Email'];

function CustomFieldsSettings() {
  const [activeTab, setActiveTab] = useState('contact');
  const [fields, setFields] = useState<CustomField[]>([
    { id: 'cf1', name: 'LinkedIn URL', type: 'URL', objectType: 'contact', createdAt: '2026-02-20' },
    { id: 'cf2', name: 'Annual Budget', type: 'Number', objectType: 'account', createdAt: '2026-03-01' },
    { id: 'cf3', name: 'Preferred Contact Method', type: 'Dropdown', objectType: 'contact', createdAt: '2026-03-05' },
    { id: 'cf4', name: 'SLA Tier', type: 'Dropdown', objectType: 'account', createdAt: '2026-03-08' },
    { id: 'cf5', name: 'Commission Rate', type: 'Number', objectType: 'opportunity', createdAt: '2026-03-10' },
  ]);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState('Text');

  const createField = () => {
    if (!newName.trim()) return;
    setFields(prev => [{ id: `cf${Date.now()}`, name: newName.trim(), type: newType, objectType: activeTab, createdAt: new Date().toISOString().split('T')[0] }, ...prev]);
    setNewName('');
    setNewType('Text');
    setShowCreate(false);
    toast({ title: 'Custom field created' });
  };

  const deleteField = (id: string) => {
    setFields(prev => prev.filter(f => f.id !== id));
    toast({ title: 'Custom field deleted' });
  };

  const tabFields = fields.filter(f => f.objectType === activeTab);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-display font-bold text-lg text-foreground">Custom Fields</h2>
        <button onClick={() => setShowCreate(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors">
          <Plus className="w-3.5 h-3.5" /> New Field
        </button>
      </div>

      {/* Object type tabs */}
      <div className="flex gap-1 mb-5 overflow-x-auto no-scrollbar bg-muted rounded-xl p-0.5">
        {objectTypes.map((ot) => (
          <button
            key={ot.key}
            onClick={() => { setActiveTab(ot.key); setShowCreate(false); }}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
              activeTab === ot.key ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {ot.label}
          </button>
        ))}
      </div>

      {showCreate && (
        <div className="mb-5 p-4 rounded-xl border border-border bg-muted/30 space-y-3 max-w-md">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Field Name</label>
            <input
              value={newName} onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Preferred Language"
              className="w-full h-9 px-3 rounded-lg border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring"
              onKeyDown={(e) => e.key === 'Enter' && createField()}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Field Type</label>
            <div className="flex flex-wrap gap-1.5">
              {fieldTypes.map((ft) => (
                <button
                  key={ft}
                  onClick={() => setNewType(ft)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors border ${
                    newType === ft
                      ? 'bg-primary/15 border-primary/30 text-primary'
                      : 'bg-muted/50 border-border text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {ft}
                </button>
              ))}
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">Adding to: <span className="font-semibold text-foreground">{objectTypes.find(o => o.key === activeTab)?.label}</span></p>
          <div className="flex gap-2">
            <button onClick={createField} disabled={!newName.trim()} className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 disabled:opacity-40 transition-colors">Create</button>
            <button onClick={() => { setShowCreate(false); setNewName(''); }} className="px-3 py-1.5 rounded-lg bg-muted text-muted-foreground text-xs font-semibold hover:text-foreground transition-colors">Cancel</button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {tabFields.map((f) => (
          <div key={f.id} className="flex items-center gap-3 p-3 rounded-xl border border-border bg-card hover:bg-muted/30 transition-colors">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground">{f.name}</p>
              <p className="text-xs text-muted-foreground">{f.type}</p>
            </div>
            <span className="text-xs text-muted-foreground hidden sm:block">{f.createdAt}</span>
            <button onClick={() => deleteField(f.id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        {tabFields.length === 0 && <p className="text-sm text-muted-foreground py-4">No custom fields for this object type.</p>}
      </div>
    </div>
  );
}

/* ─── Settings Shell ─── */
export default function Settings() {
  const location = useLocation();

  return (
    <div className="flex flex-col h-full">
      <TopBar title="Settings" />

      {/* Mobile nav */}
      <div className="md:hidden flex gap-1 overflow-x-auto no-scrollbar px-4 pt-3 pb-1 border-b border-border">
        {settingsNav.map((item) => {
          const active = item.path === '/settings' ? location.pathname === '/settings' : location.pathname.startsWith(item.path);
          return (
            <Link
              key={item.path}
              to={item.path}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                active ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'
              }`}
            >
              <item.icon className="w-3.5 h-3.5" />
              {item.label}
            </Link>
          );
        })}
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Desktop nav */}
        <nav className="hidden md:flex flex-col w-48 border-r border-border p-2 gap-0.5">
          {settingsNav.map((item) => {
            const active = item.path === '/settings' ? location.pathname === '/settings' : location.pathname.startsWith(item.path);
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors
                  ${active ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
              >
                <item.icon className="w-4 h-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Settings content */}
        <div className="flex-1 overflow-y-auto p-6 pb-20 md:pb-6">
          <Routes>
            <Route index element={<ProfileSettings />} />
            <Route path="appearance" element={<AppearanceSettings />} />
            <Route path="api-keys" element={<ApiKeysSettings />} />
            <Route path="webhooks" element={<WebhooksSettings />} />
            <Route path="custom-fields" element={<CustomFieldsSettings />} />
          </Routes>
        </div>
      </div>
    </div>
  );
}
