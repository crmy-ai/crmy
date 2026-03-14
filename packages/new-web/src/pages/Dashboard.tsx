import { TopBar } from '@/components/layout/TopBar';
import { PipelineSnapshot, ActivityFeed, AccountHealth } from '@/components/crm/CrmWidgets';
import { useAppStore } from '@/store/appStore';
import { deals, contacts } from '@/lib/mockData';
import { motion } from 'framer-motion';
import { Calendar, ArrowRight, TrendingUp, UserPlus, FolderKanban, Activity } from 'lucide-react';
import { ContactAvatar } from '@/components/crm/ContactAvatar';

export default function Dashboard() {
  const { openDrawer, openQuickAdd } = useAppStore();

  const overdueFollowups = contacts.filter((c) => {
    const lastDate = new Date(c.lastContacted);
    const daysSince = Math.floor((Date.now() - lastDate.getTime()) / 86400000);
    return daysSince > 7 && c.stage !== 'closed_won' && c.stage !== 'closed_lost';
  });

  const hotDeals = deals.filter((d) => d.stage === 'negotiation' || (d.stage === 'proposal' && d.probability > 50)).slice(0, 3);

  const upcomingEvents = [
    { time: '2:00 PM', contact: 'Sarah Chen', type: 'Showing at 789 Oak Lane', contactId: 'c1' },
    { time: '4:30 PM', contact: 'David Kim', type: 'Virtual tour review', contactId: 'c4' },
    { time: 'Tomorrow 10 AM', contact: 'Michael Torres', type: 'Inspection walkthrough', contactId: 'c12' },
  ];

  const greeting = () => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  };

  return (
    <div className="flex flex-col h-full">
      <TopBar title="Dashboard" />
      <div className="flex-1 overflow-y-auto p-4 md:p-6 pb-24 md:pb-6">
        {/* Greeting */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-6"
        >
          <h1 className="text-2xl md:text-3xl font-display font-extrabold">
            <span className="gradient-text">{greeting()}, Alex</span>
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Here's what needs your attention today.</p>
        </motion.div>

        {/* Quick Actions — 2x2 grid */}
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
            {/* Today's Focus */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="bg-card border border-border rounded-2xl p-5 shadow-sm"
            >
              <div className="flex items-center gap-2 mb-4">
                <h2 className="font-display font-bold text-foreground">Today's focus</h2>
              </div>
              <div className="space-y-2">
                {hotDeals.map((deal) => (
                  <div
                    key={deal.id}
                    onClick={() => openDrawer('deal', deal.id)}
                    className="flex items-center gap-3 p-3 rounded-xl bg-surface hover:bg-surface-sunken cursor-pointer transition-all press-scale"
                  >
                    <ContactAvatar name={deal.contactName} className="w-8 h-8 rounded-full text-xs" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-foreground truncate">{deal.name}</p>
                      <p className="text-xs text-muted-foreground">${(deal.amount / 1000).toFixed(0)}K · {deal.contactName}</p>
                    </div>
                    <ArrowRight className="w-4 h-4 text-muted-foreground" />
                  </div>
                ))}
                {overdueFollowups.slice(0, 2).map((c) => (
                  <div
                    key={c.id}
                    onClick={() => openDrawer('contact', c.id)}
                    className="flex items-center gap-3 p-3 rounded-xl bg-destructive/5 hover:bg-destructive/10 cursor-pointer transition-all press-scale"
                  >
                    <ContactAvatar name={c.name} className="w-8 h-8 rounded-full text-xs" />
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-foreground">{c.name}</p>
                      <p className="text-xs text-destructive">Overdue follow-up</p>
                    </div>
                    <ArrowRight className="w-4 h-4 text-muted-foreground" />
                  </div>
                ))}
              </div>
            </motion.div>

            {/* Recent Activity */}
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
              <div className="bg-card border border-border rounded-2xl p-5 shadow-sm">
                <h3 className="font-display font-bold text-foreground mb-3">Recent activity</h3>
                <ActivityFeed limit={8} />
              </div>
            </motion.div>
          </div>

          {/* Right column */}
          <div className="space-y-4 md:space-y-5">
            {/* Pipeline Snapshot */}
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}>
              <PipelineSnapshot />
            </motion.div>

            {/* Account Health */}
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.11 }}>
              <AccountHealth />
            </motion.div>

            {/* Upcoming Events */}
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
              <div className="bg-card border border-border rounded-2xl p-4 shadow-sm">
                <h3 className="font-display font-bold text-foreground mb-3">Upcoming</h3>
                <div className="space-y-2">
                  {upcomingEvents.map((event) => (
                    <div
                      key={event.contactId + event.time}
                      className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-muted/50 cursor-pointer transition-colors press-scale"
                      onClick={() => openDrawer('contact', event.contactId)}
                    >
                      <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <Calendar className="w-4 h-4 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-foreground font-medium truncate">{event.type}</p>
                        <p className="text-xs text-muted-foreground">{event.time} · {event.contact}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </div>
    </div>
  );
}
