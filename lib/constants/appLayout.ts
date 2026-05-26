/** Space reserved above the root tab bar (`App.tsx` `screenContainer` padding). */
export const ROOT_TAB_BAR_RESERVED_HEIGHT = 78;

/** Top corner radius on the floating root tab bar. */
export const ROOT_TAB_BAR_TOP_RADIUS = 16;

/** Gap between the root tab bar and the language switch overlay. */
export const GLOBAL_LANGUAGE_SWITCH_TAB_GAP = 8;

/** `bottom` offset for `GlobalLanguageSwitch` (above the tab bar). */
export const GLOBAL_LANGUAGE_SWITCH_BOTTOM_OFFSET =
  ROOT_TAB_BAR_RESERVED_HEIGHT + GLOBAL_LANGUAGE_SWITCH_TAB_GAP;

/** Extra host lift (px) — keeps selection boxes above the tab bar. */
export const GLOBAL_LANGUAGE_SWITCH_HOST_LIFT = 8;

/** Background extension below the track into the tab-bar gap (px). */
export const GLOBAL_LANGUAGE_SWITCH_TRACK_EXTENSION =
  GLOBAL_LANGUAGE_SWITCH_TAB_GAP + GLOBAL_LANGUAGE_SWITCH_HOST_LIFT;
