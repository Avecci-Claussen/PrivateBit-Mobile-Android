// Order matters: the chrome.* shim first, then the shared background, then the screens.
import "./shim/install.ts";
import "../shared/src/background.ts";
import "./mobile.css";
import "./inline.css";
import "./mobile.ts";
