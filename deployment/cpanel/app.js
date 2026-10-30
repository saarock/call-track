const path = require("node:path");
const { pathToFileURL } = require("node:url");
process.env.NODE_ENV = process.env.NODE_ENV || "production";
process.env.WEB_DIRECTORY =
  process.env.WEB_DIRECTORY || path.join(__dirname, "web");
process.env.CALLTRACK_RELEASE_DIR =
  process.env.CALLTRACK_RELEASE_DIR || path.join(__dirname, "private-releases");
import(pathToFileURL(path.join(__dirname, "server", "index.js")).href).catch(
  () => {
    console.error(
      "CallTrack failed to start. Check private application logs and configuration.",
    );
    process.exit(1);
  },
);
