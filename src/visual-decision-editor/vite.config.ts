import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [
        react(),
        {
            name: 'auto-save-plugin',
            configureServer(server) {
                server.middlewares.use(async (req, res, next) => {
                    if (req.url === '/api/save' && req.method === 'POST') {
                        let body = '';
                        req.on('data', chunk => { body += chunk.toString(); });
                        req.on('end', () => {
                            try {
                                const data = JSON.parse(body);
                                const rootDir = process.cwd();
                                
                                // Save internal state for editor restoration
                                const statePath = path.resolve(rootDir, 'save_data.json');
                                fs.writeFileSync(statePath, JSON.stringify(data, null, 2));
                                
                                // If YAML content is provided, save it directly to the robot config
                                if (data.yamlContent) {
                                    const yamlPath = path.resolve(rootDir, '../decision_executor/config/decision_config.yaml');
                                    // Ensure directory exists
                                    const yamlDir = path.dirname(yamlPath);
                                    if (!fs.existsSync(yamlDir)) fs.mkdirSync(yamlDir, { recursive: true });
                                    fs.writeFileSync(yamlPath, data.yamlContent);
                                }
                                
                                res.statusCode = 200;
                                res.end(JSON.stringify({ success: true }));
                            } catch (err) {
                                res.statusCode = 500;
                                res.end(JSON.stringify({ error: (err as Error).message }));
                            }
                        });
                        return;
                    }
                    if (req.url === '/api/load' && req.method === 'GET') {
                        try {
                            const savePath = path.resolve(process.cwd(), 'save_data.json');
                            if (fs.existsSync(savePath)) {
                                const data = fs.readFileSync(savePath, 'utf-8');
                                res.statusCode = 200;
                                res.setHeader('Content-Type', 'application/json');
                                res.end(data);
                            } else {
                                res.statusCode = 404;
                                res.end(JSON.stringify({ error: 'No save found' }));
                            }
                        } catch (err) {
                            res.statusCode = 500;
                            res.end(JSON.stringify({ error: (err as Error).message }));
                        }
                        return;
                    }
                    next();
                });
            }
        }
    ],
    server: {
        port: 5173,
        host: true
    }
})
