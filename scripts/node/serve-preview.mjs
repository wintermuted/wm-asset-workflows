import { createServer } from "node:http";
import { createServerConfig } from "./preview-server/config.mjs";
import { createReloadSupport } from "./preview-server/reload.mjs";
import { createRequestHandler } from "./preview-server/routes.mjs";

const config = createServerConfig();
const reload = createReloadSupport(config);
reload.startWatchers();

const server = createServer(createRequestHandler({ ...config, reload }));
server.listen(config.port, () => {
  if (!config.quiet) console.log(`Preview server running at http://localhost:${config.port}/preview/index.html`);
});
