// The shared suite runs scripts by relative path, as it does in its own package.
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
process.chdir(realpathSync(resolve(__dirname, "../shared")));
