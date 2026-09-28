/**
 * Clicking the toolbar icon opens the side panel, in whichever window it was
 * clicked. That is all the background does: signing in, refreshing and every
 * request happen in the panel itself.
 */
export default defineBackground(() => {
  void browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});
