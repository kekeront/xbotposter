export type Influencer = {
  username: string;
  name: string;
  topic?: string;
};

// Curated tech / AI / startup voices worth tracking.
// Edit this list to taste; the discover fetch endpoint reads from here.
export const INFLUENCERS: Influencer[] = [
  { username: "karpathy", name: "Andrej Karpathy", topic: "ai-research" },
  { username: "ylecun", name: "Yann LeCun", topic: "ai-research" },
  { username: "sama", name: "Sam Altman", topic: "ai-ceo" },
  { username: "gdb", name: "Greg Brockman", topic: "ai-ceo" },
  { username: "DrJimFan", name: "Jim Fan", topic: "ai-research" },
  { username: "paulg", name: "Paul Graham", topic: "startups" },
  { username: "swyx", name: "Shawn Wang", topic: "ai-eng" },
  { username: "jeremyphoward", name: "Jeremy Howard", topic: "ml" },
  { username: "soumithchintala", name: "Soumith Chintala", topic: "ml-infra" },
  { username: "andrew_n_carr", name: "Andrew Carr", topic: "ai-research" },
];
