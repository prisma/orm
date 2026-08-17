/**
 * Installs the Temporal global for this package's suites.
 *
 * Node does not ship `Temporal` yet, and the Temporal-backed PostgreSQL codecs read it off the
 * global rather than importing it — a runtime import would ship the polyfill to every consumer. So
 * the suite that exercises them has to provide it, exactly as a deployment would.
 *
 * The `full` build rather than the default one: the default omits non-ISO calendars, which the
 * calendar-rejection coverage needs in order to have something to reject.
 */
import 'temporal-polyfill/full/global';
