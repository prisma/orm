/**
 * Installs the Temporal global for this package's suites.
 *
 * Node does not ship `Temporal` yet, and the Temporal-backed codecs read it off the global rather
 * than importing it — a runtime import would ship the polyfill to every consumer. So the suite that
 * runs them has to provide it, exactly as a deployment would.
 *
 * The `full` build rather than the default one: the default omits non-ISO calendars, and the
 * calendar-rejection tests need a non-ISO value to exist before they can prove it is rejected.
 */
import 'temporal-polyfill/full/global';
