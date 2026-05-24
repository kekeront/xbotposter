// Canonical slot map — §4.1 / HGT-26 from higgsfieldtz/memory-service.
//
// The LLM emits varying keys for the same semantic slot: `employer`,
// `current_employer`, `employment.company` all describe the same fact.
// canonicaliseSlot collapses them deterministically so supersession
// works across phrasings.
//
// Two stages:
//   1. Hierarchical opinion collapse — `opinion.<a>.<b>` → `opinion.<a>`.
//      Closes opinion-arc supersession across LLM phrasings.
//   2. Alias dict for the §4.2 categories. Fallback `slot=key` preserves
//      multi-entity slots like `pet.name` / `family.spouse_name`.

const ALIASES: Record<string, string> = {
  // employment
  employer: "employment.current_company",
  current_employer: "employment.current_company",
  company: "employment.current_company",
  "employment.company": "employment.current_company",
  workplace: "employment.current_company",
  job: "employment.role",
  role: "employment.role",
  title: "employment.role",
  position: "employment.role",
  "employment.title": "employment.role",
  previous_employer: "employment.previous_company",
  previous_company: "employment.previous_company",
  "employment.previous_company": "employment.previous_company",

  // location
  city: "location.city",
  current_city: "location.city",
  "location.city": "location.city",
  hometown: "location.hometown",
  previous_city: "location.previous_city",
  "location.previous_city": "location.previous_city",
  country: "location.country",
  "location.country": "location.country",

  // diet / beverage / preferences (single-instance)
  diet: "diet.style",
  "diet.style": "diet.style",
  coffee: "beverage.coffee",
  "beverage.coffee": "beverage.coffee",

  // allergy — note: multi-entity in source schema, but commonly single
  allergy: "allergy",

  // language
  favourite_language: "language.favourite",
  favorite_language: "language.favourite",
  "language.favourite": "language.favourite",
  "language.favorite": "language.favourite",
};

export function canonicaliseSlot(key: string): string {
  const trimmed = key.trim().toLowerCase();
  if (!trimmed) return key;

  // 1. Hierarchical opinion collapse: opinion.x.y.z → opinion.x
  if (trimmed.startsWith("opinion.")) {
    const parts = trimmed.split(".");
    if (parts.length >= 2 && parts[1]) {
      return `opinion.${parts[1]}`;
    }
    return "opinion";
  }

  // 2. Alias lookup
  const alias = ALIASES[trimmed];
  if (alias) return alias;

  // 3. Fallback — preserve multi-entity keys like `pet.name`, `family.spouse_name`
  return trimmed;
}
