// Built-in library of common home maintenance tasks. Each one can be added to your
// list with a single tap. `requires` lists home features that must ALL be present.
import { today as todayFn } from './dates.js';

const T = (key, name, category, interval, month, why, opts = {}) => ({
  key, name, category, interval_months: interval, month, why, pro: false, requires: [], ...opts,
});

export const TEMPLATES = [
  // Safety
  T('smoke-co-test', 'Test smoke and CO alarms', 'Safety', 6, 4, 'A failed alarm is silent until the day you need it. Press the test button and confirm every unit sounds.'),
  T('alarm-batteries', 'Replace alarm batteries', 'Safety', 12, 11, 'Fresh batteries once a year, on a date you will remember, such as when the clocks change.'),
  T('fire-extinguisher', 'Check fire extinguishers', 'Safety', 12, 1, 'Confirm the gauge is in the green, the pin is in place, and the unit is within its date.'),
  T('gfci-test', 'Test GFCI outlets', 'Safety', 6, 3, 'Kitchen, bath, garage and outdoor outlets should trip when you press Test and reset cleanly.'),
  T('water-shutoff', 'Exercise the main water shutoff valve', 'Safety', 12, 5, 'A valve that has not moved in years can seize. Turn it off and on so it works in an emergency.'),
  T('emergency-kit', 'Refresh emergency kit and flashlights', 'Safety', 12, 9, 'Swap expired food, water and batteries so the kit is ready for an outage or storm.'),
  T('radon-test', 'Re-test for radon', 'Safety', 24, 1, 'Radon levels can change as a home settles. A low-cost test kit is enough for most homes.', { requires: ['basement'] }),
  T('insurance-review', 'Review homeowners insurance coverage', 'Safety', 12, 1, 'Check the coverage limit against rebuild costs, and update your home inventory and photos.'),

  // Heating and cooling
  T('hvac-filter', 'Replace HVAC air filter', 'HVAC', 3, 1, 'A clogged filter strains the system and worsens air quality. Note the size in Home facts.'),
  T('ac-tuneup', 'A/C tune-up', 'HVAC', 12, 4, 'A yearly check catches refrigerant, capacitor and coil problems before the first hot week.', { requires: ['central_ac'], pro: true }),
  T('heat-tuneup', 'Heating system tune-up', 'HVAC', 12, 9, 'Service the furnace or heat pump before cold weather, when technicians are less busy.', { pro: true }),
  T('ac-condensate', 'Flush A/C condensate drain line', 'HVAC', 12, 5, 'A clogged drain line can overflow into the ceiling or trip the system off.', { requires: ['central_ac'] }),
  T('ac-outdoor-unit', 'Clean outdoor A/C unit and clear plants', 'HVAC', 12, 4, 'Rinse the fins and keep about two feet of clearance so it can shed heat.', { requires: ['central_ac'] }),
  T('dryer-vent', 'Clean dryer vent', 'HVAC', 12, 4, 'Lint buildup is a common cause of house fires and makes the dryer take longer.', { pro: true }),

  // Plumbing
  T('water-heater-flush', 'Flush water heater', 'Plumbing', 12, 4, 'Draining sediment extends tank life and keeps it efficient.'),
  T('water-heater-service', 'Water heater inspection', 'Plumbing', 12, 4, 'Have the relief valve, anode rod and burner or elements checked.', { pro: true }),
  T('under-sink-check', 'Check under sinks and around toilets for leaks', 'Plumbing', 12, 2, 'Slow leaks rot cabinets and floors long before they show up on a water bill.'),
  T('sump-pump-test', 'Test sump pump', 'Plumbing', 3, 3, 'Pour water into the pit and confirm the pump starts and drains before spring rains.', { requires: ['sump_pump'] }),
  T('septic-pump', 'Pump septic tank', 'Plumbing', 36, 5, 'Every three to five years, depending on tank size and household.', { requires: ['septic'], pro: true }),
  T('well-water-test', 'Test well water', 'Plumbing', 12, 4, 'A yearly lab test checks bacteria and nitrates, which you cannot see or taste.', { requires: ['well'] }),
  T('softener-salt', 'Check water softener salt', 'Plumbing', 3, 1, 'Keep the brine tank at least a third full and break up any salt bridges.', { requires: ['water_softener'] }),
  T('winterize-faucets', 'Disconnect hoses and winterize outdoor faucets', 'Plumbing', 12, 10, 'A hose left attached can freeze and split the pipe inside the wall.', { requires: ['freeze'] }),

  // Appliances
  T('dishwasher-clean', 'Clean dishwasher filter and run a cleaner', 'Appliances', 6, 1, 'Food trapped in the filter is the usual cause of odors and poor cleaning.'),
  T('washer-clean', 'Clean washer and inspect supply hoses', 'Appliances', 12, 2, 'Wipe the gasket, run a cleaning cycle, and replace any bulging or cracked hoses.'),
  T('fridge-coils', 'Vacuum refrigerator coils', 'Appliances', 12, 3, 'Dusty coils make the compressor work harder and shorten its life.'),
  T('fridge-filter', 'Replace refrigerator water filter', 'Appliances', 6, 1, 'Most manufacturers recommend every six months.'),
  T('range-hood', 'Clean range hood filter', 'Appliances', 6, 2, 'Soak the metal filter in hot soapy water to remove built-up grease.'),

  // Exterior
  T('roof-inspect', 'Inspect roof and flashing', 'Exterior', 12, 4, 'Look for missing, cracked or curling shingles and check flashing around vents and chimneys.'),
  T('gutter-clean', 'Clean gutters and downspouts', 'Exterior', 6, 11, 'Clogged gutters overflow against the siding and foundation. Twice a year suits most homes.', { requires: ['gutters'] }),
  T('attic-check', 'Check attic insulation, ventilation and pests', 'Exterior', 12, 10, 'Look for damp spots, droppings and compressed insulation.', { requires: ['attic'] }),
  T('foundation-walk', 'Walk the foundation and check drainage', 'Exterior', 12, 4, 'Look for new cracks and make sure the soil slopes away from the house.'),
  T('power-wash', 'Power wash siding, patio and walkways', 'Exterior', 12, 4, 'Removes mildew and algae before they stain or damage surfaces.'),
  T('window-sills', 'Clean window sills and tracks', 'Exterior', 12, 4, 'Dirt and moisture in tracks lead to mold and stiff windows.'),
  T('caulk-check', 'Inspect and re-caulk windows, doors and trim', 'Exterior', 12, 9, 'Gaps let in water and drafts. Replace cracked or shrunken caulk.'),
  T('weatherstrip', 'Check weatherstripping and door sweeps', 'Exterior', 12, 10, 'A few dollars of seal can noticeably cut drafts and energy bills.'),
  T('deck-seal', 'Inspect and re-seal deck', 'Exterior', 12, 5, 'Check for loose boards and fasteners, and re-seal when water no longer beads on the surface.', { requires: ['deck'] }),
  T('fence-check', 'Inspect fence and gates', 'Exterior', 12, 4, 'Check posts, latches and hinges, and treat any rot early.', { requires: ['fence'] }),
  T('driveway-seal', 'Seal driveway cracks', 'Exterior', 36, 5, 'Sealing cracks stops water from getting under the asphalt and expanding them.', { requires: ['asphalt_driveway'] }),
  T('garage-door', 'Lubricate garage door and test auto-reverse', 'Exterior', 12, 3, 'Lubricate rollers and hinges, then confirm the door reverses when it meets an obstacle.', { requires: ['garage'] }),
  T('chimney-sweep', 'Sweep and inspect chimney', 'Exterior', 12, 9, 'Creosote buildup is a fire risk. Book before the burning season.', { requires: ['fireplace'], pro: true }),
  T('solar-check', 'Clean solar panels and check the inverter', 'Exterior', 12, 4, 'Dirt reduces output. Compare production against the same month last year.', { requires: ['solar'] }),

  // Yard and outdoor systems
  T('sprinkler-start', 'Start up sprinklers and check heads', 'Yard', 12, 4, 'Run each zone and repair broken heads and leaks.', { requires: ['sprinklers'] }),
  T('sprinkler-winterize', 'Winterize sprinklers (blow out lines)', 'Yard', 12, 10, 'Water left in the lines can freeze and crack pipes and valves.', { requires: ['sprinklers', 'freeze'], pro: true }),
  T('tree-trim', 'Trim trees away from roof and wires', 'Yard', 12, 2, 'Branches touching the roof cause wear and give pests a way in.', { requires: ['trees'] }),
  T('lawn-overseed', 'Aerate and overseed lawn', 'Yard', 12, 9, 'Early fall is the best window for cool-season grass to recover and thicken.', { requires: ['lawn'] }),
  T('mulch-beds', 'Refresh mulch in garden beds', 'Yard', 12, 3, 'Mulch suppresses weeds and holds moisture around plants.', { requires: ['lawn'] }),
  T('pool-service', 'Service pool equipment and test water', 'Yard', 12, 4, 'Check the pump, filter and chemistry before swim season.', { requires: ['pool'] }),
  T('hot-tub-drain', 'Drain and clean hot tub', 'Yard', 3, 1, 'Fresh water and a clean filter keep the chemistry stable.', { requires: ['hot_tub'] }),
  T('generator-test', 'Test-run generator', 'Yard', 6, 5, 'Run it under load and check fuel and oil so it starts during an outage.', { requires: ['generator'] }),

  // Pests and cleaning
  T('pest-inspection', 'Termite and pest inspection', 'Pests & cleaning', 12, 3, 'Early detection is far cheaper than repairing damage.', { pro: true }),
  T('deep-clean', 'Deep clean', 'Pests & cleaning', 12, 3, 'Baseboards, vents, windows, behind appliances and other areas that get skipped.'),
  T('carpet-clean', 'Deep clean carpets and upholstery', 'Pests & cleaning', 12, 4, 'Pets and daily traffic grind in dirt that vacuuming alone cannot remove.', { requires: ['pets'] }),
];

export const TEMPLATE_KEYS = new Set(TEMPLATES.map((t) => t.key));

const SEASONS = ['winter', 'spring', 'summer', 'fall'];
const seasonOf = (month) => SEASONS[[0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 0][month - 1]];

/** Months from `from` (1-12) until the next occurrence of `month`; 0 means this month. */
const monthsUntil = (month, from) => (month - from + 12) % 12;

/**
 * Templates annotated for one home: applicable (features match), already added, and how soon
 * the typical service month is. Applicable, not-yet-added items sort first, soonest first.
 */
export function suggestions({ features = [], addedKeys = new Set(), todayStr = todayFn() } = {}) {
  const have = new Set(features);
  const nowMonth = Number(todayStr.slice(5, 7));
  const out = TEMPLATES.map((t) => {
    const until = monthsUntil(t.month, nowMonth);
    return {
      ...t,
      season: seasonOf(t.month),
      applicable: t.requires.every((f) => have.has(f)),
      added: addedKeys.has(t.key),
      months_until: until,
      in_season: until <= 1,
    };
  });
  return out.sort((a, b) =>
    (b.applicable - a.applicable) || (a.added - b.added) || (a.months_until - b.months_until) || a.name.localeCompare(b.name));
}
