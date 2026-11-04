import { createServer } from 'node:http';
import { parseRegion } from '../src/geo/types.ts';
import { GeoService } from './service.ts';

const service = new GeoService();
const server = createServer(async (req, res) => {
  const respond = (status: number, body: unknown) => {
    if (res.destroyed) return;
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(JSON.stringify(body));
  };
  const controller = new AbortController();
  res.on('close', () => { if (!res.writableEnded) controller.abort(); });
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(540000)]);
  try {
    const host = new URL(`http://${req.headers.host}`).hostname;
    if (!['localhost', '127.0.0.1'].includes(host)) { respond(403, { error: 'Servico apenas local.' }); return; }
    if (req.headers.origin && !['localhost', '127.0.0.1'].includes(new URL(req.headers.origin).hostname)) {
      respond(403, { error: 'Origem nao permitida.' }); return;
    }
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (req.method === 'GET' && url.pathname === '/api/geo/health') {
      respond(200, { ok: true, geocoding: Boolean(process.env.NOMINATIM_URL) }); return;
    }
    if (req.method === 'GET' && url.pathname === '/api/geo/search') {
      respond(200, await service.geocode(url.searchParams.get('q') ?? '', signal)); return;
    }
    const match = url.pathname.match(/^\/api\/geo\/maps\/([a-f0-9]{32})$/);
    if (req.method === 'GET' && match) {
      const city = await service.cache.read(match[1]);
      respond(city ? 200 : 404, city ?? { error: 'Recorte nao encontrado no cache. Gere a regiao novamente.' }); return;
    }
    if (req.method === 'POST' && url.pathname === '/api/geo/maps') {
      if (!req.headers['content-type']?.startsWith('application/json')) { respond(415, { error: 'Use application/json.' }); return; }
      let size = 0;
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 8192) { respond(413, { error: 'Pedido excessivamente grande.' }); return; }
        chunks.push(chunk);
      }
      let region;
      try { region = parseRegion(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (error) { respond(400, { error: error instanceof Error ? error.message : 'Pedido invalido.' }); return; }
      const city = await service.generate(region, signal, url.searchParams.get('refresh') === '1');
      respond(200, { id: city.id, warnings: city.warnings }); return;
    }
    respond(404, { error: 'Endpoint inexistente.' });
  } catch (error) {
    console.error('[geo]', error);
    respond(502, { error: signal.aborted ? 'Operacao cancelada ou tempo limite excedido.' : error instanceof Error ? error.message : 'Falha ao gerar a cidade.' });
  }
});
server.requestTimeout = 550000;
server.listen(8787, '127.0.0.1', () => console.log('Geo service: http://127.0.0.1:8787 (local only)'));
