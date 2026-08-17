/**
 * Installs the Temporal global for this suite.
 *
 * Node does not ship `Temporal`, and the Temporal-backed PostgreSQL codecs read it off the global
 * rather than importing it — a runtime import would ship a polyfill to every consumer. Any suite
 * that decodes a temporal column therefore has to provide it, exactly as a deployment would.
 *
 * The `full` build rather than the default: the default omits non-ISO calendars, which the
 * calendar-rejection coverage needs in order to have something to reject.
 */
import 'temporal-polyfill/full/global';
