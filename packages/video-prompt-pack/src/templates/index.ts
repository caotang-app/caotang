/**
 * The closed set of vendor templates in this version (video-prompt-pack.md §5).
 * A new vendor is a spec change with fixtures, never a runtime registration.
 */

import type { VideoVendorTemplate } from '../template.js';

import { KLING_2_6 } from './kling.js';
import { RUNWAY_GEN4 } from './runway.js';
import { SEEDANCE_2_5 } from './seedance.js';
import { SORA_2 } from './sora.js';
import { VEO_3_1 } from './veo.js';
import { WAN_2_6 } from './wan.js';

/** The six templates, in the order the spec lists them. The order is the order a picker shows. */
export const VIDEO_TEMPLATES: readonly VideoVendorTemplate[] = [RUNWAY_GEN4, VEO_3_1, KLING_2_6, SORA_2, WAN_2_6, SEEDANCE_2_5];

/** The template ids, for a "which templates are installed" message. */
export const VIDEO_TEMPLATE_IDS: readonly string[] = VIDEO_TEMPLATES.map((template) => template.id);

/** The template with this id, or undefined. A caller turns undefined into the installed-list message. */
export function templateById(id: string): VideoVendorTemplate | undefined {
  return VIDEO_TEMPLATES.find((template) => template.id === id);
}
