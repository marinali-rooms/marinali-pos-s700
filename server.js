const express = require('express');
const Stripe = require('stripe');
const path = require('path');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_tua_chiave');
const READER_ID = process.env.STRIPE_READER_ID || 'tmr_tuo_reader_id';

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Struttura dati in memoria
let suites = {
  "1": { name: "Suite 1", amount: 0, expiresAt: null },
  "2": { name: "Suite 2", amount: 0, expiresAt: null },
  "3": { name: "Suite 3", amount: 0, expiresAt: null },
  "4": { name: "Suite 4", amount: 0, expiresAt: null }
};

// Controllo scadenze TTL
function checkExpirations() {
  const now = new Date();
  Object.keys(suites).forEach(id => {
    if (suites[id].expiresAt && new Date(suites[id].expiresAt) < now) {
      console.log(`[TTL EXPIRED] Addebito per ${suites[id].name} scaduto.`);
      suites[id].amount = 0;
      suites[id].expiresAt = null;
    }
  });
}

// API: Ritorna lo stato delle suite (incluso l'importo per la gestione Admin)
app.get('/api/suites', (req, res) => {
  checkExpirations();
  res.json(suites);
});

// API ADMIN: Imposta importo + giorni di validità (da 1 a 9 giorni)
app.post('/api/admin/set-amount', (req, res) => {
  const { suiteId, amount, daysValid = 1 } = req.body;

  if (!suites[suiteId]) {
    return res.status(400).json({ error: "Suite non valida" });
  }

  const parsedAmount = parseFloat(amount) || 0;
  const days = Math.min(Math.max(parseInt(daysValid, 10) || 1, 1), 9);

  suites[suiteId].amount = parsedAmount;

  if (parsedAmount > 0) {
    const expirationDate = new Date();
    expirationDate.setDate(expirationDate.getDate() + days);
    suites[suiteId].expiresAt = expirationDate.toISOString();
  } else {
    suites[suiteId].expiresAt = null;
  }

  console.log(`[ADMIN] ${suites[suiteId].name}: €${parsedAmount} (Validità: ${days} giorni)`);
  res.json({ success: true, suiteName: suites[suiteId].name, amount: parsedAmount, daysValid: days });
});

// API ADMIN: Annulla addebito manualmente (es. contanti)
app.post('/api/admin/clear-amount', (req, res) => {
  const { suiteId } = req.body;

  if (!suites[suiteId]) {
    return res.status(400).json({ error: "Suite non valida" });
  }

  suites[suiteId].amount = 0;
  suites[suiteId].expiresAt = null;

  console.log(`[ADMIN CLEAR] Addebito cancellato per ${suites[suiteId].name}`);
  res.json({ success: true, suiteName: suites[suiteId].name });
});

// API POS: Avvia il pagamento su Stripe S700
app.post('/api/pos/pay', async (req, res) => {
  checkExpirations();
  const { suiteId } = req.body;
  const suite = suites[suiteId];

  if (!suite || suite.amount <= 0) {
    return res.status(400).json({ error: "Nessun conto attivo per questa suite." });
  }

  try {
    const amountInCents = Math.round(suite.amount * 100);

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountInCents,
      currency: 'eur',
      payment_method_types: ['card_present'],
      capture_method: 'automatic',
      metadata: { suite: suite.name, suiteId: suiteId }
    });

    await stripe.terminal.readers.processPaymentIntent(READER_ID, {
      payment_intent: paymentIntent.id,
    });

    res.json({ success: true, amount: suite.amount, paymentIntentId: paymentIntent.id });
  } catch (error) {
    console.error("Errore Stripe Terminal:", error);
    res.status(500).json({ error: error.message });
  }
});

// WEBHOOK: Azzera l'importo a pagamento completato
app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const event = req.body;
  if (event.type === 'payment_intent.succeeded') {
    const paymentIntent = event.data.object;
    const suiteId = paymentIntent.metadata.suiteId;
    if (suiteId && suites[suiteId]) {
      console.log(`[WEBHOOK] Pagamento riuscito per ${suites[suiteId].name}. Reset scheda.`);
      suites[suiteId].amount = 0;
      suites[suiteId].expiresAt = null;
    }
  }
  res.json({ received: true });
});

module.exports = app;

if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Server attivo sulla porta ${PORT}`));
}
