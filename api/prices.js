import { Redis } from '@upstash/redis';

// Inizializzazione esplicita con le variabili create da Vercel
const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

const DEFAULT_PRICES = {
  'Suite 1': { price: '', expiresAt: null, days: 1 },
  'Suite 2': { price: '', expiresAt: null, days: 1 },
  'Suite 3': { price: '', expiresAt: null, days: 1 },
  'Suite 4': { price: '', expiresAt: null, days: 1 }
};

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  if (req.method === 'GET') {
    try {
      let prices = await redis.get('marinali_prices');
      if (!prices) {
        prices = DEFAULT_PRICES;
        await redis.set('marinali_prices', prices);
      }

      // Filtra prezzi scaduti
      const now = Date.now();
      let changed = false;
      for (const suite of Object.keys(prices)) {
        if (prices[suite]?.expiresAt && now > prices[suite].expiresAt) {
          prices[suite] = { price: '', expiresAt: null, days: 1 };
          changed = true;
        }
      }
      if (changed) await redis.set('marinali_prices', prices);

      return res.status(200).json(prices);
    } catch (e) {
      console.error('Redis read error:', e);
      return res.status(500).json({ error: 'Errore lettura prezzi' });
    }
  }

  if (req.method === 'POST') {
    try {
      const { prices } = req.body;
      if (!prices || typeof prices !== 'object') {
        return res.status(400).json({ error: 'Body deve essere { prices: {...} }' });
      }
      await redis.set('marinali_prices', prices);
      return res.status(200).json({ success: true, prices });
    } catch (e) {
      console.error('Redis write error:', e);
      return res.status(500).json({ error: 'Errore scrittura prezzi' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}