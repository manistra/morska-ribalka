// Statistics are disabled: this copy sends nothing to Google Analytics.
// The Stats interface is kept so that calls in app.js and screens.js do not break.
const Stats = {
  init() {},
  isOn() { return false; },
  set() {},
  screen() {},
  event() {}
};
