import { createServer } from "node:http";
import { createServerConfig } from "./config.js";
import { createReloadSupport } from "./reload.js";
import { createRequestHandler } from "./routes.js";

const config = createServerConfig();
const reload = createReloadSupport(config);
reload.startWatchers();

const server = createServer(createRequestHandler({ ...config, reload }));
server.listen(config.port, () => {
  if (!config.quiet) console.log(`Preview server running at http://localhost:${config.port}/preview/index.html`);
});
