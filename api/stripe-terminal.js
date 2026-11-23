import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const { suite, amount, action } = req.body;
  const readerId = process.env.STRIPE_READER_ID;

  if (!readerId) {
    return res.status(500).json({ success: false, message: 'STRIPE_READER_ID non configurato nelle variabili Vercel.' });
  }

  // Azione facoltativa per cancellare manualmente l'operazione sul POS dal tablet
  if (action === 'cancel') {
    try {
      await stripe.terminal.readers.cancelAction(readerId);
      return res.status(200).json({ success: true, message: 'POS Action Canceled' });
    } catch (e) {
      return res.status(200).json({ success: true });
    }
  }

  if (!amount || amount <= 0) {
    return res.status(400).json({ message: 'Invalid amount' });
  }

  try {
    const amountInCents = Math.round(amount * 100);

    // 1. Prima di inviare una nuova transazione, annulla eventuali operazioni pendenti sul POS
    try {
      await stripe.terminal.readers.cancelAction(readerId);
    } catch (e) {
      // Ignora se non c'erano azioni pendenti
    }

    // 2. Crea l'intenzione di pagamento su Stripe
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountInCents,
      currency: 'eur',
      payment_method_types: ['card_present'],
      capture_method: 'automatic',
      description: `Marinali Rooms - ${suite}`
    });

    // 3. Invia l'importo al lettore S700
    await stripe.terminal.readers.processPaymentIntent(readerId, {
      payment_intent: paymentIntent.id
    });

    // 4. Polling con Timeout a 60 secondi (12 tentativi da 5 secondi)
    let attempts = 0;
    const maxAttempts = 12;

    while (attempts < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      attempts++;

      const updatedIntent = await stripe.paymentIntents.retrieve(paymentIntent.id);

      // Riconosce sia 'succeeded' che 'requires_capture' o 'processing' come pagamenti ANDATI A BUON FINE
      if (['succeeded', 'requires_capture', 'processing'].includes(updatedIntent.status)) {
        return res.status(200).json({
          success: true,
          message: 'Payment completed successfully!',
          paymentIntentId: updatedIntent.id
        });
      }

      // Se la carta viene rifiutata o l'operazione viene annullata dall'utente sul lettore
      if (updatedIntent.status === 'canceled') {
        throw new Error('Transaction was canceled on the card reader.');
      }
    }

    // 5. TIMEOUT SCADUTO (60 SECONDI): Annulla l'importo sul POS e rilascia lo schermo dell'S700
    try {
      await stripe.terminal.readers.cancelAction(readerId);
    } catch (e) {}

    return res.status(408).json({
      success: false,
      message: 'Transaction timed out after 60 seconds. Reader reset.'
    });

  } catch (error) {
    console.error('Stripe Terminal Error:', error);
    // In caso di errore, resetta lo schermo del POS
    try {
      await stripe.terminal.readers.cancelAction(readerId);
    } catch (e) {}

    return res.status(500).json({
      success: false,
      message: error.message || 'Error processing payment on Stripe Reader'
    });
  }
}
