import { Sex } from 'models/enums';
import { type Strain } from 'models/frontend/Strain/Strain';

/** What a card is being used as in a cross */
export type CrossingRole = 'male' | 'female' | 'self';

const EFFECT_LABEL: Record<CrossingRole, string> = {
  male: 'male crossing defective',
  female: 'female crossing defective',
  self: 'self crossing defective',
};

/**
 * True when a phenotype the card expresses blocks it from `role`: its left
 * (male), right (female) or bottom (self) crossing rectangle is black. The
 * flags are resolved by `Strain.refreshCardInfo`; `ignore` is the settings
 * toggle that lets any cross be forced.
 */
export const isCrossingBlocked = (
  strain: Strain,
  role: CrossingRole,
  ignore = false
): boolean => {
  if (ignore) return false;
  switch (role) {
    case 'male':
      return strain.sex === Sex.Male && strain.maleCrossingDefective === true;
    case 'female':
      return (
        strain.sex === Sex.Hermaphrodite &&
        strain.femaleCrossingDefective === true
      );
    case 'self':
      return (
        strain.sex === Sex.Hermaphrodite &&
        strain.selfCrossingDefective === true
      );
  }
};

/**
 * Why two strains of the same sex cannot be crossed, in terms a student can
 * learn from: hermaphrodites self-fertilize, and mating needs one of each sex.
 */
export const sameSexMessage = (sex: Sex): string =>
  sex === Sex.Male
    ? "Two males can't mate. Use a hermaphrodite."
    : "Hermaphrodites self-fertilize, so two can't mate. Use a male.";

/** A plain sentence for a blocked cross, or undefined when `role` is allowed */
export const crossingBlockMessage = (
  strain: Strain,
  role: CrossingRole,
  ignore = false
): string | undefined => {
  if (!isCrossingBlocked(strain, role, ignore)) return undefined;
  const who = strain.name !== '' ? strain.name : 'This strain';
  const what =
    role === 'self'
      ? 'self'
      : role === 'female'
      ? 'be the hermaphrodite parent of a cross'
      : 'be the male parent of a cross';
  return `${who} cannot ${what}: a phenotype it expresses makes it ${EFFECT_LABEL[role]}. Turn on "Ignore crossing effects" in Settings to cross anyway.`;
};

/**
 * A plain sentence when `strain` cannot start a mated cross at all (a
 * hermaphrodite that cannot be the mother, or a male that cannot be the
 * father), so the Cross drawer should not open; undefined when it can.
 */
export const crossingStartMessage = (
  strain: Strain,
  ignore = false
): string | undefined =>
  crossingBlockMessage(
    strain,
    strain.sex === Sex.Male ? 'male' : 'female',
    ignore
  );

/** The tooltip on a black crossing rectangle */
export const blockedHandleTitle = (role: CrossingRole): string =>
  `Blocked by a phenotype: ${EFFECT_LABEL[role]}`;

/** A cross refused because of a crossing effect; its message is already plain */
export class CrossingBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CrossingBlockedError';
  }
}
