import "dotenv/config";
import { buildApp } from "./app.js";
import { env } from "./config/env.js";

const app = await buildApp();
try {
  await app.listen({ host: env.HOST, port: env.PORT });
} catch (error) {
  app.log.error(error);
  await app.close();
  process.exitCode = 1;
}

