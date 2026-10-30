/**
 * An ISO 8601 duration: `P`, then years, months and days, then `T` and hours, minutes and seconds. Each component is optional, but at least one follows `P` and at least one follows `T`. Each component may carry a minus sign, and seconds may have a fraction. Weeks are not read.
 */
export const ISO_DURATION =
  /^P(?!$)(-?\d+Y)?(-?\d+M)?(-?\d+D)?(?:T(?!$)(-?\d+H)?(-?\d+M)?(-?\d+(?:\.\d+)?S)?)?$/;

const UNSIGNED_DATE_PART = String.raw`(\d+Y)?(\d+M)?(\d+W)?(\d+D)?`;
const UNSIGNED_TIME_PART = String.raw`(?:T(?!$)(\d+H)?(\d+M)?(\d+(?:\.\d+)?S)?)?`;
const COMPONENT_SIGNED = String.raw`P(?!$)(-?\d+Y)?(-?\d+M)?(-?\d+W)?(-?\d+D)?(?:T(?!$)(-?\d+H)?(-?\d+M)?(-?\d+(?:\.\d+)?S)?)?`;

/**
 * An ISO 8601 duration in the forms its writers produce: what `Temporal.Duration#toString()` writes, with one sign before `P` and weeks, as in `-P1W2D`, and what {@link ISO_DURATION} matches, with a sign on each component. A sign before `P` and another on a component is refused.
 */
export const ISO_DURATION_AS_WRITTEN = new RegExp(
  `^(?:[+-]P(?!$)${UNSIGNED_DATE_PART}${UNSIGNED_TIME_PART}|${COMPONENT_SIGNED})$`,
);
