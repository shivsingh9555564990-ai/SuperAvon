import express, { Request, Response } from 'express';
import { createServer as createViteServer } from 'vite';
import { execFile, spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import http from 'http';

const PROXY_URL = 'http://rtyuaqpo:td3dikicwexn@198.23.243.226:6361';
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const PYTHON_PORT = 8081;
const isProduction = process.env.NODE_ENV === 'production';

let pythonProcess: any = null;

// Function to start the original Python script gemini_web2api.py
function startPythonScript() {
  const scriptPath = path.resolve(__dirname, 'gemini_web2api.py');
  const configPath = path.resolve(__dirname, 'config.json');

  console.log(`Starting original Python script: ${scriptPath} with config ${configPath}`);

  pythonProcess = spawn('python3', [scriptPath, '--port', String(PYTHON_PORT), '--config', configPath], {
    cwd: __dirname,
    env: {
      ...process.env,
      HTTP_PROXY: PROXY_URL,
      HTTPS_PROXY: PROXY_URL,
      http_proxy: PROXY_URL,
      https_proxy: PROXY_URL,
    },
    stdio: 'pipe',
  });

  pythonProcess.stdout?.on('data', (data: Buffer) => {
    console.log(`[Python gemini_web2api] ${data.toString().trim()}`);
  });

  pythonProcess.stderr?.on('data', (data: Buffer) => {
    console.error(`[Python gemini_web2api] ${data.toString().trim()}`);
  });

  pythonProcess.on('exit', (code: number) => {
    console.log(`Python process exited with code ${code}. Restarting in 3s...`);
    setTimeout(startPythonScript, 3000);
  });
}

// Helper to forward HTTP requests directly to Python script on port 8081
function forwardToPython(
  targetPath: string,
  method: string,
  headers: Record<string, string | string[] | undefined>,
  bodyData: any,
  clientRes: Response
) {
  const payload = bodyData ? JSON.stringify(bodyData) : null;
  const forwardHeaders: Record<string, string> = {
    'content-type': 'application/json',
  };

  if (payload) {
    forwardHeaders['content-length'] = String(Buffer.byteLength(payload));
  }

  const reqOptions: http.RequestOptions = {
    hostname: '127.0.0.1',
    port: PYTHON_PORT,
    path: targetPath,
    method: method,
    headers: forwardHeaders,
    timeout: 180000,
  };

  const pyReq = http.request(reqOptions, (pyRes) => {
    clientRes.status(pyRes.statusCode || 200);
    Object.entries(pyRes.headers).forEach(([k, v]) => {
      if (v !== undefined) {
        clientRes.setHeader(k, v);
      }
    });
    pyRes.pipe(clientRes);
  });

  pyReq.on('error', (err) => {
    console.error('Error forwarding to Python script:', err);
    if (!clientRes.headersSent) {
      clientRes.status(502).json({
        error: `Python script (gemini_web2api.py) communication failed: ${err.message}`,
      });
    }
  });

  if (payload) {
    pyReq.write(payload);
  }
  pyReq.end();
}

async function startServer() {
  // Start the pure Python script
  startPythonScript();

  const app = express();
  app.use(express.json({ limit: '15mb' }));

  // Live Proxy Check endpoint
  app.get('/api/proxy-status', (req: Request, res: Response) => {
    execFile(
      'curl',
      ['--proxy', PROXY_URL, '--max-time', '6', 'https://ipv4.webshare.io/'],
      (error, stdout) => {
        if (error) {
          return res.json({
            active: false,
            proxy: PROXY_URL,
            error: error.message || 'Connection timed out',
            ip: null,
          });
        }
        const detectedIp = stdout.trim();
        return res.json({
          active: true,
          proxy: PROXY_URL,
          ip: detectedIp,
          status: 'Online & Routing Traffic',
          provider: 'Webshare Proxies',
        });
      }
    );
  });

  // Get server configuration
  app.get('/api/config', (req: Request, res: Response) => {
    try {
      const cfgPath = path.resolve(__dirname, 'config.json');
      if (fs.existsSync(cfgPath)) {
        const data = fs.readFileSync(cfgPath, 'utf8');
        return res.json(JSON.parse(data));
      }
    } catch {
      // Fallback
    }
    return res.json({
      port: PYTHON_PORT,
      proxy: PROXY_URL,
      default_model: 'gemini-3.7-flash',
      api_keys: [],
    });
  });

  // Native chat endpoint -> FORWARDS 100% TO PYTHON SCRIPT (Zero Google GenAI SDK)
  app.post('/api/chat', (req: Request, res: Response) => {
    const { message, model } = req.body;
    const targetModel = model || 'gemini-3.7-flash';

    // Prepare OpenAI format payload for gemini_web2api.py
    const payload = {
      model: targetModel,
      stream: false,
      messages: [
        {
          role: 'user',
          content: message || '',
        },
      ],
    };

    const payloadStr = JSON.stringify(payload);
    const reqOptions: http.RequestOptions = {
      hostname: '127.0.0.1',
      port: PYTHON_PORT,
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': String(Buffer.byteLength(payloadStr)),
      },
      timeout: 180000,
    };

    const pyReq = http.request(reqOptions, (pyRes) => {
      let body = '';
      pyRes.on('data', (chunk) => {
        body += chunk;
      });
      pyRes.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          if (pyRes.statusCode && pyRes.statusCode >= 400) {
            return res.status(pyRes.statusCode).json({
              success: false,
              error: parsed.error?.message || parsed.error || body,
            });
          }
          const text = parsed.choices?.[0]?.message?.content || '';
          return res.json({
            success: true,
            model: targetModel,
            proxy: PROXY_URL,
            text,
          });
        } catch {
          return res.json({
            success: true,
            model: targetModel,
            proxy: PROXY_URL,
            text: body,
          });
        }
      });
    });

    pyReq.on('error', (err) => {
      return res.status(502).json({
        success: false,
        error: `Python gemini_web2api.py unreachable: ${err.message}`,
      });
    });

    pyReq.write(payloadStr);
    pyReq.end();
  });

  // OpenAI-compatible /v1/models endpoint -> forward directly to Python script
  app.get('/v1/models', (req: Request, res: Response) => {
    forwardToPython('/v1/models', 'GET', req.headers, null, res);
  });

  // OpenAI-compatible /v1/chat/completions endpoint -> forward directly to Python script
  app.post('/v1/chat/completions', (req: Request, res: Response) => {
    forwardToPython('/v1/chat/completions', 'POST', req.headers, req.body, res);
  });

  // Vite middlewares for frontend UI
  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (req: Request, res: Response) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 gemini-web2api gateway listening on http://0.0.0.0:${PORT}`);
    console.log(`🐍 Pure Python script listening on http://127.0.0.1:${PYTHON_PORT}`);
    console.log(`🔒 Active Outbound Proxy: ${PROXY_URL}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
