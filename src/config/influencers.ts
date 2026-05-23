export type Influencer = {
  username: string;
  name: string;
  topic?: string;
  /** X user ID. If set, skips the userByUsername call on every fetch and
   *  saves ~$0.005-0.010 per influencer per run. Resolve once and paste here.
   */
  id?: string;
};

// Curated tech / AI / startup voices worth tracking.
// Edit this list to taste; the discover fetch endpoint reads from here.
export const INFLUENCERS: Influencer[] = [
  { username: "karpathy", id: "33836629", name: "Andrej Karpathy", topic: "ai-research" },
  { username: "ylecun", id: "48008938", name: "Yann LeCun", topic: "ai-research" },
  { username: "sama", id: "1605", name: "Sam Altman", topic: "ai-ceo" },
  { username: "gdb", id: "162124540", name: "Greg Brockman", topic: "ai-ceo" },
  { username: "DrJimFan", id: "1007413134", name: "Jim Fan", topic: "ai-research" },
  { username: "paulg", id: "183749519", name: "Paul Graham", topic: "startups" },
  { username: "swyx", id: "33521530", name: "Shawn Wang", topic: "ai-eng" },
  { username: "jeremyphoward", id: "175282603", name: "Jeremy Howard", topic: "ml" },
  { username: "soumithchintala", id: "70831441", name: "Soumith Chintala", topic: "ml-infra" },
  { username: "andrew_n_carr", id: "3378986176", name: "Andrew Carr", topic: "ai-research" },
];
