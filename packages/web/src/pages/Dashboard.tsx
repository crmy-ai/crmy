// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { TopBar } from '@/components/layout/TopBar';
import { PipelineSnapshot, ActivityFeed, AccountHealth } from '@/components/crm/CrmWidgets';
import { useAppStore } from '@/store/appStore';
import { useOpportunities } from '@/api/hooks';
import { motion } from 'framer-motion';
import { ArrowRight, TrendingUp, UserPlus, FolderKanban, Activity } from 'lucide-react';
import { ContactAvatar } from '@/components/crm/ContactAvatar';

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function Dashboard() {
  const { openDrawer, openQuickAdd } = useAppStore();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: oppsData } = useOpportunities({ limit: 10 }) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const opps: any[] = oppsData?.data ?? [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hotDeals: any[] = opps
    .filter((d: any) => d.stage === 'negotiation' || (d.stage === 'proposal' && d.probability > 50))
    .slice(0, 3);

  return (
    <div className="flex flex-col h-full">
      <TopBar title="Dashboard" />
      <div className="flex-1 overflow-y-auto p-4 md:p-6 pb-24 md:pb-6">
        {/* Greeting */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
          <h1 className="text-2xl md:text-3xl font-display font-extrabold">
            <span className="gradient-text">{greeting()}</span>
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Here's what needs your attention today.</p>
        </motion.div>

        {/* Quick Actions */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3 mb-6"
        >
          {[
            { icon: UserPlus, label: 'New Contact', gradient: 'from-primary/15 to-primary/5', color: 'text-primary', action: () => openQuickAdd('contact') },
            { icon: TrendingUp, label: 'New Deal', gradient: 'from-accent/15 to-accent/5', color: 'text-accent', action: () => openQuickAdd('deal') },
            { icon: FolderKanban, label: 'New Use Case', gradient: 'from-success/15 to-success/5', color: 'text-success', action: () => openQuickAdd('use-case') },
            { icon: Activity, label: 'Log Activity', gradient: 'from-warning/15 to-warning/5', color: 'text-warning', action: () => openQuickAdd('activity') },
          ].map((action) => (
            <button
              key={action.label}
              onClick={action.action}
              className={`flex items-center gap-3 p-3 md:p-4 rounded-2xl bg-gradient-to-br ${action.gradient} border border-border/50 hover:shadow-md transition-all press-scale`}
            >
              <action.icon className={`w-5 h-5 ${action.color}`} />
              <span className="text-sm font-display font-semibold text-foreground">{action.label}</span>
            </button>
          ))}
        </motion.div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
          {/* Left column */}
          <div className="lg:col-span-2 space-y-4 md:space-y-5">
            {hotDeals.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="bg-card border border-border rounded-2xl p-5 shadow-sm"
              >
                <h2 className="font-display font-bold text-foreground mb-4">Today's focus</h2>
                <div className="space-y-2">
                  {hotDeals.map((deal: Record<string, unknown>) => {
                    const contactName = (deal.contact_name ?? deal.contactName ?? '') as string;
                    const amount = (deal.amount as number) ?? 0;
                    return (
                      <div
                        key={deal.id as string}
                        onClick={() => openDrawer('deal', deal.id as string)}
                        className="flex items-center gap-3 p-3 rounded-xl bg-surface hover:bg-surface-sunken cursor-pointer transition-all press-scale"
                      >
                        <ContactAvatar name={contactName} className="w-8 h-8 rounded-full text-xs" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-foreground truncate">{deal.name as string}</p>
                          <p className="text-xs text-muted-foreground">
                            ${amount >= 1000 ? `${(amount / 1000).toFixed(0)}K` : amount} · {contactName}
                          </p>
                        </div>
                        <ArrowRight className="w-4 h-4 text-muted-foreground" />
                      </div>
                    );
                  })}
                </div>
              </motion.div>
            )}

            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
              <div className="bg-card border border-border rounded-2xl p-5 shadow-sm">
                <h3 className="font-display font-bold text-foreground mb-3">Recent activity</h3>
                <ActivityFeed limit={8} />
              </div>
            </motion.div>
          </div>

          {/* Right column */}
          <div className="space-y-4 md:space-y-5">
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}>
              <PipelineSnapshot />
            </motion.div>
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.11 }}>
              <AccountHealth />
            </motion.div>
          </div>
        </div>
      </div>
    </div>
  );
}
