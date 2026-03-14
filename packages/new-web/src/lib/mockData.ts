export type Contact = {
  id: string;
  name: string;
  email: string;
  phone: string;
  company: string;
  avatar: string;
  stage: 'prospecting' | 'qualification' | 'proposal' | 'negotiation' | 'closed_won' | 'closed_lost';
  leadScore: number;
  tags: string[];
  lastContacted: string;
  source: string;
  address: string;
  pronouns?: string;
  aiSummary: string;
};

export type Deal = {
  id: string;
  name: string;
  contactId: string;
  contactName: string;
  contactAvatar: string;
  amount: number;
  stage: 'prospecting' | 'qualification' | 'proposal' | 'negotiation' | 'closed_won' | 'closed_lost';
  probability: number;
  daysInStage: number;
  assignedAgent: string;
  property?: string;
  notes: string;
};

export type Activity = {
  id: string;
  type: 'call' | 'email' | 'meeting' | 'note' | 'task';
  contactId: string;
  contactName: string;
  contactAvatar: string;
  description: string;
  timestamp: string;
  dealId?: string;
};

export type UseCase = {
  id: string;
  name: string;
  client: string;
  stage: 'discovery' | 'poc' | 'production' | 'scaling' | 'sunset';
  attributedARR: number;
  daysActive: number;
  assignedAgent: string;
  description: string;
  linkedDealId?: string;
  contactIds: string[];
};

const avatarUrl = (seed: string) => `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(seed)}&backgroundColor=f97316,38bdf8,facc15,6366f1,ec4899&backgroundType=solid`;

export const contacts: Contact[] = [
  { id: 'c1', name: 'Sarah Chen', email: 'sarah.chen@email.com', phone: '(555) 234-5678', company: 'Chen Properties', avatar: avatarUrl('Sarah Chen'), stage: 'negotiation', leadScore: 92, tags: ['buyer', 'pre-approved'], lastContacted: '2026-03-12', source: 'Referral', address: '456 Maple Ave, Portland, OR', pronouns: 'she/her', aiSummary: 'High-intent buyer pre-approved for $850K. Currently under contract on 789 Oak Lane. Responsive and detail-oriented — prefers email communication. Likely to close within 2 weeks.' },
  { id: 'c2', name: 'Marcus Johnson', email: 'marcus.j@realty.com', phone: '(555) 876-5432', company: 'Johnson Realty Group', avatar: avatarUrl('Marcus Johnson'), stage: 'qualification', leadScore: 78, tags: ['seller', 'investor'], lastContacted: '2026-03-10', source: 'Cold Outreach', address: '123 Broadway, Austin, TX', aiSummary: 'Owns 3 investment properties. Looking to sell 1 condo to fund a duplex purchase. Motivated seller, responsive via text. Follow up on appraisal results.' },
  { id: 'c3', name: 'Emily Rodriguez', email: 'emily.r@gmail.com', phone: '(555) 345-6789', company: '', avatar: avatarUrl('Emily Rodriguez'), stage: 'prospecting', leadScore: 45, tags: ['first-time-buyer'], lastContacted: '2026-03-05', source: 'Website', address: '789 Pine St, Denver, CO', aiSummary: 'First-time homebuyer, early-stage. Attended an open house last month but hasn\'t started the mortgage process. Needs education on pre-approval steps.' },
  { id: 'c4', name: 'David Kim', email: 'david.kim@outlook.com', phone: '(555) 456-7890', company: 'Kim & Associates', avatar: avatarUrl('David Kim'), stage: 'proposal', leadScore: 85, tags: ['buyer', 'luxury'], lastContacted: '2026-03-11', source: 'Referral', address: '321 Elm Dr, Seattle, WA', pronouns: 'he/him', aiSummary: 'Luxury buyer looking in the $1.2M–$1.8M range. Has toured 5 properties. Application submitted with First National. Strong income verification — approval expected this week.' },
  { id: 'c5', name: 'Lisa Thompson', email: 'lisa.t@insurance.com', phone: '(555) 567-8901', company: 'Thompson Insurance', avatar: avatarUrl('Lisa Thompson'), stage: 'closed_won', leadScore: 95, tags: ['referral-partner'], lastContacted: '2026-03-13', source: 'Network', address: '654 Oak Blvd, Miami, FL', aiSummary: 'Key referral partner — has sent 8 qualified leads this quarter. Closed 3 deals from her referrals. Maintain monthly check-in schedule.' },
  { id: 'c6', name: 'James Wilson', email: 'jwilson@mail.com', phone: '(555) 678-9012', company: '', avatar: avatarUrl('James Wilson'), stage: 'qualification', leadScore: 62, tags: ['seller'], lastContacted: '2026-03-08', source: 'Open House', address: '987 Cedar Ln, Nashville, TN', aiSummary: 'Considering selling primary residence to downsize. Timeline: 3–6 months. Needs a comparative market analysis. Prefers phone calls.' },
  { id: 'c7', name: 'Ana Petrov', email: 'ana.p@corp.com', phone: '(555) 789-0123', company: 'Petrov Developments', avatar: avatarUrl('Ana Petrov'), stage: 'prospecting', leadScore: 38, tags: ['developer', 'commercial'], lastContacted: '2026-02-28', source: 'LinkedIn', address: '147 Market St, San Francisco, CA', aiSummary: 'Commercial developer exploring mixed-use projects. Very early stage — needs nurturing. Has budget but unclear on timing.' },
  { id: 'c8', name: 'Robert Chang', email: 'rchang@realestate.com', phone: '(555) 890-1234', company: 'Pacific Realty', avatar: avatarUrl('Robert Chang'), stage: 'closed_won', leadScore: 98, tags: ['buyer', 'repeat'], lastContacted: '2026-03-13', source: 'Past Client', address: '258 Beach Rd, San Diego, CA', aiSummary: 'Repeat buyer — 3rd transaction together. Just closed on 258 Beach Rd. Excellent relationship. Will likely purchase another investment property in Q3.' },
  { id: 'c9', name: 'Priya Sharma', email: 'priya.s@email.com', phone: '(555) 901-2345', company: '', avatar: avatarUrl('Priya Sharma'), stage: 'proposal', leadScore: 71, tags: ['buyer', 'relocation'], lastContacted: '2026-03-09', source: 'Zillow', address: '369 River Walk, Chicago, IL', aiSummary: 'Relocating from NYC for work. Needs a home by May. Application in process. Prefers video calls due to distance.' },
  { id: 'c10', name: 'Tom Baker', email: 'tom.baker@biz.com', phone: '(555) 012-3456', company: 'Baker Mortgage Co.', avatar: avatarUrl('Tom Baker'), stage: 'qualification', leadScore: 55, tags: ['referral-partner', 'mortgage'], lastContacted: '2026-03-07', source: 'Conference', address: '741 Finance Ave, Charlotte, NC', aiSummary: 'Mortgage broker — potential referral partner. Met at the NAMB conference. Interested in cross-referral arrangement. Schedule a follow-up meeting.' },
  { id: 'c11', name: 'Rachel Green', email: 'rachel.g@properties.com', phone: '(555) 123-7890', company: '', avatar: avatarUrl('Rachel Green'), stage: 'prospecting', leadScore: 42, tags: ['buyer'], lastContacted: '2026-03-01', source: 'Facebook Ad', address: '852 Sunset Blvd, Los Angeles, CA', aiSummary: 'Responded to Facebook ad for new listings. Budget around $500K. No pre-approval yet. Needs a callback.' },
  { id: 'c12', name: 'Michael Torres', email: 'm.torres@email.com', phone: '(555) 234-8901', company: 'Torres Group', avatar: avatarUrl('Michael Torres'), stage: 'negotiation', leadScore: 88, tags: ['seller', 'investor'], lastContacted: '2026-03-12', source: 'Referral', address: '963 Highland Rd, Phoenix, AZ', pronouns: 'he/him', aiSummary: 'Selling a 4-unit apartment complex. Under contract at $1.4M. Inspection scheduled for March 15. Investor with multiple properties — high-value relationship.' },
  { id: 'c13', name: 'Jennifer Lee', email: 'jlee@startup.io', phone: '(555) 345-9012', company: 'TechHome', avatar: avatarUrl('Jennifer Lee'), stage: 'qualification', leadScore: 67, tags: ['buyer', 'tech-relocation'], lastContacted: '2026-03-06', source: 'Google Ads', address: '159 Innovation Dr, Austin, TX', aiSummary: 'Tech worker relocating from Bay Area. Budget $600K–$800K. Interested in smart home features. Needs to sell current home first.' },
  { id: 'c14', name: 'Carlos Mendez', email: 'carlos.m@mail.com', phone: '(555) 456-0123', company: '', avatar: avatarUrl('Carlos Mendez'), stage: 'closed_lost', leadScore: 25, tags: ['buyer'], lastContacted: '2026-02-15', source: 'Referral', address: '753 Desert Rd, Tucson, AZ', aiSummary: 'Was interested in a condo purchase but financing fell through. May re-engage in 6 months after credit repair. Set a follow-up reminder for September.' },
  { id: 'c15', name: 'Sophia Nakamura', email: 'sophia.n@luxury.com', phone: '(555) 567-1234', company: 'Nakamura Estates', avatar: avatarUrl('Sophia Nakamura'), stage: 'negotiation', leadScore: 91, tags: ['seller', 'luxury'], lastContacted: '2026-03-13', source: 'Network', address: '147 Hillside Dr, Malibu, CA', aiSummary: 'Luxury listing at $2.1M. Under contract with contingencies. Buyer has strong financials. Expected to close by end of March. High commission deal.' },
  { id: 'c16', name: 'Alex Rivera', email: 'alex.r@insurance.co', phone: '(555) 678-2345', company: 'Rivera Insurance', avatar: avatarUrl('Alex Rivera'), stage: 'prospecting', leadScore: 35, tags: ['referral-partner'], lastContacted: '2026-03-04', source: 'Cold Email', address: '369 Commerce St, Dallas, TX', aiSummary: 'Insurance agent — potential referral partner. Initial email sent, waiting for response. Follow up in 3 days.' },
  { id: 'c17', name: 'Hannah Williams', email: 'hannah.w@email.com', phone: '(555) 789-3456', company: '', avatar: avatarUrl('Hannah Williams'), stage: 'qualification', leadScore: 58, tags: ['buyer', 'first-time-buyer'], lastContacted: '2026-03-03', source: 'Instagram', address: '258 Park Ave, Brooklyn, NY', aiSummary: 'First-time buyer in Brooklyn. Budget $450K. Attended 2 virtual tours. Pre-approved with Chase. Looking for a 1BR with good transit access.' },
  { id: 'c18', name: 'Daniel Foster', email: 'dfoster@realty.com', phone: '(555) 890-4567', company: 'Foster Homes', avatar: avatarUrl('Daniel Foster'), stage: 'proposal', leadScore: 74, tags: ['buyer', 'family'], lastContacted: '2026-03-11', source: 'Referral', address: '147 School St, Boston, MA', aiSummary: 'Growing family needs a 4BR in a good school district. Application submitted. Budget $700K–$900K. Motivated — lease ends in May.' },
  { id: 'c19', name: 'Maria Santos', email: 'maria.s@gmail.com', phone: '(555) 901-5678', company: '', avatar: avatarUrl('Maria Santos'), stage: 'prospecting', leadScore: 30, tags: ['seller'], lastContacted: '2026-02-20', source: 'Mailer', address: '963 Olive St, Sacramento, CA', aiSummary: 'Responded to direct mail campaign. Considering selling but no timeline. Needs a home value assessment. Low urgency — nurture sequence.' },
  { id: 'c20', name: 'Kevin O\'Brien', email: 'kevin.ob@biz.com', phone: '(555) 012-6789', company: 'O\'Brien & Partners', avatar: avatarUrl('Kevin O\'Brien'), stage: 'closed_won', leadScore: 90, tags: ['investor', 'repeat'], lastContacted: '2026-03-12', source: 'Past Client', address: '852 Wall St, New York, NY', aiSummary: 'Serial investor, 5th deal together. Just closed on a 6-unit building. Strong relationship. Always looking for new opportunities — send monthly deal flow.' },
];

export const deals: Deal[] = [
  { id: 'd1', name: '789 Oak Lane Purchase', contactId: 'c1', contactName: 'Sarah Chen', contactAvatar: avatarUrl('Sarah Chen'), amount: 850000, stage: 'negotiation', probability: 85, daysInStage: 8, assignedAgent: 'You', property: '789 Oak Lane, Portland, OR', notes: 'Inspection passed. Waiting on appraisal.' },
  { id: 'd2', name: 'Condo Sale - Unit 4B', contactId: 'c2', contactName: 'Marcus Johnson', contactAvatar: avatarUrl('Marcus Johnson'), amount: 425000, stage: 'qualification', probability: 40, daysInStage: 12, assignedAgent: 'You', property: '220 River St, Unit 4B, Austin, TX', notes: 'CMA completed. Awaiting seller approval on listing price.' },
  { id: 'd3', name: 'First Home - Denver', contactId: 'c3', contactName: 'Emily Rodriguez', contactAvatar: avatarUrl('Emily Rodriguez'), amount: 380000, stage: 'prospecting', probability: 15, daysInStage: 18, assignedAgent: 'You', property: 'TBD', notes: 'Needs pre-approval first. Sent lender referral.' },
  { id: 'd4', name: 'Luxury Estate - Bellevue', contactId: 'c4', contactName: 'David Kim', contactAvatar: avatarUrl('David Kim'), amount: 1650000, stage: 'proposal', probability: 60, daysInStage: 6, assignedAgent: 'You', property: '1200 Summit Ridge, Bellevue, WA', notes: 'Application submitted. Strong financials.' },
  { id: 'd5', name: '258 Beach Rd Closing', contactId: 'c8', contactName: 'Robert Chang', contactAvatar: avatarUrl('Robert Chang'), amount: 920000, stage: 'closed_won', probability: 100, daysInStage: 2, assignedAgent: 'You', property: '258 Beach Rd, San Diego, CA', notes: 'Closed! Commission received.' },
  { id: 'd6', name: 'Chicago Relocation', contactId: 'c9', contactName: 'Priya Sharma', contactAvatar: avatarUrl('Priya Sharma'), amount: 520000, stage: 'proposal', probability: 55, daysInStage: 9, assignedAgent: 'You', property: '369 River Walk, Chicago, IL', notes: 'Mortgage application in process. Employer relocation package helping.' },
  { id: 'd7', name: '4-Unit Complex Sale', contactId: 'c12', contactName: 'Michael Torres', contactAvatar: avatarUrl('Michael Torres'), amount: 1400000, stage: 'negotiation', probability: 80, daysInStage: 5, assignedAgent: 'You', property: '963 Highland Rd, Phoenix, AZ', notes: 'Inspection March 15. Buyer financing confirmed.' },
  { id: 'd8', name: 'Malibu Hillside Listing', contactId: 'c15', contactName: 'Sophia Nakamura', contactAvatar: avatarUrl('Sophia Nakamura'), amount: 2100000, stage: 'negotiation', probability: 75, daysInStage: 11, assignedAgent: 'You', property: '147 Hillside Dr, Malibu, CA', notes: 'Contingencies in place. Buyer strong but requesting minor repairs.' },
  { id: 'd9', name: 'Brooklyn 1BR', contactId: 'c17', contactName: 'Hannah Williams', contactAvatar: avatarUrl('Hannah Williams'), amount: 445000, stage: 'qualification', probability: 35, daysInStage: 16, assignedAgent: 'You', property: 'TBD - Brooklyn, NY', notes: 'Viewing 3 units this weekend. Pre-approved.' },
  { id: 'd10', name: 'Boston Family Home', contactId: 'c18', contactName: 'Daniel Foster', contactAvatar: avatarUrl('Daniel Foster'), amount: 785000, stage: 'proposal', probability: 50, daysInStage: 4, assignedAgent: 'You', property: '147 School St, Boston, MA', notes: 'Application in process. Lease pressure — needs to close by May.' },
  { id: 'd11', name: '6-Unit Investment', contactId: 'c20', contactName: "Kevin O'Brien", contactAvatar: avatarUrl("Kevin O'Brien"), amount: 1850000, stage: 'closed_won', probability: 100, daysInStage: 1, assignedAgent: 'You', property: '852 Wall St, New York, NY', notes: 'Closed yesterday. Repeat client — 5th deal.' },
  { id: 'd12', name: 'Austin Smart Home', contactId: 'c13', contactName: 'Jennifer Lee', contactAvatar: avatarUrl('Jennifer Lee'), amount: 680000, stage: 'qualification', probability: 30, daysInStage: 20, assignedAgent: 'You', property: 'TBD - Austin, TX', notes: 'Needs to sell Bay Area home first. Timeline uncertain.' },
  { id: 'd13', name: 'Tucson Condo', contactId: 'c14', contactName: 'Carlos Mendez', contactAvatar: avatarUrl('Carlos Mendez'), amount: 275000, stage: 'closed_lost', probability: 0, daysInStage: 30, assignedAgent: 'You', property: '753 Desert Rd, Tucson, AZ', notes: 'Financing fell through. Client needs credit repair.' },
  { id: 'd14', name: 'Duplex Investment', contactId: 'c2', contactName: 'Marcus Johnson', contactAvatar: avatarUrl('Marcus Johnson'), amount: 550000, stage: 'prospecting', probability: 20, daysInStage: 5, assignedAgent: 'You', property: 'TBD - Austin, TX', notes: 'Wants to use proceeds from condo sale. Dependent on d2 closing.' },
  { id: 'd15', name: 'Sacramento Listing', contactId: 'c19', contactName: 'Maria Santos', contactAvatar: avatarUrl('Maria Santos'), amount: 460000, stage: 'prospecting', probability: 10, daysInStage: 22, assignedAgent: 'You', property: '963 Olive St, Sacramento, CA', notes: 'Very early stage. Needs home value assessment first.' },
];

export const activities: Activity[] = [
  { id: 'a1', type: 'task', contactId: 'c1', contactName: 'Sarah Chen', contactAvatar: avatarUrl('Sarah Chen'), description: 'Generated follow-up email draft for appraisal update', timestamp: '2026-03-13T14:30:00', dealId: 'd1' },
  { id: 'a2', type: 'call', contactId: 'c1', contactName: 'Sarah Chen', contactAvatar: avatarUrl('Sarah Chen'), description: 'Discussed appraisal timeline — expected by March 15', timestamp: '2026-03-13T11:00:00', dealId: 'd1' },
  { id: 'a3', type: 'email', contactId: 'c4', contactName: 'David Kim', contactAvatar: avatarUrl('David Kim'), description: 'Sent pre-approval checklist and loan officer contact', timestamp: '2026-03-13T09:15:00', dealId: 'd4' },
  { id: 'a4', type: 'note', contactId: 'c12', contactName: 'Michael Torres', contactAvatar: avatarUrl('Michael Torres'), description: 'Deal moved to Negotiation stage', timestamp: '2026-03-12T16:45:00', dealId: 'd7' },
  { id: 'a5', type: 'note', contactId: 'c15', contactName: 'Sophia Nakamura', contactAvatar: avatarUrl('Sophia Nakamura'), description: 'Buyer requesting minor roof repair before closing. Getting contractor quote.', timestamp: '2026-03-12T15:00:00', dealId: 'd8' },
  { id: 'a6', type: 'call', contactId: 'c6', contactName: 'James Wilson', contactAvatar: avatarUrl('James Wilson'), description: 'Initial consultation — discussed selling timeline and pricing strategy', timestamp: '2026-03-12T14:00:00' },
  { id: 'a7', type: 'email', contactId: 'c9', contactName: 'Priya Sharma', contactAvatar: avatarUrl('Priya Sharma'), description: 'Sent virtual tour links for 3 properties near River Walk', timestamp: '2026-03-12T10:30:00', dealId: 'd6' },
  { id: 'a8', type: 'task', contactId: 'c2', contactName: 'Marcus Johnson', contactAvatar: avatarUrl('Marcus Johnson'), description: 'Scheduled follow-up reminder for CMA review', timestamp: '2026-03-12T09:00:00', dealId: 'd2' },
  { id: 'a9', type: 'note', contactId: 'c8', contactName: 'Robert Chang', contactAvatar: avatarUrl('Robert Chang'), description: 'Closing completed! Commission: $27,600. Sent thank you gift.', timestamp: '2026-03-11T17:00:00', dealId: 'd5' },
  { id: 'a10', type: 'note', contactId: 'c8', contactName: 'Robert Chang', contactAvatar: avatarUrl('Robert Chang'), description: 'Deal moved to Closed Won 🎉', timestamp: '2026-03-11T16:30:00', dealId: 'd5' },
  { id: 'a11', type: 'call', contactId: 'c18', contactName: 'Daniel Foster', contactAvatar: avatarUrl('Daniel Foster'), description: 'Reviewed school district options and showing schedule', timestamp: '2026-03-11T13:00:00', dealId: 'd10' },
  { id: 'a12', type: 'email', contactId: 'c13', contactName: 'Jennifer Lee', contactAvatar: avatarUrl('Jennifer Lee'), description: 'Sent smart home property listings in East Austin area', timestamp: '2026-03-11T11:00:00', dealId: 'd12' },
  { id: 'a13', type: 'task', contactId: 'c5', contactName: 'Lisa Thompson', contactAvatar: avatarUrl('Lisa Thompson'), description: 'Drafted monthly check-in email to referral partner', timestamp: '2026-03-11T09:30:00' },
  { id: 'a14', type: 'meeting', contactId: 'c17', contactName: 'Hannah Williams', contactAvatar: avatarUrl('Hannah Williams'), description: 'Set up viewings for Saturday: 3 units in Williamsburg and Park Slope', timestamp: '2026-03-10T16:00:00', dealId: 'd9' },
  { id: 'a15', type: 'call', contactId: 'c10', contactName: 'Tom Baker', contactAvatar: avatarUrl('Tom Baker'), description: 'Discussed cross-referral arrangement. Will send partnership proposal.', timestamp: '2026-03-10T14:30:00' },
  { id: 'a16', type: 'note', contactId: 'c4', contactName: 'David Kim', contactAvatar: avatarUrl('David Kim'), description: 'Deal moved to Proposal stage', timestamp: '2026-03-10T10:00:00', dealId: 'd4' },
  { id: 'a17', type: 'email', contactId: 'c3', contactName: 'Emily Rodriguez', contactAvatar: avatarUrl('Emily Rodriguez'), description: 'Sent first-time buyer guide and lender recommendation', timestamp: '2026-03-09T15:00:00', dealId: 'd3' },
  { id: 'a18', type: 'task', contactId: 'c14', contactName: 'Carlos Mendez', contactAvatar: avatarUrl('Carlos Mendez'), description: 'Set 6-month follow-up reminder for September re-engagement', timestamp: '2026-03-09T11:00:00', dealId: 'd13' },
  { id: 'a19', type: 'meeting', contactId: 'c15', contactName: 'Sophia Nakamura', contactAvatar: avatarUrl('Sophia Nakamura'), description: 'Negotiated buyer repair request — agreed to $5K credit', timestamp: '2026-03-09T09:00:00', dealId: 'd8' },
  { id: 'a20', type: 'note', contactId: 'c20', contactName: "Kevin O'Brien", contactAvatar: avatarUrl("Kevin O'Brien"), description: 'Identified 3 potential 6-unit buildings for next investment', timestamp: '2026-03-08T16:00:00' },
  { id: 'a21', type: 'email', contactId: 'c6', contactName: 'James Wilson', contactAvatar: avatarUrl('James Wilson'), description: 'Sent comparative market analysis for 987 Cedar Ln', timestamp: '2026-03-08T14:00:00' },
  { id: 'a22', type: 'call', contactId: 'c2', contactName: 'Marcus Johnson', contactAvatar: avatarUrl('Marcus Johnson'), description: 'Reviewed CMA results — listing price set at $425K', timestamp: '2026-03-08T11:00:00', dealId: 'd2' },
  { id: 'a23', type: 'task', contactId: 'c11', contactName: 'Rachel Green', contactAvatar: avatarUrl('Rachel Green'), description: 'Sent automated listing alert for new $500K homes in LA', timestamp: '2026-03-07T10:00:00' },
  { id: 'a24', type: 'note', contactId: 'c7', contactName: 'Ana Petrov', contactAvatar: avatarUrl('Ana Petrov'), description: 'Commercial project timeline unclear. Will check back in April.', timestamp: '2026-03-06T15:00:00' },
  { id: 'a25', type: 'email', contactId: 'c16', contactName: 'Alex Rivera', contactAvatar: avatarUrl('Alex Rivera'), description: 'Initial outreach email sent — referral partnership proposal', timestamp: '2026-03-06T10:00:00' },
];

export const useCases: UseCase[] = [
  { id: 'uc1', name: 'Multi-property Investment Portfolio', client: "Kevin O'Brien", stage: 'production', attributedARR: 45000, daysActive: 180, assignedAgent: 'You', description: 'Managing ongoing investment property acquisitions for a serial investor. Currently handling 6-unit building transactions and identifying new opportunities.', linkedDealId: 'd11', contactIds: ['c20'] },
  { id: 'uc2', name: 'Corporate Relocation Program', client: 'TechHome', stage: 'poc', attributedARR: 28000, daysActive: 45, assignedAgent: 'You', description: 'Pilot program with TechHome to handle employee relocations from Bay Area to Austin. Currently managing Jennifer Lee as the first relocation client.', linkedDealId: 'd12', contactIds: ['c13'] },
  { id: 'uc3', name: 'Luxury Estate Portfolio', client: 'Nakamura Estates', stage: 'scaling', attributedARR: 72000, daysActive: 365, assignedAgent: 'You', description: 'Full-service luxury listing management for the Nakamura family portfolio. Currently 3 active listings across Malibu and Beverly Hills.', linkedDealId: 'd8', contactIds: ['c15'] },
  { id: 'uc4', name: 'First-time Buyer Education Program', client: 'Community Outreach', stage: 'discovery', attributedARR: 0, daysActive: 14, assignedAgent: 'You', description: 'Developing a first-time homebuyer education program to generate leads and build community trust. Currently in the planning phase.', contactIds: ['c3', 'c17'] },
  { id: 'uc5', name: 'Insurance Partner Referral Network', client: 'Thompson Insurance', stage: 'production', attributedARR: 35000, daysActive: 210, assignedAgent: 'You', description: 'Cross-referral partnership with Lisa Thompson\'s insurance agency. Generating consistent qualified leads each quarter.', contactIds: ['c5', 'c16'] },
  { id: 'uc6', name: 'Commercial Mixed-Use Development', client: 'Petrov Developments', stage: 'discovery', attributedARR: 0, daysActive: 30, assignedAgent: 'You', description: 'Early-stage exploration of representing Petrov Developments for a mixed-use commercial project in SF.', contactIds: ['c7'] },
];

export const stageConfig = {
  'prospecting': { label: 'Prospecting', color: 'hsl(var(--muted-foreground))' },
  'qualification': { label: 'Qualification', color: 'hsl(var(--accent))' },
  'proposal': { label: 'Proposal', color: 'hsl(var(--secondary))' },
  'negotiation': { label: 'Negotiation', color: 'hsl(var(--primary))' },
  'closed_won': { label: 'Closed Won', color: 'hsl(120, 60%, 45%)' },
  'closed_lost': { label: 'Closed Lost', color: 'hsl(var(--destructive))' },
};


export type Account = {
  id: string;
  name: string;
  industry: string;
  website: string;
  phone: string;
  revenue: number;
  currencyCode: string;
  employeeCount: number;
  owner: string;
  stage: 'active' | 'prospect' | 'churned' | 'partner';
  healthScore: number;
  contactIds: string[];
  address: string;
  logo: string;
  aiSummary: string;
  parentAccountId?: string;
  tags: string[];
  customFields?: Record<string, string>;
};

const companyLogo = (seed: string) => `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(seed)}&backgroundColor=6366f1,0ea5e9,f97316,10b981,ec4899&backgroundType=solid&fontSize=40`;

export const accounts: Account[] = [
  { id: 'acc1', name: 'Chen Properties', industry: 'Real Estate', website: 'chenproperties.com', phone: '(555) 200-1000', revenue: 2400000, currencyCode: 'USD', employeeCount: 12, owner: 'You', stage: 'active', healthScore: 92, contactIds: ['c1'], address: '456 Maple Ave, Portland, OR', logo: companyLogo('Chen Properties'), aiSummary: 'Top-performing account. Active deal under contract at $850K. Strong buyer relationship with Sarah Chen.', tags: ['buyer', 'high-value'] },
  { id: 'acc2', name: 'Johnson Realty Group', industry: 'Real Estate', website: 'johnsonrealty.com', phone: '(555) 200-2000', revenue: 5800000, currencyCode: 'USD', employeeCount: 35, owner: 'You', stage: 'active', healthScore: 78, contactIds: ['c2'], address: '123 Broadway, Austin, TX', logo: companyLogo('Johnson Realty'), aiSummary: 'Investment-focused realty group. Marcus Johnson managing multiple property deals. Two active deals in pipeline.', tags: ['investor', 'multi-deal'] },
  { id: 'acc3', name: 'Kim & Associates', industry: 'Legal / Real Estate', website: 'kimassociates.com', phone: '(555) 200-3000', revenue: 3200000, currencyCode: 'USD', employeeCount: 18, owner: 'You', stage: 'active', healthScore: 85, contactIds: ['c4'], address: '321 Elm Dr, Seattle, WA', logo: companyLogo('Kim Associates'), aiSummary: 'Luxury segment client. David Kim pursuing $1.65M estate. Application stage — high probability close.', tags: ['luxury', 'legal'] },
  { id: 'acc4', name: 'Thompson Insurance', industry: 'Insurance', website: 'thompsonins.com', phone: '(555) 200-4000', revenue: 1800000, currencyCode: 'USD', employeeCount: 8, owner: 'You', stage: 'partner', healthScore: 95, contactIds: ['c5'], address: '654 Oak Blvd, Miami, FL', logo: companyLogo('Thompson Insurance'), aiSummary: 'Key referral partner. 8 qualified leads this quarter, 3 closed deals. Monthly check-ins scheduled.', tags: ['referral-partner', 'insurance'] },
  { id: 'acc5', name: 'Petrov Developments', industry: 'Commercial Development', website: 'petrovdev.com', phone: '(555) 200-5000', revenue: 12000000, currencyCode: 'USD', employeeCount: 45, owner: 'You', stage: 'prospect', healthScore: 38, contactIds: ['c7'], address: '147 Market St, San Francisco, CA', logo: companyLogo('Petrov Dev'), aiSummary: 'Commercial developer exploring mixed-use projects. Early stage — high potential but unclear timeline.', tags: ['commercial', 'development'], parentAccountId: undefined },
  { id: 'acc6', name: 'Pacific Realty', industry: 'Real Estate', website: 'pacificrealty.com', phone: '(555) 200-6000', revenue: 4500000, currencyCode: 'USD', employeeCount: 22, owner: 'You', stage: 'active', healthScore: 98, contactIds: ['c8'], address: '258 Beach Rd, San Diego, CA', logo: companyLogo('Pacific Realty'), aiSummary: 'Repeat client — Robert Chang. 3rd transaction just closed. Excellent long-term relationship.', tags: ['repeat-client'] },
  { id: 'acc7', name: 'Nakamura Estates', industry: 'Luxury Real Estate', website: 'nakamuraestates.com', phone: '(555) 200-7000', revenue: 8200000, currencyCode: 'USD', employeeCount: 15, owner: 'You', stage: 'active', healthScore: 91, contactIds: ['c15'], address: '147 Hillside Dr, Malibu, CA', logo: companyLogo('Nakamura Estates'), aiSummary: 'Luxury portfolio — $2.1M listing under contract. High commission deal expected to close by end of March.', tags: ['luxury', 'high-value'] },
  { id: 'acc8', name: 'Torres Group', industry: 'Investment', website: 'torresgroup.com', phone: '(555) 200-8000', revenue: 6100000, currencyCode: 'USD', employeeCount: 28, owner: 'You', stage: 'active', healthScore: 88, contactIds: ['c12'], address: '963 Highland Rd, Phoenix, AZ', logo: companyLogo('Torres Group'), aiSummary: 'Selling 4-unit apartment complex at $1.4M. Under contract — inspection scheduled. High-value investor relationship.', tags: ['investor'] },
  { id: 'acc9', name: "O'Brien & Partners", industry: 'Investment', website: 'obrienpartners.com', phone: '(555) 200-9000', revenue: 15000000, currencyCode: 'USD', employeeCount: 52, owner: 'You', stage: 'active', healthScore: 90, contactIds: ['c20'], address: '852 Wall St, New York, NY', logo: companyLogo('OBrien Partners'), aiSummary: 'Serial investor — 5th deal together. Just closed 6-unit building. Always looking for new opportunities.', tags: ['investor', 'repeat-client', 'high-value'] },
  { id: 'acc10', name: 'Baker Mortgage Co.', industry: 'Mortgage / Finance', website: 'bakermortgage.com', phone: '(555) 200-0000', revenue: 3800000, currencyCode: 'USD', employeeCount: 14, owner: 'You', stage: 'prospect', healthScore: 55, contactIds: ['c10'], address: '741 Finance Ave, Charlotte, NC', logo: companyLogo('Baker Mortgage'), aiSummary: 'Potential referral partner. Met at NAMB conference. Cross-referral arrangement under discussion.', tags: ['mortgage', 'referral-partner'] },
  { id: 'acc11', name: 'TechHome', industry: 'Technology', website: 'techhome.io', phone: '(555) 200-1100', revenue: 9500000, currencyCode: 'USD', employeeCount: 120, owner: 'You', stage: 'prospect', healthScore: 67, contactIds: ['c13'], address: '159 Innovation Dr, Austin, TX', logo: companyLogo('TechHome'), aiSummary: 'Corporate relocation pilot program. Jennifer Lee is the first relocation client. Timeline depends on Bay Area home sale.', tags: ['technology', 'relocation'], customFields: { 'Program Type': 'Corporate Relocation' } },
  { id: 'acc12', name: 'Foster Homes', industry: 'Real Estate', website: 'fosterhomes.com', phone: '(555) 200-1200', revenue: 1200000, currencyCode: 'USD', employeeCount: 5, owner: 'You', stage: 'active', healthScore: 74, contactIds: ['c18'], address: '147 School St, Boston, MA', logo: companyLogo('Foster Homes'), aiSummary: 'Family home search — 4BR in good school district. Application submitted, lease pressure means May deadline.', tags: ['family', 'residential'] },
];

export const accountStageConfig = {
  'active': { label: 'Active', color: 'hsl(120, 60%, 45%)' },
  'prospect': { label: 'Prospect', color: 'hsl(var(--accent))' },
  'churned': { label: 'Churned', color: 'hsl(var(--destructive))' },
  'partner': { label: 'Partner', color: 'hsl(var(--primary))' },
};

export const useCaseStageConfig = {
  'discovery': { label: 'Discovery', color: 'hsl(var(--muted-foreground))' },
  'poc': { label: 'POC', color: 'hsl(var(--accent))' },
  'production': { label: 'Production', color: 'hsl(var(--primary))' },
  'scaling': { label: 'Scaling', color: 'hsl(120, 60%, 45%)' },
  'sunset': { label: 'Sunset', color: 'hsl(var(--destructive))' },
};
