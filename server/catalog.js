// Reference data shared by the API and the UI (served from /api/meta).

/** Typical service life in years. Rough industry rules of thumb; every appliance can override its own. */
export const APPLIANCE_CATEGORIES = [
  { key: 'furnace', label: 'Furnace / heating system', years: 18 },
  { key: 'central_ac', label: 'Central A/C', years: 15 },
  { key: 'heat_pump', label: 'Heat pump', years: 15 },
  { key: 'water_heater', label: 'Water heater (tank)', years: 10 },
  { key: 'tankless_heater', label: 'Water heater (tankless)', years: 20 },
  { key: 'refrigerator', label: 'Refrigerator', years: 13 },
  { key: 'freezer', label: 'Freezer', years: 15 },
  { key: 'dishwasher', label: 'Dishwasher', years: 10 },
  { key: 'washer', label: 'Washing machine', years: 11 },
  { key: 'dryer', label: 'Dryer', years: 13 },
  { key: 'range', label: 'Range / oven / cooktop', years: 15 },
  { key: 'microwave', label: 'Microwave', years: 9 },
  { key: 'disposal', label: 'Garbage disposal', years: 10 },
  { key: 'water_softener', label: 'Water softener', years: 12 },
  { key: 'sump_pump', label: 'Sump pump', years: 8 },
  { key: 'garage_opener', label: 'Garage door opener', years: 12 },
  { key: 'roof', label: 'Roof (asphalt shingle)', years: 22 },
  { key: 'windows', label: 'Windows', years: 25 },
  { key: 'other', label: 'Other', years: null },
];

export const VENDOR_CATEGORIES = [
  'HVAC', 'Plumbing', 'Electrical', 'Roofing', 'Lawn & landscaping', 'Cleaning', 'Pest control', 'Handyman',
  'Appliance repair', 'Painting', 'Fencing', 'Flooring', 'Pool & spa', 'Windows & doors', 'General contractor',
  'Inspector', 'Other',
];

export const DOC_CATEGORIES = [
  { key: 'warranty', label: 'Warranty' },
  { key: 'receipt', label: 'Receipt / invoice' },
  { key: 'manual', label: 'Manual' },
  { key: 'insurance', label: 'Insurance' },
  { key: 'permit', label: 'Permit' },
  { key: 'inspection', label: 'Inspection report' },
  { key: 'contract', label: 'Contract / quote' },
  { key: 'photo', label: 'Photo' },
  { key: 'other', label: 'Other' },
];

/** What your home has. These switch on the matching suggestions. */
export const HOME_FEATURES = [
  { key: 'central_ac', label: 'Central A/C' },
  { key: 'gas', label: 'Gas appliances or furnace' },
  { key: 'gutters', label: 'Gutters' },
  { key: 'attic', label: 'Attic' },
  { key: 'basement', label: 'Basement' },
  { key: 'crawlspace', label: 'Crawlspace' },
  { key: 'garage', label: 'Garage with door opener' },
  { key: 'fireplace', label: 'Fireplace or chimney' },
  { key: 'deck', label: 'Deck, porch or patio' },
  { key: 'fence', label: 'Fence' },
  { key: 'asphalt_driveway', label: 'Asphalt driveway' },
  { key: 'lawn', label: 'Lawn or garden beds' },
  { key: 'trees', label: 'Mature trees' },
  { key: 'sprinklers', label: 'Irrigation system' },
  { key: 'pool', label: 'Pool' },
  { key: 'hot_tub', label: 'Hot tub' },
  { key: 'septic', label: 'Septic system' },
  { key: 'well', label: 'Well water' },
  { key: 'sump_pump', label: 'Sump pump' },
  { key: 'water_softener', label: 'Water softener' },
  { key: 'generator', label: 'Generator' },
  { key: 'solar', label: 'Solar panels' },
  { key: 'pets', label: 'Pets' },
  { key: 'freeze', label: 'Freezing winters' },
];

export const FEATURE_KEYS = HOME_FEATURES.map((f) => f.key);
export const APPLIANCE_CATEGORY_KEYS = APPLIANCE_CATEGORIES.map((c) => c.key);
