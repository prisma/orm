/**
 * An ISO 8601 duration: `P`, then years, months and days, then `T` and hours, minutes and seconds. Each component is optional, but at least one follows `P` and at least one follows `T`. Each component may carry a minus sign, and seconds may have a fraction. Weeks are not read.
 */
export const ISO_DURATION =
  /^P(?!$)(-?\d+Y)?(-?\d+M)?(-?\d+D)?(?:T(?!$)(-?\d+H)?(-?\d+M)?(-?\d+(?:\.\d+)?S)?)?$/;
