import "dotenv/config";
import { buildApp } from "./app.js";
import { env } from "./config/env.js";
import { cleanupStaleTemporaryImages } from "./modules/analyses/temp-image.js";

await cleanupStaleTemporaryImages();
const tempCleanupTimer = setInterval(() => {
  void cleanupStaleTemporaryImages().catch((error) => console.error("Falha ao limpar imagens temporárias", error));
}, 15 * 60 * 1000);
tempCleanupTimer.unref();
const app = await buildApp();
app.addHook("onClose", async () => clearInterval(tempCleanupTimer));
try {
  await app.listen({ host: env.HOST, port: env.PORT });
} catch (error) {
  app.log.error(error);
  await app.close();
  process.exitCode = 1;
}

