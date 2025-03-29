import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { VercelRequest, VercelResponse } from "@vercel/node";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Logging middleware for API requests
app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

// Register routes and serve static files
(async () => {
  await registerRoutes(app);
  serveStatic(app);
})();

// Error handling middleware
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  const status = err.status || err.statusCode || 500;
  const message = err.message || "Internal Server Error";
  res.status(status).json({ message });
  throw err;
});

// Start the server if this module is the entry point.
// This will ensure that in production (on Render) the app listens on the correct port.
if (require.main === module) {
  (async () => {
    // Optionally, you could conditionally setup Vite for development here.
    if (process.env.NODE_ENV !== "production") {
      // If not in production, you might want to set up Vite's middleware.
      // If your registerRoutes returns a server instance, you can use that.
      const server = await registerRoutes(app);
      if (app.get("env") === "development") {
        await setupVite(app, server);
      } else {
        serveStatic(app);
      }
    }

    // Use process.env.PORT, which Render sets, with a fallback for local development.
    const port = process.env.PORT || 5001;
    app.listen(port, () => {
      log(`Server running on http://localhost:${port}`);
    });
  })();
}

// Export for Vercel or other serverless environments.
export default function handler(req: VercelRequest, res: VercelResponse) {
  return app(req as any, res as any);
}
