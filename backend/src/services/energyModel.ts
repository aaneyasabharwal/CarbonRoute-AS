/**
 * Energy assumption used to turn carbon intensity into estimated emissions (prototype).
 *
 * Power = 0.125 kW per requested vCPU, minimum 0.1 kW. This is an ASSUMPTION, not a
 * measurement; every emissions figure derived from it is labelled "assumed energy".
 * Shared by the scheduling engine and the workflow so both use exactly the same numbers.
 */
export const KW_PER_VCPU = 0.125;
export const MIN_POWER_KW = 0.1;

export function energyAssumption(cpu: number, durationHours: number) {
  const vcpu = Number(cpu) > 0 ? Number(cpu) : 2;
  const powerKw = Math.max(MIN_POWER_KW, Number((vcpu * KW_PER_VCPU).toFixed(3)));
  return {
    powerKw,
    energyKwh: Number((durationHours * powerKw).toFixed(3)),
    basis: 'Assumption: 0.125 kW per requested vCPU (minimum 0.1 kW). Not measured.',
  };
}
