// utils/recruit-seeds-finance-en.ts
// English version of finance interview tips (recruit-seeds-finance.ts + recruit-seeds-finance2.ts).
//
// Same structure as Chinese originals but with cat='Finance' and English round names:
//   Round 1 / Round 2 / Leader / HR / General
// IDs prefixed with 'seed3_fin_en_' to avoid collisions.
// Assembly entry: recruit-store.ts → seedResources().

import type { SeedDef } from './recruit-store';

export const FINANCE_SEEDS_EN: SeedDef[] = [
  /* ==================================================================
   * I. Round Methodology (company-agnostic: what each round tests)
   * ================================================================== */

  {
    id: 'seed3_fin_en_r1_overview', type: 'qa', cat: 'Finance', round: 'Round 1',
    tags: ['Finance', 'Round 1', 'Technical'],
    title: 'What Does Round 1 (Technical) Actually Test? — Finance Interview Framework',
    content: 'Round 1 is typically conducted by your future direct colleague or a senior finance professional. The core question is "can you actually do the work?" Four high-frequency areas: ① Technical foundations — three-statement articulation, revenue recognition, depreciation & amortization, tax basics; you should be able to write journal entries and explain their impact on financial statements; ② Tool proficiency — Excel (SUMIFS/VLOOKUP/pivot tables) is a must; SQL/BI/Python are strong differentiators; ③ Resume deep-dive — every internship on your CV will be probed line by line: "what was the scope, what did you specifically do, how did you verify the results?"; ④ A mini case — e.g., "here are three statements for a company, tell me about its operating condition." Prep tip: prepare your most familiar experience into a 10-minute version, ready for three layers of follow-up questions.'
  },
  {
    id: 'seed3_fin_en_r2_overview', type: 'qa', cat: 'Finance', round: 'Round 2',
    tags: ['Finance', 'Round 2', 'Cross-functional'],
    title: 'Round 2 (Cross-Functional): From "Can Do Accounting" to "Understands Business"',
    content: 'Round 2 is often conducted by a different department (business finance, internal control, tax, treasury) or a senior manager. The focus shifts from "technical skills" to "business understanding & collaboration." Common questions: ① How do you view the relationship between finance and business? ② A business unit wants to spend a budget — should you approve it, and based on what? ③ Revenue grew but cash flow worsened — what could be the cause, and how would you investigate? ④ How do you handle cross-departmental pushback? Answering framework: first give the judgment criteria, then the analysis path, and finally land on "I would first check which data, confirm with whom, and provide what recommendation." Avoid reciting accounting standards — Round 2 wants to hear whether you can be a "business partner," not whether you can memorize GAAP.'
  },
  {
    id: 'seed3_fin_en_r3_leader', type: 'qa', cat: 'Finance', round: 'Leader',
    tags: ['Finance', 'Leader', 'Manager'],
    title: 'Leader Round: Four Hidden Dimensions the Department Head Evaluates',
    content: 'By this round, your technical competence is already accepted. The Leader is deciding "should I put this person on my team?" Four things they truly care about: ① Stability — can you stay, do you have realistic expectations about month-end/year-end close intensity and overtime; ② Growth mindset — when facing something you haven\'t done before, do you wait for instructions or find your own way (give a real example); ③ Personality fit — what types of people are already on the team, what\'s missing, and whether you complement them; ④ Authentic motivation — why finance, why our company, why this city. Prep tip: think through "what kind of finance professional do I want to become in 3 years" and align it with the team\'s development path; be specific — avoid vague claims like "I learn fast," instead say "I taught myself X in two weeks and produced Y."'
  },
  {
    id: 'seed3_fin_en_r4_hr', type: 'qa', cat: 'Finance', round: 'HR',
    tags: ['Finance', 'HR', 'Compensation'],
    title: 'HR Round: Five Questions Where Finance Candidates Most Often Stumble',
    content: 'HR rounds rarely reject candidates, but finance candidates have five high-frequency failure points: ① "How many offers do you have?" — state the number and stage honestly; don\'t fabricate or reveal full salary details; ② "Expected salary" — first ask about the structure (base / performance bonus / year-end / allowances / equity), then give a range where the lower bound is your acceptable minimum; ③ "Why did you leave your last job / why didn\'t your internship convert?" — state objective reasons and what you learned, never complain about the former employer; ④ "Can you accept overtime?" — finance genuinely has intense month-end/year-end closes and audit busy seasons; recommended answer: "I understand and accept periodic high-intensity, while using processes and templates to compress repetitive work"; ⑤ "What questions do you have for me?" — ask about development paths, team structure, and evaluation methods; don\'t ask detailed compensation questions (that\'s for the offer negotiation stage).'
  },
  {
    id: 'seed3_fin_en_r1_case', type: 'qa', cat: 'Finance', round: 'Round 1',
    tags: ['Finance', 'Case Study', 'On-the-spot Modeling'],
    title: 'Round 1 Case Question: Four-Step Method for Rapid Statement Reading',
    content: 'When handed a set of financial statements, follow these four steps to stay calm: ① Check scale & growth — absolute revenue and net profit figures plus YoY growth rates; first qualitatively assess "what magnitude of company is this?"; ② Check quality — ratio of operating cash flow to net profit (sustained <1 is a red flag), gross margin and net margin trends, whether A/R and inventory days are deteriorating; ③ Check structure — debt-to-asset ratio, interest-bearing debt scale, whether cash covers short-term borrowings (liquidity safety); ④ Give your conclusion — use DuPont to decompose ROE into net margin × turnover × equity multiplier, identify the driving factor, then say "if I were to improve it, I\'d first look at this component." Bonus move: proactively say "these are statement-level figures; I\'d also want to confirm revenue recognition policy and related-party transactions" — this demonstrates professional skepticism.'
  },
  {
    id: 'seed3_fin_en_r2_bp', type: 'qa', cat: 'Finance', round: 'Round 2',
    tags: ['Finance', 'FP&A', 'Business Partner'],
    title: 'Round 2 High-Frequency: Business Wants to Add Budget — Do You Approve?',
    content: 'This is the classic FP&A scenario question. It tests "do you have a judgment framework?" not "approve or reject." Recommended four-step answer: ① First clarify inputs & outputs — where is the money going, how much revenue or cost savings will it generate, what\'s the payback period; require the business team to provide their calculation methodology; ② Calculate ROI and payback period, compare with historical similar projects and industry benchmarks; ③ Check cash flow & budget headroom — even if ROI looks good, verify whether current-quarter cash can support it and whether it would crowd out higher-priority projects; ④ Offer alternatives — small-scale pilot before full rollout, or milestone-linked phased funding. Close with: "I would document the assumptions and calculation methodology clearly, align with the business team\'s methodology before presenting to leadership" — this shows you understand business while maintaining financial rigor.'
  },

  /* ==================================================================
   * II. Tech Giants · Finance-Specific
   * ================================================================== */

  {
    id: 'seed3_fin_en_tx_r1', type: 'qa', cat: 'Finance', company: 'Tencent', round: 'Round 1',
    tags: ['Finance', 'Tencent', 'Tech'],
    title: 'Tencent Finance Round 1: Technical Questions & Business Understanding',
    content: 'Tencent finance (including FP&A, accounting, internal control) Round 1 emphasizes: solid technical foundation + feel for business models. High-frequency questions: ① Internet company revenue recognition — how to recognize game virtual items, membership subscriptions, and ad revenue respectively (period-based amortization / progress-based / per-click or per-impression); ② Why deferred revenue is a large proportion on internet company balance sheets and what it means; ③ Given a business\'s DAU, ARPU, and customer acquisition cost, how to assess whether the business is healthy; ④ Excel practical — multi-dimensional aggregation with SUMIFS, pivot tables grouped by month. Prep tip: read Tencent\'s latest annual report\'s "Revenue" and "Deferred Revenue" notes beforehand; being able to discuss the revenue mix of games vs. ads is far more useful than memorizing GAAP.'
  },
  {
    id: 'seed3_fin_en_tx_leader', type: 'qa', cat: 'Finance', company: 'Tencent', round: 'Leader',
    tags: ['Finance', 'Tencent', 'Leader'],
    title: 'Tencent Finance Leader Round: What Kind of People They Like',
    content: 'Tencent finance Leaders generally value three qualities: ① Logic & structured communication — answer with conclusion first, then supporting evidence; able to explain one thing clearly within a minute; ② Initiative & ownership mindset — give examples of problems you proactively discovered and changes you drove, rather than waiting to be assigned tasks; ③ Data sensitivity — given an anomalous number, will you follow up with "why?" Common follow-up: How do you interpret "finance must understand business"? Do you see finance\'s role as supervision or enablement? Recommendation: prepare a real example where you used data to convince someone — this is more persuasive than any theory. Tencent also strongly values cultural fit, so be authentic rather than reciting templates.'
  },
  {
    id: 'seed3_fin_en_ali_r1', type: 'qa', cat: 'Finance', company: 'Alibaba', round: 'Round 1',
    tags: ['Finance', 'Alibaba', 'E-commerce'],
    title: 'Alibaba Finance Round 1: E-commerce Finance Topics',
    content: 'Alibaba finance Round 1 heavily incorporates e-commerce business scenarios: ① How platform commission, ad revenue, and first-party sales revenue differ in recognition (gross method vs. net method — this is a high-frequency topic); ② How promotional event (Singles\' Day) revenue and costs are recognized across periods, how pre-sale deposits are handled; ③ The difference between GMV and revenue, why GMV is high but revenue is low; ④ Impact of return rates, bad debt, and subsidies (e.g., coupons, red packets) on revenue and expenses; ⑤ Common metric decomposition — AOV × conversion rate × traffic, which component would you investigate first if there\'s a problem. Prep tip: master the judgment criteria for "gross vs. net method" (whether the entity is a principal, bears inventory risk, has pricing power) — this is the core dividing line in e-commerce finance.'
  },
  {
    id: 'seed3_fin_en_ali_r2', type: 'qa', cat: 'Finance', company: 'Alibaba', round: 'Round 2',
    tags: ['Finance', 'Alibaba', 'Round 2'],
    title: 'Alibaba Finance Round 2: Cross-department Collaboration & Driving Projects',
    content: 'Alibaba Round 2 leans toward "business partner + driving force." Typical questions: ① A business line is consistently losing money, the business head wants to keep investing — as finance, what\'s your view? ② How do you get the business team to cooperate with budget preparation? What if they don\'t cooperate? ③ Data metrics don\'t match between finance and business — how do you handle it? Answering approach: provide a process — first align on metric definitions (documented), then find discrepancy samples and verify line by line, then determine whether it\'s a system data-extraction issue or a business input issue, and finally codify as rules and dashboards. Alibaba heavily values "getting results," so emphasize your final output (e.g., "after aligning metrics, monthly reconciliation time dropped from 3 days to half a day"), not just the process.'
  },
  {
    id: 'seed3_fin_en_bd_r1', type: 'qa', cat: 'Finance', company: 'ByteDance', round: 'Round 1',
    tags: ['Finance', 'ByteDance', 'Tech'],
    title: 'ByteDance Finance Round 1: Technical & Resilience Under Fast Pace',
    content: 'ByteDance finance is known for fast pace and constant change. Round 1 tests both technical and resilience simultaneously: ① Technically, focus on revenue recognition (ads, livestreaming, e-commerce), multi-currency and FX treatment for overseas business, and data tool capabilities (SQL for data extraction and Excel modeling are hard requirements; Python is a plus); ② Resilience & adaptability — "if requirements come today and results are needed tomorrow, how do you ensure quality?" Recommended answer: "first confirm scope and priority, use templated processes to ensure baseline quality, while logging improvement items for later"; ③ Will ask about your views on overtime and rapid change — answer honestly but express that you use methods to reduce repetitive work. Prep tip: review "overseas revenue recognition" and "related-party transactions & transfer pricing" — ByteDance has extensive overseas operations, making these distinct from domestic peers.'
  },
  {
    id: 'seed3_fin_en_bd_hr', type: 'qa', cat: 'Finance', company: 'ByteDance', round: 'HR',
    tags: ['Finance', 'ByteDance', 'HR'],
    title: 'ByteDance Finance HR Round: Pragmatic, Direct, Data-Driven',
    content: 'ByteDance HR style is direct and pragmatic. Common questions: ① Current offer situation and priority (be honest; ByteDance cares a lot about whether you\'ll actually come); ② Why ByteDance, which business line interests you; ③ Expected salary (ask about structure first, then give a range); ④ Can you handle high intensity. Key points: articulate your understanding of and interest in specific businesses (Douyin / E-commerce / Lark / Overseas), explain what you can bring; when discussing compensation, factor in year-end bonus and equity — ByteDance\'s cash + options structure has significant flexibility. In the reverse-Q&A, ask "what business does this role support in the team, what\'s the most important output for the first six months" — this shows goal orientation.'
  },
  {
    id: 'seed3_fin_en_mt_r1', type: 'qa', cat: 'Finance', company: 'Meituan', round: 'Round 1',
    tags: ['Finance', 'Meituan', 'Local Services'],
    title: 'Meituan Finance Round 1: Financial Characteristics of Local Services',
    content: 'Meituan\'s business is operations- and subsidy-heavy. Round 1 technical questions often revolve around these: ① How to recognize commission revenue from food delivery / in-store dining, whether the platform is a principal or agent; ② User subsidies, rider costs, and merchant incentives — which accounts do they hit (subsidies typically reduce revenue or go to selling expenses, depending on whether a distinct service is obtained); ③ Per-order profitability model — AOV, commission rate, delivery cost, subsidy rate; how to calculate whether a single order is profitable; ④ Key operating metrics: order volume, GTV, monetization rate, fulfillment cost rate. Prep tip: being able to explain the judgment logic for "should subsidies reduce revenue or go to expenses" is hard currency in Meituan finance interviews; preparing a "UE model (unit economics)" explanation is a strong differentiator.'
  },
  {
    id: 'seed3_fin_en_mt_r2', type: 'qa', cat: 'Finance', company: 'Meituan', round: 'Round 2',
    tags: ['Finance', 'Meituan', 'UE Model'],
    title: 'Meituan Finance Round 2: How to Explain UE Models Like You Truly Understand Them',
    content: 'Round 2 almost certainly covers unit economics (UE). Recommended structure: ① Revenue side — AOV × monetization rate (commission rate + ads); ② Cost side — fulfillment cost (delivery), subsidies, payment & customer service costs; ③ Derive per-order contribution margin, then look at customer acquisition cost (CAC) vs. lifetime value (LTV), checking whether LTV/CAC exceeds 3; ④ Sensitivity analysis — if subsidy drops by 1 percentage point, how much does per-order profit improve, and how much might order volume decline. Bonus: proactively note that "UE is a static snapshot; you also need to consider scale effects, fixed cost absorption, and the rationality of new-business ramp-up periods" — this shows you don\'t just calculate, you understand business stages.'
  },
  {
    id: 'seed3_fin_en_jd_r1', type: 'qa', cat: 'Finance', company: 'JD.com', round: 'Round 1',
    tags: ['Finance', 'JD.com', 'Retail'],
    title: 'JD.com Finance Round 1: Retail & Supply Chain Finance Topics',
    content: 'JD.com is primarily first-party retail, so its finance topics differ significantly from platform-type companies: ① Revenue recognition differences between first-party and platform (first-party uses gross method for merchandise sales; platform recognizes only commission); ② Inventory & accounts payable turnover — retail companies can have negative cash conversion cycles, why (sell goods before paying suppliers) — this is retail\'s core advantage; ③ Low gross margin but fast turnover — how to evaluate this business using ROIC rather than gross margin; ④ Logistics fulfillment cost and warehouse depreciation allocation. Prep tip: memorize "cash conversion cycle = A/R days + inventory days − A/P days" and be able to explain why retail companies want it as short as possible or even negative — this is a classic differentiator in retail finance interviews.'
  },
  {
    id: 'seed3_fin_en_baidu_r1', type: 'qa', cat: 'Finance', company: 'Baidu', round: 'Round 1',
    tags: ['Finance', 'Baidu', 'Tech'],
    title: 'Baidu Finance Round 1: Ad Revenue & R&D Investment Treatment',
    content: 'Baidu finance Round 1 distinctive topics: ① Search ad and feed ad revenue recognition (typically per-click or per-impression, a point-in-time or short-cycle performance obligation); ② Revenue recognition under agency model — settlement with agencies vs. advertisers, gross vs. net method implications; ③ R&D expenditure capitalization vs. expensing judgment (research phase = expense; development phase may be capitalized if conditions are met), and impact on current-period profit and balance sheet; ④ AI business (cloud, autonomous driving) has large investment and long payback periods — how to evaluate financial rationality. Prep tip: memorize "the five conditions for R&D capitalization" and explain the impact of capitalization on profit and asset structure — this is a high-frequency topic for tech-company finance interviews.'
  },
  {
    id: 'seed3_fin_en_pdd_r1', type: 'qa', cat: 'Finance', company: 'PDD', round: 'Round 1',
    tags: ['Finance', 'PDD', 'E-commerce'],
    title: 'PDD Finance Round 1: Financial Judgment for Subsidy-Driven Business',
    content: 'PDD finance questions almost always involve subsidies: ① How to account for "10-billion subsidy" in financial statements (mostly as promotional reduction of revenue or selling expense; key question is whether a distinctly identifiable service is obtained); ② How to use financial tools to evaluate subsidy efficiency — look at incremental ROI, repeat purchase rate, and customer acquisition cost, not just GMV; ③ Agricultural and white-label products\' low-margin high-turnover model — what does cash flow look like; ④ Temu\'s overseas expansion involves multi-currency, tariffs, and cross-border settlement risks. Prep tip: when answering subsidy questions, always distinguish between "accounting treatment" and "business judgment" — first explain how accounting standards handle it, then how finance should evaluate efficiency; covering both layers is a complete answer.'
  },
  {
    id: 'seed3_fin_en_xm_r1', type: 'qa', cat: 'Finance', company: 'Xiaomi', round: 'Round 1',
    tags: ['Finance', 'Xiaomi', 'Hardware'],
    title: 'Xiaomi Finance Round 1: Hardware + Internet Services Dual Structure',
    content: 'Xiaomi\'s unique "low-margin hardware + high-margin internet services" dual structure is frequently tested in Round 1: ① How hardware revenue and internet services revenue are recognized respectively (hardware at delivery point; services amortized over subscription period); ② The business logic and financial impact behind the comprehensive net margin commitment (≤5%); ③ Inventory write-down — phones and electronics iterate quickly, how to conduct impairment testing; ④ Investment income from IoT ecosystem companies and equity method accounting for associates. Prep tip: being able to explain the "use hardware for traffic, monetize through services" business model and its manifestation on financial statements (overall gross margin pulled up by services) shows you\'ve genuinely studied the company, not just how to make journal entries.'
  },
  {
    id: 'seed3_fin_en_wy_r1', type: 'qa', cat: 'Finance', company: 'NetEase', round: 'Round 1',
    tags: ['Finance', 'NetEase', 'Gaming'],
    title: 'NetEase Finance Round 1: Game Revenue Recognition Is Central',
    content: 'NetEase is gaming-centric; game revenue recognition is a must-test in Round 1: ① Two types of virtual items — consumable items (recognized as consumed) vs. permanent items (amortized over estimated player lifecycle); what are the judgment criteria; ② How to estimate player lifecycle (PUR), and how changes in estimate (an accounting estimate change) are handled; ③ What a large deferred revenue balance means (revenue from top-ups not yet recognized — a reservoir of future revenue); ④ Revenue sharing with channels — gross method or net method. Prep tip: thoroughly explain "consumable vs. permanent" judgment and "deferred revenue" — these are the biggest differentiators for gaming-company finance interviews compared to other industries.'
  },
  {
    id: 'seed3_fin_en_hw_r1', type: 'qa', cat: 'Finance', company: 'Huawei', round: 'Round 1',
    tags: ['Finance', 'Huawei', 'Manufacturing'],
    title: 'Huawei Finance Round 1: Project Finance & Global Settlement',
    content: 'Huawei finance (especially PFC / Project Finance Controller) Round 1 features: ① Full-lifecycle project financial management — cost estimation at bidding stage, budget control during execution, final settlement and post-mortem at close; ② Multi-currency settlement for overseas projects, FX risk, and basics of hedging; ③ Revenue recognition — equipment sales, software licensing, and service delivery often constitute multiple performance obligations requiring transaction price allocation; ④ Cost accounting — standard cost vs. actual cost variance analysis in manufacturing. Prep tip: Huawei strongly values "willingness to go overseas, ability to handle pressure, understanding of business" — demonstrate your grasp of project-based finance and proactively express willingness to work on the business front lines.'
  },
  {
    id: 'seed3_fin_en_hw_r2', type: 'qa', cat: 'Finance', company: 'Huawei', round: 'Round 2',
    tags: ['Finance', 'Huawei', 'Round 2'],
    title: 'Huawei Finance Round 2: Stress Interview & Values Assessment',
    content: 'Huawei Round 2 is often described as a stress interview — they intentionally push until you can\'t answer, to see your reaction: ① When stumped, don\'t fabricate — say "I\'m genuinely not familiar with this area; my understanding is... I would verify it this way" — honesty is valued more than bluffing; ② They will repeatedly challenge the authenticity of your experience, so every number on your resume must have a traceable source; ③ Values & willingness to endure — can you accept overseas assignment and high intensity? Answer sincerely but with boundaries (willing to take on challenges, while expressing you use methods to improve efficiency). Prep tip: prepare your most impressive experience to withstand five layers of probing, and pre-plan your standard response for "when I don\'t know."'
  },
  {
    id: 'seed3_fin_en_byd_r1', type: 'qa', cat: 'Finance', company: 'BYD', round: 'Round 1',
    tags: ['Finance', 'BYD', 'Manufacturing'],
    title: 'BYD Finance Round 1: Manufacturing Cost & Supply Chain Finance',
    content: 'As a vertically integrated manufacturer, BYD Round 1 focuses on: ① Cost accounting — choice between process costing / job-order costing / step-down method, standard cost & variance analysis (material price variance, quantity variance, labor efficiency variance); ② Internal transfer pricing issues from vertical integration, and intercompany transaction elimination; ③ Inventory & write-down — raw material prices are volatile (e.g., lithium, copper), how to test for impairment; ④ Depreciation policies in asset-heavy industries, timing of AUC-to-asset reclassification, and impact on profit; ⑤ Government grant accounting (asset-related vs. income-related). Prep tip: being able to explain the three variances in "standard cost variance analysis" clearly is standard for manufacturing finance interviews.'
  },

  /* ==================================================================
   * III. Accounting Firms (Big 4) Specific
   * ================================================================== */

  {
    id: 'seed3_fin_en_pwc_r1', type: 'qa', cat: 'Finance', company: 'PwC', round: 'Round 1',
    tags: ['Finance', 'Big 4', 'Audit', 'PwC'],
    title: 'Big 4 Round 1 (M/Manager Interview): How to Pass for Audit',
    content: 'Big 4 audit Round 1 is typically conducted by a manager. Three core areas: ① Technical foundation — revenue recognition, inventory, fixed assets, receivable confirmation, internal control testing; you\'ll be asked to walk through the audit approach for one account (e.g., "what procedures would you perform for revenue?"); ② Experience match — any internship, have you done working papers, can you adapt to travel and busy season; ③ English capability — some teams include an English self-introduction or Q&A segment. Prep tip: prepare a complete audit approach template for any account (Objective → Risk → Control Testing → Substantive Procedures → Conclusion) that works for any account; also organize your CPA passed subjects, Excel, and data analysis capabilities in advance — these are hard currency.'
  },
  {
    id: 'seed3_fin_en_deloitte_r1', type: 'qa', cat: 'Finance', company: 'Deloitte', round: 'Round 1',
    tags: ['Finance', 'Big 4', 'Audit', 'Deloitte'],
    title: 'Big 4 Audit High-Frequency: Revenue Audit Approach',
    content: 'Standard answer structure: ① Audit objective — confirm revenue\'s occurrence (did it happen?), completeness (is it all recorded?), cutoff (is it in the right period?); ② Risk of material misstatement — revenue recognition is a high-risk area for fraud, typically presumed to have a significant risk; ③ Control testing — understand internal controls over the sales & collection cycle (order approval, shipping, invoicing, recording segregation of duties), test their effectiveness; ④ Substantive procedures — detail testing (sample sales contracts, shipping docs, invoices, payment records for four-way match), analytical procedures (monthly revenue fluctuation, gross margin vs. prior year), cutoff testing (revenue entries several days before and after year-end), external confirmation (confirm transaction amounts and balances with major customers); ⑤ Conclusion — form audit conclusion and consider impact on audit report. Delivering these five steps completely essentially secures the technical round.'
  },
  {
    id: 'seed3_fin_en_ey_r1', type: 'qa', cat: 'Finance', company: 'EY', round: 'Round 1',
    tags: ['Finance', 'Big 4', 'Audit', 'EY'],
    title: 'Big 4 Audit High-Frequency: Inventory Observation & External Confirmation',
    content: 'Inventory: ① Observation objective — confirm inventory existence, condition, and completeness; ② Procedures — observe site setup and labeling before count, during count perform sample checks (from count sheet to physical for existence, from physical to count sheet for completeness), pay attention to obsolete, damaged, third-party-held, and consignment inventory; ③ Special situations — when observation is impossible, implement alternative procedures (e.g., confirm with third party, examine warehousing contracts). Confirmation: ① A/R confirmation is a core procedure; control the sending process (send yourself, receive responses directly); ② Alternative procedures for non-responses (check subsequent collections, contracts, shipping documents); ③ Electronic responses need source verification (phone confirmation, check electronic signature). Key: always state "which assertion this procedure validates" — that\'s what demonstrates professionalism.'
  },
  {
    id: 'seed3_fin_en_kpmg_par', type: 'qa', cat: 'Finance', company: 'KPMG', round: 'Leader',
    tags: ['Finance', 'Big 4', 'Partner'],
    title: 'Big 4 Partner Round: What They\'re Looking For',
    content: 'By the Partner round, technical competence is proven. Partners judge three things: ① Can you survive busy season — they\'ll directly ask about your views on overtime, travel, and sustained high-intensity work; answer honestly but methodically (e.g., "I understand busy season intensity, and I reduce unproductive overtime through process templates and proactive communication"); ② Do you have long-term commitment to the profession — they\'ll ask about career plans and CPA exam schedule; recommend clearly stating "I plan to complete CPA within 2-3 years, build a solid foundation in audit for 3 years, then evaluate direction"; ③ Are you interesting and easy to work with — partners bring teams to meet clients, so communication ease matters; don\'t be too stiff. For reverse Q&A, ask "what common traits do people who excel in this group have?" — it\'s a great closer.'
  },
  {
    id: 'seed3_fin_en_big4_exp', type: 'experience', cat: 'Finance', company: 'Big 4', round: 'General',
    author: 'Anonymous', tags: ['Finance', 'Big 4', 'Experience'],
    title: 'Big 4 Audit Fall Recruitment Experience (Round 1 → Partner)',
    content: 'Timeline: Online application (Aug-Sep) → OT (online assessment: aptitude + numerical reasoning + logic + English; must practice with real past tests) → Group/Individual interview → M interview → Partner interview. Round 1 impressions: technical questions aren\'t hard but require structured answers; managers keep asking "why" — if you can\'t answer, don\'t fabricate. Partner impressions: mostly discuss experience and motivation; low pressure but must be genuine. Pitfalls encountered: ① Didn\'t practice real OT tests, ran out of time; ② Resume stated "participated in annual audit" but couldn\'t answer which specific account, how many vouchers sampled — vague answers are very penalizing; ③ Didn\'t prepare English self-introduction, froze when asked to answer in English. Advice: practice OT two weeks in advance, ensure every number on your resume withstands three layers of probing, memorize English self-introduction.'
  },

  /* ==================================================================
   * IV. Banks / Securities / Funds / SOEs
   * ================================================================== */

  {
    id: 'seed3_fin_en_bank_r1', type: 'qa', cat: 'Finance', company: 'State-owned Bank', round: 'Round 1',
    tags: ['Finance', 'Bank', 'Fall Recruitment'],
    title: 'Bank Finance/Treasury Round 1: Bank-Specific Finance Topics',
    content: 'Bank finance differs significantly from general corporate finance. Round 1 often covers: ① A bank\'s "inventory" is loans; the core topic is the five-category loan classification (normal, special mention, substandard, doubtful, loss) and provision calculation; ② Composition of net interest income (NIM) and non-interest income (fees); ③ Meaning of regulatory metrics: loan-to-deposit ratio, capital adequacy ratio, NPL ratio, provision coverage ratio; ④ Why a bank\'s cash flow statement looks different from a regular company\'s (deposit-taking and loan-making are operating activities). Prep tip: familiarize yourself with "NPL ratio = NPLs / total loans" and "provision coverage ratio = loan loss provision / NPLs" plus their regulatory thresholds — these are the admission ticket for bank finance interviews.'
  },
  {
    id: 'seed3_fin_en_bank_hr', type: 'qa', cat: 'Finance', company: 'State-owned Bank', round: 'HR',
    tags: ['Finance', 'Bank', 'HR'],
    title: 'Bank HR Round: Stability & Compliance Are Repeatedly Confirmed',
    content: 'Bank HR cares most about two things: ① Stability — will repeatedly confirm whether you can accept branch rotation (teller / account manager), assignment to designated outlets, and whether your hometown matches the work location; answer to show long-term intent; ② Compliance & risk awareness — may ask "if you discover a colleague\'s operation violates rules, what would you do?" The standard answer is "first confirm facts, report to supervisor or compliance department per procedure, protect client and bank interests" — never answer "just give them a private reminder." Also, banks generally value certifications (junior accounting, banking qualification, partial CPA) and local-candidate preference; mention relevant certifications proactively if you have them.'
  },
  {
    id: 'seed3_fin_en_sec_r1', type: 'qa', cat: 'Finance', company: 'Securities/Fund', round: 'Round 1',
    tags: ['Finance', 'Securities', 'Fund'],
    title: 'Securities/Fund Finance Round 1: Financial Institution Finance Characteristics',
    content: 'Securities and fund finance differs from corporate finance: ① Revenue mix — brokerage commissions, investment banking fees, asset management fees, proprietary trading gains; each has different recognition rules; ② Risk-based capital requirements — net capital, risk-weighted assets, regulatory capital ratios; ③ Fair value measurement hierarchy for financial instruments (Level 1/2/3); ④ Distinction between FVTPL, FVOCI, and amortized cost classification. Prep tip: master the logic of "financial asset classification" and "fair value hierarchy" — these are the core differentiators for financial institution finance interviews.'
  },
  {
    id: 'seed3_fin_en_soe_r1', type: 'qa', cat: 'Finance', company: 'SOE/Central SOE', round: 'Round 1',
    tags: ['Finance', 'SOE', 'Central SOE'],
    title: 'SOE / Central SOE Finance Round 1: Compliance, Budget & State-Asset Evaluation',
    content: 'SOE finance topics carry distinct institutional characteristics: ① Comprehensive budget management — the "two-up two-down" preparation process, budget execution and adjustment approval; ② State-asset evaluation metrics (e.g., "two profits four ratios": total profit, net profit, debt-to-asset ratio, revenue profit margin, R&D intensity, full labor productivity); ③ Eight-point regulations and expense reimbursement compliance — a high-frequency compliance topic; ④ Government grants and special funds accounting with dedicated-use requirements; ⑤ Consolidated statements and preservation/appreciation of state capital. Prep tip: SOEs strongly value political awareness and stability; they\'ll ask about Party membership, student leadership experience, and industry understanding; professionally, memorizing "two profits four ratios" is a strong differentiator.'
  },
  {
    id: 'seed3_fin_en_fmcg_r1', type: 'qa', cat: 'Finance', company: 'FMCG MNC', round: 'Round 1',
    tags: ['Finance', 'FMCG', 'MNC'],
    title: 'FMCG MNC (P&G / Unilever etc.) Finance Management Trainee Round 1',
    content: 'FMCG finance MT characteristics: ① Eight classic questions (leadership, problem solving, innovation, teamwork, etc.) answered using STAR — prepare one real 3-minute case for each with specific data; ② English is a hard threshold — may include English case reading and English presentation; ③ Business case — e.g., "a brand\'s sales declined, how would you analyze it as finance" — the framework is decompose volume and price (volume × price × mix), then examine channel, promotion, and competitors, finally give recommendations; ④ Numerical and diagrammatic reasoning online assessments require practice. Prep tip: FMCG values "leadership + business sensitivity"; rather than memorizing accounting standards, prepare two real stories demonstrating how you drove others and delivered results.'
  },

  /* ==================================================================
   * V. Professional Depth (Accounting Standards & Core Topics)
   * ================================================================== */

  {
    id: 'seed3_fin_en_qa_rev', type: 'qa', cat: 'Finance', round: 'Round 1',
    tags: ['Finance', 'New Revenue Standard', 'High-frequency'],
    title: 'New Revenue Standard Five-Step Method (Almost Every Company Asks)',
    content: 'Five steps: ① Identify the contract with the customer (contract exists when commercial substance is present, consideration is probable of collection, etc.); ② Identify distinct performance obligations in the contract (goods or services are separately identifiable); ③ Determine the transaction price (consider variable consideration, significant financing component, non-cash consideration, consideration payable to customer); ④ Allocate the transaction price to each distinct performance obligation (typically based on relative standalone selling prices); ⑤ Recognize revenue when/as each performance obligation is satisfied (at a point in time or over a period). Three conditions for over-time recognition: customer simultaneously receives and consumes benefits as entity performs; customer controls the in-process asset; asset has no alternative use and entity has right to payment for completed portion. Bonus: give an example from your familiar industry (e.g., SaaS amortized over subscription period, hardware at delivery point).'
  },
  {
    id: 'seed3_fin_en_qa_gross', type: 'qa', cat: 'Finance', round: 'Round 1',
    tags: ['Finance', 'Gross Method', 'Net Method'],
    title: 'Gross vs. Net Method: How to Judge? (E-commerce/Platform Must-Know)',
    content: 'Determine whether the entity is a "principal" or "agent" in the transaction: principal → recognize revenue at gross amount (full); agent → recognize only commission at net. Judgment indicators (no single indicator is determinative; consider in aggregate): ① Who bears inventory risk (principals typically obtain control of the good before transfer); ② Who has pricing power; ③ Who bears primary responsibility for fulfillment and after-sales; ④ Whether the entity bears credit risk. Example: platform first-party (procure then sell) uses gross method; platform only provides matchmaking and earns commission uses net method. Key: first state the principle is "whether the entity controls the good before transfer," then list three indicators, and finally apply to the specific business.'
  },
  {
    id: 'seed3_fin_en_qa_lease', type: 'qa', cat: 'Finance', round: 'Round 1',
    tags: ['Finance', 'New Lease Standard'],
    title: 'New Lease Standard: Why Lessees Now Almost Always Recognize On-Balance-Sheet',
    content: 'Under the new lease standard, lessees recognize "right-of-use assets" and "lease liabilities" for virtually all leases (short-term and low-value asset leases may be exempt), no longer distinguishing between operating and finance leases. Consequences: ① Balance sheet expands, debt-to-asset ratio increases; ② Income statement shifts from straight-line rent to "ROU asset depreciation + lease liability interest," causing front-loaded expenses (interest is higher early, lower later) and profit trending lower-then-higher; ③ EBITDA improves (rent moves from operating expense to depreciation and interest). Bonus: articulate the impact on financial metrics for lease-heavy industries like retail and airlines (debt-to-asset ratio, EBITDA, current ratio) — this shows you understand the practical consequences of the standard change, not just the accounting treatment.'
  },
  {
    id: 'seed3_fin_en_qa_deftax', type: 'qa', cat: 'Finance', round: 'Round 2',
    tags: ['Finance', 'Deferred Tax'],
    title: 'Understanding Deferred Tax: Common Scenarios That Generate It',
    content: 'Essence: inter-period allocation of tax burden arising from "temporary differences" between accounting profit and taxable income. Taxable temporary differences → deferred tax liability (pay more tax in future); Deductible temporary differences → deferred tax asset (pay less tax in future, limited by probable future taxable income). Common scenarios: ① Asset depreciation (accounting uses straight-line; tax law uses accelerated); ② Asset impairment provisions (accounting recognized; tax law deducts only when actually realized); ③ Provisions (e.g., warranty, litigation); ④ Tax-deductible losses (recognized as DTA, require assessment of future profitability). Key: emphasize "temporary differences reverse," and explain the prudence condition for DTA recognition.'
  },
  {
    id: 'seed3_fin_en_qa_goodwill', type: 'qa', cat: 'Finance', round: 'Round 2',
    tags: ['Finance', 'Consolidated Statements', 'Goodwill'],
    title: 'Consolidated Statements & Goodwill: Why Impairment Is a Major Pitfall',
    content: 'Consolidation: ① Business combination under common control uses pooling method, no goodwill, difference adjusts capital reserve. ② Business combination not under common control uses purchase method; excess of consideration over acquirer\'s share of identifiable net assets at fair value is recognized as goodwill. Goodwill impairment: ① Goodwill is not amortized; must be tested for impairment annually, allocated to relevant asset groups or combinations; ② Once recognized, impairment cannot be reversed (key difference from inventory write-down); ③ Impairment test uses "recoverable amount = max(fair value less costs of disposal, value in use)." Bonus: note that goodwill impairment is an area of significant management judgment and audit focus; large impairments often signal that the acquisition\'s high-premium assumptions have failed.'
  },
  {
    id: 'seed3_fin_en_qa_wc', type: 'qa', cat: 'Finance', round: 'Round 1',
    tags: ['Finance', 'Working Capital', 'Cash Flow'],
    title: 'Working Capital Management: How to Improve the Cash Conversion Cycle',
    content: 'Cash Conversion Cycle CCC = A/R days + Inventory days − A/P days; shorter is better, theoretically can be negative (sell before paying, common in retail). Improvement paths: ① Receivables — tighten credit policy & terms, collection processes, factoring or bill discounting; ② Inventory — improve demand forecast accuracy, clear obsolete stock, produce to demand (JIT); ③ Payables — negotiate longer terms while maintaining supplier relationships, or use supply chain finance. Key: don\'t just say "delay supplier payments" — point out that excessively extending payables damages supply chain stability and may increase costs; the essence of working capital improvement is "get cash back to the company faster."'
  },
  {
    id: 'seed3_fin_en_qa_cost', type: 'qa', cat: 'Finance', round: 'Round 1',
    tags: ['Finance', 'Cost Reduction', 'Cost Control'],
    title: 'How to Answer "Cost Reduction" Questions with a Finance Perspective',
    content: 'These questions test structured thinking and business understanding. Recommended framework: ① First decompose the cost structure — by nature (material/labor/overhead), by department, by product line, by variable/fixed; find the largest and fastest-growing components; ② Distinguish "good costs" from "bad costs" — good costs drive revenue and competitiveness (R&D, core talent, customer experience); bad costs are redundant and inefficient (duplicate processes, idle assets, inefficient inventory); ③ Provide actionable measures with quantified targets, e.g., "through centralized procurement and annual negotiation, expect 3%-5% savings"; ④ Explain tracking mechanisms — build cost dashboards, monthly reviews vs. budget. Bonus: proactively note "cost reduction isn\'t across-the-board; avoid sacrificing long-term capability" — this shows financial judgment, not just budget-cutting.'
  },
  {
    id: 'seed3_fin_en_qa_ic', type: 'qa', cat: 'Finance', round: 'Round 2',
    tags: ['Finance', 'Internal Control', 'Risk'],
    title: 'Internal Control & Fraud Risk: Professional Skepticism Required for Finance',
    content: 'COSO five components: control environment, risk assessment, control activities, information & communication, monitoring. Fraud triangle: pressure/motive, opportunity, rationalization. Key segregation of duties for finance: authorization vs. execution, execution vs. custody, recording vs. custody, execution vs. independent verification. Example (when discovering anomalies): ① First verify facts and data, preserve evidence; ② Report per company procedure to direct supervisor or internal control/compliance; ③ Never confront privately or disclose externally without authorization. Bonus: mention that "professional skepticism" isn\'t doubting everything — it\'s "maintaining follow-up questions for anomalies and speaking with evidence."'
  },
  {
    id: 'seed3_fin_en_qa_tools', type: 'qa', cat: 'Finance', round: 'Round 1',
    tags: ['Finance', 'Excel', 'SQL', 'BI'],
    title: 'Finance Tool Proficiency: How Good Do Excel/SQL/BI Need to Be?',
    content: 'Excel (must-have): SUMIFS/COUNTIFS, XLOOKUP or INDEX+MATCH, pivot tables & slicers, IFERROR, date & text functions; when building models, separate assumption area from calculation area so one change cascades through the entire model. SQL (strong plus): SELECT + WHERE + GROUP BY + JOIN + window functions (ROW_NUMBER / SUM OVER); able to self-serve data from the warehouse without depending on business teams. BI (plus): Power BI / Tableau / Feishu multidimensional tables for dashboards; clearly explain metric definitions and refresh mechanisms. Interview tip: don\'t say "proficient" — say "I built a monthly expense dashboard with SUMIFS + pivot tables, reducing output time from 2 days to 2 hours" — prove with specific output.'
  },
  {
    id: 'seed3_fin_en_qa_tax', type: 'qa', cat: 'Finance', round: 'Round 1',
    tags: ['Finance', 'Tax'],
    title: 'Tax High-Frequency: VAT & Corporate Income Tax Essentials',
    content: 'VAT: ① Calculation methods — general method (output − input) vs. simplified method; rate tiers (13%, 9%, 6%, etc., per latest policy); ② Input credit requires valid special VAT invoice; inputs for exempt items or employee benefits cannot be credited (must be reversed out); ③ Tax obligation timing — upon receipt of payment or obtaining evidence of right to collect; if invoice is issued first, timing is invoice date. Corporate Income Tax: ① Standard rate 25%; small enterprises and high-tech enterprises enjoy preferential rates; ② Pre-tax deductions require authenticity, relevance, and reasonableness; business entertainment is deductible at 60% of amount but capped at 0.5% of revenue; advertising expenses capped at 15% of revenue; ③ Losses can be carried forward (generally 5 years; high-tech enterprises may extend). Key: policies change; state "per latest policy" to demonstrate rigor.'
  },

  /* ==================================================================
   * Company-specific Round 2 & Leader entries
   * ================================================================== */

  {
    id: 'seed3_fin_en_jd_r2', type: 'qa', cat: 'Finance', company: 'JD.com', round: 'Round 2',
    tags: ['Finance', 'JD.com', 'Round 2'],
    title: 'JD.com Finance Round 2: Financial Analysis of Warehousing & Fulfillment Costs',
    content: 'Round 2 digs into fulfillment cost: ① Decompose per-order fulfillment cost — warehousing (rent, depreciation, labor), delivery (in-house courier cost or third-party), packaging & after-sales; track fulfillment cost ratio (fulfillment cost / revenue) trend; ② Scale effects — as order volume rises, fixed costs are absorbed, but can fulfillment pricing cover incremental cost; how to determine whether to open a warehouse in a new region; ③ Business collaboration — how to use financial models to support decisions like "free-shipping threshold" and "member free delivery"; key is calculating incremental margin vs. incremental cost; ④ Inventory turnover & slow-moving — write-down and capital tied up in first-party inventory. Bonus: proactively note "fulfillment cost ratio decline typically comes from order density improvement and automation, not simply reducing courier wages" — this shows understanding of cost drivers.'
  },
  {
    id: 'seed3_fin_en_pdd_r2', type: 'qa', cat: 'Finance', company: 'PDD', round: 'Round 2',
    tags: ['Finance', 'PDD', 'Round 2'],
    title: 'PDD Finance Round 2: How to Evaluate the "Value-for-Money" Strategy in Financial Language',
    content: 'Round 2 often asks strategy-level financial judgment: ① What is the financial source of low prices — supply chain efficiency (eliminating intermediaries, direct agricultural sourcing) or subsidies (unsustainable); use gross margin and expense ratio to distinguish; ② How to quantify subsidy efficiency — incremental GMV / subsidy spend, new-customer CAC and repeat rate, post-subsidy retention; ③ Merchant ecosystem — impact of low commission and traffic allocation on platform monetization rate; how to improve monetization without harming merchants; ④ Temu\'s fully managed model — the platform bears inventory and logistics risk, affecting revenue recognition and cash flow. Key: don\'t just say "low price is a strategy" — land on "this strategy manifests as low margin + high turnover on financial statements; finance must watch cash conversion cycle and subsidy ROI."'
  },
  {
    id: 'seed3_fin_en_xm_r2', type: 'qa', cat: 'Finance', company: 'Xiaomi', round: 'Round 2',
    tags: ['Finance', 'Xiaomi', 'Round 2'],
    title: 'Xiaomi Finance Round 2: Hardware Margin & Ecosystem Investments',
    content: 'Three areas: ① Hardware gross margin is persistently low (company commits to ≤5% comprehensive net margin) — how to evaluate this business financially: look at ROIC and cash flow rather than gross margin; hardware is a traffic entry point, monetization comes from internet services; ② Ecosystem investments — equity method vs. fair value measurement for non-controlling investees; how to determine "significant influence" (typically 20%-50% shareholding presumed); ③ Inventory & FX — global sales involve multiple currencies; FX volatility\'s impact on revenue and gross margin, and whether hedging is used. Bonus: articulate how "hardware + new retail + internet services" three-engine model manifests on financial statements — this shows understanding of the business model, not just bookkeeping.'
  },
  {
    id: 'seed3_fin_en_baidu_r2', type: 'qa', cat: 'Finance', company: 'Baidu', round: 'Round 2',
    tags: ['Finance', 'Baidu', 'Round 2'],
    title: 'Baidu Finance Round 2: Evaluating AI & Cloud Business Investments',
    content: 'Round 2\'s distinctive topic: how to evaluate long-cycle investments: ① Cloud & AI businesses have early-stage losses and large capex (compute equipment depreciation); financially, you can\'t reject them with short-term ROI — look at unit customer economics (LTV/CAC) and scale inflection point; ② R&D capitalization boundary — capitalization beautifies current-period profit but increases future depreciation; finance must hold the line on "capitalize only when conditions are met" and perform sensitivity analysis; ③ How to use management reporting to distinguish "strategic losses" from "operational runaway" — check alignment with budget, improving unit economics, milestone achievement. Key: demonstrate the balance of "supporting strategic investment while maintaining financial discipline" — this is the judgment big-tech finance values most.'
  },
  {
    id: 'seed3_fin_en_ali_leader', type: 'qa', cat: 'Finance', company: 'Alibaba', round: 'Leader',
    tags: ['Finance', 'Alibaba', 'Leader'],
    title: 'Alibaba Finance Leader Round: Beyond Technical — "Heart Force" & "Brain Force"',
    content: 'Alibaba Leader round typically has three question types: ① What\'s the hardest thing you\'ve done, how did you push through (testing resilience/heart force) — use STAR, focus on what you did when stuck and the final result; ② Your understanding of the finance profession (testing thinking/brain force) — recommend answering "finance isn\'t bookkeeping; it\'s using data to tell the business story clearly and help management make decisions" with an example; ③ How you handle change and uncertainty — Alibaba reorganizes frequently; answer to demonstrate adaptability and proactive communication. Prep tip: research the team\'s served business (e.g., Taobao-Tmall, Cainiao, Cloud Intelligence) beforehand; showing understanding of one or two financial metrics for that business is more effective than any generic answer.'
  },
  {
    id: 'seed3_fin_en_bd_leader', type: 'qa', cat: 'Finance', company: 'ByteDance', round: 'Leader',
    tags: ['Finance', 'ByteDance', 'Leader'],
    title: 'ByteDance Finance Leader Round: Data-Driven & Self-Driven',
    content: 'ByteDance Leaders are generally young and fast-paced. They value two things: ① Data-driven — they\'ll give you a business phenomenon (e.g., "a product\'s revenue grew but profit didn\'t") and expect on-the-spot decomposition: first break down volume and price, then look at cost structure and expense allocation, finally pinpoint the specific component and suggest next verification steps; ② Self-driven — they\'ll ask "what have you proactively done beyond your job description" — answer with concrete output (e.g., "I proactively templated monthly reports, reducing output time from 3 days to 1 day"). ByteDance is pragmatic and dislikes abstract methodology — keep answers short, with numbers and conclusions. Reverse Q&A: ask "what are the top three priorities for this role in the next six months."'
  },
  {
    id: 'seed3_fin_en_mt_leader', type: 'qa', cat: 'Finance', company: 'Meituan', round: 'Leader',
    tags: ['Finance', 'Meituan', 'Leader'],
    title: 'Meituan Finance Leader Round: Can You Get Into the Business?',
    content: 'Meituan\'s finance culture emphasizes "getting close to the business." Leaders will assess whether you\'re willing and able to go deep into the front lines: ① They\'ll ask whether you\'ve visited business sites, interviewed business colleagues, or understood actual processes (e.g., delivery station settlement methods, merchant reconciliation pain points); ② They\'ll give a real dilemma — e.g., "business wants to invest in a project that\'s short-term loss-making but strategically important; do you approve?" Recommended answer: "first calculate the loss magnitude, duration, and exit conditions; carve it out as a strategic budget line-item with milestones — achieved means additional investment, missed means stop-loss"; ③ They\'ll test your understanding of industry competition (local services landscape and cost structure). Prep tip: personally experience Meituan\'s full delivery process once before the interview; being able to articulate one efficiency issue you observed will be very compelling.'
  },
  {
    id: 'seed3_fin_en_tx_hr', type: 'qa', cat: 'Finance', company: 'Tencent', round: 'HR',
    tags: ['Finance', 'Tencent', 'HR'],
    title: 'Tencent Finance HR Round: Compensation & Intent Confirmation',
    content: 'Tencent HR is relatively gentle, but two key points: ① Intent level — Tencent cares a lot about whether candidates genuinely want to join; they\'ll ask "which business do you most want to work on and why" — be specific about the business group and business line (e.g., WeChat, Games, Cloud) and share your understanding; ② Compensation structure — Tencent typically uses base + year-end + equity (equity vests over years); when discussing compensation, clarify the vesting schedule before giving your range; when stating expectations, ask about the full structure first, then give a range. They\'ll also confirm start date, internship duration, and whether you have competing offers or grad school plans — answer honestly. Reverse Q&A: ask "what role does finance play on this business team, and how do new hires onboard in the first six months."'
  },
  {
    id: 'seed3_fin_en_wy_leader', type: 'qa', cat: 'Finance', company: 'NetEase', round: 'Leader',
    tags: ['Finance', 'NetEase', 'Leader'],
    title: 'NetEase Finance Leader Round: Meticulous, Steady, Long-term Oriented',
    content: 'NetEase\'s style leans steady. Leader round focuses on: ① Meticulousness & reliability — finance errors are costly; they\'ll ask how you ensure work quality (recommend answering "dual review + checklist + track anomalies item by item" with an example); ② Long-term orientation — they\'ll ask about career plans and stability; NetEase wants employees who stay and grow; answer to demonstrate long-term interest in the finance profession; ③ Gaming business financial sensitivity — e.g., deferred revenue balance changes, revenue ramp-up and marketing expense pacing after new game launch. Prep tip: NetEase values cultural fit; answer naturally without over-packaging; prepare a real story of "discovering and correcting an error" — it matches their preferences perfectly.'
  },
  {
    id: 'seed3_fin_en_ks_r1', type: 'qa', cat: 'Finance', company: 'Kuaishou', round: 'Round 1',
    tags: ['Finance', 'Kuaishou', 'Livestreaming'],
    title: 'Kuaishou Finance Round 1: Livestreaming & E-commerce Revenue Recognition',
    content: 'Kuaishou Round 1 business-specific topics: ① Livestreaming tip revenue — users purchase virtual gifts to tip hosts; how to recognize platform revenue (typically when gifts are consumed), and how to handle revenue sharing with hosts and guilds (gross vs. net method, depending on whether platform is principal or agent); ② E-commerce commission and ad revenue; ③ Host incentive and subsidy accounting treatment; ④ Key operating metrics — DAU, time spent, e-commerce GMV, monetization rate, selling expense ratio (acquisition spending is high; must articulate ROI). Prep tip: clearly explain "virtual item revenue recognition timing" and "platform share principal vs. agent judgment" — these are core topics for livestreaming/social company finance interviews.'
  },
  {
    id: 'seed3_fin_en_ant_r1', type: 'qa', cat: 'Finance', company: 'Ant Group', round: 'Round 1',
    tags: ['Finance', 'Ant Group', 'Fintech'],
    title: 'Ant Group Finance Round 1: Fintech & Compliance Dual Attributes',
    content: 'Ant\'s finance roles combine financial and tech attributes. Round 1 topics: ① Fintech revenue composition — payment processing fees, loan facilitation service fees, technology service fees; how each is recognized; ② Credit risk and provisioning for lending business (while not a bank, understanding risk-sharing and accounting treatment under joint lending model is important); ③ Customer reserve funds & segregation — payment institutions cannot treat customer reserves as own funds; this is a strong compliance requirement; ④ Data compliance and personal information protection\'s impact on business and costs. Prep tip: financial institution finance roles heavily value compliance awareness; when discussing fund and risk topics, address compliance boundaries first, then efficiency — this appears more professional.'
  },
  {
    id: 'seed3_fin_en_big4_hr', type: 'qa', cat: 'Finance', company: 'Big 4', round: 'HR',
    tags: ['Finance', 'Big 4', 'HR'],
    title: 'Big 4 HR Round: Six Things to Confirm Before Accepting an Offer',
    content: 'HR rounds typically cover offer details. Six must-ask items: ① Start date and group (audit or consulting, which industry served); ② Compensation structure — base, travel allowance, overtime pay or time-off-in-lieu policy, annual leave; ③ CPA policy — exam leave, pass bonus, certification allowance; ④ Busy season intensity & travel arrangement (are you constantly on the road?); ⑤ Training system & promotion path (A1→A2→S1 pace and evaluation criteria); ⑥ Signing terms & penalty clauses. Reminder: Big 4 compensation is relatively transparent, no need to over-negotiate; focus on "which group and which projects you can access" — the industry and project experience in the first two years is far more valuable than a few thousand RMB more per month.'
  },

  /* ==================================================================
   * VI. Resume & Offer
   * ================================================================== */

  {
    id: 'seed3_fin_en_cv_struct', type: 'resume', cat: 'Finance', round: 'General',
    tags: ['Resume', 'Finance', 'Template'],
    title: 'Finance Resume Template (Accounting Track vs. FP&A Track)',
    content: 'Accounting/Reporting track: Education → Certifications (CPA passed subjects, junior/senior accounting) → Experience (month-end close, statement preparation, audit working papers, tax filing — use quantified expressions like "independently completed month-end close for X entities, reducing statement output time from 8 to 5 days") → Systems (SAP / Yonyou / Kingdee / Oracle). FP&A / Financial Analysis track: Education → Certifications → Experience (budget preparation, business analysis, ad-hoc modeling) → Tools (Excel modeling, SQL, Power BI / Tableau) → Business analysis or competitions. Common to both: numbers must be real with clear methodology; finance particularly values meticulousness — typos and messy formatting are fatal; one page, export as PDF named "Name-Position-University."'
  },
  {
    id: 'seed3_fin_en_cv_cert', type: 'resume', cat: 'Finance', round: 'General',
    tags: ['Resume', 'Certification', 'CPA'],
    title: 'How to List Certifications on a Finance Resume (Don\'t Write "Studying" as "Passed")',
    content: 'Writing conventions: ① Passed subjects: write them explicitly, e.g., "CPA Passed: Accounting, Tax Law (2025)" — don\'t make HR guess; ② In-progress: write "CPA In Progress (planning X subjects in 2026)" — never ambiguously write just "CPA" which implies you hold the certificate; ③ Junior/Senior Accounting, ACCA (specify how many F-stage papers passed), CFA similarly; ④ English and computer skills listed separately (CET-6 score, Computer Level 2). Ordering: put the most relevant to the target position first — for accounting firms, prioritize CPA and audit internship; for corporate FP&A, prioritize modeling and data analysis skills. Reminder: interviews will definitely ask about certification progress; whatever you write, be ready to discuss.'
  },
  {
    id: 'seed3_fin_en_offer', type: 'qa', cat: 'Finance', round: 'HR',
    tags: ['Finance', 'Offer', 'Compensation'],
    title: 'Finance Offer Comparison & Salary Negotiation: Look at Structure, Not Just Numbers',
    content: 'When comparing offers, decompose into five parts: ① Cash — monthly base × payment months (13/14/16-month) + year-end bonus (note whether fixed or performance-linked; ask about historical payout multiplier); ② Allowances — meal, transport, housing, travel & expat; ③ Long-term incentive — equity/options (check vesting schedule and exercise conditions; don\'t just look at the total package number); ④ Growth — is the role accounting or analysis, will you interface with business, does the team have mentorship; ⑤ Hidden costs — overtime intensity, commute, city cost of living. Negotiation script: "I\'m very excited about this opportunity; I\'m targeting total compensation in the X to Y range, primarily considering overall structure and team development — could you walk me through the year-end and incentive components?" Ask structure first, then give a range — far more proactive than quoting a number.'
  },
  {
    id: 'seed3_fin_en_timeline', type: 'qa', cat: 'Finance', round: 'General',
    tags: ['Finance', 'Fall Recruitment', 'Timeline'],
    title: 'Finance Fall Recruitment Timeline (Don\'t Miss Key Milestones)',
    content: 'Jul-Aug: Summer internship conversion (most important — many companies\' finance roles mainly come from conversion); Aug-Sep: Early batch and main batch online applications, Big 4 and internet companies earliest; Sep-Oct: Written tests (aptitude, personality, technical) and Round 1/2 interviews; Oct-Nov: Peak interview period and offer issuance; Nov-Dec: SOEs, banks, and public institutions gradually open; Mar-Apr next year: Spring recruitment supplementary hiring. Three tips: ① Build an application tracker — record company, position, application date, status, deadline; avoid missing written tests; ② Big 4 and internet companies are earliest — use them for practice, schedule target companies later; ③ Banks and SOEs have slower timelines; offers may drag to year-end — reserve waiting time and clarify signing deadlines in advance.'
  },

  /* ==================================================================
   * VII. Financial Statements (from finance2)
   * ================================================================== */

  {
    id: 'seed3_fin_en2_fs_overview', type: 'qa', cat: 'Finance', round: 'Round 1',
    tags: ['Financial Statements', 'Balance Sheet', 'Income Statement', 'Cash Flow', 'Articulation'],
    title: 'Financial Statements Overview: What Each Statement Answers & How They Articulate',
    content: 'The three statements are finance\'s "common language": ① Balance Sheet answers "at a point in time, what do I own, what do I owe, what\'s the net?" (Assets = Liabilities + Equity); ② Income Statement answers "over a period, how much did I earn?" (Revenue − Expenses = Profit); ③ Cash Flow Statement answers "did cash actually come in?" (Operating / Investing / Financing activities). Articulation: IS net income flows to BS equity via retained earnings; CFS ending cash equals BS cash (excluding restricted); the difference between net income and operating cash flow is explained by working capital changes (A/R, inventory, A/P). Bonus: proactively say "high profit but poor cash flow is a red flag" — this shows you read statements holistically.'
  },
  {
    id: 'seed3_fin_en2_fs_bs', type: 'qa', cat: 'Finance', round: 'Round 1',
    tags: ['Balance Sheet', 'Solvency', 'Asset Quality'],
    title: 'How to Read a Balance Sheet: From Reclassification to Asset Quality',
    content: 'Three steps: ① Structure — current/non-current assets and liabilities proportions; identify maturity mismatch; ② Quality — A/R bad debt provision adequacy, inventory obsolescence (write-down), related-party receivables indicating shareholder occupation, goodwill impairment risk; ③ Solvency — current/quick ratio for short-term, debt-to-asset and interest coverage for long-term. High-frequency follow-up: "why are some assets on the books but essentially worthless?" — answer lies in impairment and realizability. Prep tip: take a company you know well and be able to calculate and explain its current ratio and debt-to-asset ratio.'
  },
  {
    id: 'seed3_fin_en2_fs_is', type: 'qa', cat: 'Finance', round: 'Round 1',
    tags: ['Income Statement', 'Gross Margin', 'Profitability'],
    title: 'Income Statement Analysis: Don\'t Just Stare at Net Profit — Look at Structure & Quality',
    content: 'The core is "revenue − cost − expenses − tax = net profit," but interviewers want to hear structure: ① Gross margin (revenue − COGS) reflects product competitiveness; persistent decline is a warning sign; ② Expense ratios (selling/admin/R&D) show investment direction; R&D capitalization can beautify short-term profit; ③ Operating profit vs. profit before tax vs. net profit — distinguish earnings from core operations vs. non-recurring items like government grants or investment gains. Key metrics: net margin, EBITDA (core earnings power), net margin attributable to parent. Bonus: point out that "net profit excluding non-recurring items" better reflects core operations — this shows you distinguish one-time gains.'
  },
  {
    id: 'seed3_fin_en2_fs_cf', type: 'qa', cat: 'Finance', round: 'Round 2',
    tags: ['Cash Flow Statement', 'Cash Flow', 'Earnings Quality'],
    title: 'Cash Flow Statement: Why "Earned Profit" and "Cash Received" Often Don\'t Match',
    content: 'Three activity types: ① Operating cash flow — core earnings power; persistently negative is a danger signal; ② Investing cash flow — expansion/M&A typically negative; financial returns positive; ③ Financing cash flow — borrowing/equity raises positive; dividends/repayment negative. The gap between net income and operating cash flow is mainly explained by A/R (sold but not yet collected), inventory (production tie-up), and A/P (owed to suppliers). Earnings quality check: operating cash flow / net income consistently below 1 is a red flag (low profit "gold content"). Prep tip: give a real example of "revenue up but cash flow not" (e.g., major customer extending payment terms) to show you\'d trace to receivables.'
  },
  {
    id: 'seed3_fin_en2_fs_ratio', type: 'qa', cat: 'Finance', round: 'Round 1',
    tags: ['Financial Ratios', 'Solvency', 'Profitability', 'Efficiency'],
    title: 'Financial Ratio Analysis Four-Piece Set: Solvency / Profitability / Efficiency / Growth',
    content: 'Systematic answering: ① Solvency — current/quick ratio (short-term), debt-to-asset / interest coverage (long-term); ② Profitability — gross margin, net margin, ROE/ROA (use DuPont to decompose into net margin × turnover × equity multiplier); ③ Efficiency — A/R / inventory / total asset turnover (how effectively resources are used); ④ Growth — revenue/profit growth rates, market position. Framework: choose metric → provide industry benchmark → state "this company is above/below peers, likely because..." Bonus: proactively note that single metrics can be manipulated; cross-validate (e.g., high ROE might come from high leverage, not high efficiency).'
  },
  {
    id: 'seed3_fin_en2_fs_red', type: 'qa', cat: 'Finance', round: 'Round 2',
    tags: ['Financial Statement Manipulation', 'Professional Skepticism', 'Audit'],
    title: 'Common Financial Statement Manipulation Techniques & Detection (Essential Professional Skepticism)',
    content: 'High-frequency manipulations: ① Revenue recognition pulled forward / fictitious revenue (no physical goods flow, channel stuffing); ② Under-provisioning for impairment (A/R, inventory, goodwill) to beautify assets; ③ Expense capitalization (stuffing R&D into assets); ④ Related-party transactions to transfer profits; ⑤ Abuse of accounting estimate changes. Detection signals: operating cash flow persistently far below net income, A/R growth far outpacing revenue, gross margin significantly above peers, abnormal other receivables. Key: emphasize "professional skepticism isn\'t suspecting everything — it\'s pursuing evidence for anomalies," and give one specific item you\'d verify (e.g., send confirmation, check bank statements).'
  },

  /* ==================================================================
   * VIII. Budget Management (from finance2)
   * ================================================================== */

  {
    id: 'seed3_fin_en2_bg_flow', type: 'qa', cat: 'Finance', round: 'Round 1',
    tags: ['Budget', 'Comprehensive Budget', 'Two-Up Two-Down', 'Budget Preparation'],
    title: 'Comprehensive Budget Preparation Process: What Is "Two-Up Two-Down"',
    content: 'Comprehensive budget is "the business plan expressed in numbers": ① First Up — each business unit prepares and submits to finance; First Down — finance issues the total budget and control targets; Second Up — units revise and resubmit; Second Down — board/executive committee approves and issues for execution. Timing typically starts one quarter ahead (Sep-Oct for next year). Three budget types: operating budget (sales/production/expenses), capital budget (investments/acquisitions), financial budget (projected IS/BS/CFS). Prep tip: articulate that "budget isn\'t finance dictating numbers — it\'s the iterative process of business and finance negotiating and aligning" — this shows business-finance integration thinking.'
  },
  {
    id: 'seed3_fin_en2_bg_types', type: 'qa', cat: 'Finance', round: 'Round 1',
    tags: ['Budget', 'Flexible Budget', 'Rolling Budget'],
    title: 'Flexible Budget / Rolling Budget / Zero-Based Budget: How to Choose',
    content: '① Fixed budget — prepared for a single activity level; suits stable environments; ② Flexible budget — prepared for multiple activity levels; suits manufacturing/retail with volume volatility; facilitates variance analysis; ③ Rolling budget — continuously rolls forward (e.g., 13-week, quarterly); copes with uncertainty; common in internet/FMCG; ④ Zero-based budget — every expenditure justified from zero; powerful cost control but labor-intensive. Framework: first describe business characteristics (volatile → flexible/rolling; aggressive cost control → zero-based), then specify how you\'d implement. Bonus: mention that "budget should be distinguished from management accounting\'s rolling forecast — the former is control, the latter is prediction."'
  },
  {
    id: 'seed3_fin_en2_bg_var', type: 'qa', cat: 'Finance', round: 'Round 2',
    tags: ['Budget', 'Variance Analysis', 'Budget Execution'],
    title: 'Budget Variance Analysis: Actual vs. Budget — How to Investigate?',
    content: 'Four-step variance analysis: ① Calculate total variance — how much did actual deviate from budget; ② Decompose into volume & price — for expenses, split into "volume variance + rate variance"; identify whether the issue is volume not met or unit cost increased; ③ Assign responsibility — is it market/business-driven or procurement/finance-driven; ④ Take action — should overspend be controlled, or should underspend be reinvested? Common pit: looking only at totals, not structure (revenue target met but through price cuts with higher volume — poor quality). Prep tip: use a real example from your internship to explain "from which report I spotted the variance, which account I traced it to, and what adjustment I drove" — more useful than reciting definitions.'
  },
  {
    id: 'seed3_fin_en2_bg_kpi', type: 'qa', cat: 'Finance', round: 'Round 2',
    tags: ['Budget', 'Budget Evaluation', 'Business-Finance Integration'],
    title: 'Budget Evaluation & Business-Finance Integration: Making the Budget "Actually Used"',
    content: 'Budget failure often stems from "prepared then locked in a drawer." To make it work: ① Break the budget down to department/month/owner, link to evaluation but allow flexibility; ② Establish monthly business review meetings, using actual vs. budget to drive business post-mortems; ③ Shift finance from "bookkeeper" to "business partner" — don\'t just block spending; help business calculate ROI. SOE context specifically emphasizes connecting state-asset evaluation metrics (e.g., "two profits four ratios") with the budget. Bonus: say "budget is a communication tool, not a control lock," and illustrate how you used a dashboard to let business self-serve variance insights.'
  },

  /* ==================================================================
   * IX. Cost Control (from finance2)
   * ================================================================== */

  {
    id: 'seed3_fin_en2_cc_method', type: 'qa', cat: 'Finance', round: 'Round 1',
    tags: ['Cost Accounting', 'Process Costing', 'Job Costing', 'Step-Down', 'ABC'],
    title: 'Cost Accounting Methods: Process / Job-Order / Step-Down / Activity-Based',
    content: 'Choice depends on production type: ① Process costing — high-volume single-product (power generation, flour); costs collected by product variety; ② Job-order costing — by order/batch (custom, projects); suits project finance; ③ Step-down method — continuous multi-process (chemicals, steel); costs transferred sequentially; ④ Activity-based costing (ABC) — allocates overhead by activity drivers; suits manufacturing with high overhead and diverse products; yields more accurate unit costs. Key: note that "choosing the wrong method skews product profitability," and explain which method your company uses and why.'
  },
  {
    id: 'seed3_fin_en2_cc_cvp', type: 'qa', cat: 'Finance', round: 'Round 1',
    tags: ['CVP', 'Break-Even', 'Cost Reduction'],
    title: 'Cost-Volume-Profit Analysis (CVP): How to Calculate the Break-Even Point',
    content: 'Core formula: Break-even quantity = Fixed Costs ÷ (Unit Price − Unit Variable Cost). Three levers: ① Price ↑ or ② Variable cost ↓ or ③ Fixed cost ↓ — all lower the break-even point and increase margin of safety. You can also calculate "target-profit quantity" and "operating leverage (small volume change → large profit change)." Business applications: pricing decisions, whether to accept a low-price order (does it cover variable cost?), capacity utilization. Prep tip: be able to calculate break-even and target-profit points on the spot with a set of assumed numbers — more impressive than explaining theory.'
  },
  {
    id: 'seed3_fin_en2_cc_std', type: 'qa', cat: 'Finance', round: 'Round 1',
    tags: ['Standard Cost', 'Variance Analysis', 'Manufacturing'],
    title: 'Standard Cost Variance Analysis: Material Price/Quantity, Labor Efficiency',
    content: 'Standard cost = what should have been spent; Actual − Standard = Variance, further decomposed: ① Material — price variance (procurement side, who negotiated) + usage variance (production side, waste); ② Labor — rate variance + efficiency variance (hours); ③ Manufacturing overhead — spending variance + efficiency variance. Purpose isn\'t to penalize — it\'s to locate improvement opportunities (e.g., large usage variance → process or waste issues). Bonus: note that "variance analysis should link to responsibility centers — procurement owns price variance, production owns usage variance" — this shows you understand management accounting\'s responsibility accounting logic.'
  },
  {
    id: 'seed3_fin_en2_cc_cut', type: 'qa', cat: 'Finance', round: 'Round 2',
    tags: ['Cost Reduction', 'Cost Control', 'Good Cost Bad Cost'],
    title: 'How to Translate Cost Reduction into Finance Actions (Don\'t Just Say "Cut Budget")',
    content: 'Structured framework: ① Decompose — by material/labor/overhead, by department, by product, by variable/fixed; find the largest and fastest-growing items; ② Classify good/bad costs — R&D, core talent, customer experience are "good costs" (protect); redundant inventory, duplicate processes are "bad costs" (cut); ③ Set quantified targets — e.g., centralized procurement saves 3%-5%, automation reduces fulfillment cost; ④ Build tracking — cost dashboards with monthly review vs. budget. Bonus: explicitly state "cost reduction must not damage long-term capability," and give an example of how you used templates to compress output time from X to Y — demonstrating finance-driven efficiency, not just cost-cutting.'
  },

  /* ==================================================================
   * X. Tax (from finance2)
   * ================================================================== */

  {
    id: 'seed3_fin_en2_tx_vat', type: 'qa', cat: 'Finance', round: 'Round 1',
    tags: ['VAT', 'Input Credit', 'Excess Credit', 'Tax'],
    title: 'VAT Full Process: Input/Output Credit, Excess Credit Refund & Risk Points',
    content: 'Logic: general taxpayer pays "output − input." Key points: ① Input credit requires valid special VAT invoice; inputs for exempt items or employee benefits cannot be credited (must be reversed out); ② Tax obligation timing — upon receipt of payment or evidence of right to collect; if invoiced first, timing is invoice date; ③ Excess input credit — forms when input exceeds output; eligible for refund (favorable for manufacturing/innovation); ④ Risks — issuing fictitious invoices (criminal), input/output mismatch. Prep tip: articulate "VAT is a price-excluded tax with chain credit," and know whether your company is general or small-scale taxpayer and applicable rate tier (13%/9%/6%).'
  },
  {
    id: 'seed3_fin_en2_tx_cit', type: 'qa', cat: 'Finance', round: 'Round 1',
    tags: ['Corporate Income Tax', 'Tax Adjustment', 'Deferred Tax'],
    title: 'Corporate Income Tax: How to Adjust Accounting Profit to Taxable Income',
    content: 'Accounting profit ≠ taxable income; tax adjustments required: ① Permanent differences — business entertainment deductible at 60% capped at 0.5% of revenue; advertising capped at 15%; fines and penalties non-deductible; ② Temporary differences — generate deferred tax (asset impairment, depreciation methodology differences); ③ Preferences — small enterprise 25% effective rate, high-tech 15%, R&D super deduction. In practice: maintain a reconciliation ledger during annual filing. Bonus: link "deferred tax" back to the earlier technical question to show you understand tax-accounting differences as institutional design, not a bug.'
  },
  {
    id: 'seed3_fin_en2_tx_iit', type: 'qa', cat: 'Finance', round: 'Round 1',
    tags: ['Personal Income Tax', 'Tax', 'Compensation'],
    title: 'Personal Income Tax: Salary & Special Additional Deductions',
    content: 'Comprehensive income (salary, labor remuneration, author\'s remuneration, royalties) consolidated annually with cumulative withholding, year-end reconciliation. Key points: ① Threshold ¥5,000/month; seven special additional deductions (children\'s education, mortgage interest, rent, elderly support, infant care under 3, continuing education, major medical expenses) reduce tax; ② Year-end bonus can be taxed separately or merged (tax-rate threshold planning opportunities); ③ HR may ask "how to help employees with tax planning" — within compliance, maximize special deductions and optimize year-end bonus treatment. Note: policies are subject to latest updates; answer rigorously.'
  },
  {
    id: 'seed3_fin_en2_tx_plan', type: 'qa', cat: 'Finance', round: 'Round 2',
    tags: ['Tax Planning', 'Tax', 'Compliance'],
    title: 'Tax Planning Boundaries: Legitimate Planning vs. Evasion',
    content: 'Three principles: ① Legality — leverage preferential policies and institutional arrangements, not concealment; ② Business substance — business first, invoices second; never fabricate invoices; ③ Advance planning — engage during transaction structure design, not retroactively finding invoices. Common compliant actions: maximize R&D super deduction, high-tech enterprise certification, regional tax incentives (note commercial substance), related-party pricing (transfer pricing contemporaneous documentation). Red lines: dual contracts, purchased invoices, dual books. Key: emphasize "tax planning helps the company save what it should, while respecting lines that cannot be crossed" — this demonstrates a solid compliance bottom line.'
  },

  /* ==================================================================
   * XI. Treasury / Fund Management (from finance2)
   * ================================================================== */

  {
    id: 'seed3_fin_en2_cash_plan', type: 'qa', cat: 'Finance', round: 'Round 1',
    tags: ['Treasury', 'Cash Pool', 'Cash Planning', 'Solvency'],
    title: 'Cash Planning & Cash Pool: How Groups Manage Money',
    content: 'Treasury objectives: safety, liquidity, yield. Tools: ① Cash planning — weekly/monthly rolling cash flow forecast; know in advance which days need funding, which have surplus; ② Cash pool — group inter-company account sweeping (physical or notional); mobilizes idle balances, reduces external borrowing; ③ Separate income/expenditure accounts — income account receives only, expenditure account disburses per budget; ④ Surplus funds — principal-guaranteed wealth management / structured deposits. Bonus: articulate "treasury management is fundamentally liquidity risk management," and give an example of cash weeklies or forecasts you\'ve produced.'
  },
  {
    id: 'seed3_fin_en2_cash_ar', type: 'qa', cat: 'Finance', round: 'Round 1',
    tags: ['Accounts Receivable', 'Credit Management', 'Cash Flow'],
    title: 'Accounts Receivable & Credit Management: Promoting Sales While Controlling Bad Debt',
    content: 'Three elements of credit policy: credit period (e.g., 30/60 days), cash discount, credit limit. Management actions: ① Build customer credit rating, assign limits by grade; ② Aging analysis (within 1 year / 1-2 years / 2+ years), overdue alerts, bad debt provision; ③ Collection process — reminder → formal notice → legal; ④ Use factoring / bill discounting to mobilize. Metrics: DSO (days sales outstanding), bad debt rate. Key: note that "relaxing credit boosts revenue but hurts cash flow" — finance should help business calculate "incremental profit from this sale on credit vs. bad debt and cost of capital," not just tighten across the board.'
  },
  {
    id: 'seed3_fin_en2_cash_fx', type: 'qa', cat: 'Finance', round: 'Round 2',
    tags: ['FX Risk', 'Hedging', 'Treasury'],
    title: 'FX Risk & Hedging: Required Course for Overseas Business Finance',
    content: 'Three types of FX risk: transaction risk (committed but unsettled foreign-currency receivables/payables), translation risk (overseas subsidiary statement translation), economic risk (long-term cash flow impacted by exchange rates). Hedging: ① Natural hedge — receive and spend in the same foreign currency (currency matching); ② Financial hedge — forwards / swaps / options to lock rates; ③ Pricing pass-through — include FX clauses in contracts. Metrics: hedge ratio, hedging cost. Bonus: tie to your company\'s overseas business (e.g., Temu for e-commerce, Xiaomi for hardware) and say "I\'d first calculate net exposure then decide hedge ratio — not blindly full-lock or full-float."'
  },

  /* ==================================================================
   * XII. Experience Sharing (from finance2)
   * ================================================================== */

  {
    id: 'seed3_fin_en2_exp_modules', type: 'experience', cat: 'Finance', round: 'General',
    author: 'Anonymous', tags: ['Finance', 'Experience', 'Five Modules'],
    title: 'Finance Comprehensive Experience: How to Answer Questions on the Five Modules',
    content: 'Timeline: Online application → Written test (aptitude + technical + personality) → Round 1 (technical deep-dive) → Round 2 (business + cross-functional) → HR/Leader. Five-module questioning patterns: ① Statements — almost always ask "three-statement articulation / how to calculate X metric"; ② Budget — "two-up two-down / how to investigate variances"; ③ Cost — "CVP / standard cost variances"; ④ Tax — "VAT input/output / tax-accounting differences"; ⑤ Treasury — "cash pool / credit management". Pitfalls: memorizing standards without connecting to business; fabricating when probed at the third layer. Advice: prepare a "real case + numbers" for each module, tell it using STAR, and proactively say "I would align methodology before giving a conclusion."'
  },
  {
    id: 'seed3_fin_en2_exp_framework', type: 'experience', cat: 'Finance', round: 'General',
    author: 'Anonymous', tags: ['Finance', 'On-the-spot Modeling', 'Framework'],
    title: 'Live Interview Question: Build a Financial Analysis Framework for a Company',
    content: 'High-frequency stress question. My approach (reusable framework): ① First ask the purpose — evaluate profitability, assess solvency, or judge investment value? Different purposes need different metrics; ② Pull the three statements, calculate structure (asset/liability proportions) and quality (A/R/inventory/goodwill risk); ③ Compute four ratio groups (solvency / profitability / efficiency / growth), use DuPont to decompose ROE; ④ Check cash flow quality (operating CF / net income); ⑤ Give conclusion + recommendation (e.g., "revenue growing but cash not; recommend investigating A/R and credit policy"). Key: talk while writing on paper to demonstrate structure; don\'t start by rattling off numbers — show the framework first, then fill in data; interviewers value thought process more than precise values.'
  }
];
