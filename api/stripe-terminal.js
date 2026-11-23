import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const { suite, amount } = req.body;

  if (!amount || amount <= 0) {
    return res.status(400).json({ message: 'Invalid amount' });
  }

  try {
    const amountInCents = Math.round(amount * 100);
    const readerId = process.env.STRIPE_READER_ID;

    if (!readerId) {
      throw new Error('STRIPE_READER_ID non configurato nelle variabili Vercel.');
    }

    // 1. Crea il Payment Intent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountInCents,
      currency: 'eur',
      payment_method_types: ['card_present'],
      capture_method: 'automatic',
      description: `Marinali Rooms - ${suite}`
    });

    // 2. Invia l'importo al lettore S700
    await stripe.terminal.readers.processPaymentIntent(readerId, {
      payment_intent: paymentIntent.id
    });

    // 3. POLLING/ATTESA: Interroga Stripe finché l'ospite non passa la carta sul lettore (max 45 secondi)
    let completed = false;
    let attempts = 0;
    const maxAttempts = 15; // 15 tentativi ogni 3 secondi = 45 secondi di timeout

    while (!completed && attempts < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      attempts++;

      const updatedIntent = await stripe.paymentIntents.retrieve(paymentIntent.id);

      // Se la carta è stata strisciata/avvicinata con successo
      if (updatedIntent.status === 'succeeded') {
        completed = true;
        return res.status(200).json({
          success: true,
          message: 'Payment completed successfully!',
          paymentIntentId: updatedIntent.id
        });
      }

      // Se il pagamento sul lettore è stato annullato o fallito
      if (updatedIntent.status === 'canceled' || updatedIntent.status === 'requires_payment_method') {
        if (attempts > 2 && updatedIntent.status === 'requires_payment_method') {
          // Il lettore ha rifiutato la carta
          throw new Error('Payment was declined or canceled on the reader.');
        }
      }
    }

    // Se scadono i 45 secondi senza passaggio di carta, annulla la transazione sul POS
    await stripe.terminal.readers.cancelAction(readerId);
    return res.status(408).json({
      success: false,
      message: 'Transaction timed out. Please try again.'
    });

  } catch (error) {
    console.error('Stripe Terminal Error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Error processing payment on Stripe Reader'
    });
  }
}
